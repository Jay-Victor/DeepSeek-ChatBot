/**
 * Android 壳（window.DeepSeekNative）的文件保存桥。
 *
 * WebView 里对 blob: 链接的 <a download> 会被静默丢弃（DownloadListener 不触发，也不报错），
 * 所以在壳里把 Blob 分片交给原生，由原生用 SAF 写进用户选定的位置；浏览器里保留原下载路径。
 */

import { createId } from '../utils/id.js'

type SaveBridge = {
  saveBegin?: (id: string, name: string) => void
  saveChunk?: (token: string, base64: string) => boolean
  saveEnd?: (token: string, ok: boolean) => void
}

export type SaveResult = 'saved' | 'cancelled' | 'failed'

type WindowWithBridge = Window & {
  DeepSeekNative?: SaveBridge
  __onSaveToken?: (id: string, token: string | null) => void
}

const bridge = () => (window as WindowWithBridge).DeepSeekNative

const waiters = new Map<string, (token: string | null) => void>()

/** 原生在用户选好位置（或取消）后回调 */
;(window as WindowWithBridge).__onSaveToken = (id, token) => {
  const resolve = waiters.get(id)
  waiters.delete(id)
  resolve?.(token)
}

/** 单次写入上限，避免一次性构造过大的 base64 字符串 */
const CHUNK_SIZE = 512 * 1024

const toBase64 = (bytes: Uint8Array) => {
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(text)
}

const anchorDownload = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 保存一个 Blob：壳里写入用户选的位置，浏览器里触发下载 */
export const saveBlob = async (name: string, blob: Blob): Promise<SaveResult> => {
  const native = bridge()
  if (!native?.saveBegin || !native.saveChunk || !native.saveEnd) {
    anchorDownload(name, blob)
    return 'saved'
  }
  const id = createId()
  const token = await new Promise<string | null>((resolve) => {
    waiters.set(id, resolve)
    native.saveBegin?.(id, name)
  })
  if (!token) {
    waiters.delete(id)
    return 'cancelled'
  }
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = toBase64(bytes.subarray(offset, offset + CHUNK_SIZE))
      if (!native.saveChunk(token, chunk)) {
        native.saveEnd(token, false)
        return 'failed'
      }
    }
    native.saveEnd(token, true)
    return 'saved'
  } catch {
    native.saveEnd(token, false)
    return 'failed'
  }
}
