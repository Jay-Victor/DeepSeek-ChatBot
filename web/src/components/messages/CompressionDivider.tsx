import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import type { ContextCompression } from '../../services/chat/types.js'
import styles from './CompressionDivider.module.css'

/** 消息列表中的压缩分隔条：说明哪些较早轮次不再进入请求，并可查看摘要 */
export const CompressionDivider = ({ compression }: { compression: ContextCompression }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const [open, setOpen] = useState(false)
  const format = (value: number) => new Intl.NumberFormat(locale).format(value)

  return (
    <div className={styles.divider}>
      <span className={styles.line} aria-hidden="true" />
      <button
        type="button"
        className={styles.label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('messageCompressedDivider', {
          rounds: compression.coveredRounds,
          tokens: format(compression.coveredTokens),
        })}
        <span className={styles.toggle}>
          {open ? t('messageCompressedHideSummary') : t('messageCompressedViewSummary')}
        </span>
      </button>
      <span className={styles.line} aria-hidden="true" />
      {open ? <div className={styles.summary}>{compression.summary}</div> : null}
    </div>
  )
}
