import { useChatStore } from './chat/store.js'
import {
  capabilitiesFor,
  resolveSessionModel,
  resolveSessionProfile,
  useEndpoints,
  type EndpointCapabilities,
  type EndpointProfile,
} from './endpoints.js'

export type SessionEndpoint = {
  profile: EndpointProfile
  model: string
  capabilities: EndpointCapabilities
}

/**
 * 当前会话（或新会话）绑定的方案、模型与能力。
 * 订阅方案列表与活动方案，切换方案或模型后组件会重新计算。
 */
export const useSessionEndpoint = (sessionId: string | null): SessionEndpoint => {
  useEndpoints((state) => state.profiles)
  useEndpoints((state) => state.activeId)
  const session = useChatStore((state) =>
    sessionId !== null && Object.hasOwn(state.sessionCache, sessionId)
      ? state.sessionCache[sessionId]
      : undefined
  )
  const profile = resolveSessionProfile(session)
  const model = resolveSessionModel(session, profile)
  return { profile, model, capabilities: capabilitiesFor(profile, model) }
}
