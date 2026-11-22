/**
 * 本地朗读桥：壳里调用原生系统 TTS（`window.DeepSeekNative.speak`），
 * 浏览器预览里回退到 Web Speech 的 `speechSynthesis`（Android WebView 没有这个 API）。
 *
 * 原生把进度用 `window.__onSpeech({ token, state, error })` 回传；
 * 页面按 token 匹配当前的朗读会话，停止后迟到的回调直接丢弃。
 */
import { useSettings } from '../settings.js'

export type LocalSpeechErrorCode = 'no_engine' | 'no_voice' | 'failed' | 'empty'

export type LocalSpeechEvent = {
  state: 'start' | 'done' | 'error'
  error?: LocalSpeechErrorCode
}

type SpeechBridge = {
  speak?: (text: string, lang: string, rate: number, token: string) => boolean
  stopSpeak?: () => void
}

type SpeechWindow = Window & {
  DeepSeekNative?: SpeechBridge
  speechSynthesis?: SpeechSynthesis
  __onSpeech?: (raw: string) => void
}

const speechWindow = () => window as SpeechWindow

/** token -> 该次朗读的事件回调；停止时整体清空，迟到的事件自然被丢弃 */
const handlers = new Map<string, (event: LocalSpeechEvent) => void>()

const settle = (token: string, event: LocalSpeechEvent) => {
  const handler = handlers.get(token)
  if (event.state !== 'start') {
    handlers.delete(token)
  }
  handler?.(event)
}

/** 原生回调：只接受已知字段，形状不对就忽略 */
speechWindow().__onSpeech = (raw) => {
  let payload: { token?: unknown; state?: unknown; error?: unknown }
  try {
    payload = JSON.parse(raw)
  } catch {
    return
  }
  if (typeof payload.token !== 'string') {
    return
  }
  if (payload.state !== 'start' && payload.state !== 'done' && payload.state !== 'error') {
    return
  }
  const error =
    payload.error === 'no_engine' ||
    payload.error === 'no_voice' ||
    payload.error === 'failed' ||
    payload.error === 'empty'
      ? payload.error
      : undefined
  settle(payload.token, { state: payload.state, error })
}

export const hasNativeSpeech = () => typeof speechWindow().DeepSeekNative?.speak === 'function'

export const hasBrowserSpeech = () => {
  if (typeof window === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
    return false
  }
  return typeof speechWindow().speechSynthesis?.speak === 'function'
}

/** 壳里的原生引擎或浏览器语音合成，任一可用即可本地朗读 */
export const localSpeechAvailable = () => hasNativeSpeech() || hasBrowserSpeech()

/** 语速取设置里的百分数，收口到引擎支持的范围 */
const currentRate = () =>
  Math.min(2, Math.max(0.5, useSettings.getState().localTtsRatePercent / 100))

/** 正文是中文时优先用中文语音：界面语言是英文也不会拿英文引擎念汉字 */
const CJK = /[\u4e00-\u9fff]/

const speechLanguage = (text: string, locale: string) => (CJK.test(text) ? 'zh-CN' : locale)

const browserSpeak = (
  text: string,
  language: string,
  rate: number,
  token: string,
  onEvent: (event: LocalSpeechEvent) => void
): boolean => {
  const synth = speechWindow().speechSynthesis
  if (!synth) {
    return false
  }
  try {
    // 同一个页面里只保留一条朗读
    synth.cancel()
    handlers.set(token, onEvent)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language
    utterance.rate = rate
    utterance.onstart = () => settle(token, { state: 'start' })
    utterance.onend = () => settle(token, { state: 'done' })
    utterance.onerror = (event) => {
      const reason = event.error
      settle(token, {
        state: 'error',
        error:
          reason === 'language-unavailable' || reason === 'voice-unavailable'
            ? 'no_voice'
            : 'failed',
      })
    }
    synth.speak(utterance)
    return true
  } catch {
    handlers.delete(token)
    return false
  }
}

/**
 * 开始本地朗读；返回 false 表示没有可用引擎（页面提示换方式）。
 * 文本应是已经清洗过的纯文本（见 speakableText.ts）。
 */
export const speakLocal = (
  text: string,
  token: string,
  onEvent: (event: LocalSpeechEvent) => void
): boolean => {
  const spoken = text.trim()
  if (!spoken) {
    return false
  }
  const { locale } = useSettings.getState()
  const rate = currentRate()
  const language = speechLanguage(spoken, locale)
  if (hasNativeSpeech()) {
    handlers.set(token, onEvent)
    const accepted = speechWindow().DeepSeekNative?.speak?.(spoken, language, rate, token) === true
    if (!accepted) {
      handlers.delete(token)
    }
    return accepted
  }
  return browserSpeak(spoken, language, rate, token, onEvent)
}

/** 停止本地朗读；已经结束或不存在时为无操作 */
export const stopLocalSpeech = () => {
  handlers.clear()
  if (hasNativeSpeech()) {
    speechWindow().DeepSeekNative?.stopSpeak?.()
    return
  }
  if (hasBrowserSpeech()) {
    speechWindow().speechSynthesis?.cancel()
  }
}
