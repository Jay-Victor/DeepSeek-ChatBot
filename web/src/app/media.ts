/**
 * 相册 / 拍照的原生桥。
 *
 * WebView 不能枚举系统相册，Android 壳通过 MediaStore 返回最近照片的缩略图；
 * 选中后按 token 分片读回字节，拼成 File 再交给现有上传流程。
 */

export type GalleryItem = {
  id: string
  name: string
  type: string
  size: number
  thumb: string
}

export type GalleryResult = {
  items: GalleryItem[]
  error?: 'permission' | 'failed'
}

type CameraPayload = {
  token?: string
  name?: string
  type?: string
  cancelled?: boolean
  error?: string
}

type MediaBridge = {
  loadGallery?: () => void
  openMedia?: (id: string) => string | null
  readMediaChunk?: (token: string) => string | null
  closeMedia?: (token: string) => void
  takePhoto?: () => void
}

type WindowWithMedia = Window & {
  DeepSeekNative?: MediaBridge
  __onGallery?: (json: string) => void
  __onCamera?: (json: string) => void
}

const bridge = () => (window as WindowWithMedia).DeepSeekNative

const MAX_FILE_BYTES = 100 * 1024 * 1024

/** 是否具备完整的相册 / 拍照能力（旧壳没有这些方法） */
export const hasNativeMedia = () => {
  const native = bridge()
  return Boolean(
    native?.loadGallery &&
      native.openMedia &&
      native.readMediaChunk &&
      native.closeMedia &&
      native.takePhoto
  )
}

let galleryWaiter: ((raw: string) => void) | null = null
let cameraWaiter: ((payload: CameraPayload) => void) | null = null

;(window as WindowWithMedia).__onGallery = (raw) => {
  const resolve = galleryWaiter
  galleryWaiter = null
  resolve?.(raw)
}

;(window as WindowWithMedia).__onCamera = (raw) => {
  const resolve = cameraWaiter
  cameraWaiter = null
  try {
    resolve?.(JSON.parse(raw) as CameraPayload)
  } catch {
    resolve?.({ error: 'invalid' })
  }
}

/** 请求最近照片；原生会在需要时先申请相册权限 */
export const loadGallery = (): Promise<GalleryResult> => {
  const native = bridge()
  if (!native?.loadGallery) {
    return Promise.resolve({ items: [], error: 'failed' })
  }
  galleryWaiter?.('{"error":"cancelled"}')
  return new Promise((resolve) => {
    galleryWaiter = (raw) => {
      try {
        const payload = JSON.parse(raw) as { items?: GalleryItem[]; error?: string }
        if (payload.error) {
          resolve({
            items: [],
            error: payload.error === 'permission' ? 'permission' : 'failed',
          })
          return
        }
        resolve({ items: Array.isArray(payload.items) ? payload.items : [] })
      } catch {
        resolve({ items: [], error: 'failed' })
      }
    }
    native.loadGallery?.()
  })
}

const base64ToBytes = (value: string) => {
  const text = atob(value)
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index)
  }
  return bytes
}

const withExtension = (name: string, type: string) => {
  if (/\.[^./\\]+$/.test(name)) {
    return name
  }
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
  return `${name || 'photo'}.${extension}`
}

const readToken = async (token: string, name: string, type: string): Promise<File> => {
  const native = bridge()
  if (!native?.readMediaChunk || !native.closeMedia) {
    throw new Error('media bridge missing')
  }
  const parts: BlobPart[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = native.readMediaChunk(token)
      if (chunk === null) {
        throw new Error('read failed')
      }
      if (chunk === '') {
        break
      }
      const part = base64ToBytes(chunk)
      bytes += part.length
      if (bytes > MAX_FILE_BYTES) {
        throw new Error('file too large')
      }
      parts.push(part)
    }
  } finally {
    native.closeMedia(token)
  }
  const mime = type || 'image/jpeg'
  return new File(parts, withExtension(name, mime), { type: mime })
}

/** 读取相册缩略图对应的原图 */
export const readGalleryImage = async (item: GalleryItem): Promise<File> => {
  const native = bridge()
  const token = native?.openMedia?.(item.id) ?? null
  if (!token) {
    throw new Error('cannot open media')
  }
  return readToken(token, item.name, item.type)
}

/** 调用系统相机拍照；取消时返回 null */
export const capturePhoto = (): Promise<File | null> => {
  const native = bridge()
  if (!native?.takePhoto) {
    return Promise.resolve(null)
  }
  cameraWaiter?.({ cancelled: true })
  return new Promise((resolve, reject) => {
    cameraWaiter = (payload) => {
      if (payload.cancelled) {
        resolve(null)
        return
      }
      if (!payload.token) {
        reject(new Error(payload.error || 'camera failed'))
        return
      }
      readToken(payload.token, payload.name || 'photo.jpg', payload.type || 'image/jpeg').then(
        resolve,
        reject
      )
    }
    native.takePhoto?.()
  })
}
