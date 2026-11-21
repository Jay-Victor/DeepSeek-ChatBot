package com.deepseekchatbot

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.util.Locale

/**
 * 自定义背景的媒体存储：
 * - SAF 选择后复制到 filesDir/background/，图片与视频各保留一份
 * - 通过 shouldInterceptRequest 以 https://appassets.androidplatform.net/userbg/<name> 提供，
 *   并实现 Range（206），视频循环 / seek 才稳定
 * - 不新增系统权限，ACTION_OPEN_DOCUMENT 自带读授权
 */
class BackgroundStore(private val context: Context) {

    private val directory = File(context.filesDir, "background").apply { mkdirs() }
    private val prefs = context.getSharedPreferences("background", Context.MODE_PRIVATE)

    fun pickIntent(kind: String): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = if (kind == KIND_VIDEO) "video/*" else "image/*"
    }

    /** 页面启动时读取两类背景的 URL / 名称 / 大小；没有文件的类型直接省略 */
    fun info(): JSONObject {
        val result = JSONObject()
        imageFile()?.let { result.put(KIND_IMAGE, mediaJson(KIND_IMAGE, it)) }
        videoFile()?.let { result.put(KIND_VIDEO, mediaJson(KIND_VIDEO, it)) }
        return result
    }

    /** 复制选中的媒体；返回 {ok, kind, media} 或 {ok:false, kind, error} */
    fun save(kind: String, uri: Uri): JSONObject {
        val expected = if (kind == KIND_VIDEO) "video/" else "image/"
        val resolver = context.contentResolver
        val displayName = queryName(uri)
            ?: if (kind == KIND_VIDEO) "background.mp4" else "background.jpg"
        val declared = resolver.getType(uri)?.lowercase(Locale.US)
        val mime = if (declared != null && declared.startsWith(expected)) {
            declared
        } else {
            guessMime(displayName) ?: declared ?: ""
        }
        if (!mime.startsWith(expected)) {
            return failure(kind, "unsupported")
        }
        val extension = extensionFor(mime) ?: return failure(kind, "unsupported")
        val maxBytes = if (kind == KIND_VIDEO) MAX_VIDEO_BYTES else MAX_IMAGE_BYTES
        directory.listFiles()
            ?.filter { it.name.startsWith("tmp_${kind}_") }
            ?.forEach { it.delete() }
        val temp = File(directory, "tmp_${kind}_${System.currentTimeMillis()}.$extension")
        var copied = 0L
        try {
            resolver.openInputStream(uri)?.use { input ->
                temp.outputStream().use { output ->
                    val buffer = ByteArray(256 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) {
                            break
                        }
                        copied += read
                        if (copied > maxBytes) {
                            temp.delete()
                            return failure(kind, "too_large")
                        }
                        output.write(buffer, 0, read)
                    }
                }
            } ?: run {
                temp.delete()
                return failure(kind, "copy_failed")
            }
        } catch (error: Exception) {
            temp.delete()
            return failure(kind, "copy_failed")
        }
        if (copied <= 0L) {
            temp.delete()
            return failure(kind, "copy_failed")
        }
        val destination = File(directory, "bg_${kind}_${System.currentTimeMillis()}.$extension")
        if (!temp.renameTo(destination)) {
            temp.delete()
            return failure(kind, "copy_failed")
        }
        // 只替换同类型旧文件，另一种类型保留，切换图片 / 视频时不用重新选择
        directory.listFiles()?.forEach { file ->
            if (file != destination && file.name.startsWith("bg_${kind}_")) {
                file.delete()
            }
        }
        prefs.edit()
            .putString("name_$kind", displayName)
            .putString("mime_$kind", mime)
            .apply()
        return JSONObject()
            .put("ok", true)
            .put("kind", kind)
            .put("media", mediaJson(kind, destination))
    }

    fun clear(kind: String): Boolean {
        var removed = false
        directory.listFiles()?.forEach { file ->
            if (file.name.startsWith("bg_${kind}_")) {
                removed = file.delete() || removed
            }
        }
        prefs.edit().remove("name_$kind").remove("mime_$kind").apply()
        return removed
    }

    /** 只处理 /userbg/；其它请求返回 null，继续交给 WebViewAssetLoader */
    fun serve(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.host != ASSET_HOST) {
            return null
        }
        val path = url.path ?: return null
        if (!path.startsWith(URL_PREFIX)) {
            return null
        }
        val name = path.removePrefix(URL_PREFIX)
        if (!NAME_PATTERN.matches(name)) {
            return notFound()
        }
        val file = File(directory, name)
        if (!file.isFile) {
            return notFound()
        }
        val mime = mimeForExtension(file.extension)
        val size = file.length()
        val rangeHeader = request.requestHeaders.entries
            .firstOrNull { it.key.equals("Range", ignoreCase = true) }
            ?.value
        var start = 0L
        var end = size - 1
        var partial = false
        if (!rangeHeader.isNullOrBlank() &&
            rangeHeader.startsWith("bytes=") &&
            !rangeHeader.contains(',')
        ) {
            val range = parseRange(rangeHeader, size) ?: return rangeNotSatisfiable(size)
            start = range.first
            end = range.last
            partial = true
        }
        val headers = HashMap<String, String>()
        headers["Accept-Ranges"] = "bytes"
        headers["Cache-Control"] = "public, max-age=31536000, immutable"
        if (partial) {
            headers["Content-Range"] = "bytes $start-$end/$size"
        }
        val status = if (partial) 206 else 200
        val reason = if (partial) "Partial Content" else "OK"
        if (request.method.equals("HEAD", ignoreCase = true)) {
            return WebResourceResponse(
                mime,
                null,
                status,
                reason,
                headers,
                ByteArrayInputStream(ByteArray(0))
            )
        }
        val input = FileInputStream(file)
        // WebView 对带 Range 的拦截响应会自己把流跳过 start，
        // 这里只把流截到 end + 1，避免我们和 WebView 各跳一次导致短读/失败。
        return WebResourceResponse(
            mime,
            null,
            status,
            reason,
            headers,
            LimitedInputStream(input, end + 1)
        )
    }

    private fun mediaJson(kind: String, file: File): JSONObject {
        val name = prefs.getString("name_$kind", null) ?: file.name
        val mime = prefs.getString("mime_$kind", null) ?: mimeForExtension(file.extension)
        return JSONObject()
            .put("url", "$BASE_URL$URL_PREFIX${file.name}")
            .put("name", name)
            .put("size", file.length())
            .put("mime", mime)
    }

    private fun imageFile(): File? = newestFile(KIND_IMAGE)

    private fun videoFile(): File? = newestFile(KIND_VIDEO)

    private fun newestFile(kind: String): File? =
        directory.listFiles()
            ?.filter { it.name.startsWith("bg_${kind}_") }
            ?.maxByOrNull { it.lastModified() }

    private fun queryName(uri: Uri): String? = runCatching {
        context.contentResolver
            .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
    }.getOrNull()

    private fun guessMime(name: String): String? =
        mimeForExtension(name.substringAfterLast('.', ""))

    private fun extensionFor(mime: String): String? = when (mime) {
        "image/jpeg" -> "jpg"
        "image/png" -> "png"
        "image/webp" -> "webp"
        "image/gif" -> "gif"
        "image/svg+xml" -> "svg"
        "image/avif" -> "avif"
        "video/mp4", "video/x-m4v" -> "mp4"
        "video/webm" -> "webm"
        "video/quicktime" -> "mov"
        else -> null
    }

    private fun mimeForExtension(extension: String): String =
        when (extension.lowercase(Locale.US)) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "svg" -> "image/svg+xml"
            "avif" -> "image/avif"
            "mp4", "m4v" -> "video/mp4"
            "webm" -> "video/webm"
            "mov" -> "video/quicktime"
            else -> "application/octet-stream"
        }

    private fun failure(kind: String, error: String): JSONObject =
        JSONObject().put("ok", false).put("kind", kind).put("error", error)

    private fun notFound(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        "utf-8",
        404,
        "Not Found",
        emptyMap(),
        ByteArrayInputStream(ByteArray(0))
    )

    private fun rangeNotSatisfiable(size: Long): WebResourceResponse {
        val headers = HashMap<String, String>()
        headers["Content-Range"] = "bytes */$size"
        headers["Accept-Ranges"] = "bytes"
        return WebResourceResponse(
            "text/plain",
            null,
            416,
            "Range Not Satisfiable",
            headers,
            ByteArrayInputStream(ByteArray(0))
        )
    }

    /** bytes=start-end / bytes=start- / bytes=-suffix；多段或非法返回 null */
    private fun parseRange(header: String, size: Long): LongRange? {
        val spec = header.removePrefix("bytes=").trim()
        val dash = spec.indexOf('-')
        if (dash < 0) {
            return null
        }
        val startText = spec.substring(0, dash).trim()
        val endText = spec.substring(dash + 1).trim()
        var start: Long
        var end: Long
        if (startText.isEmpty()) {
            val suffix = endText.toLongOrNull() ?: return null
            if (suffix <= 0L) {
                return null
            }
            start = (size - suffix).coerceAtLeast(0L)
            end = size - 1
        } else {
            start = startText.toLongOrNull() ?: return null
            end = if (endText.isEmpty()) size - 1 else (endText.toLongOrNull() ?: return null)
            if (end >= size) {
                end = size - 1
            }
        }
        if (start < 0L || start >= size || end < start) {
            return null
        }
        return start..end
    }

    private fun skipFully(input: InputStream, bytes: Long) {
        var remaining = bytes
        while (remaining > 0L) {
            val skipped = input.skip(remaining)
            if (skipped <= 0L) {
                break
            }
            remaining -= skipped
        }
    }

    private class LimitedInputStream(
        input: InputStream,
        private var remaining: Long
    ) : FilterInputStream(input) {

        override fun read(): Int {
            if (remaining <= 0L) {
                return -1
            }
            val value = super.read()
            if (value >= 0) {
                remaining--
            }
            return value
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (remaining <= 0L) {
                return -1
            }
            val count = super.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
            if (count > 0) {
                remaining -= count
            }
            return count
        }

        override fun skip(count: Long): Long {
            val skipped = super.skip(minOf(count, remaining))
            remaining -= skipped
            return skipped
        }

        override fun available(): Int = minOf(super.available().toLong(), remaining).toInt()
    }

    companion object {
        const val KIND_IMAGE = "image"
        const val KIND_VIDEO = "video"
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val URL_PREFIX = "/userbg/"
        private const val BASE_URL = "https://$ASSET_HOST"
        private const val MAX_IMAGE_BYTES = 30L * 1024 * 1024
        private const val MAX_VIDEO_BYTES = 100L * 1024 * 1024
        private val NAME_PATTERN =
            Regex("^bg_(image|video)_\\d+\\.(jpg|jpeg|png|webp|gif|svg|avif|mp4|m4v|webm|mov)$")
    }
}
