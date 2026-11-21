import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  cancelCompression,
  compressSession,
  undoCompression,
  useCompression,
  type CompressionSkipReason,
} from '../../services/chat/compression.js'
import { computeContextUsage, type ContextUsage } from '../../services/tokenizer/contextUsage.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './ContextUsageRing.module.css'

const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** 1M 窗口下普通会话只有 1–2%，给一个最小可见弧度，避免看起来像坏了 */
const MIN_VISIBLE_ARC = 0.02

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

const skipKey = (reason: CompressionSkipReason): TranslationKey => {
  switch (reason) {
    case 'running':
      return 'contextCompressRunning'
    case 'busy':
      return 'contextCompressBusy'
    case 'too-short':
      return 'contextCompressTooShort'
    case 'below-target':
      return 'contextCompressBelowTarget'
    case 'nothing-to-compress':
      return 'contextCompressNothing'
    case 'no-key':
      return 'contextCompressNoKey'
    case 'stale':
      return 'contextCompressStale'
    case 'cooldown':
      return 'contextCompressBusy'
    default:
      return 'contextCompressStale'
  }
}

/** 输入框内的上下文占用环：回合结束、切换会话或分支后统计一次 */
export const ContextUsageRing = ({ sessionId }: { sessionId: string }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const autoCompress = useSettings((state) => state.autoCompress)
  const compressThreshold = useSettings((state) => state.compressThreshold)
  const compressTarget = useSettings((state) => state.compressTarget)
  const session = useChatStore((state) => state.sessionCache[sessionId])
  const streaming = useChatStore((state) => Object.hasOwn(state.streaming, sessionId))
  const active = useChatStore((state) => state.activeId === sessionId)
  const running = useCompression((state) => state.running[sessionId])
  const [usage, setUsage] = useState<ContextUsage | null>(null)
  const [open, setOpen] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  /** 一轮回复只自动尝试一次；下次生成开始或切换会话时重置 */
  const autoTried = useRef(false)

  // 会话切换时先清掉上一份统计，避免短暂显示别人的数字
  useEffect(() => {
    setUsage(null)
    setOpen(false)
    setShowSummary(false)
    autoTried.current = false
  }, [sessionId])

  useEffect(() => {
    if (streaming) {
      autoTried.current = false
    }
  }, [streaming])

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

  // 自动压缩：只在当前会话、超过阈值、没有生成/压缩任务时尝试一次
  useEffect(() => {
    if (!usage || streaming || !autoCompress || !active || running) {
      return
    }
    if (usage.percent * 100 < compressThreshold || autoTried.current) {
      return
    }
    autoTried.current = true
    void compressSession(sessionId, 'auto').then((result) => {
      if (result.status === 'done') {
        showToast({
          key:
            result.afterPercent <= compressTarget
              ? 'contextCompressDone'
              : 'contextCompressPartial',
          params: {
            rounds: result.rounds,
            before: result.beforePercent.toFixed(1),
            after: result.afterPercent.toFixed(1),
            target: compressTarget,
          },
        })
      } else if (result.status === 'failed') {
        showToast({ key: 'contextCompressFailed', type: 'error' })
      }
    })
  }, [
    usage,
    streaming,
    autoCompress,
    active,
    running,
    sessionId,
    compressThreshold,
    compressTarget,
  ])

  const runCompression = async () => {
    // 手动压缩后不要立刻被自动压缩再压一次；下一轮生成开始时再允许
    autoTried.current = true
    setShowSummary(false)
    const result = await compressSession(sessionId, 'manual')
    if (result.status === 'done') {
      showToast({
        key:
          result.afterPercent <= compressTarget ? 'contextCompressDone' : 'contextCompressPartial',
        params: {
          rounds: result.rounds,
          before: result.beforePercent.toFixed(1),
          after: result.afterPercent.toFixed(1),
          target: compressTarget,
        },
      })
      return
    }
    if (result.status === 'cancelled') {
      showToast({ key: 'contextCompressCancelled' })
      return
    }
    if (result.status === 'failed') {
      showToast({ key: 'contextCompressFailed', type: 'error' })
      return
    }
    if (result.reason === 'no-key') {
      setOpen(false)
      showToast({ key: 'contextCompressNoKey', type: 'error' })
      openSettings('data')
      return
    }
    showToast({
      key: skipKey(result.reason),
      ...(result.reason === 'running' || result.reason === 'busy' ? { type: 'error' as const } : {}),
    })
  }

  const undo = () => {
    if (!undoCompression(sessionId)) {
      return
    }
    // 撤销后不要马上被自动压缩又压回去；下一轮生成开始时再允许
    autoTried.current = true
    setShowSummary(false)
    showToast({ key: 'contextCompressUndone' })
  }

  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open && Boolean(usage),
    { side: 'top', align: 'end', offset: 8, maxHeight: 380, measureKey: usage }
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
  // usage.compression 为 null 时即使会话上有记录，也说明它不在当前分支上
  const compression = usage.compression ? session.compression : undefined

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
              aria-busy={running ? true : undefined}
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
              {usage.summary > 0 ? (
                <div className={styles.row}>
                  <span>{t('contextUsageSummary')}</span>
                  <span className={styles.num}>{format(usage.summary)}</span>
                </div>
              ) : null}
              <div className={styles.row}>
                <span>{t('contextUsageSystem')}</span>
                <span className={styles.num}>
                  {format(usage.used - usage.dialog - usage.summary)}
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

              <div className={styles.compress}>
                {running ? (
                  <div className={styles.compressRow}>
                    <span className={styles.compressState}>
                      {t('contextCompressing', { done: running.done, total: running.total })}
                    </span>
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => cancelCompression(sessionId)}
                    >
                      {t('contextCompressCancel')}
                    </button>
                  </div>
                ) : compression ? (
                  <>
                    <div className={styles.compressState}>
                      {t('contextCompressCovered', {
                        rounds: compression.coveredRounds,
                        tokens: format(compression.coveredTokens),
                      })}
                    </div>
                    <div className={styles.compressRow}>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => setShowSummary((value) => !value)}
                      >
                        {showSummary
                          ? t('contextCompressHideSummary')
                          : t('contextCompressViewSummary')}
                      </button>
                      <button type="button" className={styles.textButton} onClick={undo}>
                        {t('contextCompressUndo')}
                      </button>
                    </div>
                    {showSummary ? (
                      <div className={styles.summaryText}>{compression.summary}</div>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.compressButton}
                    disabled={streaming}
                    onClick={() => void runCompression()}
                  >
                    {t('contextCompressAction')}
                  </button>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </span>
  )
}
