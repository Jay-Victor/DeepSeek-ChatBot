/**
 * Android 壳（window.DeepSeekNative）的文件桥。
 *
 * WebView 里对 blob: 链接的 <a download> 会被静默丢弃（DownloadListener 不触发，也不报错），
 * 图片 / PDF 的 target=_blank 也无法打开；所以在壳里把 Blob 分片交给原生：
 * - saveBlob：SAF 写进用户选定的位置（浏览器里保留原来的 <a download>）
 * - openBlob：写入 cache/attachments，再由 FileProvider 交给系统查看器打开
 */

import { createId } from '../utils/id.js'

type FileBridge = {
  saveBegin?: (id: string, name: string, mime: string) => void
  saveChunk?: (token: string, base64: string) => boolean
  saveEnd?: (token: string, ok: boolean) => void
  openFileBegin?: (name: string, mime: string, size: number) => string | null
  openFileChunk?: (token: string, base64: string) => boolean
  openFileEnd?: (token: string, ok: boolean) => boolean
}

export type SaveResult = 'saved' | 'cancelled' | 'failed'
export type OpenResult = 'opened' | 'failed' | 'unsupported'

type WindowWithBridge = Window & {
  DeepSeekNative?: FileBridge
  __onSaveToken?: (id: string, token: string | null) => void
}

const bridge = () => (window as WindowWithBridge).DeepSeekNative

/** 原生是否提供了文件保存桥（旧版本壳方法仍在，只是没有 MIME 参数） */
export const hasNativeFileBridge = () => {
  const native = bridge()
  return Boolean(native?.saveBegin && native.saveChunk && native.saveEnd)
}

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

/** 按块读取 Blob：比整份 arrayBuffer 更省峰值内存，几十 MB 的 PDF 也能交出去 */
const readChunk = async (blob: Blob, offset: number) =>
  new Uint8Array(await blob.slice(offset, offset + CHUNK_SIZE).arrayBuffer())

/**
 * 把 Blob 切成分片交给原生。正常情况下按块读；Android WebView 把 SAF 选中的文件
 * 存进 IndexedDB 后读回时 size 为 0（arrayBuffer 仍有完整数据），此时只能一次读完再分片。
 */
const forEachChunk = async (blob: Blob, visit: (chunk: Uint8Array) => boolean) => {
  if (blob.size > 0) {
    for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
      if (!visit(await readChunk(blob, offset))) {
        return false
      }
    }
    return true
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    if (!visit(bytes.subarray(offset, offset + CHUNK_SIZE))) {
      return false
    }
  }
  return true
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
export const saveBlob = async (name: string, blob: Blob, mime?: string): Promise<SaveResult> => {
  const native = bridge()
  if (!native?.saveBegin || !native.saveChunk || !native.saveEnd) {
    anchorDownload(name, blob)
    return 'saved'
  }
  const id = createId()
  const token = await new Promise<string | null>((resolve) => {
    waiters.set(id, resolve)
    native.saveBegin?.(id, name, mime ?? blob.type)
  })
  if (!token) {
    waiters.delete(id)
    return 'cancelled'
  }
  try {
    const ok = await forEachChunk(
      blob,
      (chunk) => native.saveChunk?.(token, toBase64(chunk)) === true
    )
    native.saveEnd(token, ok)
    return ok ? 'saved' : 'failed'
  } catch {
    native.saveEnd(token, false)
    return 'failed'
  }
}

/** 交给系统查看器打开（PDF）：壳里写临时文件 + FileProvider，浏览器里不支持 */
export const openBlob = async (name: string, blob: Blob, mime?: string): Promise<OpenResult> => {
  const native = bridge()
  if (!native?.openFileBegin || !native.openFileChunk || !native.openFileEnd) {
    return 'unsupported'
  }
  const token = native.openFileBegin(name, mime || blob.type, blob.size)
  if (!token) {
    return 'failed'
  }
  try {
    const ok = await forEachChunk(
      blob,
      (chunk) => native.openFileChunk?.(token, toBase64(chunk)) === true
    )
    if (!ok) {
      native.openFileEnd(token, false)
      return 'failed'
    }
    return native.openFileEnd(token, true) ? 'opened' : 'failed'
  } catch {
    native.openFileEnd(token, false)
    return 'failed'
  }
}
