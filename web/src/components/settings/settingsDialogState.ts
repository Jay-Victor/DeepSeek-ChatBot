import { create } from 'zustand'
import { getActiveProfile, setActiveProfile } from '../../services/endpoints.js'

/** 设置弹窗的分组：通用设置 / 外观 / 身份声明 / 上下文与压缩 / 数据管理 / 关于 */
export type SettingsSection = 'general' | 'appearance' | 'identity' | 'context' | 'data' | 'about'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 指定方案是否有 Key；会话发送时用它，避免把当前方案的 Key 当成本会话的 */
export const ensureProfileKey = (profile: { id: string; apiKey: string }) => {
  if (profile.apiKey) {
    return true
  }
  // 从会话进入时把当前方案切到该会话的方案，用户才能直接补这个方案的 Key
  if (getActiveProfile().id !== profile.id) {
    setActiveProfile(profile.id)
  }
  openSettings('data')
  return false
}

/** 新会话 / 当前方案没有 API Key 时打开设置并选中「数据管理」 */
export const ensureEndpoint = () => ensureProfileKey(getActiveProfile())

/** 兼容旧调用点 */
export const ensureApiKey = ensureEndpoint
