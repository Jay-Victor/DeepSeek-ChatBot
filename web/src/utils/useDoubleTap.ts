import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** 两次点击的最大间隔；Android WebView 不一定合成 dblclick，这里自己判定 */
const DOUBLE_TAP_INTERVAL = 320
/** 单次点击按下到抬起的最大位移，避免把滑动当成点击 */
const TAP_MOVE_TOLERANCE = 10
/** 两次点击落点的最大距离 */
const DOUBLE_TAP_DISTANCE = 24

type PointerHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * 同时覆盖鼠标双击与触屏双击。Android WebView 对 touch 的 dblclick 支持不稳定，
 * 所以用 pointerdown / pointerup 的时间与位移判定，标题不需要额外 onClick。
 */
export const useDoubleTap = (onDoubleTap: () => void, enabled = true): PointerHandlers => {
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const callbackRef = useRef(onDoubleTap)
  callbackRef.current = onDoubleTap

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary) {
      return
    }
    downRef.current = { x: event.clientX, y: event.clientY }
  }, [])

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || !event.isPrimary) {
        return
      }
      const down = downRef.current
      downRef.current = null
      if (!down || (event.pointerType === 'mouse' && event.button !== 0)) {
        lastTapRef.current = null
        return
      }
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_MOVE_TOLERANCE) {
        lastTapRef.current = null
        return
      }
      const last = lastTapRef.current
      if (
        last &&
        event.timeStamp - last.time <= DOUBLE_TAP_INTERVAL &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_TAP_DISTANCE
      ) {
        lastTapRef.current = null
        callbackRef.current()
        return
      }
      lastTapRef.current = { time: event.timeStamp, x: event.clientX, y: event.clientY }
    },
    [enabled]
  )

  const onPointerCancel = useCallback(() => {
    downRef.current = null
    lastTapRef.current = null
  }, [])

  return { onPointerDown, onPointerUp, onPointerCancel }
}
