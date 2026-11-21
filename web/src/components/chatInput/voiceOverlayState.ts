import { create } from 'zustand'

/**
 * 录音浮层是否打开，供原生返回键同步决策。
 * closeHandler 由输入框注册：返回键先取消录音 / 转写，再让页面处理下一层弹层。
 */
type VoiceOverlayState = {
  open: boolean
  closeHandler: (() => void) | null
  setOpen: (open: boolean, closeHandler?: () => void) => void
  close: () => void
}

export const useVoiceOverlay = create<VoiceOverlayState>((set, get) => ({
  open: false,
  closeHandler: null,
  setOpen: (open, closeHandler) =>
    set({ open, closeHandler: open ? (closeHandler ?? null) : null }),
  close: () => {
    const handler = get().closeHandler
    set({ open: false, closeHandler: null })
    handler?.()
  },
}))
