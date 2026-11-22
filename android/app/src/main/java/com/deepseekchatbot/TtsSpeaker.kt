package com.deepseekchatbot

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import org.json.JSONObject
import java.util.Locale

/**
 * 本地朗读：把页面推来的纯文本交给系统 TextToSpeech 引擎。
 *
 * - 首次朗读时才创建引擎：init 是异步的，文本先挂起，就绪后自动开读；
 * - 长文本按标点切成小段排队播放，单段不超过 [MAX_CHUNK]（引擎单次上限 4000 字）；
 * - 进度通过 [onEvent] 回传 start / done / error，页面按 token 匹配自己的朗读会话；
 * - 只申请瞬态音频焦点（允许其他声音压低），不起后台服务，切后台时系统继续读完。
 */
class TtsSpeaker(
    private val context: Context,
    private val onEvent: (JSONObject) -> Unit
) {
    private var engine: TextToSpeech? = null
    private var initialized = false
    private var failed = false
    private var initStatus: Int? = null

    /** 引擎就绪 */
    private var ready = false

    /** 引擎还在 init 时先存下要读的正文 */
    private var pending: String? = null

    private var currentToken: String? = null
    private var language = "zh-CN"
    private var rate = 1f

    /** 每次停止/重新开始都自增，用来丢弃上一轮的迟到回调 */
    private var generation = 0
    private var lastIndex = -1

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focusRequest: AudioFocusRequest? = null

    /** 页面调用：返回 false 表示这段文本不值得读（空文本或引擎已确认不可用） */
    fun speak(text: String, lang: String, rate: Float, token: String): Boolean {
        val body = text.trim()
        if (body.isEmpty()) {
            return false
        }
        stopInternal()
        if (failed) {
            emit(token, "error", "no_engine")
            return false
        }
        currentToken = token
        language = lang.ifBlank { "zh-CN" }
        this.rate = rate.coerceIn(MIN_RATE, MAX_RATE)
        if (ready) {
            start(body)
            return true
        }
        pending = body
        if (engine == null) {
            createEngine()
        }
        return true
    }

    fun stop() {
        stopInternal()
    }

    fun destroy() {
        stopInternal()
        engine?.shutdown()
        engine = null
        ready = false
    }

    private fun createEngine() {
        val created = TextToSpeech(context.applicationContext) { status ->
            initStatus = status
            handleInit(status)
        }
        engine = created
        created.setOnUtteranceProgressListener(progressListener)
        // 极端情况下 onInit 可能在赋值前同步回调：补一次，handleInit 自己会去重
        initStatus?.let { handleInit(it) }
    }

    private fun handleInit(status: Int) {
        if (initialized) {
            return
        }
        initialized = true
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "TTS init failed: $status")
            failed = true
            pending = null
            currentToken?.let { emit(it, "error", "no_engine") }
            currentToken = null
            return
        }
        ready = true
        val body = pending
        pending = null
        if (body != null) {
            start(body)
        }
    }

    private fun start(body: String) {
        val tts = engine ?: return
        val token = currentToken ?: return
        if (!applyLanguage(tts)) {
            Log.w(TAG, "no voice for $language")
            currentToken = null
            emit(token, "error", "no_voice")
            return
        }
        tts.setSpeechRate(rate)
        tts.setAudioAttributes(AUDIO_ATTRIBUTES)
        val chunks = split(body)
        if (chunks.isEmpty()) {
            currentToken = null
            emit(token, "error", "empty")
            return
        }
        val gen = generation
        lastIndex = chunks.lastIndex
        requestFocus()
        chunks.forEachIndexed { index, chunk ->
            val id = "$gen:$index"
            val result = tts.speak(
                chunk,
                if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD,
                null,
                id
            )
            if (result != TextToSpeech.SUCCESS) {
                Log.w(TAG, "speak failed at chunk $index")
                stopInternal()
                emit(token, "error", "failed")
                return
            }
        }
    }

    /** 依次尝试页面语言与系统默认语言；都不可用返回 false */
    private fun applyLanguage(tts: TextToSpeech): Boolean {
        val status = tts.setLanguage(localeFor(language))
        if (status != TextToSpeech.LANG_MISSING_DATA && status != TextToSpeech.LANG_NOT_SUPPORTED) {
            return true
        }
        val fallback = tts.setLanguage(Locale.getDefault())
        return fallback != TextToSpeech.LANG_MISSING_DATA &&
            fallback != TextToSpeech.LANG_NOT_SUPPORTED
    }

    private fun localeFor(tag: String): Locale = runCatching {
        Locale.forLanguageTag(tag.replace('_', '-'))
    }.getOrDefault(Locale.getDefault())

    private fun stopInternal() {
        generation += 1
        currentToken = null
        lastIndex = -1
        pending = null
        engine?.stop()
        abandonFocus()
    }

    private fun requestFocus() {
        val request = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(AUDIO_ATTRIBUTES)
            .setOnAudioFocusChangeListener(focusListener)
            .build()
            .also { focusRequest = it }
        audioManager.requestAudioFocus(request)
    }

    private fun abandonFocus() {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    }

    /** 被通话/音乐永久抢占时静默停下，并回到 idle，避免页面一直显示正在朗读 */
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS) {
            val token = currentToken
            stopInternal()
            if (token != null) {
                emit(token, "done")
            }
        }
    }

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            val (gen, _) = parseId(utteranceId) ?: return
            if (gen != generation) {
                return
            }
            currentToken?.let { emit(it, "start") }
        }

        override fun onDone(utteranceId: String?) {
            val (gen, index) = parseId(utteranceId) ?: return
            if (gen != generation || index != lastIndex) {
                return
            }
            val token = currentToken ?: return
            abandonFocus()
            generation += 1
            currentToken = null
            lastIndex = -1
            emit(token, "done")
        }

        /** 旧接口（API 21 以下）仍要求实现；正常路径走带 errorCode 的重载 */
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            Log.w(TAG, "utterance failed (legacy callback)")
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            val (gen, _) = parseId(utteranceId) ?: return
            if (gen != generation) {
                return
            }
            Log.w(TAG, "utterance failed: $errorCode")
            val token = currentToken
            stopInternal()
            if (token != null) {
                // 网络音色但没有离线语音包时引擎报 -7 / -6 / -9：提示去装语音数据，比“失败”更可操作
                val code = when (errorCode) {
                    TextToSpeech.ERROR_NETWORK,
                    TextToSpeech.ERROR_NETWORK_TIMEOUT,
                    TextToSpeech.ERROR_NOT_INSTALLED_YET -> "no_voice"
                    else -> "failed"
                }
                emit(token, "error", code)
            }
        }
    }

    /** utteranceId 形如 `generation:index` */
    private fun parseId(id: String?): Pair<Int, Int>? {
        val parts = id?.split(':') ?: return null
        if (parts.size != 2) {
            return null
        }
        val gen = parts[0].toIntOrNull() ?: return null
        val index = parts[1].toIntOrNull() ?: return null
        return gen to index
    }

    private fun emit(token: String, state: String, error: String? = null) {
        val payload = JSONObject().put("token", token).put("state", state)
        if (error != null) {
            payload.put("error", error)
        }
        onEvent(payload)
    }

    /** 超过上限的正文按标点切成小段；找不到标点就硬切 */
    private fun split(text: String): List<String> {
        if (text.length <= MAX_CHUNK) {
            return listOf(text)
        }
        val chunks = ArrayList<String>(text.length / MAX_CHUNK + 1)
        var start = 0
        while (start < text.length) {
            var end = minOf(start + MAX_CHUNK, text.length)
            if (end < text.length) {
                val cut = text.substring(start, end).lastIndexOfAny(BREAK_CHARS)
                if (cut >= MAX_CHUNK / 3) {
                    end = start + cut + 1
                }
            }
            chunks.add(text.substring(start, end))
            start = end
        }
        return chunks
    }

    companion object {
        private const val TAG = "DeepSeekTts"
        private const val MAX_CHUNK = 600
        private const val MIN_RATE = 0.5f
        private const val MAX_RATE = 2f
        private val BREAK_CHARS = charArrayOf(
            '。', '！', '？', '；', '，', '\n', '.', '!', '?', ';', ','
        )
        private val AUDIO_ATTRIBUTES = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    }
}
