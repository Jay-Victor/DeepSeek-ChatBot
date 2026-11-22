import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize, TTS_SAMPLE_RATE } from '../api/speech.js'
import { useSettings, type TtsEngine } from '../settings.js'
import {
  localSpeechAvailable,
  speakLocal,
  stopLocalSpeech,
  type LocalSpeechErrorCode,
} from './localTts.js'
import { toSpeakableText } from './speakableText.js'

/**
 * 朗读：同一时间只读一条回复。两种引擎：
 * - 在线：请求 TTS 的裸 PCM 流，边收边用 AudioContext 按顺序排程播放，首帧到达即出声；
 * - 本地：把清洗后的纯文本交给系统 TextToSpeech（壳里），或在浏览器里用 speechSynthesis。
 * 状态：loading（已请求、未出声）→ playing → 结束回到 idle。
 */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

type ReadAloudState = {
  /** 正在朗读的回复 id */
  messageId: string | null
  status: ReadAloudStatus
}

export const useReadAloud = create<ReadAloudState>(() => ({ messageId: null, status: 'idle' }))

/** 首帧前多缓冲一点，减少网络抖动造成的断续 */
const START_DELAY = 0.1

type RemotePlayback = { kind: 'remote'; controller: AbortController; context: AudioContext }
type LocalPlayback = { kind: 'local'; token: string }
type Playback = RemotePlayback | LocalPlayback

let current: Playback | null = null

/** 本地朗读失败：携带原因码，交给 describeReadAloudError 映射文案 */
type LocalSpeechFailure = { kind: 'local-speech'; code: LocalSpeechErrorCode }

const localSpeechFailure = (code: LocalSpeechErrorCode): LocalSpeechFailure => ({
  kind: 'local-speech',
  code,
})

const isLocalSpeechFailure = (error: unknown): error is LocalSpeechFailure =>
  typeof error === 'object' &&
  error !== null &&
  (error as { kind?: unknown }).kind === 'local-speech' &&
  typeof (error as { code?: unknown }).code === 'string'

