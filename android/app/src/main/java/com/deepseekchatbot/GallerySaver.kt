package com.deepseekchatbot

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import java.io.File
import java.io.OutputStream
import java.util.UUID

/**
 * 把页面里的图片写进系统相册（Pictures/DeepSeek ChatBot）。
 *
 * - Android 10+：MediaStore 的 RELATIVE_PATH + IS_PENDING，不需要任何存储权限；
 * - Android 8/9：仍要 WRITE_EXTERNAL_STORAGE，页面会在保存前触发一次运行时授权；
 * - 写入过程中失败或页面中途放弃时删除半成品，避免相册里出现坏图。
 */
class GallerySaver(private val activity: MainActivity) {

    private class Pending(val uri: Uri, val stream: OutputStream)

    /** token -> 正在写入的相册条目 */
    private val pending = HashMap<String, Pending>()

    /** ready：可以直接写；permission：8/9 需要先授权；页面据此决定是否弹权限 */
    fun state(): String {
        if (Build.VERSION.SDK_INT >= 29) {
            return STATE_READY
        }
        val granted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
        ) == PackageManager.PERMISSION_GRANTED
        return if (granted) STATE_READY else STATE_PERMISSION
    }

    fun begin(name: String, mime: String): String? {
        if (state() != STATE_READY) {
            return null
        }
        val resolver = activity.contentResolver
        val type = mime.ifBlank { "image/png" }
        val name = displayName(name, type)
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, type)
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.Images.Media.RELATIVE_PATH, ALBUM_PATH)
                put(MediaStore.Images.Media.IS_PENDING, 1)
            } else {
                // 8/9 没有 RELATIVE_PATH：显式写 DATA，避免 MediaProvider 生成空路径
                @Suppress("DEPRECATION")
                val directory = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_PICTURES
                )
                val album = File(directory, ALBUM_FOLDER)
                if (!album.exists() && !album.mkdirs()) {
                    return null
                }
                put(MediaStore.Images.Media.DATA, uniqueFile(album, name).absolutePath)
            }
        }
        val uri = runCatching {
            resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        }.onFailure { Log.w(TAG, "insert failed", it) }.getOrNull() ?: return null
        val stream = runCatching { resolver.openOutputStream(uri) }
            .onFailure { Log.w(TAG, "open stream failed", it) }
            .getOrNull()
        if (stream == null) {
            runCatching { resolver.delete(uri, null, null) }
            return null
        }
        val token = UUID.randomUUID().toString()
        synchronized(pending) { pending[token] = Pending(uri, stream) }
        return token
    }

    fun chunk(token: String, base64: String): Boolean {
        val entry = synchronized(pending) { pending[token] } ?: return false
        return runCatching {
            entry.stream.write(Base64.decode(base64, Base64.NO_WRAP))
            true
        }.onFailure { Log.w(TAG, "write failed", it) }.getOrDefault(false)
    }

    /** 收尾：成功时把 IS_PENDING 置 0 并保留条目；失败时删除半成品 */
    fun end(token: String, success: Boolean): Boolean {
        val entry = synchronized(pending) { pending.remove(token) } ?: return false
        val closed = runCatching {
            entry.stream.flush()
            entry.stream.close()
            true
        }.getOrDefault(false)
        if (!success || !closed) {
            discard(entry.uri)
            return false
        }
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
            val updated = runCatching {
                activity.contentResolver.update(entry.uri, values, null, null)
            }.getOrDefault(0)
            if (updated <= 0) {
                discard(entry.uri)
                return false
            }
        }
        return true
    }

    /** Activity 销毁时清掉未完成的写入，避免残留隐藏条目 */
    fun destroy() {
        val entries = synchronized(pending) {
            val values = pending.values.toList()
            pending.clear()
            values
        }
        entries.forEach { entry ->
            runCatching { entry.stream.close() }
            discard(entry.uri)
        }
    }

    private fun discard(uri: Uri) {
        runCatching { activity.contentResolver.delete(uri, null, null) }
    }

    private fun displayName(name: String, mime: String): String {
        val cleaned = name.substringAfterLast('/').substringAfterLast('\\').trim()
            .ifBlank { DEFAULT_NAME }
        if (cleaned.contains('.')) {
            return cleaned
        }
        return cleaned + when (mime) {
            "image/jpeg" -> ".jpg"
            "image/png" -> ".png"
            else -> ""
        }
    }

    /** 8/9 直接写公共目录；同名时补序号，避免覆盖上一张 */
    private fun uniqueFile(directory: File, name: String): File {
        var candidate = File(directory, name)
        if (!candidate.exists()) {
            return candidate
        }
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val extension = if (dot > 0) name.substring(dot) else ""
        var index = 1
        while (candidate.exists()) {
            candidate = File(directory, "$base-$index$extension")
            index += 1
        }
        return candidate
    }

    companion object {
        private const val TAG = "DeepSeekGallery"
        private const val ALBUM_PATH = "Pictures/DeepSeek ChatBot"
        private const val ALBUM_FOLDER = "DeepSeek ChatBot"
        private const val DEFAULT_NAME = "DeepSeekChatBot-tip"
        private const val STATE_READY = "ready"
        private const val STATE_PERMISSION = "permission"
    }
}
