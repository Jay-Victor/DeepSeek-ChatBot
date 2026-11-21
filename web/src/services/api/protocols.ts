import { ApiError, request, streamMessageAt } from './client.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  CreateMessageRequest,
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
} from './types.js'
import {
  endpointHeaders,
  endpointUrl,
  type EndpointCapabilities,
  type EndpointModel,
  type EndpointProfile,
  type EndpointProtocol,
} from '../endpoints.js'

/** 一轮聊天请求；messages 已按目标协议过滤过历史块 */
export type ChatRequest = {
  profile: EndpointProfile
  model: string
  system: string
  messages: MessageParam[]
  thinking: boolean
  search: boolean
  title: boolean
  capabilities: EndpointCapabilities
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isErrorBody = (value: unknown): value is { error: { message: string } } =>
  isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string'

const isEventStream = (response: Response) => {
  const contentType = response.headers.get('Content-Type') ?? ''
  return Boolean(response.body) && contentType.includes('text/event-stream')
}

/** 按协议分派；所有适配器都产出统一的 MessageStreamEvent，交给 applyEvent 消费 */
export async function* streamChat(
  input: ChatRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  switch (input.profile.protocol) {
    case 'deepseek':
      yield* streamDeepSeek(input, signal)
      return
    case 'anthropic':
      yield* streamAnthropic(input, signal)
      return
    case 'openai':
      yield* streamOpenAI(input, signal)
      return
  }
}

/** DeepSeek：保留 safety_check、title、服务端搜索工具等原生扩展 */
async function* streamDeepSeek(
  input: ChatRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (input.search && input.capabilities.webSearch) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  const body: CreateMessageRequest = {
    model: input.model,
    system: input.system,
    messages: input.messages,
    thinking: { type: input.thinking ? 'enabled' : 'disabled' },
    safety_check: { level: 'high' },
    tools,
    ...(input.title ? { title: { enabled: true } } : {}),
  }
  yield* streamMessageAt(
    endpointUrl(input.profile, 'messages'),
    input.profile.apiKey,
    body,
    signal,
    // DeepSeek 同时接受 x-api-key 与 Bearer；带上后者兼容只认 Authorization 的中转
    endpointHeaders(input.profile)
  )
}

/**
 * Anthropic 官方协议：
 * - 去掉 latest_reminder、safety_check、title 与 DeepSeek 服务端工具；
 * - thinking 必须带 budget_tokens；
 * - max_tokens 必填。
 */
async function* streamAnthropic(
  input: ChatRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const messages = input.messages.filter((message) => message.role !== 'latest_reminder')
  const body: Record<string, unknown> = {
    model: input.model,
    system: input.system,
    messages,
    max_tokens: 8192,
    stream: true,
  }
  if (input.capabilities.thinking === 'param') {
    body.thinking = input.thinking ? { type: 'enabled', budget_tokens: 4096 } : { type: 'disabled' }
  } else if (input.capabilities.thinking === 'always') {
    body.thinking = { type: 'enabled', budget_tokens: 4096 }
  }
  const response = await request(endpointUrl(input.profile, 'messages'), {
    method: 'POST',
    headers: {
      ...endpointHeaders(input.profile),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!isEventStream(response) || !response.body) {
    throw new ApiError('protocol', 'The endpoint did not return an event stream')
  }
  const stream = response.body
  for await (const { data } of readServerSentEvents(stream, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    // Anthropic 的 stop_sequence / pause_turn 不在本应用的结束原因集合里
    if (isRecord(payload) && payload.type === 'message_delta' && isRecord(payload.delta)) {
      const reason = payload.delta.stop_reason
      if (reason === 'stop_sequence' || reason === 'pause_turn') {
        payload = { ...payload, delta: { ...payload.delta, stop_reason: 'end_turn' } }
      }
    }
    const event = readMessageEvent(payload)
    if (event) {
      yield event
      if (event.type === 'message_stop') {
        return
      }
    }
  }
  throw new ApiError('interrupted', '')
}

/** 内部 Anthropic 风格消息 → OpenAI chat/completions 的纯文本消息 */
const blockText = (content: MessageParam['content']): string =>
  typeof content === 'string'
    ? content
    : content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const toOpenAIMessages = (system: string, messages: MessageParam[]): OpenAIMessage[] => {
  const result: OpenAIMessage[] = []
  if (system.trim()) {
    result.push({ role: 'system', content: system })
  }
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    const content = blockText(message.content)
    if (!content.trim()) {
      continue
    }
    result.push({ role: message.role, content })
  }
  return result
}

const mapStopReason = (reason: string | null): StopReason => {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

const mapOpenAIUsage = (value: Record<string, unknown>): MessageUsage | undefined => {
  const prompt = typeof value.prompt_tokens === 'number' ? value.prompt_tokens : null
  const completion = typeof value.completion_tokens === 'number' ? value.completion_tokens : null
  if (prompt === null && completion === null) {
    return undefined
  }
  const details = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : undefined
  const cached = typeof details?.cached_tokens === 'number' ? details.cached_tokens : 0
  return {
    input_tokens: Math.max(0, (prompt ?? 0) - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: completion ?? 0,
  }
}

/**
 * OpenAI 兼容：把 chat/completions 的 SSE 增量合成为统一事件。
 * 只消费正文与 reasoning_content；工具调用、图片等第一版不进入这条链路。
 */
async function* streamOpenAI(
  input: ChatRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const body = {
    model: input.model,
    messages: toOpenAIMessages(input.system, input.messages),
    stream: true,
  }
  const response = await request(endpointUrl(input.profile, 'messages'), {
    method: 'POST',
    headers: {
      ...endpointHeaders(input.profile),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!isEventStream(response) || !response.body) {
    throw new ApiError('protocol', 'The endpoint did not return an event stream')
  }
  const stream = response.body
  let nextIndex = 0
  let textIndex: number | null = null
  let thinkingIndex: number | null = null
  let finishReason: string | null = null
  let usage: MessageUsage | undefined

  for await (const { data } of readServerSentEvents(stream, signal)) {
    if (data.trim() === '[DONE]') {
      break
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (!isRecord(payload)) {
      continue
    }
    if (isRecord(payload.usage)) {
      usage = mapOpenAIUsage(payload.usage) ?? usage
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : []
    const choice = isRecord(choices[0]) ? choices[0] : undefined
    if (typeof choice?.finish_reason === 'string') {
      finishReason = choice.finish_reason
    }
    const delta = isRecord(choice?.delta) ? choice.delta : undefined
    const reasoning =
      typeof delta?.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta?.reasoning === 'string'
          ? delta.reasoning
          : ''
    // 正文开始后不再插入思考块，避免部分中转把 reasoning 放在正文之后
    if (reasoning && textIndex === null) {
      if (thinkingIndex === null) {
        thinkingIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      }
    }
    const text = typeof delta?.content === 'string' ? delta.content : ''
    if (text) {
      if (textIndex === null) {
        textIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text },
      }
    }
  }

  if (thinkingIndex !== null) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  if (textIndex !== null) {
    yield { type: 'content_block_stop', index: textIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: mapStopReason(finishReason), stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}

const readModelList = (protocol: EndpointProtocol, body: unknown): EndpointModel[] => {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return []
  }
  return body.data.flatMap((item): EndpointModel[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) {
      return []
    }
    if (protocol === 'deepseek') {
      const effort = isRecord(item.effort) ? item.effort : undefined
      const levels = Array.isArray(effort?.supported_levels) ? effort.supported_levels : null
      const modalities = Array.isArray(item.input_modalities) ? item.input_modalities : null
      return [
        {
          id: item.id,
          name: typeof item.name === 'string' ? item.name : undefined,
          contextWindow: typeof item.context_window === 'number' ? item.context_window : undefined,
          maxOutputTokens:
            typeof item.max_output_tokens === 'number' ? item.max_output_tokens : undefined,
          // 元数据缺失时不要写死 false / none，留给 capabilitiesFor 按协议默认推断
          vision: modalities ? modalities.includes('image') : undefined,
          thinking: levels ? (levels.length > 0 ? 'param' : 'none') : undefined,
          webSearch: true,
        },
      ]
    }
    if (protocol === 'anthropic') {
      return [
        {
          id: item.id,
          name: typeof item.display_name === 'string' ? item.display_name : undefined,
        },
      ]
    }
    return [
      {
        id: item.id,
        name: typeof item.name === 'string' ? item.name : undefined,
      },
    ]
  })
}

/** GET 模型列表；DeepSeek 带窗口/模态/effort 元数据，另外两家只有 id */
export const listModels = async (
  profile: EndpointProfile,
  signal?: AbortSignal
): Promise<EndpointModel[]> => {
  const response = await request(endpointUrl(profile, 'models'), {
    method: 'GET',
    headers: { ...endpointHeaders(profile), Accept: 'application/json' },
    signal,
  })
  const body: unknown = await response.json()
  const models = readModelList(profile.protocol, body)
  if (models.length === 0) {
    throw new ApiError('protocol', 'The endpoint returned no models')
  }
  return models
}
