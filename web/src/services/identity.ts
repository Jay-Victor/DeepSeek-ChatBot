import { create } from 'zustand'
import { createId } from '../utils/id.js'

/** 一条身份声明：姓名显示在顶栏，设定作为系统提示的正文 */
export type IdentityProfile = {
  id: string
  name: string
  prompt: string
}

/** 内置方案：可以编辑，但不能删除；旧会话与删除后的兜底都落到它 */
export const BUILTIN_IDENTITY_ID = 'default'
export const BUILTIN_IDENTITY_NAME = 'DeepSeek'
export const BUILTIN_IDENTITY_PROMPT = '由深度求索公司创造。'
export const IDENTITY_NAME_MAX = 20
export const IDENTITY_PROMPT_MAX = 2000
export const IDENTITY_LIMIT = 20

const BUILTIN_IDENTITY: IdentityProfile = {
  id: BUILTIN_IDENTITY_ID,
  name: BUILTIN_IDENTITY_NAME,
  prompt: BUILTIN_IDENTITY_PROMPT,
}

const KEYS = {
  profiles: 'chat-demo:identities',
  defaultId: 'chat-demo:identity-default',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储不可用时只在内存中生效
  }
}

const characters = (value: string) => Array.from(value)

export const clipIdentityName = (value: string) => {
  const name = value.replace(/\s+/g, ' ').trim()
  const list = characters(name)
  return list.length > IDENTITY_NAME_MAX ? list.slice(0, IDENTITY_NAME_MAX).join('') : name
}

export const clipIdentityPrompt = (value: string) => {
  const prompt = value.replace(/\r\n?/g, '\n').trim()
  const list = characters(prompt)
  return list.length > IDENTITY_PROMPT_MAX ? list.slice(0, IDENTITY_PROMPT_MAX).join('') : prompt
}

/** 读取时逐条过滤损坏项，始终保证内置方案存在且 id 不重复 */
const readProfiles = (): IdentityProfile[] => {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(read(KEYS.profiles) ?? 'null')
  } catch {
    parsed = null
  }
  const profiles: IdentityProfile[] = []
  const ids = new Set<string>()
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        continue
      }
      const record = item as Record<string, unknown>
      if (
        typeof record.id !== 'string' ||
        typeof record.name !== 'string' ||
        typeof record.prompt !== 'string'
      ) {
        continue
      }
      const id = record.id.trim()
      const name = clipIdentityName(record.name)
      if (!id || id === 'new' || !name || ids.has(id)) {
        continue
      }
      ids.add(id)
      profiles.push({ id, name, prompt: clipIdentityPrompt(record.prompt) })
      if (profiles.length >= IDENTITY_LIMIT) {
        break
      }
    }
  }
  if (!ids.has(BUILTIN_IDENTITY_ID)) {
    profiles.unshift({ ...BUILTIN_IDENTITY })
  }
  return profiles.slice(0, IDENTITY_LIMIT)
}

const readDefaultId = (profiles: IdentityProfile[]): string => {
  const saved = read(KEYS.defaultId)
  return saved && profiles.some((profile) => profile.id === saved) ? saved : BUILTIN_IDENTITY_ID
}

type IdentityState = {
  profiles: IdentityProfile[]
  /** 新会话使用的方案；当前会话的身份在会话上单独记录 */
  defaultId: string
}

export const useIdentities = create<IdentityState>(() => {
  const profiles = readProfiles()
  return { profiles, defaultId: readDefaultId(profiles) }
})

const save = (state: IdentityState) => {
  write(KEYS.profiles, JSON.stringify(state.profiles))
  write(KEYS.defaultId, state.defaultId)
  useIdentities.setState(state)
}

/** 找不到（例如方案已删除）时回落到内置方案 */
export const resolveIdentity = (id?: string): IdentityProfile => {
  const { profiles } = useIdentities.getState()
  return (
    profiles.find((profile) => profile.id === id) ??
    profiles.find((profile) => profile.id === BUILTIN_IDENTITY_ID) ?? { ...BUILTIN_IDENTITY }
  )
}

export const hasIdentity = (id: string): boolean =>
  useIdentities.getState().profiles.some((profile) => profile.id === id)

export const getDefaultIdentityId = (): string => {
  const state = useIdentities.getState()
  return state.profiles.some((profile) => profile.id === state.defaultId)
    ? state.defaultId
    : BUILTIN_IDENTITY_ID
}

/** 姓名进入系统提示，设定作为正文；设定为空时只声明名字 */
export const composeIdentityPrompt = (profile: IdentityProfile): string => {
  const name = clipIdentityName(profile.name)
  const prompt = clipIdentityPrompt(profile.prompt)
  return prompt ? `你是${name}。${prompt}` : `你是${name}。`
}

/** 请求、占用统计与压缩预算共用这一处解析；缺省 id 表示旧会话的内置身份 */
export const getIdentityPrompt = (id?: string): string => composeIdentityPrompt(resolveIdentity(id))

export const setDefaultIdentity = (id: string): boolean => {
  const state = useIdentities.getState()
  if (!state.profiles.some((profile) => profile.id === id)) {
    return false
  }
  if (state.defaultId !== id) {
    save({ ...state, defaultId: id })
  }
  return true
}

export const createIdentity = (name: string, prompt: string): IdentityProfile | null => {
  const state = useIdentities.getState()
  const normalizedName = clipIdentityName(name)
  if (!normalizedName || state.profiles.length >= IDENTITY_LIMIT) {
    return null
  }
  const profile: IdentityProfile = {
    id: createId(),
    name: normalizedName,
    prompt: clipIdentityPrompt(prompt),
  }
  save({ ...state, profiles: [...state.profiles, profile] })
  return profile
}

export const updateIdentity = (id: string, name: string, prompt: string): boolean => {
  const state = useIdentities.getState()
  const normalizedName = clipIdentityName(name)
  if (!normalizedName || !state.profiles.some((profile) => profile.id === id)) {
    return false
  }
  const nextPrompt = clipIdentityPrompt(prompt)
  const profiles = state.profiles.map((profile) =>
    profile.id === id ? { ...profile, name: normalizedName, prompt: nextPrompt } : profile
  )
  save({ ...state, profiles })
  return true
}

export const deleteIdentity = (id: string): boolean => {
  if (id === BUILTIN_IDENTITY_ID) {
    return false
  }
  const state = useIdentities.getState()
  if (!state.profiles.some((profile) => profile.id === id)) {
    return false
  }
  save({
    profiles: state.profiles.filter((profile) => profile.id !== id),
    defaultId: state.defaultId === id ? BUILTIN_IDENTITY_ID : state.defaultId,
  })
  return true
}
