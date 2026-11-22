import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 自定义背景的媒体类型 */
export type WallpaperKind = 'image' | 'video'

/** 朗读引擎：在线走 DeepSeek TTS 接口，本地走系统文字转语音 */
export type TtsEngine = 'remote' | 'local'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、自动检查更新、思考内容自动折叠、自动朗读、上下文压缩、外观 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  /** 朗读引擎；默认在线，老用户行为不变 */
  ttsEngine: TtsEngine
  /** 本地朗读语速，百分数（50–200），100 为正常语速 */
  localTtsRatePercent: number
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
  /** 自定义主题色的色相（0–360）；null 表示使用 DeepSeek 蓝 */
  accentHue: number | null
  /** 壁纸上方蒙层浓度（0–100）：0 最清晰，100 完全遮住 */
  wallpaperOverlay: number
  /** 壁纸模糊半径（px，0–24） */
  wallpaperBlur: number
  /** 当前显示的背景类型 */
  wallpaperKind: WallpaperKind
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  ttsEngine: 'chat-demo:tts-engine',
  localTtsRate: 'chat-demo:local-tts-rate',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  autoCheckUpdates: 'chat-demo:auto-check-updates',
  autoCollapseThinking: 'chat-demo:auto-collapse-thinking',
  autoReadAloud: 'chat-demo:auto-read-aloud',
  autoCompress: 'chat-demo:auto-compress',
  compressThreshold: 'chat-demo:compress-threshold',
  compressTarget: 'chat-demo:compress-target',
  accentHue: 'chat-demo:accent-hue',
  wallpaperOverlay: 'chat-demo:wallpaper-overlay',
  wallpaperBlur: 'chat-demo:wallpaper-blur',
  wallpaperKind: 'chat-demo:wallpaper-kind',
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

/** 未保存过时保持在线朗读，与旧版本行为一致 */
const initialTtsEngine = (): TtsEngine => (read(KEYS.ttsEngine) === 'local' ? 'local' : 'remote')

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

/** 外观数值统一存整数；缺失、损坏或越界时回退 */
const readRangeInt = (key: string, fallback: number, min: number, max: number): number => {
  const raw = read(key)
  if (raw === null || raw.trim() === '') {
    return fallback
  }
  return clampRangeInt(Number(raw), fallback, min, max)
}

const clampRangeInt = (value: number, fallback: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

/** 未拖动过色相条时为 null，保持上游 DeepSeek 蓝 */
const initialAccentHue = (): number | null => {
  const raw = read(KEYS.accentHue)
  if (raw === null || raw.trim() === '') {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? ((Math.round(value) % 360) + 360) % 360 : null
}

const initialWallpaperKind = (): WallpaperKind =>
  read(KEYS.wallpaperKind) === 'video' ? 'video' : 'image'

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  ttsEngine: initialTtsEngine(),
  localTtsRatePercent: readRangeInt(KEYS.localTtsRate, 100, 50, 200),
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
  // 未自定义主题色时保持 DeepSeek 蓝；默认留 20% 蒙层，避免亮壁纸压住正文
  accentHue: initialAccentHue(),
  wallpaperOverlay: readRangeInt(KEYS.wallpaperOverlay, 20, 0, 100),
  wallpaperBlur: readRangeInt(KEYS.wallpaperBlur, 0, 0, 24),
  wallpaperKind: initialWallpaperKind(),
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

export const setTtsEngine = (ttsEngine: TtsEngine) => {
  write(KEYS.ttsEngine, ttsEngine)
  useSettings.setState({ ttsEngine })
}

/** 语速百分数收口到 50–200；下一次朗读开始生效 */
export const setLocalTtsRatePercent = (value: number) => {
  const localTtsRatePercent = clampRangeInt(
    value,
    useSettings.getState().localTtsRatePercent,
    50,
    200
  )
  write(KEYS.localTtsRate, String(localTtsRatePercent))
  useSettings.setState({ localTtsRatePercent })
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

/** 色相取整并回绕到 0–359；null 表示恢复默认主题色 */
export const setAccentHue = (hue: number | null) => {
  const accentHue =
    hue === null || !Number.isFinite(hue) ? null : ((Math.round(hue) % 360) + 360) % 360
  write(KEYS.accentHue, accentHue === null ? null : String(accentHue))
  useSettings.setState({ accentHue })
}

export const setWallpaperOverlay = (value: number) => {
  const wallpaperOverlay = clampRangeInt(value, useSettings.getState().wallpaperOverlay, 0, 100)
  write(KEYS.wallpaperOverlay, String(wallpaperOverlay))
  useSettings.setState({ wallpaperOverlay })
}

export const setWallpaperBlur = (value: number) => {
  const wallpaperBlur = clampRangeInt(value, useSettings.getState().wallpaperBlur, 0, 24)
  write(KEYS.wallpaperBlur, String(wallpaperBlur))
  useSettings.setState({ wallpaperBlur })
}

export const setWallpaperKind = (wallpaperKind: WallpaperKind) => {
  write(KEYS.wallpaperKind, wallpaperKind)
  useSettings.setState({ wallpaperKind })
}
