import { create } from 'zustand'
import { createId } from '../utils/id.js'
import { useSettings } from './settings.js'

/**
 * API 接入方案：一个方案 = 端点 + 协议 + Key + 默认模型。
 * 会话通过 endpointId / modelId 绑定方案，切换方案不会影响旧会话。
 */
export type EndpointProtocol = 'deepseek' | 'anthropic' | 'openai'

/** param：请求里可开关；always：模型自带思考，不可关；none：不支持 */
export type ThinkingSupport = 'param' | 'always' | 'none'

export type EndpointCapabilities = {
  thinking: ThinkingSupport
  webSearch: boolean
  files: boolean
  speech: boolean
  title: boolean
  vision: boolean
}

export type EndpointModel = {
  id: string
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
  vision?: boolean
  thinking?: ThinkingSupport
  webSearch?: boolean
}

export type EndpointProfile = {
  id: string
  name: string
  /** API 根地址，不带 /v1、/anthropic 等协议后缀 */
  baseUrl: string
  protocol: EndpointProtocol
  apiKey: string
  modelId: string
  /** 模型没有返回窗口时使用；默认按协议取 1M / 200K / 128K */
  contextWindow: number
  models: EndpointModel[]
  createdAt: number
  updatedAt: number
}

const PROFILES_KEY = 'chat-demo:endpoints'
const ACTIVE_KEY = 'chat-demo:active-endpoint'
const LEGACY_KEY = 'chat-demo:api-key'

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash'
export const DEFAULT_WINDOWS: Record<EndpointProtocol, number> = {
  deepseek: 1_048_576,
  anthropic: 200_000,
  openai: 128_000,
}

export const ENDPOINT_PATHS: Record<
  EndpointProtocol,
  { messages: string; models: string; files: string }
> = {
  deepseek: {
    messages: '/anthropic/v1/messages',
    models: '/models',
    files: '/anthropic/v1/files',
  },
  anthropic: { messages: '/v1/messages', models: '/v1/models', files: '/v1/files' },
  openai: {
    messages: '/v1/chat/completions',
    models: '/v1/models',
    files: '/v1/files',
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isProtocol = (value: unknown): value is EndpointProtocol =>
  value === 'deepseek' || value === 'anthropic' || value === 'openai'

const readString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

const readNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

const readModel = (value: unknown): EndpointModel | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    return null
  }
  return {
    id: value.id.trim(),
    name: typeof value.name === 'string' ? value.name : undefined,
    contextWindow:
      typeof value.contextWindow === 'number' && value.contextWindow > 0
        ? value.contextWindow
        : undefined,
    maxOutputTokens:
      typeof value.maxOutputTokens === 'number' && value.maxOutputTokens > 0
        ? value.maxOutputTokens
        : undefined,
    vision: typeof value.vision === 'boolean' ? value.vision : undefined,
    thinking:
      value.thinking === 'param' || value.thinking === 'always' || value.thinking === 'none'
        ? value.thinking
        : undefined,
    webSearch: typeof value.webSearch === 'boolean' ? value.webSearch : undefined,
  }
}

const readProfile = (value: unknown): EndpointProfile | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    return null
  }
  const protocol = isProtocol(value.protocol) ? value.protocol : 'deepseek'
  return {
    id: value.id.trim(),
    name: readString(value.name, 'API 接入'),
    baseUrl: readString(value.baseUrl),
    protocol,
    apiKey: readString(value.apiKey),
    modelId: readString(value.modelId),
    contextWindow: readNumber(value.contextWindow, DEFAULT_WINDOWS[protocol]),
    models: Array.isArray(value.models)
      ? value.models.flatMap((item) => {
          const model = readModel(item)
          return model ? [model] : []
        })
      : [],
    createdAt: readNumber(value.createdAt, Date.now()),
    updatedAt: readNumber(value.updatedAt, Date.now()),
  }
}

/** 默认 DeepSeek 官方方案；带两个已知模型，断网时也能切换 */
export const createDefaultProfile = (apiKey = ''): EndpointProfile => ({
  id: 'deepseek-official',
  name: 'DeepSeek 官方',
  baseUrl: 'https://api.deepseek.com',
  protocol: 'deepseek',
  apiKey,
  modelId: DEFAULT_DEEPSEEK_MODEL,
  contextWindow: DEFAULT_WINDOWS.deepseek,
  models: [
    {
      id: 'deepseek-flash',
      name: 'DeepSeek-V4.1-Flash',
      contextWindow: 1_048_576,
      maxOutputTokens: 393_216,
      vision: true,
      thinking: 'param',
      webSearch: true,
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      contextWindow: 1_048_576,
      maxOutputTokens: 393_216,
      vision: false,
      thinking: 'param',
      webSearch: true,
    },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStorage = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

const loadProfiles = (): EndpointProfile[] => {
  const raw = readStorage(PROFILES_KEY)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const profiles = parsed.flatMap((item) => {
          const profile = readProfile(item)
          return profile ? [profile] : []
        })
        if (profiles.length > 0) {
          return profiles
        }
      }
    } catch {
      // 损坏时回落到默认方案
    }
  }
  // 旧版本只有单个 API Key：迁移成默认 DeepSeek 方案，旧键保留以便回滚
  return [createDefaultProfile(readStorage(LEGACY_KEY) ?? '')]
}

