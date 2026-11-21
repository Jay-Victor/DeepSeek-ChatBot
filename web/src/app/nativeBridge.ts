/**
 * 壳需要的三个钩子：
 * - 返回键：原生先问页面有没有打开的弹层，页面吃掉就不退出
 * - 系统栏：页面主题切换后把深浅色和背景色回传，状态栏字色才不会和背景撞色
 * - 弹层状态：同步给原生，让返回键能同步决策（不做异步 JS 回调）
 */
import { closeSettings, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { useImageViewer } from '../components/files/imageViewerState.js'
import { useVoiceOverlay } from '../components/chatInput/voiceOverlayState.js'
import { useAttachmentPanel } from '../components/chatInput/attachmentPanelState.js'

type NativeBridge = {
  setOverlay?: (open: boolean) => void
  setTheme?: (dark: boolean, background: string) => void
}

type WindowWithBridge = Window & {
  DeepSeekNative?: NativeBridge
  __closeOverlay?: () => boolean
}

const bridge = () => (window as WindowWithBridge).DeepSeekNative

const hasOpenLayer = () =>
  useVoiceOverlay.getState().open ||
  useImageViewer.getState().image !== null ||
  useAttachmentPanel.getState().open ||
  useSettingsDialog.getState().open ||
  useSearchPanel.getState().entry !== null ||
  useMobileSider.getState().open ||
  // 收起动画还没走完时也算有弹层，避免按返回键直接退出应用
  useMobileSider.getState().closing

const closeTopLayer = () => {
  if (useVoiceOverlay.getState().open) {
    useVoiceOverlay.getState().close()
    return true
  }
  if (useImageViewer.getState().image !== null) {
    useImageViewer.getState().closeImage()
    return true
  }
  if (useAttachmentPanel.getState().open) {
    useAttachmentPanel.getState().close()
    return true
  }
  if (useSettingsDialog.getState().open) {
    closeSettings()
    return true
  }
  if (useSearchPanel.getState().entry !== null) {
    closeSearchPanel()
    return true
  }
  if (useMobileSider.getState().open) {
    closeMobileSider()
    return true
  }
  return false
}

/** rgb()/rgba() 转 #rrggbb，原生侧只认十六进制 */
const toHex = (color: string) => {
  const match = color.match(/rgba?\(([^)]+)\)/)
  if (!match) {
    return color.startsWith('#') ? color : '#ffffff'
  }
  const parts = match[1].split(',').map((part) => Number.parseInt(part.trim(), 10))
  const [r = 255, g = 255, b = 255] = parts
  return `#${[r, g, b]
    .map((value) => (Number.isFinite(value) ? Math.min(255, Math.max(0, value)) : 255))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}

export const installNativeBridge = () => {
  const native = bridge()
  if (!native) {
    return
  }

  ;(window as WindowWithBridge).__closeOverlay = closeTopLayer

  const syncOverlay = () => native.setOverlay?.(hasOpenLayer())
  useVoiceOverlay.subscribe(syncOverlay)
  useImageViewer.subscribe(syncOverlay)
  useAttachmentPanel.subscribe(syncOverlay)
  useSettingsDialog.subscribe(syncOverlay)
  useSearchPanel.subscribe(syncOverlay)
  useMobileSider.subscribe(syncOverlay)
  syncOverlay()

  const syncTheme = () => {
    const dark = document.body.classList.contains('dark')
    native.setTheme?.(dark, toHex(getComputedStyle(document.body).backgroundColor))
  }
  new MutationObserver(syncTheme).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  })
  syncTheme()
}
