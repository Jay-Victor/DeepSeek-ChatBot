import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { Message } from '../../services/chat/types.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import styles from './MessageLocator.module.css'

/** 轨道上下留白，避免圆点贴边被裁掉 */
const RAIL_INSET = 8
/** 低于这个高度不显示轨道（键盘弹出、窗口过矮） */
const MIN_TRACK_HEIGHT = 80
/** 与 MessageList 的跟底阈值保持一致 */
const NEAR_BOTTOM = 40
/** 轨道高度 / 消息数小于该值时隐藏回答刻度，只保留提问点 */
const DENSITY_THRESHOLD = 6
/** 预览卡的大致高度，用于把它夹在轨道范围内 */
const PREVIEW_HEIGHT = 100
/** 鼠标悬停时离 marker 多远显示预览 */
const HOVER_DISTANCE = 18

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

type Marker = {
  id: string
  role: 'user' | 'assistant'
  /** 相对轨道顶部的像素位置 */
  top: number
  preview: string
  isLast: boolean
}

type Geometry = {
  /** 滚动层相对 .body 的顶部 */
  top: number
  /** 滚动层可见高度（已扣掉输入框覆盖部分） */
  height: number
  /** 可放置 marker / 滑块的轨道高度 */
  trackHeight: number
  thumbHeight: number
  maxScroll: number
  scrollHeight: number
  clientHeight: number
  composerHeight: number
}

type PreviewState = {
  id: string
  role: 'user' | 'assistant'
  text: string
  top: number
}

