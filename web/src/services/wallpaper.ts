import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { create } from 'zustand'
import { setWallpaperKind, useSettings, type WallpaperKind } from './settings.js'

export type WallpaperMedia = {
  url: string
  name: string
  size?: number
  mime?: string
}

type WallpaperState = {
  ready: boolean
  image: WallpaperMedia | null
  video: WallpaperMedia | null
  /** 正在由原生选择器 / 浏览器文件选择器读取的类型 */
  picking: WallpaperKind | null
}

export const useWallpaper = create<WallpaperState>(() => ({
  ready: false,
  image: null,
  video: null,
  picking: null,
}))

export type PickWallpaperResult = 'ok' | 'cancelled' | 'failed' | 'too_large' | 'unsupported'

type NativeBackgroundMedia = {
  url?: unknown
  name?: unknown
  size?: unknown
  mime?: unknown
}

type NativeBackgroundBridge = {
  pickBackground?: (kind: string) => void
  backgroundInfo?: () => string
  clearBackground?: (kind: string) => void
}

type WindowWithBackgroundBridge = Window & {
  DeepSeekNative?: NativeBackgroundBridge
  __onBackground?: (json: string) => void
}

const bridge = () => (window as WindowWithBackgroundBridge).DeepSeekNative

const hasNativeBridge = () => Boolean(bridge()?.backgroundInfo && bridge()?.pickBackground)

/** 浏览器回退更保守，避免整段读进内存 */
const MAX_BROWSER_BYTES: Record<WallpaperKind, number> = {
  image: 30 * 1024 * 1024,
  video: 60 * 1024 * 1024,
}

const putMedia = (kind: WallpaperKind, media: WallpaperMedia | null) => {
  useWallpaper.setState(kind === 'image' ? { image: media } : { video: media })
}

const currentMedia = (kind: WallpaperKind): WallpaperMedia | null =>
  useWallpaper.getState()[kind]

const parseNativeMedia = (raw: NativeBackgroundMedia | undefined): WallpaperMedia | null => {
  if (!raw || typeof raw.url !== 'string' || !raw.url.startsWith('https://')) {
    return null
  }
  return {
    url: raw.url,
    name: typeof raw.name === 'string' ? raw.name : 'background',
    size: typeof raw.size === 'number' ? raw.size : undefined,
    mime: typeof raw.mime === 'string' ? raw.mime : undefined,
  }
}

/** 浏览器回退：独立的小库，不碰聊天主库，避免版本迁移 */
type StoredWallpaper = {
  kind: WallpaperKind
  blob: Blob
  name: string
  size: number
  mime: string
}

interface AppearanceDB extends DBSchema {
  wallpapers: { key: WallpaperKind; value: StoredWallpaper }
}

let dbPromise: Promise<IDBPDatabase<AppearanceDB>> | null = null

const openAppearanceDB = () => {
  dbPromise ??= openDB<AppearanceDB>('deepseek-chatbot-appearance', 1, {
    upgrade(database) {
      database.createObjectStore('wallpapers', { keyPath: 'kind' })
    },
  })
  return dbPromise
}

const objectUrls = new Map<WallpaperKind, string>()

const releaseObjectUrl = (kind: WallpaperKind) => {
  const url = objectUrls.get(kind)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrls.delete(kind)
  }
}

const mediaFromRecord = (record: StoredWallpaper): WallpaperMedia => {
  const previous = currentMedia(record.kind)
  if (previous?.url.startsWith('blob:')) {
    URL.revokeObjectURL(previous.url)
  }
  releaseObjectUrl(record.kind)
  const url = URL.createObjectURL(record.blob)
  objectUrls.set(record.kind, url)
  return { url, name: record.name, size: record.size, mime: record.mime }
}

const loadFromNative = () => {
  const info = bridge()?.backgroundInfo?.()
  if (!info) {
    return
  }
  const parsed = JSON.parse(info) as { image?: NativeBackgroundMedia; video?: NativeBackgroundMedia }
  putMedia('image', parseNativeMedia(parsed.image))
  putMedia('video', parseNativeMedia(parsed.video))
}

const loadFromBrowser = async () => {
  try {
    const database = await openAppearanceDB()
    const records = await database.getAll('wallpapers')
    for (const record of records) {
      putMedia(record.kind, mediaFromRecord(record))
    }
  } catch {
    // 存储不可用时没有背景，不影响聊天
  }
}

/** 启动时恢复背景；当前类型没有媒体而另一类有时自动切过去 */
export const initWallpaper = async () => {
  if (useWallpaper.getState().ready) {
    return
  }
  try {
    if (hasNativeBridge()) {
      loadFromNative()
    } else {
      await loadFromBrowser()
    }
  } catch {
    // 背景读取失败只意味着没有背景
  }
  useWallpaper.setState({ ready: true })
  const state = useWallpaper.getState()
  const kind = useSettings.getState().wallpaperKind
  if (!state[kind] && (state.image || state.video)) {
    setWallpaperKind(state.image ? 'image' : 'video')
  }
}

