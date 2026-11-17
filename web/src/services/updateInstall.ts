import { create } from 'zustand'
import type { ReleaseInfo } from './update.js'

/**
 * 应用内安装更新：页面只负责发起与展示进度，下载、校验与调起系统安装器都在原生壳里完成。
 * 事件通过 window.__onUpdateEvent 回到这里；设置面板关闭后下载继续，重新打开还能看到进度。
 */

export type UpdateInstallPhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'permission'
  | 'ready'
  | 'installing'
  | 'error'

type NativeUpdateBridge = {
  downloadUpdate?: (
    url: string,
    version: string,
    name: string,
    size: string,
    sha256: string
  ) => string
  cancelUpdate?: (id: string) => void
}

type UpdateEvent = {
  id?: string
  phase?: string
  received?: number
  total?: number
  code?: string
}

type UpdateInstallState = {
  phase: UpdateInstallPhase
  requestId: string | null
  received: number
  total: number
  /** 原生返回的错误码，由界面翻译 */
  code: string | null
  /** 发起下载；没有原生桥或没有 APK 资产时返回 false */
  start: (release: ReleaseInfo) => boolean
  cancel: () => void
  reset: () => void
}

type WindowWithBridge = Window & {
  DeepSeekNative?: NativeUpdateBridge
  __onUpdateEvent?: (payload: string) => void
}

const bridge = () => (window as WindowWithBridge).DeepSeekNative

/** 只有 Android 壳提供 downloadUpdate；纯浏览器里退回普通下载链接 */
export const canInstallInApp = () => Boolean(bridge()?.downloadUpdate)

const parseEvent = (payload: string): UpdateEvent | null => {
  try {
    const value: unknown = JSON.parse(payload)
    return typeof value === 'object' && value !== null ? (value as UpdateEvent) : null
  } catch {
    return null
  }
}

export const useUpdateInstall = create<UpdateInstallState>((set, get) => ({
  phase: 'idle',
  requestId: null,
  received: 0,
  total: 0,
  code: null,

  start: (release) => {
    const native = bridge()
    const url = release.apkApiUrl ?? release.apkUrl
    if (!native?.downloadUpdate || !url) {
      return false
    }
    const id = native.downloadUpdate(
      url,
      release.version,
      release.apkName ?? '',
      String(release.apkSize || 0),
      release.apkSha256 ?? ''
    )
    if (!id) {
      set({ phase: 'error', code: 'start_failed', requestId: null })
      return false
    }
    set({
      phase: 'downloading',
      requestId: id,
      received: 0,
      total: release.apkSize || 0,
      code: null,
    })
    return true
  },

  cancel: () => {
    const { requestId } = get()
    if (requestId) {
      bridge()?.cancelUpdate?.(requestId)
    }
    set({ phase: 'idle', requestId: null, received: 0, total: 0, code: null })
  },

  reset: () => set({ phase: 'idle', requestId: null, received: 0, total: 0, code: null }),
}))

;(window as WindowWithBridge).__onUpdateEvent = (payload) => {
  const event = parseEvent(payload)
  if (!event?.phase) {
    return
  }
  const state = useUpdateInstall.getState()
  // 旧请求的迟到事件不覆盖当前请求
  if (state.requestId && event.id && event.id !== state.requestId) {
    return
  }
  switch (event.phase) {
    case 'downloading':
      useUpdateInstall.setState({
        phase: 'downloading',
        requestId: state.requestId ?? event.id ?? null,
        received: event.received ?? state.received,
        total: event.total && event.total > 0 ? event.total : state.total,
      })
      return
    case 'verifying':
    case 'permission':
    case 'ready':
    case 'installing':
      useUpdateInstall.setState({
        phase: event.phase,
        requestId: state.requestId ?? event.id ?? null,
      })
      return
    case 'cancelled':
      useUpdateInstall.setState({
        phase: 'idle',
        requestId: null,
        received: 0,
        total: 0,
        code: null,
      })
      return
    case 'error':
      useUpdateInstall.setState({
        phase: 'error',
        requestId: state.requestId ?? event.id ?? null,
        code: event.code ?? 'unknown',
      })
      return
    default:
      return
  }
}
