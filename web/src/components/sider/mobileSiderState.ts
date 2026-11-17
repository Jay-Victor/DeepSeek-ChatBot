import { create } from 'zustand'

/**
 * 移动端推挤式侧边栏。
 *
 * - open：目标状态（true 展开 / false 收起），返回键与抽屉内容都按它判断
 * - closing：收起动画进行中，用来保持内容挂载、并让返回键先等动画结束
 * - dragging：手势拖动中，抽屉内容要提前出现在屏幕外，松手后才决定开合
 */
type MobileSiderState = {
  open: boolean
  closing: boolean
  dragging: boolean
}

export const useMobileSider = create<MobileSiderState>(() => ({
  open: false,
  closing: false,
  dragging: false,
}))

export const openMobileSider = () => useMobileSider.setState({ open: true, closing: false })

/** 关闭抽屉；已经收到底时不动，避免挂载阶段做一次无意义的状态更新 */
export const closeMobileSider = () => {
  const { open, closing, dragging } = useMobileSider.getState()
  if (!open && !closing && !dragging) {
    return
  }
  useMobileSider.setState({ open: false, closing: true })
}

export const setMobileSiderDragging = (dragging: boolean) => {
  useMobileSider.setState({ dragging })
}

/** 收起动画结束：卸载抽屉内容，返回键恢复“退出应用” */
export const settleMobileSider = () => {
  useMobileSider.setState({ closing: false, dragging: false })
}