const loadActiveId = (profiles: EndpointProfile[]): string => {
  const saved = readStorage(ACTIVE_KEY)
  return saved && profiles.some((profile) => profile.id === saved) ? saved : profiles[0].id
}

type EndpointsState = {
  profiles: EndpointProfile[]
  activeId: string
}

export const useEndpoints = create<EndpointsState>(() => {
  const profiles = loadProfiles()
  return { profiles, activeId: loadActiveId(profiles) }
})

/** 当前方案的 Key 同步到 settings.apiKey，供上传、语音等旧调用链复用 */
const syncActiveApiKey = () => {
  const active = getActiveProfile()
  useSettings.setState({ apiKey: active.apiKey })
}

const persist = (profiles: EndpointProfile[], activeId: string) => {
  writeStorage(PROFILES_KEY, JSON.stringify(profiles))
  writeStorage(ACTIVE_KEY, activeId)
  syncActiveApiKey()
}

export const getProfileById = (id: string | null | undefined): EndpointProfile | undefined => {
  if (!id) {
    return undefined
  }
  return useEndpoints.getState().profiles.find((profile) => profile.id === id)
}

export const getActiveProfile = (): EndpointProfile => {
  const { profiles, activeId } = useEndpoints.getState()
  return (
    profiles.find((profile) => profile.id === activeId) ?? profiles[0] ?? createDefaultProfile()
  )
}

/** 会话绑定的方案；方案被删除时回落到当前方案 */
export const resolveSessionProfile = (session?: { endpointId?: string } | null): EndpointProfile =>
  getProfileById(session?.endpointId) ?? getActiveProfile()

export const resolveSessionModel = (
  session?: { endpointId?: string; modelId?: string } | null,
  profile: EndpointProfile = resolveSessionProfile(session)
): string => {
  // 方案被删除后，会话里的旧模型 ID 不再属于任何端点，改用回落方案的默认模型
  if (!getProfileById(session?.endpointId)) {
    return profile.modelId
  }
  return session?.modelId?.trim() || profile.modelId
}

export const findModel = (profile: EndpointProfile, modelId: string): EndpointModel | undefined =>
  profile.models.find((model) => model.id === modelId)

export const contextWindowFor = (profile: EndpointProfile, modelId: string): number =>
  findModel(profile, modelId)?.contextWindow ??
  profile.contextWindow ??
  DEFAULT_WINDOWS[profile.protocol]

export const resolveContextWindow = (
  session?: { endpointId?: string; modelId?: string } | null
): number => {
  const profile = resolveSessionProfile(session)
  return contextWindowFor(profile, resolveSessionModel(session, profile))
}

const CLAUDE_THINKING_RE = /claude-(3-7|4|sonnet-4|opus-4|haiku-4)/i
const REASONING_MODEL_RE = /(^|[-_.])(o1|o3|o4|r1|reasoner|thinking)([-_.]|$)/i

/**
 * 按协议与模型元数据推断能力：
 * - DeepSeek 协议保留全部原生能力；
 * - Anthropic / OpenAI 第一版只做文本 + 思考，搜索、附件、语音、标题走降级；
 * - thinking 由模型决定：OpenAI 的推理模型通常自带思考且不能关。
 */
export const capabilitiesFor = (
  profile: EndpointProfile,
  modelId: string
): EndpointCapabilities => {
  const model = findModel(profile, modelId)
  switch (profile.protocol) {
    case 'deepseek': {
      // ASR/TTS 是 DeepSeek 官方工具端点，不随自定义 /anthropic 根地址转发
      const official = profile.baseUrl.replace(/\/+$/, '') === 'https://api.deepseek.com'
      return {
        thinking: model?.thinking ?? 'param',
        webSearch: model?.webSearch ?? true,
        files: true,
        speech: official,
        title: true,
        vision: model?.vision ?? true,
      }
    }
    case 'anthropic':
      return {
        thinking: model?.thinking ?? (CLAUDE_THINKING_RE.test(modelId) ? 'param' : 'none'),
        webSearch: false,
        files: false,
        speech: false,
        title: false,
        vision: false,
      }
    case 'openai':
      return {
        thinking: model?.thinking ?? (REASONING_MODEL_RE.test(modelId) ? 'always' : 'none'),
        webSearch: false,
        files: false,
        speech: false,
        title: false,
        vision: false,
      }
  }
}

