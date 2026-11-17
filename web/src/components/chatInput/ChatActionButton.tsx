import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  IconMicFill16,
  IconMicOutline16,
  IconSendOutline16,
  IconStopFill16,
} from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import type { VoiceInputStatus } from './useVoiceInput.js'
import styles from './ChatActionButton.module.css'

/**
 * 输入框右侧的单按钮：
 * 没有内容时是麦克风，有内容后变发送，输出中变停止；录音与转写沿用原来的光圈、读秒和加载环。
 */
export type ChatActionMode = 'voice' | 'send' | 'stop' | Exclude<VoiceInputStatus, 'idle'>

export const ChatActionButton = ({
  mode,
  seconds,
  dimmed = false,
  unavailable = false,
  onClick,
}: {
  mode: ChatActionMode
  /** 本次录音已录秒数，录音中显示在按钮左侧 */
  seconds: number
  /** 置灰但保留 tooltip 与无障碍名称；是否响应由调用方判断 */
  dimmed?: boolean
  /** 非安全上下文：语音入口不可用，tooltip 换成 HTTPS 提示 */
  unavailable?: boolean
  onClick: () => void
}) => {
  const t = useTranslate()
  const label =
    mode === 'voice'
      ? t(unavailable ? 'voiceInputRequiresHttps' : 'voiceInput')
      : mode === 'recording'
        ? t('voiceInputStop')
        : mode === 'transcribing'
          ? t('voiceInputCancel')
          : mode === 'stop'
            ? t('chatInputStopButtonTooltip')
            : t('send')

  return (
    <>
      {mode === 'recording' ? (
        <span className={styles.timer}>{t('voiceInputTimer', { seconds })}</span>
      ) : null}
      <Tooltip content={label}>
        <button
          type="button"
          className={clsx(
            styles.button,
            (mode === 'send' || mode === 'stop') && styles.primary,
            dimmed && styles.dimmed
          )}
          aria-label={label}
          aria-disabled={dimmed}
          aria-pressed={mode === 'recording' ? true : undefined}
          onClick={onClick}
        >
          {/* key 让图标换位时重新播一次进出场动画 */}
          <span key={mode} className={styles.swap}>
            {mode === 'recording' ? (
              <span className={styles.active}>
                <span className={styles.halo} />
                <span className={styles.core} />
                <span className={styles.outline}>
                  <IconMicOutline16 />
                </span>
                <span className={styles.glyph}>
                  <IconMicFill16 />
                </span>
              </span>
            ) : mode === 'transcribing' ? (
              <span className={styles.loading} />
            ) : mode === 'stop' ? (
              <IconStopFill16 />
            ) : mode === 'send' ? (
              <IconSendOutline16 />
            ) : (
              <IconMicOutline16 />
            )}
          </span>
        </button>
      </Tooltip>
    </>
  )
}
