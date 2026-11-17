import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { useChatStore } from '../../services/chat/store.js'
import { computeContextUsage, type ContextUsage } from '../../services/tokenizer/contextUsage.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import styles from './ContextUsageRing.module.css'

const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** 1M 窗口下普通会话只有 1–2%，给一个最小可见弧度，避免看起来像坏了 */
const MIN_VISIBLE_ARC = 0.02

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

/** 输入框内的上下文占用环：回合结束、切换会话或分支后统计一次 */
export const ContextUsageRing = ({ sessionId }: { sessionId: string }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const session = useChatStore((state) => state.sessionCache[sessionId])
  const streaming = useChatStore((state) => Object.hasOwn(state.streaming, sessionId))
  const [usage, setUsage] = useState<ContextUsage | null>(null)
  const [open, setOpen] = useState(false)

  // 会话切换时先清掉上一份统计，避免短暂显示别人的数字
  useEffect(() => {
    setUsage(null)
    setOpen(false)
  }, [sessionId])

  useEffect(() => {
    if (!session || streaming) {
      return
    }
    let cancelled = false
    const run = () => {
      void computeContextUsage(session)
        .then((next) => {
          if (!cancelled) {
            setUsage(next)
          }
        })
        .catch(() => {
          // 资源未加载或解析失败时保留空环，不阻断输入框
        })
    }
    const idleWindow = window as IdleWindow
    const timer = idleWindow.requestIdleCallback?.(run, { timeout: 800 }) ??
      window.setTimeout(run, 0)
    return () => {
      cancelled = true
      if (idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(timer)
      } else {
        window.clearTimeout(timer)
      }
    }
  }, [session, streaming])

  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open && Boolean(usage),
    { side: 'top', align: 'end', offset: 8, measureKey: usage }
  )
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false))

  if (!session) {
    return null
  }

  // 首轮回复结束前没有可统计的内容：保留同宽占位，避免环出现时挤动功能行
  if (!usage) {
    return <span className={styles.anchor} aria-hidden />
  }

  const used = usage.used
  const percent = usage.percent
  const arc = percent > 0 ? Math.min(1, Math.max(percent, MIN_VISIBLE_ARC)) : 0
  const tone = percent >= 0.95 ? styles.danger : percent >= 0.7 ? styles.warning : undefined
  const format = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
  const percentText = (percent * 100).toFixed(percent >= 0.1 ? 1 : 2)

  const label = t('contextUsageDetail', {
    used: format(used),
    window: format(usage.window),
    percent: percentText,
  })

  return (
    <span ref={anchorRef} className={styles.anchor}>
      <button
        type="button"
        className={clsx(styles.button, tone)}
        aria-label={label}
        onClick={() => usage && setOpen((value) => !value)}
      >
        <svg className={styles.svg} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle className={styles.track} cx="12" cy="12" r={RADIUS} />
          <circle
            className={styles.progress}
            cx="12"
            cy="12"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - arc)}
          />
        </svg>
      </button>

      {open && usage
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.popover}
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
              role="dialog"
              aria-label={t('contextUsage')}
            >
              <div className={styles.title}>{t('contextUsage')}</div>
              <div className={styles.value}>
                {format(used)}
                <span> / {format(usage.window)}</span>
                <em>{percentText}%</em>
              </div>
              <div className={styles.row}>
                <span>{t('contextUsageDialog')}</span>
                <span className={styles.num}>{format(usage.dialog)}</span>
              </div>
              <div className={styles.row}>
                <span>{t('contextUsageSystem')}</span>
                <span className={styles.num}>
                  {format(usage.used - usage.dialog)}
                </span>
              </div>
              {usage.measured ? (
                <div className={styles.note}>
                  {t('contextUsageMeasured', {
                    prompt: format(usage.measured.prompt),
                    output: format(usage.measured.output),
                  })}
                </div>
              ) : null}
              {usage.approximate === 'attachments' ? (
                <div className={styles.note}>{t('contextUsageApproximate')}</div>
              ) : usage.approximate === 'uncalibrated' ? (
                <div className={styles.note}>{t('contextUsageUncalibrated')}</div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </span>
  )
}
