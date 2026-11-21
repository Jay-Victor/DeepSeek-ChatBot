import { useEffect, useState, type MouseEvent } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getFileViewType, isImage } from '../../services/attachments.js'
import { loadFile } from '../../services/chat/db.js'
import { hasNativeFileBridge, openBlob, saveBlob } from '../../app/native.js'
import { showToast } from '../base/toastState.js'
import { useImageViewer } from './imageViewerState.js'

const createViewUrl = (original: Blob, type: string) => {
  // Android WebView 从 IndexedDB 读回的 SAF 文件 size 为 0（arrayBuffer 仍有数据），
  // 这时 slice 会得到空 Blob，只能直接用原对象；桌面浏览器仍按原逻辑重设 MIME。
  const blob =
    original.size > 0
      ? original.slice(0, original.size, type || 'application/octet-stream')
      : original
  if (type !== 'image/svg+xml') {
    return URL.createObjectURL(blob)
  }
  // SVG 缩略图用 data: 地址，单独打开图片时也与应用隔离。
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 草稿传 File，已发送的附件传 IndexedDB 原件 ID。 */
export const useFileView = (source: File | string, name: string) => {
  const t = useTranslate()
  const openImage = useImageViewer((state) => state.openImage)
  const type = getFileViewType(name)
  const [state, setState] = useState<{
    source: File | string
    type: string
    url: string | null
    blob: Blob | null
  }>()
  useEffect(() => {
    let active = true
    const original = typeof source === 'string' ? loadFile(source) : Promise.resolve(source)
    const pending = original
      .then((blob) =>
        active && blob
          ? Promise.resolve(createViewUrl(blob, type)).then((url) => ({ url, blob }))
          : null
      )
      .catch(() => null)
    void pending.then((view) => {
      if (active) {
        setState({ source, type, url: view?.url ?? null, blob: view?.blob ?? null })
      }
    })
    return () => {
      active = false
      void pending.then((view) => {
        if (view?.url.startsWith('blob:')) {
          URL.revokeObjectURL(view.url)
        }
      })
    }
  }, [source, type])

  const current = state?.source === source && state.type === type ? state : undefined
  const url = current?.url
  const blob = current?.blob
  const image = isImage(type)
  const svg = type === 'image/svg+xml'
  const openInTab = type === 'application/pdf' || (image && !svg)

  // 壳里 blob: 链接既不能下载也不能新开标签：图片走应用内预览，PDF 交给系统查看器，
  // SVG / 其他文件走 SAF 保存；浏览器里保持上游的 target=_blank / download。
  const onActivate = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (!blob || !url) {
      return
    }
    if (image && !svg) {
      openImage({ blob, name })
      return
    }
    if (openInTab) {
      const result = await openBlob(name, blob, type || blob.type)
      if (result === 'opened') {
        return
      }
      showToast(t('attachmentNoViewer'))
    }
    void saveBlob(name, blob, type || blob.type)
  }

  const action = hasNativeFileBridge()
    ? { onClick: onActivate }
    : openInTab
      ? { target: '_blank', rel: 'noreferrer' }
      : { download: name }
  return { url, image, link: url ? { href: url, ...action } : undefined }
}
