import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、自动检查更新、思考内容自动折叠、自动朗读、上下文压缩 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  autoCheckUpdates: boolean
  autoCollapseThinking: boolean
  autoReadAloud: boolean
  /** 上下文占用超过阈值时自动摘要较早的对话 */
  autoCompress: boolean
  /** 触发自动压缩的上下文占比（百分数，1–99） */
  compressThreshold: number
  /** 压缩后希望达到的上下文占比（百分数，1–99，必须小于阈值） */
  compressTarget: number
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  autoCheckUpdates: 'chat-demo:auto-check-updates',
  autoCollapseThinking: 'chat-demo:auto-collapse-thinking',
  autoReadAloud: 'chat-demo:auto-read-aloud',
  autoCompress: 'chat-demo:auto-compress',
  compressThreshold: 'chat-demo:compress-threshold',
  compressTarget: 'chat-demo:compress-target',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const PERCENT_MIN = 1
const PERCENT_MAX = 99

/** 设置项里的占比统一存百分数整数；越界或损坏时回退到默认值 */
export const clampCompressPercent = (value: number, fallback: number): number =>
  Number.isFinite(value)
    ? Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, Math.round(value)))
    : fallback

/** localStorage 里没有值时不能把 null 当成 0，否则默认值会被压到下限 */
const readCompressPercent = (key: string, fallback: number): number => {
  const saved = read(key)
  if (saved === null || saved.trim() === '') {
    return fallback
  }
  return clampCompressPercent(Number(saved), fallback)
}

/** 阈值至少为 2，保证目标仍能取到 1 */
const initialCompressThreshold = (): number =>
  Math.max(2, readCompressPercent(KEYS.compressThreshold, 50))

/** 目标必须严格小于阈值；读取时若已不满足（例如手改过 localStorage），向下收口 */
const initialCompressTarget = (): number => {
  const value = readCompressPercent(KEYS.compressTarget, 20)
  return Math.min(value, initialCompressThreshold() - 1)
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  // 默认开启自动检查；用户关掉后写 'false'
  autoCheckUpdates: read(KEYS.autoCheckUpdates) !== 'false',
  // 思考内容默认保持展开，由用户主动打开自动折叠
  autoCollapseThinking: read(KEYS.autoCollapseThinking) === 'true',
  // 自动朗读默认关闭，由顶栏开关主动打开
  autoReadAloud: read(KEYS.autoReadAloud) === 'true',
  // 自动压缩默认关闭，避免未预期地产生摘要请求
  autoCompress: read(KEYS.autoCompress) === 'true',
  compressThreshold: initialCompressThreshold(),
  compressTarget: initialCompressTarget(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setAutoCheckUpdates = (autoCheckUpdates: boolean) => {
  write(KEYS.autoCheckUpdates, String(autoCheckUpdates))
  useSettings.setState({ autoCheckUpdates })
}

export const setAutoCollapseThinking = (autoCollapseThinking: boolean) => {
  write(KEYS.autoCollapseThinking, String(autoCollapseThinking))
  useSettings.setState({ autoCollapseThinking })
}

export const setAutoReadAloud = (autoReadAloud: boolean) => {
  write(KEYS.autoReadAloud, String(autoReadAloud))
  useSettings.setState({ autoReadAloud })
}

export const setAutoCompress = (autoCompress: boolean) => {
  write(KEYS.autoCompress, String(autoCompress))
  useSettings.setState({ autoCompress })
}

/** 阈值下调到目标以下时，把目标一并收口，保证始终“目标 < 阈值” */
export const setCompressThreshold = (value: number) => {
  const compressThreshold = Math.max(
    2,
    clampCompressPercent(value, useSettings.getState().compressThreshold)
  )
  const compressTarget = Math.min(useSettings.getState().compressTarget, compressThreshold - 1)
  write(KEYS.compressThreshold, String(compressThreshold))
  write(KEYS.compressTarget, String(compressTarget))
  useSettings.setState({ compressThreshold, compressTarget })
}

export const setCompressTarget = (value: number) => {
  const compressThreshold = useSettings.getState().compressThreshold
  const compressTarget = Math.min(
    clampCompressPercent(value, useSettings.getState().compressTarget),
    compressThreshold - 1
  )
  write(KEYS.compressTarget, String(compressTarget))
  useSettings.setState({ compressTarget })
}
