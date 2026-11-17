import { useEffect, type RefObject } from 'react'
import { useSearchPanel } from '../search/searchPanelState.js'
import { useSettingsDialog } from '../settings/settingsDialogState.js'
import {
  closeMobileSider,
  openMobileSider,
  setMobileSiderDragging,
  settleMobileSider,
  useMobileSider,
} from './mobileSiderState.js'

/** 开合动画时长；拖动时不用它，松手后按同一条进度曲线补完 */
const DURATION = 280
/** 判定为横向手势前允许的抖动 */
const START_SLOP = 8
/** 松手速度（px/ms）：超过它按方向吸附，否则看已推开的比例 */
const FLICK_VELOCITY = 0.35
/** 手指停住后再松手不算甩动 */
const FLICK_IDLE = 120

type DragMode = 'open' | 'close'

type Drag = {
  mode: DragMode
  startX: number
  startY: number
  lastX: number
  lastTime: number
  velocity: number
  locked: boolean
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** 收尾干脆、起步快，接近抽屉常用的减速曲线 */
const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3

/**
 * 推挤式侧边栏的位移与手势：
 * 把一条 0–1 的进度写到 .frame 上的 --sider-progress / --sider-offset，
 * 抽屉和主内容各自用 CSS 读取同一个值，拖动、吸附和按钮开合都不会脱节。
 *
 * 手势从全屏任意位置开始（Android 手势导航把左边缘留给了系统返回，
 * 所以不以屏幕边缘作为打开入口），纵向滚动、横向滚动区、输入框内的触摸都让行。
 */
export const usePushSider = (
  frameRef: RefObject<HTMLDivElement>,
  drawerRef: RefObject<HTMLDivElement>
) => {
  useEffect(() => {
    const frame = frameRef.current
    const drawer = drawerRef.current
    if (!frame || !drawer) {
      return
    }

    let progress = 0
    let width = drawer.getBoundingClientRect().width
    let frameId = 0
    let animating = false
    let drag: Drag | null = null
    let suppressClick = false
    let suppressTimer = 0

    const apply = (next: number) => {
      progress = next
      if (width <= 0) {
        width = drawer.getBoundingClientRect().width
      }
      frame.style.setProperty('--sider-progress', String(next))
      frame.style.setProperty('--sider-offset', `${Math.round(next * width * 100) / 100}px`)
    }

    const animateTo = (target: number, done?: () => void) => {
      window.cancelAnimationFrame(frameId)
      animating = false
      const from = progress
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reducedMotion || Math.abs(target - from) < 0.001) {
        apply(target)
        done?.()
        return
      }
      const startedAt = performance.now()
      animating = true
      const step = (now: number) => {
        const elapsed = Math.min(1, (now - startedAt) / DURATION)
        apply(from + (target - from) * easeOutCubic(elapsed))
        if (elapsed < 1) {
          frameId = window.requestAnimationFrame(step)
        } else {
          animating = false
          apply(target)
          done?.()
        }
      }
      frameId = window.requestAnimationFrame(step)
    }

    // 抽屉的开合只有一个来源：状态变化。按钮、返回键、选中会话都走这里
    const unsubscribe = useMobileSider.subscribe((state, previous) => {
      if (state.open === previous.open) {
        return
      }
      if (state.open) {
        animateTo(1)
      } else {
        animateTo(0, settleMobileSider)
      }
    })

    /** 触摸起点落在横向滚动区里（代码块、表格、附件横滑条）时让给页面 */
    const isHorizontalScroller = (target: EventTarget | null) => {
      for (
        let element = target instanceof Element ? target : null;
        element && element !== frame;
        element = element.parentElement
      ) {
        const style = getComputedStyle(element)
        if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) {
          return true
        }
      }
      return false
    }

    /** 文本框内横向拖动用于选字，不抢 */
    const isTextControl = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || animating || drag) {
        return
      }
      // 新手势开始，上一次拖动残留的点击抑制作废
      suppressClick = false
      window.clearTimeout(suppressTimer)
      const state = useMobileSider.getState()
      if (!state.open) {
        // 设置弹窗、搜索结果面板打开时不响应打开手势
        if (useSettingsDialog.getState().open || useSearchPanel.getState().entry !== null) {
          return
        }
        if (isTextControl(event.target) || isHorizontalScroller(event.target)) {
          return
        }
      } else if (isHorizontalScroller(event.target)) {
        return
      }
      const measured = drawer.getBoundingClientRect().width
      if (measured <= 0) {
        return
      }
      width = measured
      const touch = event.touches[0]
      drag = {
        mode: state.open ? 'close' : 'open',
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastTime: performance.now(),
        velocity: 0,
        locked: false,
      }
    }

    /** 松开或取消时按同一个规则吸附：先看甩动方向，再看推开的比例 */
    const settle = (targetOpen: boolean) => {
      const state = useMobileSider.getState()
      if (targetOpen) {
        if (state.open) {
          animateTo(1)
        } else {
          openMobileSider()
        }
      } else if (state.open) {
        closeMobileSider()
      } else {
        // 本来就没开：没有状态变化可订阅，自己把动画补完
        closeMobileSider()
        animateTo(0, settleMobileSider)
      }
      setMobileSiderDragging(false)
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!drag) {
        return
      }
      if (event.touches.length !== 1) {
        // 第二根手指加入（缩放等）：按当前进度收尾，别把抽屉停在半路
        const locked = drag.locked
        drag = null
        if (locked) {
          settle(progress > 0.5)
        }
        return
      }
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      const dx = touch.clientX - drag.startX
      const dy = touch.clientY - drag.startY
      const now = performance.now()
      const elapsed = now - drag.lastTime
      if (elapsed > 0) {
        drag.velocity = (touch.clientX - drag.lastX) / elapsed
        drag.lastX = touch.clientX
        drag.lastTime = now
      }

      if (!drag.locked) {
        // 纵向占优：本次触摸交给页面滚动，之后不再接管
        if (Math.abs(dy) > START_SLOP && Math.abs(dy) >= Math.abs(dx)) {
          drag = null
          return
        }
        const forward = drag.mode === 'open' ? dx : -dx
        if (forward < START_SLOP || Math.abs(dx) < Math.abs(dy) * 1.2) {
          return
        }
        drag.locked = true
        window.cancelAnimationFrame(frameId)
        animating = false
        setMobileSiderDragging(true)
      }

      event.preventDefault()
      const raw = drag.mode === 'open' ? dx / width : 1 + dx / width
      apply(clamp01(raw))
    }

    const onTouchEnd = () => {
      if (!drag) {
        return
      }
      const { locked } = drag
      const idle = performance.now() - drag.lastTime
      const velocity = idle > FLICK_IDLE ? 0 : drag.velocity
      drag = null
      if (!locked) {
        return
      }
      // 拖完会补发一次 click，落在会话项上会误切会话
      suppressClick = true
      window.clearTimeout(suppressTimer)
      suppressTimer = window.setTimeout(() => {
        suppressClick = false
      }, 500)

      let targetOpen: boolean
      if (velocity > FLICK_VELOCITY) {
        targetOpen = true
      } else if (velocity < -FLICK_VELOCITY) {
        targetOpen = false
      } else {
        targetOpen = progress > 0.5
      }
      settle(targetOpen)
    }

    const onTouchCancel = () => {
      if (!drag) {
        return
      }
      const locked = drag.locked
      drag = null
      if (!locked) {
        return
      }
      const opened = useMobileSider.getState().open
      if (!opened) {
        // 关到底之前保持内容挂载，避免回弹动画里抽屉变空
        closeMobileSider()
      }
      setMobileSiderDragging(false)
      animateTo(opened ? 1 : 0, settleMobileSider)
    }

    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) {
        return
      }
      suppressClick = false
      window.clearTimeout(suppressTimer)
      event.preventDefault()
      event.stopPropagation()
    }

    // 旋转、键盘弹出都会改变可视高度；宽度变了要按新宽度重算位移
    const onResize = () => {
      const measured = drawer.getBoundingClientRect().width
      if (measured <= 0) {
        return
      }
      width = measured
      apply(progress)
    }

    apply(useMobileSider.getState().open ? 1 : 0)

    frame.addEventListener('touchstart', onTouchStart, { passive: true })
    frame.addEventListener('touchmove', onTouchMove, { passive: false })
    frame.addEventListener('touchend', onTouchEnd)
    frame.addEventListener('touchcancel', onTouchCancel)
    frame.addEventListener('click', onClickCapture, true)
    window.addEventListener('resize', onResize)

    return () => {
      unsubscribe()
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(suppressTimer)
      frame.removeEventListener('touchstart', onTouchStart)
      frame.removeEventListener('touchmove', onTouchMove)
      frame.removeEventListener('touchend', onTouchEnd)
      frame.removeEventListener('touchcancel', onTouchCancel)
      frame.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('resize', onResize)
      frame.style.removeProperty('--sider-progress')
      frame.style.removeProperty('--sider-offset')
    }
  }, [drawerRef, frameRef])
}
