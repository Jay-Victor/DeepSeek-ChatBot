import clsx from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  IconGlobeLanguageOutline14,
  IconKeyboardCircle20,
  IconPlusCircle20,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { ChatActionButton, type ChatActionMode } from './ChatActionButton.js'
import { ContextUsageRing } from './ContextUsageRing.js'
import { Spectrum } from './Spectrum.js'
import { VoiceOverlay } from './VoiceOverlay.js'
import { useVoiceOverlay } from './voiceOverlayState.js'
import { AttachmentPanel } from './AttachmentPanel.js'
import { useAttachmentPanel } from './attachmentPanelState.js'
import { hasNativeMedia } from '../../app/media.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 上滑超过这个距离后松手视为取消 */
const VOICE_CANCEL_DISTANCE = 56

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)
  const [voiceMode, setVoiceMode] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [cancelArmed, setCancelArmed] = useState(false)
  const holdPointerRef = useRef<number | null>(null)
  const holdStartYRef = useRef<number | null>(null)
  const sendAfterVoiceRef = useRef(false)
  const focusAfterVoiceRef = useRef(false)
  const sendRef = useRef<(force?: boolean) => void>(() => {})
  const setVoiceOverlayOpen = useVoiceOverlay((state) => state.setOpen)
  const setAttachmentPanelOpen = useAttachmentPanel((state) => state.setOpen)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      // 用两个按钮的实际外框量需要多宽；scrollWidth 在 overflow: visible 下并不可靠
      const buttons = Array.from(toggles.querySelectorAll('button'))
      const required = buttons.length
        ? buttons[buttons.length - 1].getBoundingClientRect().right -
          buttons[0].getBoundingClientRect().left
        : 0
      toggles.classList.toggle(styles.collapsedToggles, required > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    // 字体晚于首帧生效时（系统字体 / 自定义字体）重新量一次
    let active = true
    void document.fonts?.ready.then(() => {
      if (active) {
        updateLabels()
      }
    })
    return () => {
      active = false
      observer.disconnect()
    }
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0) {
      return
    }
    setAttachmentOpen(false)
    if (useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处；按住说话时直接发送，其余情况把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    if (sendAfterVoiceRef.current) {
      sendAfterVoiceRef.current = false
      // 等 setText 写入草稿、浮层收起后再走正常的发送流程
      requestAnimationFrame(() => {
        setVoiceMode(false)
        sendRef.current(true)
      })
      return
    }
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = (force = false) => {
    if (
      useChatStore.getState().importingHistory ||
      (!force && voice.status !== 'idle') ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    setAttachmentOpen(false)
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }
  sendRef.current = send

  const resetHold = () => {
    holdPointerRef.current = null
    holdStartYRef.current = null
    setCancelArmed(false)
  }

  /** 按住说话：按下即开始录音，松手转写并按草稿直接发送 */
  const startHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (voice.status !== 'idle') {
      return
    }
    if (!voice.available) {
      showToast({ key: 'voiceInputRequiresHttps' })
      return
    }
    if (!ensureApiKey()) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    holdPointerRef.current = event.pointerId
    holdStartYRef.current = event.clientY
    setCancelArmed(false)
    sendAfterVoiceRef.current = true
    void voice.start()
  }

  const moveHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (holdPointerRef.current !== event.pointerId || holdStartYRef.current === null) {
      return
    }
    setCancelArmed(holdStartYRef.current - event.clientY >= VOICE_CANCEL_DISTANCE)
  }

  const endHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (holdPointerRef.current !== event.pointerId) {
      return
    }
    // 录满上限后 hook 已经自动进入转写，松手不能再取消这次转写
    if (voice.status === 'transcribing') {
      resetHold()
      return
    }
    const cancelled =
      holdStartYRef.current !== null &&
      holdStartYRef.current - event.clientY >= VOICE_CANCEL_DISTANCE
    resetHold()
    if (cancelled) {
      sendAfterVoiceRef.current = false
      voice.cancel()
      return
    }
    void voice.finish()
  }

  const abortHold = () => {
    resetHold()
    if (voice.status === 'transcribing') {
      return
    }
    sendAfterVoiceRef.current = false
    voice.cancel()
  }

  const enterVoiceMode = () => {
    if (importingHistory || !voice.available) {
      return
    }
    setAttachmentOpen(false)
    textareaRef.current?.blur()
    setVoiceMode(true)
  }

  const exitVoiceMode = () => {
    focusAfterVoiceRef.current = true
    setVoiceMode(false)
  }

  const closeAttachmentPanel = useCallback(() => setAttachmentOpen(false), [])

  const toggleAttachments = () => {
    if (attachmentOpen) {
      setAttachmentOpen(false)
      return
    }
    if (!ensureApiKey()) {
      return
    }
    // 桌面浏览器没有相册 / 拍照桥，保持原来的直接选文件
    if (!hasNativeMedia()) {
      fileInputRef.current?.click()
      return
    }
    setVoiceMode(false)
    textareaRef.current?.blur()
    setAttachmentOpen(true)
  }

  const openAlbumPicker = () => {
    setAttachmentOpen(false)
    imageInputRef.current?.click()
  }

  const openFilesPicker = () => {
    setAttachmentOpen(false)
    fileInputRef.current?.click()
  }

  useEffect(() => {
    setAttachmentPanelOpen(attachmentOpen, attachmentOpen ? closeAttachmentPanel : undefined)
  }, [attachmentOpen, setAttachmentPanelOpen, closeAttachmentPanel])

  useEffect(() => () => setAttachmentPanelOpen(false), [setAttachmentPanelOpen])

  /** 原生返回键关闭录音浮层：取消录音或转写 */
  const closeVoiceOverlay = useCallback(() => {
    holdPointerRef.current = null
    holdStartYRef.current = null
    setCancelArmed(false)
    sendAfterVoiceRef.current = false
    cancelVoice()
  }, [cancelVoice])

  useEffect(() => {
    const open = voiceMode && voice.status !== 'idle'
    setVoiceOverlayOpen(open, open ? closeVoiceOverlay : undefined)
  }, [voiceMode, voice.status, setVoiceOverlayOpen, closeVoiceOverlay])

  useEffect(() => () => setVoiceOverlayOpen(false), [setVoiceOverlayOpen])

  useEffect(() => {
    if (!voiceMode && focusAfterVoiceRef.current) {
      focusAfterVoiceRef.current = false
      textareaRef.current?.focus({ preventScroll: true })
    }
  }, [voiceMode])

  // 右侧只有一个主按钮：显式状态（录音 / 转写 / 停止）优先，其余按有没有内容在语音与发送之间切换
  const hasContent = text.trim().length > 0 || attachments.length > 0
  const actionMode: ChatActionMode =
    voice.status === 'recording'
      ? 'recording'
      : voice.status === 'transcribing'
        ? 'transcribing'
        : streaming && sessionId !== null
          ? 'stop'
          : hasContent
            ? 'send'
            : 'voice'
  const actionDimmed =
    actionMode === 'send'
      ? !canSend
      : actionMode === 'voice'
        ? importingHistory || !voice.available
        : false

  const onAction = () => {
    if (actionMode === 'stop') {
      if (sessionId !== null) {
        stopReadAloud()
        stopReply(sessionId)
      }
      return
    }
    if (actionMode === 'send') {
      send()
      return
    }
    if (actionMode === 'voice') {
      enterVoiceMode()
    }
  }

  return (
    <>
      <div
        className={clsx(
          styles.wrapper,
          sessionId === null ? styles.home : styles.session,
          voiceMode && styles.voiceWrapper
        )}
        onClick={(event) => {
          if (!voiceMode && event.target === event.currentTarget) {
            setAttachmentOpen(false)
            textareaRef.current?.focus({ preventScroll: true })
          }
        }}
      >
      <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      {voiceMode ? (
        <div className={styles.voiceRow}>
          <button
            type="button"
            className={styles.holdButton}
            disabled={importingHistory}
            onPointerDown={startHold}
            onPointerMove={moveHold}
            onPointerUp={endHold}
            onPointerCancel={abortHold}
            onLostPointerCapture={() => {
              if (holdPointerRef.current !== null) {
                abortHold()
              }
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {voice.status === 'transcribing' ? t('voiceTranscribing') : t('voiceHoldToTalk')}
          </button>
        </div>
      ) : (
        <div className={styles.textareaWrapper}>
          <textarea
            ref={textareaRef}
            className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
            placeholder={t('chatInputPlaceholderChat')}
            rows={2}
            // 移动端不自动聚焦，避免一打开就弹出键盘
            autoFocus={!isMobile}
            disabled={importingHistory}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setAttachmentOpen(false)}
            onMouseDown={(event) => {
              // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
              if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
                event.preventDefault()
                event.currentTarget.focus({ preventScroll: true })
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length > 0) {
                event.preventDefault()
                acceptFiles(files)
              }
            }}
          />
          {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
          <div className={styles.mirror} aria-hidden>
            {`${text}\n`}
          </div>
        </div>
      )}
      <div className={clsx(styles.functionRow, voiceMode && styles.voiceFunctionRow)}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Tooltip content={t('deactivatedThinkTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, thinking && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinking}
              onClick={() => setThinking(!thinking)}
            >
              <IconThinkOutline14 />
              <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
        </div>
        <div className={styles.right}>
          {!voiceMode && sessionId !== null ? <ContextUsageRing sessionId={sessionId} /> : null}
          <IconButton
            size="m"
            tone="primary"
            icon={<IconPlusCircle20 />}
            tooltip={t('addAttachment')}
            disabled={importingHistory}
            onClick={toggleAttachments}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            multiple
            hidden
            accept="image/*"
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {voiceMode ? (
            <IconButton
              size="m"
              tone="primary"
              icon={<IconKeyboardCircle20 />}
              tooltip={t('voiceSwitchToKeyboard')}
              disabled={importingHistory}
              onClick={exitVoiceMode}
            />
          ) : (
            <ChatActionButton
              mode={actionMode}
              seconds={voice.seconds}
              dimmed={actionDimmed}
              unavailable={!voice.available}
              onClick={onAction}
            />
          )}
        </div>
      </div>
      {voiceMode && voice.status !== 'idle' ? (
        <VoiceOverlay
          transcribing={voice.status === 'transcribing'}
          cancelArmed={cancelArmed}
          getAnalyser={voice.getAnalyser}
        />
      ) : null}
      {dragging ? <DragMask /> : null}
      </div>
      <div
        className={clsx(styles.attachmentSlot, attachmentOpen && styles.attachmentSlotOpen)}
        aria-hidden={!attachmentOpen}
      >
        <div className={styles.attachmentSlotInner}>
          <AttachmentPanel
            active={attachmentOpen}
            onPickFiles={acceptFiles}
            onOpenAlbum={openAlbumPicker}
            onOpenFiles={openFilesPicker}
          />
        </div>
      </div>
    </>
  )
}
