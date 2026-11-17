package com.deepseekchatbot

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import java.io.OutputStream
import java.util.UUID

/**
 * chat-demo 的原生壳：静态包放在 assets/www，通过 WebViewAssetLoader 以
 * https://appassets.androidplatform.net/assets/www/index.html 载入（固定 origin，IndexedDB 与
 * localStorage 才不会丢）。原生只负责页面拿不到的六件事：资产与 origin、麦克风、文件选择、
 * 导出 ZIP、外链、返回键与系统栏。
 */
class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var errorView: TextView? = null

    /** 页面首帧就绪前保持启动图 */
    @Volatile
    private var pageReady = false

    /** 页面上的弹层（设置 / 搜索面板 / 侧边抽屉）是否打开，决定返回键先关弹层还是退出 */
    @Volatile
    private var overlayOpen = false

    private var pendingPermissionRequest: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSaveId: String? = null

    /** 导出 ZIP 的写入流，key 是回传给页面的 token */
    private val saveStreams = HashMap<String, OutputStream>()

    private val micPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingPermissionRequest
            pendingPermissionRequest = null
            if (request == null) {
                return@registerForActivityResult
            }
            if (granted) request.grant(request.resources) else request.deny()
        }

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileCallback
            fileCallback = null
            if (callback == null) {
                return@registerForActivityResult
            }
            val data = result.data
            val clip = data?.clipData
            val uris: Array<Uri> = when {
                clip != null -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                data?.data != null -> arrayOf(data.data!!)
                else -> emptyArray()
            }
            callback.onReceiveValue(if (uris.isEmpty()) null else uris)
        }

    private val createDocumentLauncher =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
            val id = pendingSaveId
            pendingSaveId = null
            if (id == null) {
                return@registerForActivityResult
            }
            val stream = uri?.let { target ->
                runCatching { contentResolver.openOutputStream(target) }.getOrNull()
            }
            if (stream == null) {
                notifySaveToken(id, null)
                return@registerForActivityResult
            }
            val token = UUID.randomUUID().toString()
            synchronized(saveStreams) { saveStreams[token] = stream }
            notifySaveToken(id, token)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        super.onCreate(savedInstanceState)
        splashScreen.setKeepOnScreenCondition { !pageReady }

        WindowCompat.setDecorFitsSystemWindows(window, false)

        root = FrameLayout(this)
        root.setBackgroundColor(ContextCompat.getColor(this, R.color.window_bg))
        setContentView(root)

        webView = createWebView()
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        // 系统栏与输入法都给 WebView 留白：页面用 100dvh 的弹窗（设置、搜索面板）在键盘弹出时
        // 才会跟着缩短，否则底部的「确定」会压在键盘下面。聊天区自身用 visualViewport 跟随键盘，
        // 这里缩短的是 WebView 视口本身，不会和页面逻辑叠加。
        // 注意：WebView 会忽略自身 padding，视口仍是整块 view 的大小；必须给容器留白，
        // 让 WebView 的测量尺寸真正变小（否则页面里的 100dvh / visualViewport 都不会跟着缩）。
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottom = maxOf(bars.bottom, ime.bottom)
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "insets bars=$bars ime=$ime")
            }
            view.setPadding(bars.left, bars.top, bars.right, bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)

        applyBarAppearance(isNightMode())
        webView.loadUrl(INDEX_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (overlayOpen) {
                    webView.evaluateJavascript("window.__closeOverlay && window.__closeOverlay()", null)
                } else {
                    finish()
                }
            }
        })
    }

    override fun onDestroy() {
        synchronized(saveStreams) {
            saveStreams.values.forEach { stream -> runCatching { stream.close() } }
            saveStreams.clear()
        }
        webView.removeJavascriptInterface(BRIDGE_NAME)
        webView.destroy()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val view = WebView(this)
        view.setBackgroundColor(ContextCompat.getColor(this, R.color.window_bg))

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        with(view.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            textZoom = 100
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        view.addJavascriptInterface(WebAppBridge(), BRIDGE_NAME)
        view.webViewClient = createWebViewClient()
        view.webChromeClient = createWebChromeClient()

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        return view
    }

    private fun createWebViewClient() = object : WebViewClient() {
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            val url = request.url
            if (url.host == ASSET_HOST) {
                return false
            }
            openExternally(url)
            return true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            pageReady = true
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            if (!request.isForMainFrame || request.url.host != ASSET_HOST) {
                return
            }
            Log.e(TAG, "asset load failed: ${error.description} ${request.url}")
            showLoadError()
        }
    }

    private fun createWebChromeClient() = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            val audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE
            if (audio !in request.resources) {
                request.deny()
                return
            }
            val granted = ContextCompat.checkSelfPermission(
                this@MainActivity,
                android.Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
            if (granted) {
                request.grant(arrayOf(audio))
            } else {
                pendingPermissionRequest?.deny()
                pendingPermissionRequest = request
                micPermissionLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
            }
        }

        override fun onShowFileChooser(
            view: WebView?,
            callback: ValueCallback<Array<Uri>>?,
            params: FileChooserParams?
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            if (callback == null) {
                return false
            }
            // accept 在页面上是扩展名列表，Android 只认 MIME：能映射的映射，带 "/" 的原样保留
            val mimes = params?.acceptTypes.orEmpty()
                .mapNotNull { type ->
                    when {
                        type.startsWith(".") -> MimeTypeMap.getSingleton()
                            .getMimeTypeFromExtension(type.trimStart('.').lowercase())
                        type.contains("/") -> type
                        else -> null
                    }
                }
                .distinct()
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                if (mimes.isNotEmpty()) {
                    putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
                }
                putExtra(
                    Intent.EXTRA_ALLOW_MULTIPLE,
                    params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                )
            }
            return try {
                fileChooserLauncher.launch(intent)
                true
            } catch (error: ActivityNotFoundException) {
                Log.w(TAG, "no document picker: $error")
                fileCallback = null
                false
            }
        }

        // window.open / target=_blank：交给系统浏览器（Custom Tabs），不在壳里再开一个 WebView 窗口
        override fun onCreateWindow(
            view: WebView?,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: Message?
        ): Boolean {
            val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
            val probe = WebView(this@MainActivity)
            probe.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    openExternally(request.url)
                    probe.post { probe.destroy() }
                    return true
                }
            }
            transport.webView = probe
            resultMsg.sendToTarget()
            // 弹出窗口没被真正 attach（WebView 的常见回退：由主页面自行导航）时也要销毁，
            // 否则每次 window.open 都会泄漏一个空白 WebView
            probe.postDelayed({ runCatching { probe.destroy() } }, PROBE_TIMEOUT_MS)
            return true
        }

        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "console: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
            }
            return true
        }
    }

    private fun openExternally(uri: Uri) {
        if (uri.scheme == "http" || uri.scheme == "https") {
            val launched = runCatching {
                CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .setUrlBarHidingEnabled(true)
                    .build()
                    .launchUrl(this, uri)
            }.isSuccess
            if (launched) {
                return
            }
        }
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            .onFailure { Log.w(TAG, "no activity for $uri") }
    }

    private fun notifySaveToken(id: String, token: String?) {
        val safeId = id.filter { it.isLetterOrDigit() || it == '-' }
        val argument = token?.let { "'$it'" } ?: "null"
        webView.post {
            webView.evaluateJavascript(
                "window.__onSaveToken && window.__onSaveToken('$safeId', $argument)",
                null
            )
        }
    }

    private fun applyTheme(dark: Boolean, background: String) {
        val color = runCatching { Color.parseColor(background) }
            .getOrDefault(ContextCompat.getColor(this, R.color.window_bg))
        root.setBackgroundColor(color)
        webView.setBackgroundColor(color)
        applyBarAppearance(dark)
    }

    private fun applyBarAppearance(dark: Boolean) {
        val controller = WindowInsetsControllerCompat(window, root)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
    }

    private fun isNightMode() =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private fun showLoadError() {
        if (errorView != null) {
            return
        }
        errorView = TextView(this).apply {
            setText(R.string.load_failed)
            gravity = Gravity.CENTER
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_primary))
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.window_bg))
            isClickable = true
            setOnClickListener {
                root.removeView(this)
                errorView = null
                webView.reload()
            }
        }
        root.addView(
            errorView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
    }

    /** 页面通过 window.DeepSeekNative 调用的原生能力，只对本应用自己的 assets 页面开放 */
    inner class WebAppBridge {

        @android.webkit.JavascriptInterface
        fun appVersion(): String = BuildConfig.VERSION_NAME

        @android.webkit.JavascriptInterface
        fun setOverlay(open: Boolean) {
            overlayOpen = open
        }

        @android.webkit.JavascriptInterface
        fun setTheme(dark: Boolean, background: String) {
            runOnUiThread { applyTheme(dark, background) }
        }

        @android.webkit.JavascriptInterface
        fun saveBegin(id: String, name: String) {
            runOnUiThread {
                pendingSaveId = id
                val suggested = name.ifBlank { DEFAULT_EXPORT_NAME }
                val started = runCatching { createDocumentLauncher.launch(suggested) }.isSuccess
                if (!started) {
                    pendingSaveId = null
                    notifySaveToken(id, null)
                }
            }
        }

        @android.webkit.JavascriptInterface
        fun saveChunk(token: String, base64: String): Boolean {
            val stream = synchronized(saveStreams) { saveStreams[token] } ?: return false
            return runCatching {
                stream.write(Base64.decode(base64, Base64.NO_WRAP))
                true
            }.getOrDefault(false)
        }

        @android.webkit.JavascriptInterface
        fun saveEnd(token: String, success: Boolean) {
            val stream = synchronized(saveStreams) { saveStreams.remove(token) } ?: return
            val ok = runCatching {
                stream.flush()
                stream.close()
                true
            }.getOrDefault(false)
            if (success && ok) {
                runOnUiThread {
                    Toast.makeText(
                        this@MainActivity,
                        R.string.export_saved,
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }

        @android.webkit.JavascriptInterface
        fun toast(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    companion object {
        private const val TAG = "DeepSeekWeb"
        private const val BRIDGE_NAME = "DeepSeekNative"
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val INDEX_URL = "https://$ASSET_HOST/assets/www/index.html"
        private const val DEFAULT_EXPORT_NAME = "deepseek-chat-history.zip"
        private const val PROBE_TIMEOUT_MS = 3_000L
    }
}
