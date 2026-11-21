package com.deepseekchatbot

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.util.Base64
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.UUID

/**
 * 附件预览：页面把 Blob 分片交给原生，写入 cache/attachments/<uuid>/<原名>，
 * 再通过 FileProvider 交给系统查看器。WebView 自己打不开 blob: 的 PDF / 图片。
 *
 * 文件只是临时副本，超过 24 小时在下次打开附件时清理；退出应用时关闭未完成的写入流。
 */
class AttachmentOpener(private val activity: Activity) {

    private class Entry(
        val file: File,
        val stream: OutputStream,
        val mime: String
    ) {
        var written = 0L
    }

    /** token -> 正在写入的临时文件 */
    private val entries = HashMap<String, Entry>()

    /** 页面开始传递附件；返回 token，页面按 token 分片写入。size 未知时传 0。 */
    fun begin(name: String, mime: String, size: Long): String? {
        if (size > MAX_BYTES || !isViewable(mime)) {
            return null
        }
        return try {
            val dir = File(activity.cacheDir, DIR_NAME).apply { mkdirs() }
            prune(dir)
            val target = File(File(dir, UUID.randomUUID().toString()).apply { mkdirs() }, sanitize(name))
            val stream = FileOutputStream(target)
            val token = UUID.randomUUID().toString()
            synchronized(entries) { entries[token] = Entry(target, stream, mime) }
            token
        } catch (error: Exception) {
            Log.w(TAG, "cannot create attachment", error)
            null
        }
    }

    /** 写入一个分片；失败时页面会调用 end 收尾。 */
    fun chunk(token: String, base64: String): Boolean {
        val entry = synchronized(entries) { entries[token] } ?: return false
        return try {
            val bytes = Base64.decode(base64, Base64.NO_WRAP)
            entry.written += bytes.size
            if (entry.written > MAX_BYTES) {
                Log.w(TAG, "attachment exceeds ${MAX_BYTES} bytes")
                return false
            }
            entry.stream.write(bytes)
            true
        } catch (error: Exception) {
            Log.w(TAG, "cannot write attachment", error)
            false
        }
    }

    /** 收尾并交给系统查看器；success=false 时只关闭并删除临时文件。 */
    fun end(token: String, success: Boolean): Boolean {
        val entry = synchronized(entries) { entries.remove(token) } ?: return false
        val written = try {
            entry.stream.flush()
            entry.stream.close()
            true
        } catch (error: Exception) {
            Log.w(TAG, "cannot finish attachment", error)
            false
        }
        if (!written || !success) {
            entry.file.delete()
            return false
        }
        val uri = try {
            FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                entry.file
            )
        } catch (error: Exception) {
            Log.w(TAG, "cannot expose attachment", error)
            entry.file.delete()
            return false
        }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, entry.mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = ClipData.newRawUri("", uri)
        }
        return try {
            activity.startActivity(intent)
            true
        } catch (error: Exception) {
            Log.w(TAG, "no viewer for ${entry.mime}", error)
            entry.file.delete()
            false
        }
    }

    /** 退出应用时关闭还没写完的流，避免泄漏文件句柄。 */
    fun destroy() {
        synchronized(entries) {
            entries.values.forEach { entry -> runCatching { entry.stream.close() } }
            entries.clear()
        }
    }

    /** 只接受能交给系统查看器的类型；下载（其他文件）走 SAF 保存桥。 */
    private fun isViewable(mime: String) =
        mime == PDF_MIME || mime.startsWith("image/")

    private fun prune(dir: File) {
        val cutoff = System.currentTimeMillis() - CACHE_TTL_MS
        dir.listFiles()?.forEach { entry ->
            if (entry.lastModified() < cutoff) {
                entry.deleteRecursively()
            }
        }
    }

    /** 去掉路径分隔符并限制文件名长度；扩展名保留，系统查看器与 MIME 仍按页面传入值。 */
    private fun sanitize(name: String): String {
        val base = name.substringAfterLast('/').substringAfterLast('\\').trim()
        val cleaned = base.map { char ->
            if (char.isLetterOrDigit() || char in "._- " || char.code > 127) char else '_'
        }
        return cleaned.joinToString("").take(MAX_NAME_LENGTH).ifBlank { "attachment" }
    }

    companion object {
        private const val TAG = "DeepSeekAttachment"
        private const val DIR_NAME = "attachments"
        private const val PDF_MIME = "application/pdf"
        private const val MAX_BYTES = 100L * 1024 * 1024
        private const val MAX_NAME_LENGTH = 120
        private const val CACHE_TTL_MS = 24L * 60 * 60 * 1000
    }
}
