import { create } from 'zustand'
import { useSettings } from './settings.js'

/**
 * 版本更新：以 GitHub 仓库的 Release 为准。
 *
 * 只用公开的 releases/latest 接口（未登录限流 60 次/小时），
 * 结果缓存在 localStorage；自动检查在每次打开应用时触发一次，手动检查随时可用。
 */
const REPO = 'Jay-Victor/DeepSeek-ChatBot'
const REPO_URL = `https://github.com/${REPO}`
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASE_KEY = 'chat-demo:update-release'
/** 已经提示过的新版本；检查每次都做，同版本只弹一次提示 */
const NOTIFIED_KEY = 'chat-demo:update-notified'
const REQUEST_TIMEOUT = 12_000

export type ReleaseInfo = {
  version: string
  name: string
  /** Release 页面 */
  url: string
  /** Release 里的 APK 资产，没有时为 null */
  apkUrl: string | null
  publishedAt: string
}

type UpdateState = {
  /** 正在请求 GitHub API */
  checking: boolean
  /** 最近一次检查失败（网络、限流、协议异常） */
  failed: boolean
  release: ReleaseInfo | null
}

type WindowWithBridge = Window & {
  DeepSeekNative?: { appVersion?: () => string }
}

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储不可用时只在本次会话内生效
  }
}

/** 当前安装的版本来自原生壳；纯浏览器预览没有桥，按 0.0.0 处理 */
export const appVersion = (): string => {
  const bridge = (window as WindowWithBridge).DeepSeekNative
  try {
    return bridge?.appVersion?.() || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+](.*))?$/

const parseVersion = (value: string) => {
  const match = value.trim().replace(/^v/i, '').match(VERSION_PATTERN)
  if (!match) {
    return null
  }
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
    pre: match[4] ?? '',
  }
}

export const isVersion = (value: string) => parseVersion(value) !== null

/** 语义化版本比较：返回正数表示 a 比 b 新 */
export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) {
    return 0
  }
  for (let index = 0; index < left.parts.length; index += 1) {
    const delta = left.parts[index] - right.parts[index]
    if (delta !== 0) {
      return delta
    }
  }
  // 同号版本里正式版高于预发布版
  if (left.pre && !right.pre) {
    return -1
  }
  if (!left.pre && right.pre) {
    return 1
  }
  return left.pre.localeCompare(right.pre)
}

export const hasUpdate = (release: ReleaseInfo | null) =>
  release !== null && compareVersions(release.version, appVersion()) > 0

/** 只接受本仓库的链接，避免把 API 返回的内容当成任意跳转 */
const safeReleaseUrl = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.startsWith(`${REPO_URL}/`) ? value : fallback

const safeDownloadUrl = (value: unknown) =>
  typeof value === 'string' && value.startsWith(`${REPO_URL}/releases/download/`) ? value : null

const parseRelease = (data: unknown): ReleaseInfo | null => {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const item = data as Record<string, unknown>
  const version =
    typeof item.tag_name === 'string' ? item.tag_name.trim().replace(/^v/i, '') : ''
  if (!isVersion(version)) {
    return null
  }
  const assets = Array.isArray(item.assets) ? item.assets : []
  let apkUrl: string | null = null
  for (const asset of assets) {
    if (typeof asset !== 'object' || asset === null) {
      continue
    }
    const download = (asset as Record<string, unknown>).browser_download_url
    if (typeof download === 'string' && /\.apk$/i.test(download)) {
      apkUrl = safeDownloadUrl(download)
      if (apkUrl) {
        break
      }
    }
  }
  return {
    version,
    name:
      typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `v${version}`,
    url: safeReleaseUrl(item.html_url, `${REPO_URL}/releases/tag/v${version}`),
    apkUrl,
    publishedAt: typeof item.published_at === 'string' ? item.published_at : '',
  }
}

const readCachedRelease = (): ReleaseInfo | null => {
  const raw = readStorage(RELEASE_KEY)
  if (!raw) {
    return null
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const item = value as Record<string, unknown>
    const version = typeof item.version === 'string' ? item.version : ''
    if (!isVersion(version)) {
      return null
    }
    return {
      version,
      name: typeof item.name === 'string' && item.name ? item.name : `v${version}`,
      url: safeReleaseUrl(item.url, `${REPO_URL}/releases/tag/v${version}`),
      apkUrl: safeDownloadUrl(item.apkUrl),
      publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : '',
    }
  } catch {
    return null
  }
}

export const useUpdate = create<UpdateState>(() => ({
  checking: false,
  failed: false,
  release: readCachedRelease(),
}))

let inflight: Promise<void> | null = null

/** 请求 GitHub Release；手动与自动检查共用，失败只置 failed，不抛给调用方 */
export const checkForUpdates = (): Promise<void> => {
  if (inflight) {
    return inflight
  }
  inflight = (async () => {
    useUpdate.setState({ checking: true, failed: false })
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
      const response = await fetch(API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const release = parseRelease(await response.json())
      if (!release) {
        throw new Error('invalid release payload')
      }
      writeStorage(RELEASE_KEY, JSON.stringify(release))
      useUpdate.setState({ checking: false, failed: false, release })
    } catch {
      // 失败保留上一次成功的结果，由「关于」页显示“检查失败”
      useUpdate.setState({ checking: false, failed: true })
    } finally {
      window.clearTimeout(timer)
      inflight = null
    }
  })()
  return inflight
}

/** 打开应用时调用：自动检查关闭则跳过（返回 null），否则每次都请求一次 */
export const maybeAutoCheck = async (): Promise<UpdateState | null> => {
  if (!useSettings.getState().autoCheckUpdates) {
    return null
  }
  await checkForUpdates()
  return useUpdate.getState()
}

/** 同一个版本只提示一次，避免每次回到前台都弹同一条 toast */
export const shouldNotifyRelease = (release: ReleaseInfo) =>
  readStorage(NOTIFIED_KEY) !== release.version

export const markReleaseNotified = (version: string) => writeStorage(NOTIFIED_KEY, version)
