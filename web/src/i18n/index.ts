import { useSettings } from '../services/settings.js'
import { en } from './en.js'
import { zh } from './zh.js'

export type TranslationKey = keyof typeof zh
export type TranslationParams = Record<string, string | number>
export type TranslationMessage = { key: TranslationKey; params?: TranslationParams }
/** 带文字链接的提示：link 跟在正文后；有 onClick 时走应用内动作，否则在新窗口打开 href */
export type LinkedMessage = TranslationMessage & {
  type?: 'error'
  link?: { key: TranslationKey; href?: string; onClick?: () => void }
}

export const isTranslationKey = (key: unknown): key is TranslationKey =>
  typeof key === 'string' && Object.hasOwn(zh, key)

const createTranslate =
  (messages: Record<TranslationKey, string>) =>
  (key: TranslationKey, params?: TranslationParams): string =>
    messages[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name]
      return typeof value === 'string' || typeof value === 'number' ? String(value) : placeholder
    })

const translators = {
  'zh-CN': createTranslate(zh),
  'en-US': createTranslate(en),
}

/** 组件订阅语言变化；普通函数在调用时读取当前语言。 */
export const useTranslate = () => useSettings((state) => translators[state.locale])

export const translate = (key: TranslationKey, params?: TranslationParams): string =>
  translators[useSettings.getState().locale](key, params)
