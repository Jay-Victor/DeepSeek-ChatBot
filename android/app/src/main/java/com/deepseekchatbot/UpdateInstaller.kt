package com.deepseekchatbot

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

/**
 * 应用内更新：从 GitHub Release 下载 APK 到私有 cache/updates，校验字节数、SHA-256、
 * 包名、签名证书与 versionCode 后，通过 FileProvider 交给系统安装器。
 *
 * 只接受本仓库的 HTTPS release 链接；安装未知来源权限由系统设置授予，返回应用后自动继续。
 * 下载线程只在 Activity 存活期间运行，不引入前台服务。
 */
class UpdateInstaller(
    private val activity: Activity,
    private val emit: (JSONObject) -> Unit
) {

    private enum class PendingReason { PERMISSION, READY }

    private data class Pending(val file: File, val id: String, val reason: PendingReason)

    @Volatile
    private var generation = 0

    @Volatile
    private var activeId: String? = null

    @Volatile
    private var resumed = false

    @Volatile
    private var thread: Thread? = null

    @Volatile
    private var pending: Pending? = null

    private var lastProgressAt = 0L

    /** 由页面传入 Release 资产信息；返回请求 id，参数不可用时返回空串 */
    fun start(url: String, version: String, assetName: String, size: String, sha256: String): String {
        if (!isAllowedUrl(url)) {
            return ""
        }
        val expectedSize = size.toLongOrNull()?.takeIf { it > 0 } ?: 0L
        val expectedDigest = if (sha256.isBlank()) null else normalizeDigest(sha256) ?: return ""

        generation += 1
        val currentGeneration = generation
        thread?.interrupt()
        thread = null
        pending = null
        val id = UUID.randomUUID().toString()
        activeId = id
        lastProgressAt = 0L
        val fileName = safeFileName(version)
        val job = Thread {
            download(currentGeneration, id, url, version, fileName, expectedSize, expectedDigest)
        }
        job.name = "update-download"
        thread = job
        job.start()
        Log.d(TAG, "update download started: $version ($expectedSize bytes)")
        return id
    }

    fun cancel(id: String) {
        if (activeId != id) {
            return
        }
        generation += 1
        activeId = null
        pending = null
        thread?.interrupt()
        thread = null
        emitEvent(id, "cancelled")
    }

    fun onResume() {
        resumed = true
        val item = pending ?: return
        pending = null
        if (!item.file.exists()) {
            emitError(item.id, "invalid_apk")
            return
        }
        activeId = item.id
        when (item.reason) {
            PendingReason.PERMISSION -> {
                if (canInstallPackages()) {
                    install(item.file, item.id)
                } else {
                    item.file.delete()
                    emitError(item.id, "permission_denied")
                }
            }
            PendingReason.READY -> installOrRequestPermission(item.file, item.id)
        }
    }

    fun onPause() {
        resumed = false
    }

    fun onDestroy() {
        generation += 1
        activeId = null
        pending = null
        thread?.interrupt()
        thread = null
    }

    private fun download(
        currentGeneration: Int,
        id: String,
        url: String,
        version: String,
        fileName: String,
        expectedSize: Long,
        expectedDigest: String?
    ) {
        var connection: HttpURLConnection? = null
        var part: File? = null
        val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
        val target = File(dir, fileName)
        try {
            if (currentGeneration != generation) {
                return
            }
            dir.listFiles()?.forEach { old -> runCatching { old.delete() } }

            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 15_000
                readTimeout = 60_000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "DeepSeekChatBot/${BuildConfig.VERSION_NAME}")
                setRequestProperty("Accept", "application/octet-stream")
                setRequestProperty("Accept-Encoding", "identity")
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                throw UpdateFailure("http_$status")
            }
            val contentLength = connection.contentLengthLong
            val total = if (contentLength > 0) contentLength else expectedSize
            if (total > MAX_APK_BYTES) {
                throw UpdateFailure("too_large")
            }
            val usable = activity.cacheDir.usableSpace
            if (total > 0 && usable > 0 && usable < total + MIN_FREE_BYTES) {
                throw UpdateFailure("no_space")
            }

            part = File(dir, "$fileName.part")
            target.delete()
            part.delete()
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            emitProgress(currentGeneration, id, 0, total)
            connection.inputStream.use { input ->
                FileOutputStream(part).use { output ->
                    val buffer = ByteArray(BUFFER_SIZE)
                    while (true) {
                        if (currentGeneration != generation || Thread.currentThread().isInterrupted) {
                            throw UpdateCancelled()
                        }
                        val read = input.read(buffer)
                        if (read < 0) {
                            break
                        }
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        received += read
                        if (received > MAX_APK_BYTES) {
                            throw UpdateFailure("too_large")
                        }
                        emitProgress(currentGeneration, id, received, total)
                    }
                }
            }
            if (currentGeneration != generation) {
                throw UpdateCancelled()
            }
            if (expectedSize > 0 && received != expectedSize) {
                throw UpdateFailure("size_mismatch")
            }
            val actualDigest = digest.digest().toHex()
            if (expectedDigest != null && !actualDigest.equals(expectedDigest, ignoreCase = true)) {
                throw UpdateFailure("digest_mismatch")
            }

            if (!part.renameTo(target)) {
                throw UpdateFailure("storage")
            }
            part = null
            emitEvent(id, "verifying")
            verifyPackage(target, version)
            Log.d(TAG, "update verified: $fileName ($received bytes)")

            if (currentGeneration != generation) {
                return
            }
            if (!resumed) {
                pending = Pending(target, id, PendingReason.READY)
                emitEvent(id, "ready")
                return
            }
            installOrRequestPermission(target, id)
        } catch (error: UpdateCancelled) {
            part?.delete()
            if (currentGeneration == generation) {
                emitEvent(id, "cancelled")
            }
        } catch (error: UpdateFailure) {
            part?.delete()
            if (currentGeneration == generation) {
                emitError(id, error.code)
            }
        } catch (error: Exception) {
            part?.delete()
            if (currentGeneration == generation) {
                Log.w(TAG, "update download failed", error)
                emitError(id, "network")
            }
        } finally {
            connection?.disconnect()
            if (thread === Thread.currentThread()) {
                thread = null
            }
        }
    }

    private fun verifyPackage(file: File, expectedVersion: String) {
        val manager = activity.packageManager
        val archive = manager.getPackageArchiveInfo(file.absolutePath, signatureFlags())
            ?: throw UpdateFailure("invalid_apk")
        if (archive.packageName != activity.packageName) {
            throw UpdateFailure("package_mismatch")
        }
        val installed = manager.getPackageInfo(activity.packageName, signatureFlags())
        val archiveSigners = signatureHashes(archive)
        val installedSigners = signatureHashes(installed)
        if (archiveSigners.isEmpty() || archiveSigners != installedSigners) {
            throw UpdateFailure("signature_mismatch")
        }
        if (versionCode(archive) <= versionCode(installed)) {
            throw UpdateFailure("not_newer")
        }
        if (expectedVersion.isNotBlank() && archive.versionName != expectedVersion) {
            throw UpdateFailure("version_mismatch")
        }
    }

    private fun installOrRequestPermission(file: File, id: String) {
        if (!canInstallPackages()) {
            pending = Pending(file, id, PendingReason.PERMISSION)
            emitEvent(id, "permission")
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${activity.packageName}")
            )
            activity.runOnUiThread {
                try {
                    activity.startActivity(intent)
                } catch (error: Exception) {
                    pending = null
                    Log.w(TAG, "no unknown-sources settings", error)
                    emitError(id, "installer_missing")
                }
            }
            return
        }
        install(file, id)
    }

    private fun install(file: File, id: String) {
        activity.runOnUiThread {
            try {
                val uri = FileProvider.getUriForFile(
                    activity,
                    "${activity.packageName}.fileprovider",
                    file
                )
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, APK_MIME)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    clipData = ClipData.newRawUri("", uri)
                }
                activity.startActivity(intent)
                emitEvent(id, "installing")
                Log.d(TAG, "system installer launched for $id")
            } catch (error: Exception) {
                Log.w(TAG, "installer launch failed", error)
                emitError(id, "installer_missing")
            }
        }
    }

    private fun canInstallPackages(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            activity.packageManager.canRequestPackageInstalls()

    private fun emitProgress(currentGeneration: Int, id: String, received: Long, total: Long) {
        if (currentGeneration != generation) {
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (received < total && now - lastProgressAt < PROGRESS_INTERVAL_MS) {
            return
        }
        lastProgressAt = now
        emitEvent(id, "downloading", received, total)
    }

    private fun emitEvent(
        id: String,
        phase: String,
        received: Long? = null,
        total: Long? = null,
        code: String? = null
    ) {
        val payload = JSONObject().put("id", id).put("phase", phase)
        if (received != null) {
            payload.put("received", received)
        }
        if (total != null && total > 0) {
            payload.put("total", total)
        }
        if (code != null) {
            payload.put("code", code)
        }
        emit(payload)
    }

    private fun emitError(id: String, code: String) {
        emitEvent(id, "error", code = code)
    }

    private fun isAllowedUrl(value: String): Boolean {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        if (!uri.scheme.equals("https", ignoreCase = true)) {
            return false
        }
        val path = uri.path ?: return false
        return when {
            uri.host.equals("api.github.com", ignoreCase = true) -> API_ASSET_PATH.matches(path)
            uri.host.equals("github.com", ignoreCase = true) ->
                path.startsWith("/$REPO/releases/download/") &&
                    path.endsWith(".apk", ignoreCase = true)
            else -> false
        }
    }

    private fun safeFileName(version: String): String {
        val safe = version
            .filter { it.isLetterOrDigit() || it == '.' || it == '-' || it == '_' }
            .take(32)
        return if (safe.isBlank()) "DeepSeekChatBot-update.apk" else "DeepSeekChatBot-$safe.apk"
    }

    private fun normalizeDigest(value: String): String? {
        val hex = value.trim().removePrefix("sha256:").removePrefix("SHA256:")
        return if (SHA256_PATTERN.matches(hex)) hex.lowercase() else null
    }

    private fun signatureFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }

    @Suppress("DEPRECATION")
    private fun signatureHashes(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners ?: return emptySet()
        } else {
            info.signatures ?: return emptySet()
        }
        return signatures.mapTo(HashSet()) { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).toHex()
        }
    }

    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            info.versionCode.toLong()
        }

    private fun ByteArray.toHex(): String =
        joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private class UpdateFailure(val code: String) : Exception()

    private class UpdateCancelled : Exception()

    private companion object {
        const val TAG = "DeepSeekUpdate"
        const val REPO = "Jay-Victor/DeepSeek-ChatBot"
        const val APK_MIME = "application/vnd.android.package-archive"
        const val BUFFER_SIZE = 64 * 1024
        const val PROGRESS_INTERVAL_MS = 200L
        const val MIN_FREE_BYTES = 50L * 1024 * 1024
        const val MAX_APK_BYTES = 200L * 1024 * 1024
        val SHA256_PATTERN = Regex("^[0-9a-fA-F]{64}$")
        val API_ASSET_PATH = Regex("^/repos/${Regex.escape(REPO)}/releases/assets/\\d+$")
    }
}