const finishRemote = (controller: AbortController) => {
  if (current?.kind !== 'remote' || current.controller !== controller) {
    return
  }
  void current.context.close()
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

const isLocal = (token: string) => current?.kind === 'local' && current.token === token

const finishLocal = (token: string) => {
  if (!isLocal(token)) {
    return
  }
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

/** 停止当前朗读（发送、停止生成、切换会话、切换引擎等场景调用） */
export const stopReadAloud = () => {
  if (!current) {
    return
  }
  if (current.kind === 'remote') {
    const { controller } = current
    controller.abort()
    finishRemote(controller)
    return
  }
  stopLocalSpeech()
  finishLocal(current.token)
}

/** 16-bit 小端 PCM 转成 Float32；奇数字节留到下一段 */
const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

/** 本地引擎的失败原因映射到提示文案 */
export const describeLocalSpeechError = (code: LocalSpeechErrorCode): TranslationMessage => {
  switch (code) {
    case 'no_engine':
      return { key: 'ttsNoEngine' }
    case 'no_voice':
      return { key: 'ttsNoVoiceData' }
    case 'empty':
      return { key: 'ttsEmptyText' }
    default:
      return { key: 'ttsLocalFailed' }
  }
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  if (isLocalSpeechFailure(error)) {
    return describeLocalSpeechError(error.code)
  }
  if (error instanceof ApiError && error.kind === 'protocol') {
    return error.message
  }
  // 400 表示这段正文服务端无法合成，与其余失败区分开
  if (error instanceof ApiError && error.status === 400) {
    return { key: 'ttsUnavailable' }
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return { key: 'apiKeyInvalidRetry' }
    case 'insufficientBalance':
      return { key: 'insufficientBalance' }
    case 'rateLimited':
      return { key: 'rateLimited' }
    default:
      return { key: 'ttsFailed' }
  }
}

/** 这条会话能不能朗读：本地引擎不看端点能力，在线引擎仍要求 DeepSeek 官方端点 */
export const readAloudSupported = (capabilities: { speech: boolean }, engine: TtsEngine): boolean =>
  engine === 'local' ? localSpeechAvailable() : capabilities.speech

/** 组件里用：引擎切换后重新计算朗读按钮与自动朗读入口 */
export const useReadAloudSupported = (capabilities: { speech: boolean }): boolean => {
  const engine = useSettings((state) => state.ttsEngine)
  return readAloudSupported(capabilities, engine)
}

/** 本地朗读：文本先清洗成纯文本，再交给系统引擎 */
const startLocalReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  const speakable = toSpeakableText(text)
  if (!speakable) {
    onError(localSpeechFailure('empty'))
    return
  }
  const token = createId()
  current = { kind: 'local', token }
  useReadAloud.setState({ messageId, status: 'loading' })
  const accepted = speakLocal(speakable, token, (event) => {
    if (event.state === 'start') {
      if (isLocal(token)) {
        useReadAloud.setState({ status: 'playing' })
      }
      return
    }
    if (event.state === 'error') {
      if (isLocal(token)) {
        current = null
        useReadAloud.setState({ messageId: null, status: 'idle' })
      }
      onError(localSpeechFailure(event.error ?? 'failed'))
      return
    }
    finishLocal(token)
  })
  if (!accepted) {
    current = null
    useReadAloud.setState({ messageId: null, status: 'idle' })
    onError(localSpeechFailure(localSpeechAvailable() ? 'failed' : 'no_engine'))
  }
}

/** 在线朗读：流式 PCM + AudioContext；必须在点击事件里同步创建 context */
const startRemoteReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void,
  apiKeyOverride?: string
) => {
  const controller = new AbortController()
  const context = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  // 自动朗读发生在回复结束后、不在手势回调里：壳里已关闭媒体手势限制，这里再兜底恢复
  void context.resume().catch(() => {})
  current = { kind: 'remote', controller, context }
  useReadAloud.setState({ messageId, status: 'loading' })
  // 音色在开始朗读时读取，设置中切换后下一次朗读生效
  const { apiKey, ttsVoice } = useSettings.getState()
  const key = apiKeyOverride ?? apiKey ?? ''

  void (async () => {
    let nextTime = 0
    let lastSource: AudioBufferSourceNode | null = null
    let rest = new Uint8Array(0)
    try {
      const stream = await synthesize(key, text, ttsVoice, controller.signal)
      const reader = stream.getReader()
      controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        const bytes = new Uint8Array(rest.length + value.length)
        bytes.set(rest)
        bytes.set(value, rest.length)
        const samples = toFloat32(bytes)
        rest = bytes.slice(samples.length * 2)
        if (samples.length === 0) {
          continue
        }
        const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        // 网络慢于播放时从当前时间续上，不补播过去的时间
        nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
        source.start(nextTime)
        nextTime += buffer.duration
        lastSource = source
        if (useReadAloud.getState().status === 'loading') {
          useReadAloud.setState({ status: 'playing' })
        }
      }
      if (lastSource) {
        lastSource.onended = () => finishRemote(controller)
      } else {
        finishRemote(controller)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        finishRemote(controller)
        onError(error)
      }
    }
  })()
}

/** 开始朗读一条回复的正文；已有朗读先停止。自动朗读也走这里。 */
export const startReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void,
  apiKeyOverride?: string
) => {
  stopReadAloud()
  if (useSettings.getState().ttsEngine === 'local') {
    startLocalReadAloud(messageId, text, onError)
    return
  }
  startRemoteReadAloud(messageId, text, onError, apiKeyOverride)
}

/**
 * 手动朗读：点击同一条时停止，否则开始新的朗读。
 * 必须在点击事件中同步调用：AudioContext 需要用户手势才能出声。
 */
export const toggleReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void,
  apiKeyOverride?: string
) => {
  if (useReadAloud.getState().messageId === messageId) {
    stopReadAloud()
    return
  }
  startReadAloud(messageId, text, onError, apiKeyOverride)
}
