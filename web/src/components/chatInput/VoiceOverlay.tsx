import clsx from 'clsx'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { Spectrum } from './Spectrum.js'
import styles from './VoiceOverlay.module.css'

/**
 * 按住说话的全屏浮层：底部蓝色渐变 + 提示语 + 实时频谱。
 * pointer-events 关闭，按住的手指仍由触发按钮的 pointer capture 接收，不受浮层影响。
 */
export const VoiceOverlay = ({
  transcribing,
  cancelArmed,
  getAnalyser,
}: {
  transcribing: boolean
  /** 上滑到取消阈值后为 true */
  cancelArmed: boolean
  getAnalyser: () => AnalyserNode | null
}) => {
  const t = useTranslate()
  const hint = transcribing
    ? t('voiceTranscribing')
    : cancelArmed
      ? t('voiceReleaseToCancel')
      : t('voiceReleaseToSend')

  return createPortal(
    <div
      className={clsx(styles.overlay, cancelArmed && styles.cancel)}
      role="status"
      aria-live="polite"
    >
      <div className={styles.gradient} />
      <div className={styles.content}>
        <span className={styles.hint}>{hint}</span>
        {transcribing ? (
          <span className={styles.spinner} />
        ) : (
          <Spectrum variant="overlay" getAnalyser={getAnalyser} />
        )}
      </div>
    </div>,
    document.body
  )
}