export const MessageLocator = ({
  bodyRef,
  scrollRef,
  contentRef,
  composerRef,
  messages,
  isMobile,
  onJumpToMessage,
  onScrollToBottom,
}: {
  bodyRef: RefObject<HTMLDivElement>
  scrollRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  composerRef: RefObject<HTMLDivElement>
  messages: Message[]
  isMobile: boolean
  onJumpToMessage: (messageId: string, isLast: boolean) => void
  onScrollToBottom: () => void
}) => {
  const t = useTranslate()
  const railRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startY: number
    moved: boolean
    onThumb: boolean
  } | null>(null)
  const geometryRef = useRef<Geometry | null>(null)
  const markersRef = useRef<Marker[]>([])
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const messageKey = useMemo(() => messages.map((message) => message.id).join('|'), [messages])

  const previewMessage = useCallback(
    (message: Message | undefined): string => {
      if (!message) {
        return ''
      }
      const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()
      if (message.role === 'user') {
        return (
          collapse(message.content) ||
          message.files.map((file) => file.name).join('、') ||
          t('messageLocatorEmpty')
        )
      }
      const text = collapse(
        message.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ')
      )
      return text || t('messageLocatorEmpty')
    },
    [t]
  )

  const updateThumb = useCallback(() => {
    const scroll = scrollRef.current
    const rail = railRef.current
    const thumb = thumbRef.current
    const current = geometryRef.current
    if (!scroll || !thumb || !current) {
      return
    }
    const ratio = current.maxScroll > 0 ? clamp(scroll.scrollTop / current.maxScroll, 0, 1) : 0
    const travel = Math.max(0, current.trackHeight - current.thumbHeight)
    thumb.style.height = `${current.thumbHeight}px`
    thumb.style.transform = `translate(-50%, ${ratio * travel}px)`
    rail?.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
  }, [scrollRef])

  const updateAtBottom = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) {
      return
    }
    const near = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < NEAR_BOTTOM
    setAtBottom((previous) => (previous === near ? previous : near))
  }, [scrollRef])

  const measure = useCallback(() => {
    const scroll = scrollRef.current
    const body = bodyRef.current
    const content = contentRef.current
    if (!scroll || !body || !content) {
      return
    }
    const scrollRect = scroll.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const composerRect = composerRef.current?.getBoundingClientRect()
    let overlay = 0
    if (composerRect) {
      overlay = Math.max(
        0,
        Math.min(scrollRect.bottom, composerRect.bottom) -
          Math.max(scrollRect.top, composerRect.top)
      )
    }
    const height = scrollRect.height - overlay
    const trackHeight = Math.max(0, height - RAIL_INSET * 2)
    const scrollHeight = Math.max(1, scroll.scrollHeight)
    const clientHeight = scroll.clientHeight
    const maxScroll = Math.max(0, scrollHeight - clientHeight)
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(18, (clientHeight / scrollHeight) * trackHeight)
    )
    const next: Geometry = {
      top: scrollRect.top - bodyRect.top,
      height,
      trackHeight,
      thumbHeight,
      maxScroll,
      scrollHeight,
      clientHeight,
      composerHeight: composerRect?.height ?? 0,
    }
    const previous = geometryRef.current
    geometryRef.current = next
    if (
      !previous ||
      previous.top !== next.top ||
      previous.height !== next.height ||
      previous.trackHeight !== next.trackHeight ||
      previous.thumbHeight !== next.thumbHeight ||
      previous.maxScroll !== next.maxScroll ||
      previous.scrollHeight !== next.scrollHeight ||
      previous.clientHeight !== next.clientHeight ||
      previous.composerHeight !== next.composerHeight
    ) {
      setGeometry(next)
    }
    if (height < MIN_TRACK_HEIGHT) {
      markersRef.current = []
      setMarkers([])
      updateThumb()
      return
    }
    const byId = new Map(messagesRef.current.map((message) => [message.id, message]))
    const items: Marker[] = []
    const nodes = content.querySelectorAll<HTMLElement>('[data-message-id]')
    nodes.forEach((node, index) => {
      const id = node.dataset.messageId
      if (!id) {
        return
      }
      const role = node.dataset.messageRole === 'assistant' ? 'assistant' : 'user'
      const rect = node.getBoundingClientRect()
      const top = rect.top - scrollRect.top + scroll.scrollTop
      const ratio = clamp(top / scrollHeight, 0, 1)
      items.push({
        id,
        role,
        top: clamp(ratio * trackHeight, 3, Math.max(3, trackHeight - 3)),
        preview: previewMessage(byId.get(id)),
        isLast: index === nodes.length - 1,
      })
    })
    const dense = items.length > 0 && trackHeight / items.length < DENSITY_THRESHOLD
    const visible = dense ? items.filter((item) => item.role === 'user') : items
    const nextMarkers = visible.length > 0 ? visible : items
    markersRef.current = nextMarkers
    setMarkers(nextMarkers)
    updateThumb()
    updateAtBottom()
  }, [bodyRef, composerRef, contentRef, previewMessage, scrollRef, updateAtBottom, updateThumb])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    const composer = composerRef.current
    if (!scroll || !content) {
      return
    }
    let disposed = false
    let measureFrame = 0
    let measureTimer = 0
    let scrollFrame = 0
    // 流式正文每帧都在增高；定位点不需要跟着每一帧重算，100ms 一次足够且不卡长会话。
    const scheduleMeasure = () => {
      if (measureTimer !== 0) {
        return
      }
      measureTimer = window.setTimeout(() => {
        measureTimer = 0
        measureFrame = requestAnimationFrame(() => {
          if (!disposed) {
            measure()
          }
        })
      }, 100)
    }
    const onScroll = () => {
      if (scrollFrame !== 0) {
        return
      }
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0
        if (!disposed) {
          updateThumb()
          updateAtBottom()
        }
      })
    }
    measure()
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(scroll)
    observer.observe(content)
    if (composer) {
      observer.observe(composer)
    }
    scroll.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    document.fonts?.ready
      .then(() => {
        if (!disposed) {
          scheduleMeasure()
        }
      })
      .catch(() => {})
    return () => {
      disposed = true
      window.clearTimeout(measureTimer)
      cancelAnimationFrame(measureFrame)
      cancelAnimationFrame(scrollFrame)
      observer.disconnect()
      scroll.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [composerRef, contentRef, isMobile, measure, scrollRef, updateAtBottom, updateThumb])

  // 消息 id / 数量变化（新消息、分支、版本、压缩）时重算；流式追加正文只有高度变化，靠 ResizeObserver。
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [messageKey, measure])

  useEffect(() => {
    if (activeId && !markers.some((marker) => marker.id === activeId)) {
      activeIdRef.current = null
      setActiveId(null)
      setPreview(null)
    }
  }, [activeId, markers])

  // 轨道刚挂载或尺寸变化后，滑块还没有内联高度/位移，补一次。
  useLayoutEffect(() => {
    updateThumb()
  }, [geometry, updateThumb])

  const nearestMarker = useCallback((y: number): Marker | null => {
    const items = markersRef.current
    if (items.length === 0) {
      return null
    }
    let best = items[0]
    let distance = Math.abs(best.top - y)
    for (const marker of items.slice(1)) {
      const next = Math.abs(marker.top - y)
      if (next < distance) {
        best = marker
        distance = next
      }
    }
    return best
  }, [])

  const showPreview = useCallback((marker: Marker | null) => {
    if (!marker) {
      if (activeIdRef.current === null) {
        return
      }
      activeIdRef.current = null
      setPreview(null)
      setActiveId(null)
      return
    }
    if (activeIdRef.current === marker.id) {
      return
    }
    activeIdRef.current = marker.id
    const current = geometryRef.current
    const half = PREVIEW_HEIGHT / 2
    const top = current
      ? clamp(
          marker.top,
          Math.min(half, current.trackHeight / 2),
          Math.max(half, current.trackHeight - half)
        )
      : marker.top
    setPreview({
      id: marker.id,
      role: marker.role,
      text: marker.preview,
      top,
    })
    setActiveId(marker.id)
  }, [])

  const pointerY = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = railRef.current?.getBoundingClientRect()
    return rect ? event.clientY - rect.top : 0
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!geometryRef.current || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }
    const thumb = thumbRef.current?.getBoundingClientRect()
    const onThumb = thumb ? event.clientY >= thumb.top && event.clientY <= thumb.bottom : false
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
      onThumb,
    }
    setDragging(true)
    showPreview(nearestMarker(pointerY(event)))
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const y = pointerY(event)
    if (drag && drag.pointerId === event.pointerId) {
      if (Math.abs(event.clientY - drag.startY) > 4) {
        drag.moved = true
      }
      if (drag.moved) {
        const current = geometryRef.current
        const scroll = scrollRef.current
        if (current && scroll) {
          const ratio = clamp(y / Math.max(1, current.trackHeight), 0, 1)
          scroll.scrollTop = ratio * current.maxScroll
          updateThumb()
          updateAtBottom()
        }
      }
      showPreview(nearestMarker(y))
      return
    }
    if (event.pointerType === 'mouse') {
      const marker = nearestMarker(y)
      showPreview(marker && Math.abs(marker.top - y) <= HOVER_DISTANCE ? marker : null)
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!drag.moved && !drag.onThumb) {
      const marker = nearestMarker(pointerY(event))
      if (marker) {
        onJumpToMessage(marker.id, marker.isLast)
        showPreview(null)
      }
    }
    if (event.pointerType !== 'mouse') {
      showPreview(null)
    }
  }

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    showPreview(null)
  }

  const onPointerLeave = () => {
    if (!dragRef.current) {
      showPreview(null)
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home') {
      event.preventDefault()
      const first = markersRef.current[0]
      if (first) {
        onJumpToMessage(first.id, first.isLast)
      }
    } else if (event.key === 'End') {
      event.preventDefault()
      onScrollToBottom()
    }
  }

  const railVisible =
    geometry !== null &&
    geometry.height >= MIN_TRACK_HEIGHT &&
    geometry.scrollHeight > geometry.clientHeight + 120 &&
    messages.length >= 3
  const showBackToBottom =
    geometry !== null && !atBottom && geometry.scrollHeight > geometry.clientHeight + NEAR_BOTTOM

  return (
    <>
      {railVisible && geometry ? (
        <div
          ref={railRef}
          className={clsx(styles.rail, dragging && styles.dragging)}
          style={{
            top: geometry.top + RAIL_INSET,
            height: Math.max(0, geometry.height - RAIL_INSET * 2),
          }}
          role="scrollbar"
          aria-label={t('messageLocator')}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown}
        >
          <div className={styles.track}>
            {markers.map((marker) => (
              <span
                key={marker.id}
                aria-hidden="true"
                className={clsx(
                  styles.marker,
                  marker.role === 'user' ? styles.userMarker : styles.assistantMarker,
                  activeId === marker.id && styles.markerActive
                )}
                style={{ top: marker.top }}
              />
            ))}
            <div ref={thumbRef} className={styles.thumb} />
          </div>
          {preview ? (
            <div className={styles.preview} style={{ top: preview.top }} role="presentation">
              <div className={styles.previewRole}>
                {t(preview.role === 'user' ? 'messageLocatorQuestion' : 'messageLocatorAnswer')}
              </div>
              <div className={styles.previewText}>{preview.text}</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showBackToBottom ? (
        <div className={styles.backPosition} style={{ bottom: geometry.composerHeight + 12 }}>
          <Tooltip content={t('backToBottom')} placement="top">
            <button
              type="button"
              className={styles.backToBottom}
              aria-label={t('backToBottom')}
              onClick={onScrollToBottom}
            >
              <IconChevronDownOutline14 />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </>
  )
}