const isLocalHost = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/**
 * 规范化 API 根地址：去尾斜杠、去协议后缀、只允许 https（本机调试允许 http）。
 * 用户可能直接粘贴 SDK 的 base_url（带 /v1 或 /anthropic），这里统一还原成根。
 */
export const normalizeBaseUrl = (raw: string, protocol: EndpointProtocol): string | null => {
  let value = raw.trim()
  if (!value) {
    return null
  }
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    value = `https://${value}`
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    return null
  }
  if (url.username || url.password) {
    return null
  }
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/v1$/i, '')
  if (protocol === 'deepseek' || protocol === 'anthropic') {
    path = path.replace(/\/anthropic$/i, '')
  }
  return `${url.origin}${path}`
}

export const endpointUrl = (
  profile: Pick<EndpointProfile, 'baseUrl' | 'protocol'>,
  kind: 'messages' | 'models' | 'files'
): string => `${profile.baseUrl.replace(/\/+$/, '')}${ENDPOINT_PATHS[profile.protocol][kind]}`

export const endpointHeaders = (
  profile: Pick<EndpointProfile, 'apiKey' | 'protocol'>
): Record<string, string> => {
  if (profile.protocol === 'anthropic') {
    return {
      'x-api-key': profile.apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic 官方要求浏览器直连显式声明，否则会被 CORS 拒绝
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
  if (profile.protocol === 'deepseek') {
    return {
      Authorization: `Bearer ${profile.apiKey}`,
      'x-api-key': profile.apiKey,
    }
  }
  return { Authorization: `Bearer ${profile.apiKey}` }
}

export const setActiveProfile = (id: string) => {
  const { profiles } = useEndpoints.getState()
  if (!profiles.some((profile) => profile.id === id)) {
    return
  }
  useEndpoints.setState({ activeId: id })
  persist(profiles, id)
}

export type ProfileDraft = {
  name: string
  baseUrl: string
  protocol: EndpointProtocol
  apiKey: string
  modelId: string
  contextWindow: number
}

export const addProfile = (draft: ProfileDraft): string => {
  const now = Date.now()
  const profile: EndpointProfile = {
    id: createId(),
    ...draft,
    baseUrl: normalizeBaseUrl(draft.baseUrl, draft.protocol) ?? draft.baseUrl,
    models: [],
    createdAt: now,
    updatedAt: now,
  }
  const { profiles } = useEndpoints.getState()
  const next = [...profiles, profile]
  useEndpoints.setState({ profiles: next, activeId: profile.id })
  persist(next, profile.id)
  return profile.id
}

export const updateProfile = (id: string, draft: ProfileDraft) => {
  const { profiles, activeId } = useEndpoints.getState()
  const next = profiles.map((profile) =>
    profile.id === id
      ? {
          ...profile,
          ...draft,
          baseUrl: normalizeBaseUrl(draft.baseUrl, draft.protocol) ?? draft.baseUrl,
          updatedAt: Date.now(),
        }
      : profile
  )
  useEndpoints.setState({ profiles: next })
  persist(next, activeId)
}

export const removeProfile = (id: string) => {
  const { profiles, activeId } = useEndpoints.getState()
  if (profiles.length <= 1) {
    return false
  }
  const next = profiles.filter((profile) => profile.id !== id)
  const nextActive = activeId === id ? next[0].id : activeId
  useEndpoints.setState({ profiles: next, activeId: nextActive })
  persist(next, nextActive)
  return true
}

export const setProfileModel = (id: string, modelId: string) => {
  const { profiles, activeId } = useEndpoints.getState()
  const next = profiles.map((profile) =>
    profile.id === id ? { ...profile, modelId, updatedAt: Date.now() } : profile
  )
  useEndpoints.setState({ profiles: next })
  persist(next, activeId)
}

export const cacheModels = (id: string, models: EndpointModel[]) => {
  const { profiles, activeId } = useEndpoints.getState()
  const next = profiles.map((profile) =>
    profile.id === id
      ? {
          ...profile,
          models: models.slice(0, 500),
          updatedAt: Date.now(),
        }
      : profile
  )
  useEndpoints.setState({ profiles: next })
  persist(next, activeId)
}

// 初始化时把迁移后的 Key 同步出去；模块加载早于界面挂载
syncActiveApiKey()