let pendingPick: { kind: WallpaperKind; resolve: (result: PickWallpaperResult) => void } | null =
  null

const finishPick = (result: PickWallpaperResult) => {
  useWallpaper.setState({ picking: null })
  const pending = pendingPick
  pendingPick = null
  pending?.resolve(result)
}

/** 原生复制完成 / 取消后回调 */
;(window as WindowWithBackgroundBridge).__onBackground = (json) => {
  let payload: {
    kind?: unknown
    ok?: unknown
    media?: NativeBackgroundMedia
    error?: unknown
  }
  try {
    payload = JSON.parse(json)
  } catch {
    return
  }
  const kind: WallpaperKind = payload.kind === 'video' ? 'video' : 'image'
  if (payload.ok === true) {
    const media = parseNativeMedia(payload.media)
    if (media) {
      putMedia(kind, media)
    }
    finishPick(media ? 'ok' : 'failed')
    return
  }
  const error = typeof payload.error === 'string' ? payload.error : ''
  if (error === 'cancelled') {
    finishPick('cancelled')
  } else if (error === 'too_large') {
    finishPick('too_large')
  } else if (error === 'unsupported') {
    finishPick('unsupported')
  } else {
    finishPick('failed')
  }
}

const pickInBrowser = (kind: WallpaperKind): Promise<PickWallpaperResult> =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = kind === 'image' ? 'image/*' : 'video/*'
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    let settled = false
    let blurred = false
    const finish = (result: PickWallpaperResult) => {
      if (settled) {
        return
      }
      settled = true
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      input.remove()
      resolve(result)
    }
    const onWindowBlur = () => {
      blurred = true
    }
    // 只有窗口先失焦（文件对话框打开）后才用 focus 兜底判取消，
    // 避免某些环境下 focus 事件来回抖动，把还在选文件的流程提前结束。
    const onWindowFocus = () => {
      if (!blurred) {
        return
      }
      window.setTimeout(() => {
        if (!input.files?.length) {
          finish('cancelled')
        }
      }, 800)
    }
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        finish('cancelled')
        return
      }
      if (file.size > MAX_BROWSER_BYTES[kind]) {
        finish('too_large')
        return
      }
      const mime = file.type || ''
      if (!mime.startsWith(`${kind}/`)) {
        finish('unsupported')
        return
      }
      void (async () => {
        try {
          // 物化成新的 Blob：WebView 把 SAF 文件结构化克隆进 IndexedDB 后读回 size=0，
          // 直接存 File 会让视频无法播放；这里先读成 ArrayBuffer 再建 Blob。
          const bytes = await file.arrayBuffer()
          const blob = new Blob([bytes], { type: mime })
          const record: StoredWallpaper = {
            kind,
            blob,
            name: file.name,
            size: blob.size,
            mime,
          }
          const database = await openAppearanceDB()
          await database.put('wallpapers', record)
          putMedia(kind, mediaFromRecord(record))
          finish('ok')
        } catch {
          finish('failed')
        }
      })()
    })
    input.addEventListener('cancel', () => finish('cancelled'))
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('focus', onWindowFocus)
    document.body.appendChild(input)
    input.click()
  })

/** 选择背景：壳里走原生 SAF 并复制到私有目录；浏览器里存独立 IndexedDB */
export const pickWallpaper = async (kind: WallpaperKind): Promise<PickWallpaperResult> => {
  const native = bridge()
  if (native?.pickBackground) {
    if (pendingPick) {
      return 'failed'
    }
    useWallpaper.setState({ picking: kind })
    return await new Promise<PickWallpaperResult>((resolve) => {
      pendingPick = { kind, resolve }
      try {
        native.pickBackground?.(kind)
      } catch {
        finishPick('failed')
      }
    })
  }
  useWallpaper.setState({ picking: kind })
  try {
    return await pickInBrowser(kind)
  } finally {
    useWallpaper.setState({ picking: null })
  }
}

/** 删除当前类型的背景文件；原生与浏览器回退都清掉持久化数据 */
export const removeWallpaper = async (kind: WallpaperKind) => {
  const native = bridge()
  try {
    if (native?.clearBackground) {
      native.clearBackground(kind)
    } else {
      const database = await openAppearanceDB()
      await database.delete('wallpapers', kind)
      releaseObjectUrl(kind)
    }
  } catch {
    // 删除失败也先让界面回到无背景状态
  }
  const previous = currentMedia(kind)
  if (previous?.url.startsWith('blob:')) {
    URL.revokeObjectURL(previous.url)
  }
  putMedia(kind, null)
}

/** 媒体加载/解码失败：只从界面移除，不擅自删除用户文件 */
export const dropWallpaper = (kind: WallpaperKind) => {
  const previous = currentMedia(kind)
  if (previous?.url.startsWith('blob:')) {
    URL.revokeObjectURL(previous.url)
  }
  putMedia(kind, null)
}
