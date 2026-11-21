package com.deepseekchatbot

import android.Manifest
import android.content.ContentUris
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.Size
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.UUID

/**
 * 相册与拍照的数据桥：
 * - 用 MediaStore 列出最近照片，返回缩略图 data URL；
 * - 选中后按 token 分片把原图字节交回页面；
 * - 相机拍完的文件也从这里分片读出。
 *
 * 只读 ContentResolver / 应用私有 cache，不写系统相册。
 */
class MediaBridge(
    private val activity: MainActivity,
    private val emitGallery: (JSONObject) -> Unit
) {

    private class Entry(val stream: InputStream, val file: File? = null)

    /** token -> 正在读取的流 */
    private val entries = HashMap<String, Entry>()
    @Volatile
    private var loadGeneration = 0

    fun hasPermission(): Boolean {
        val context = activity
        return if (android.os.Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) ==
                PackageManager.PERMISSION_GRANTED ||
                (android.os.Build.VERSION.SDK_INT >= 34 &&
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
                    ) == PackageManager.PERMISSION_GRANTED)
        } else {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    fun permissions(): Array<String> = when {
        android.os.Build.VERSION.SDK_INT >= 34 -> arrayOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
        )
        android.os.Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES)
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    /** 后台查询最近照片；权限不足时直接回报 permission */
    fun loadGallery() {
        if (!hasPermission()) {
            emitGallery(JSONObject().put("error", "permission"))
            return
        }
        val generation = ++loadGeneration
        Thread {
            val payload = try {
                queryGallery()
            } catch (error: Exception) {
                Log.w(TAG, "gallery query failed", error)
                JSONObject().put("error", "failed")
            }
            if (generation == loadGeneration) {
                emitGallery(payload)
            }
        }.start()
    }

    /** 打开相册条目的原图，返回读取 token */
    fun openMedia(id: String): String? = runCatching {
        val uri = ContentUris.withAppendedId(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            id.toLong()
        )
        val stream = activity.contentResolver.openInputStream(uri) ?: return null
        register(Entry(stream))
    }.onFailure { Log.w(TAG, "cannot open media $id", it) }.getOrNull()

    /** 打开相机写出的临时文件，返回读取 token */
    fun openFile(file: File): String? = runCatching {
        register(Entry(FileInputStream(file), file))
    }.onFailure { Log.w(TAG, "cannot open camera file", it) }.getOrNull()

    /** 读一个分片；空串表示读完，null 表示失败 */
    fun read(token: String): String? {
        val entry = synchronized(entries) { entries[token] } ?: return null
        val buffer = ByteArray(CHUNK)
        val count = try {
            entry.stream.read(buffer)
        } catch (error: Exception) {
            Log.w(TAG, "read media failed", error)
            close(token)
            return null
        }
        if (count < 0) {
            close(token)
            return ""
        }
        return Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)
    }

    fun close(token: String) {
        val entry = synchronized(entries) { entries.remove(token) } ?: return
        runCatching { entry.stream.close() }
        entry.file?.delete()
    }

    fun destroy() {
        synchronized(entries) {
            entries.values.forEach { entry ->
                runCatching { entry.stream.close() }
                entry.file?.delete()
            }
            entries.clear()
        }
    }

    private fun register(entry: Entry): String {
        val token = UUID.randomUUID().toString()
        synchronized(entries) { entries[token] = entry }
        return token
    }

    private fun queryGallery(): JSONObject {
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.SIZE
        )
        val items = JSONArray()
        activity.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            "${MediaStore.Images.Media.DATE_MODIFIED} DESC"
        )?.use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE)
            val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
            var count = 0
            while (count < LIMIT && cursor.moveToNext()) {
                val id = cursor.getLong(idColumn)
                val mime = cursor.getString(mimeColumn) ?: "image/jpeg"
                if (!mime.startsWith("image/")) {
                    continue
                }
                val thumb = thumbnail(id) ?: continue
                items.put(
                    JSONObject()
                        .put("id", id.toString())
                        .put("name", cursor.getString(nameColumn) ?: "photo.jpg")
                        .put("type", mime)
                        .put("size", cursor.getLong(sizeColumn))
                        .put("thumb", thumb)
                )
                count += 1
            }
        }
        return JSONObject().put("items", items)
    }

    private fun thumbnail(id: Long): String? = runCatching {
        val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
        val bitmap: Bitmap? = if (android.os.Build.VERSION.SDK_INT >= 29) {
            activity.contentResolver.loadThumbnail(uri, Size(THUMB_SIZE, THUMB_SIZE), null)
        } else {
            @Suppress("DEPRECATION")
            MediaStore.Images.Thumbnails.getThumbnail(
                activity.contentResolver,
                id,
                MediaStore.Images.Thumbnails.MINI_KIND,
                null
            )
        } ?: return null
        val output = ByteArrayOutputStream()
        val image = bitmap ?: return null
        image.compress(Bitmap.CompressFormat.JPEG, THUMB_QUALITY, output)
        image.recycle()
        "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
    }.onFailure { Log.w(TAG, "thumbnail failed for $id", it) }.getOrNull()

    companion object {
        private const val TAG = "DeepSeekMedia"
        private const val CHUNK = 256 * 1024
        private const val LIMIT = 24
        private const val THUMB_SIZE = 160
        private const val THUMB_QUALITY = 72
    }
}
