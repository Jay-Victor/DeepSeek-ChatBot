import { useEffect, useRef, type CSSProperties } from 'react'
import { useSettings } from '../services/settings.js'
import { dropWallpaper, useWallpaper } from '../services/wallpaper.js'
import styles from './Wallpaper.module.css'

/**
 * 聊天页背景层：图片 / 视频铺满 frame，壁纸上方再盖一层可调浓度的主题底色蒙层。
 * 设置里没有背景时完全不渲染，页面保持原来的纯色外观。
 */
export const Wallpaper = () => {
  const kind = useSettings((state) => state.wallpaperKind)
  const overlay = useSettings((state) => state.wallpaperOverlay)
  const blur = useSettings((state) => state.wallpaperBlur)
  const media = useWallpaper((state) => state[kind])
  const videoRef = useRef<HTMLVideoElement>(null)

  // 只有存在背景时才让 frame / 面板切到半透明
  useEffect(() => {
    document.body.classList.toggle('wallpaper-active', Boolean(media))
    return () => document.body.classList.remove('wallpaper-active')
  }, [media])

  // 视频背景切到后台暂停，回到前台继续；避免锁屏后持续解码耗电
  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }
    const sync = () => {
      if (document.visibilityState === 'visible') {
        void video.play().catch(() => undefined)
      } else {
        video.pause()
      }
    }
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => document.removeEventListener('visibilitychange', sync)
  }, [media])

  if (!media) {
    return null
  }

  const style = {
    '--wallpaper-overlay': String(overlay / 100),
    '--wallpaper-blur': `${blur}px`,
  } as CSSProperties

  return (
    <div className={styles.layer} style={style} aria-hidden="true">
      {kind === 'image' ? (
        <img
          className={styles.media}
          src={media.url}
          alt=""
          draggable={false}
          onError={() => dropWallpaper(kind)}
        />
      ) : (
        <video
          ref={videoRef}
          className={styles.media}
          src={media.url}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onError={() => dropWallpaper(kind)}
        />
      )}
      <div className={styles.overlay} />
    </div>
  )
}
