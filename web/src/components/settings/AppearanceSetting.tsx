import { useTranslate } from '../../i18n/index.js'
import {
  setAccentHue,
  setWallpaperBlur,
  setWallpaperKind,
  setWallpaperOverlay,
  useSettings,
  type WallpaperKind,
} from '../../services/settings.js'
import {
  dropWallpaper,
  pickWallpaper,
  removeWallpaper,
  useWallpaper,
} from '../../services/wallpaper.js'
import { DEFAULT_ACCENT_HUE } from '../../app/accent.js'
import { Button } from '../base/Button.js'
import { Segmented } from '../base/Segmented.js'
import { Slider } from '../base/Slider.js'
import { showToast } from '../base/toastState.js'
import styles from './AppearanceSetting.module.css'

const mediaOptions: { value: WallpaperKind; labelKey: 'settingsWallpaperImage' | 'settingsWallpaperVideo' }[] =
  [
    { value: 'image', labelKey: 'settingsWallpaperImage' },
    { value: 'video', labelKey: 'settingsWallpaperVideo' },
  ]

/**
 * 外观分组：自定义背景（图片 / 视频、蒙层浓度、模糊）与主题色（色相滑杆）。
 * 所有改动即时生效并写 localStorage；背景媒体由壳复制到私有目录，浏览器回退到 IndexedDB。
 */
export const AppearanceSetting = () => {
  const t = useTranslate()
  const kind = useSettings((state) => state.wallpaperKind)
  const overlay = useSettings((state) => state.wallpaperOverlay)
  const blur = useSettings((state) => state.wallpaperBlur)
  const accentHue = useSettings((state) => state.accentHue)
  const media = useWallpaper((state) => state[kind])
  const picking = useWallpaper((state) => state.picking)
  const busy = picking !== null
  const hue = accentHue ?? DEFAULT_ACCENT_HUE
  const swatch = `hsl(${hue}, 85%, 55%)`

  const pick = async () => {
    const result = await pickWallpaper(kind)
    if (result === 'failed') {
      showToast({ key: 'settingsWallpaperPickFailed', type: 'error' })
    } else if (result === 'too_large') {
      showToast({ key: 'settingsWallpaperTooLarge', type: 'error' })
    } else if (result === 'unsupported') {
      showToast({ key: 'settingsWallpaperUnsupported', type: 'error' })
    }
  }

  const remove = async () => {
    await removeWallpaper(kind)
  }

  const onMediaError = () => {
    dropWallpaper(kind)
    showToast({ key: 'settingsWallpaperLoadFailed', type: 'error' })
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionTitle}>{t('settingsWallpaper')}</div>
        <div className={styles.card}>
          <Segmented
            ariaLabel={t('settingsWallpaper')}
            value={kind}
            options={mediaOptions.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            onChange={setWallpaperKind}
          />
          <div className={styles.preview}>
            {media ? (
              kind === 'image' ? (
                <img
                  className={styles.previewMedia}
                  src={media.url}
                  alt=""
                  draggable={false}
                  style={{ filter: `blur(${blur}px)` }}
                  onError={onMediaError}
                />
              ) : (
                <video
                  className={styles.previewMedia}
                  src={media.url}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  style={{ filter: `blur(${blur}px)` }}
                  onError={onMediaError}
                />
              )
            ) : (
              <div className={styles.empty}>{t('settingsWallpaperEmpty')}</div>
            )}
            <div className={styles.previewOverlay} style={{ opacity: overlay / 100 }} />
          </div>
          <div className={styles.actions}>
            <Button
              variant="outlined"
              size="m"
              className={styles.actionButton}
              disabled={!media || busy}
              onClick={() => void remove()}
            >
              {t('settingsWallpaperRemove')}
            </Button>
            <Button
              size="m"
              className={styles.actionButton}
              disabled={busy}
              onClick={() => void pick()}
            >
              {picking === kind
                ? t('settingsWallpaperPicking')
                : kind === 'image'
                  ? t('settingsWallpaperPickImage')
                  : t('settingsWallpaperPickVideo')}
            </Button>
          </div>
          <div className={styles.divider} />
          <div className={styles.sliders}>
            <Slider
              label={t('settingsWallpaperOverlay')}
              valueText={`${overlay}%`}
              value={overlay}
              min={0}
              max={100}
              hint={t('settingsWallpaperOverlayDescription')}
              disabled={!media}
              onChange={setWallpaperOverlay}
            />
            <Slider
              label={t('settingsWallpaperBlur')}
              valueText={`${blur}px`}
              value={blur}
              min={0}
              max={24}
              hint={t('settingsWallpaperBlurDescription')}
              disabled={!media}
              onChange={setWallpaperBlur}
            />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.accentTitle}>
            <span className={styles.swatch} style={{ backgroundColor: swatch }} aria-hidden="true" />
            <span className={styles.sectionTitle}>{t('settingsAccentColor')}</span>
          </div>
          <button
            type="button"
            className={styles.reset}
            disabled={accentHue === null}
            onClick={() => setAccentHue(null)}
          >
            {t('settingsAccentReset')}
          </button>
        </div>
        <div className={styles.card}>
          <Slider
            label={t('settingsAccentHue')}
            valueText={accentHue === null ? t('settingsAccentDefault') : `${accentHue}°`}
            value={hue}
            min={0}
            max={359}
            rainbow
            thumbColor={swatch}
            hint={t('settingsAccentDescription')}
            onChange={(value) => setAccentHue(value)}
          />
        </div>
      </section>

      <div className={styles.note}>{t('settingsAppearanceDeviceOnly')}</div>
    </>
  )
}
