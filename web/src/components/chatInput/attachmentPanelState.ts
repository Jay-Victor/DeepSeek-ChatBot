import { create } from 'zustand'

/** 添加附件面板是否打开，供原生返回键先关闭面板 */
type AttachmentPanelState = {
  open: boolean
  closeHandler: (() => void) | null
  setOpen: (open: boolean, closeHandler?: () => void) => void
  close: () => void
}

export const useAttachmentPanel = create<AttachmentPanelState>((set, get) => ({
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
