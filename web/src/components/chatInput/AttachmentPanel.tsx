import { useEffect, useState } from 'react'
import {
  capturePhoto,
  loadGallery,
  readGalleryImage,
  type GalleryItem,
} from '../../app/media.js'
import { useTranslate } from '../../i18n/index.js'
import { isAcceptedExt } from '../../services/attachments.js'
import {
  IconCameraOutline20,
  IconFileOutline20,
  IconImageOutline20,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './AttachmentPanel.module.css'

type GalleryState = 'idle' | 'loading' | 'ready' | 'permission' | 'failed'

/**
 * 添加附件面板：一行最近照片 + 拍照 / 相册 / 文件。
 * 面板由输入框下方的网格槽展开，输入框随之上滑；关闭时内容高度收为 0。
 */
export const AttachmentPanel = ({
  active,
  onPickFiles,
  onOpenAlbum,
  onOpenFiles,
}: {
  active: boolean
  onPickFiles: (files: File[]) => void
  onOpenAlbum: () => void
  onOpenFiles: () => void
}) => {
  const t = useTranslate()
  const [items, setItems] = useState<GalleryItem[]>([])
  const [state, setState] = useState<GalleryState>('idle')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!active) {
      return
    }
    let alive = true
    setState('loading')
    void loadGallery().then((result) => {
      if (!alive) {
        return
      }
      if (result.error) {
        setItems([])
        setState(result.error)
        return
      }
      setItems(result.items.filter((item) => isAcceptedExt(item.name)))
      setState('ready')
    })
    return () => {
      alive = false
    }
  }, [active])

  const pickPhoto = async (item: GalleryItem) => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      onPickFiles([await readGalleryImage(item)])
    } catch {
      showToast(t('attachmentReadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const takePhoto = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const file = await capturePhoto()
      if (file) {
        onPickFiles([file])
      }
    } catch {
      showToast(t('attachmentCameraFailed'))
    } finally {
      setBusy(false)
    }
  }

  const retry = () => {
    setState('loading')
    void loadGallery().then((result) => {
      if (result.error) {
        setItems([])
        setState(result.error)
        return
      }
      setItems(result.items.filter((item) => isAcceptedExt(item.name)))
      setState('ready')
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.gallery} aria-busy={state === 'loading'}>
        {state === 'loading' ? (
          Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={styles.skeleton} />
          ))
        ) : state === 'permission' ? (
          <div className={styles.notice}>
            <span>
              {t('attachmentGalleryPermission')} · {t('attachmentGalleryPermissionHint')}
            </span>
            <button type="button" className={styles.retry} onClick={retry}>
              {t('attachmentGalleryRetry')}
            </button>
          </div>
        ) : state === 'failed' ? (
          <div className={styles.notice}>
            <span>{t('attachmentGalleryPermission')}</span>
            <button type="button" className={styles.retry} onClick={retry}>
              {t('attachmentGalleryRetry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.notice}>
            <span>{t('attachmentGalleryEmpty')}</span>
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.thumb}
              title={item.name}
              aria-label={item.name}
              onClick={() => void pickPhoto(item)}
            >
              <img src={item.thumb} alt={item.name} loading="lazy" />
            </button>
          ))
        )}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.action} disabled={busy} onClick={takePhoto}>
          <IconCameraOutline20 />
          <span>{t('attachmentCamera')}</span>
        </button>
        <button type="button" className={styles.action} disabled={busy} onClick={onOpenAlbum}>
          <IconImageOutline20 />
          <span>{t('attachmentAlbum')}</span>
        </button>
        <button type="button" className={styles.action} disabled={busy} onClick={onOpenFiles}>
          <IconFileOutline20 />
          <span>{t('attachmentFiles')}</span>
        </button>
      </div>
    </div>
  )
}
