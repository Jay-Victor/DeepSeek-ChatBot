import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { useImageViewer } from './imageViewerState.js'
import styles from './ImageViewer.module.css'

/**
 * 应用内图片预览：全屏遮罩 + contain 显示；点图片在「适应屏幕 / 原始尺寸」间切换，
 * 点空白、右上角关闭或返回键退出。返回键由 nativeBridge 把预览计入弹层状态。
 */
export const ImageViewer = () => {
  const t = useTranslate()
  const image = useImageViewer((state) => state.image)
  const zoomed = useImageViewer((state) => state.zoomed)
  const close = useImageViewer((state) => state.closeImage)
  const toggleZoom = useImageViewer((state) => state.toggleZoom)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!image) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(image.blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [image])

  useEffect(() => {
    if (!image) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [image, close])

  if (!image) {
    return null
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      onClick={close}
    >
      <div className={styles.header} onClick={(event) => event.stopPropagation()}>
        <span className={styles.name}>{image.name}</span>
        <button type="button" className={styles.close} aria-label={t('close')} onClick={close}>
          <IconCloseOutline16 />
        </button>
      </div>
      <div className={clsx(styles.stage, zoomed && styles.stageZoomed)}>
        {url ? (
          <img
            className={clsx(styles.image, zoomed && styles.imageZoomed)}
            src={url}
            alt={image.name}
            onClick={(event) => {
              event.stopPropagation()
              toggleZoom()
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
