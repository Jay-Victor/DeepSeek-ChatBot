import { create } from 'zustand'
import type { ChatModel, CreateMessageRequest } from '../api/types.js'
import { streamMessage } from '../api/client.js'
import { useSettings } from '../settings.js'
import {
  CONTEXT_WINDOW,
  computeContextUsage,
  countMessageTokens,
} from '../tokenizer/contextUsage.js'
import { loadTokenCounter } from '../tokenizer/index.js'
import { getCompressionCut, getVisibleMessages } from './branches.js'
import { getContextRounds, getReplyText } from './reply.js'
import {
  SYSTEM_PROMPT,
  getSessionSnapshot,
  holdSessionForCompression,
  releaseSessionForCompression,
  setSessionCompression,
  useChatStore,
} from './store.js'
import type { AssistantMessage, ContextCompression, UserMessage } from './types.js'

/**
 * 上下文压缩：把较早的轮次交给模型总结成摘要，之后请求只带摘要 + 最近若干轮。
 * 原始消息不动；摘要在 request 里替换覆盖点之前的轮次，撤销即恢复完整上下文。
 */

const MODEL: ChatModel = 'deepseek-flash'
/** 摘要输出预留：选切点时先从目标预算里扣掉，避免摘要本身把比例顶回去 */
const SUMMARY_RESERVE = 4096
/** 单次摘要请求的最大输入；更大的前缀滚动分块，避免接近窗口上限 */
const CHUNK_TOKENS = 80_000
/** 摘要提示词的字数上限；实际长度由模型控制 */
const SUMMARY_MAX_CHARS = 1200
/** 自动压缩失败或压缩后仍超阈值时，短时间内不反复尝试 */
const AUTO_COOLDOWN_MS = 5 * 60 * 1000

const SUMMARY_SYSTEM_PROMPT = `你是一个对话压缩器。把用户提供的较早对话压缩成一份可供后续回答参考的摘要。

要求：
- 保留：用户的长期目标、明确约束与偏好；已经确认的事实、数字、名称与结论；做出的决定；代码、文件、接口与命令线索；尚未解决的问题。
- 省略：寒暄、重复内容、模型思考过程、工具调用的中间步骤、与后续无关的细节。
- 使用对话的主要语言；用第三人称、条目式；不要编造原文没有的信息。
- 只做摘要，不要调用任何工具，也不要联网。
- 只输出摘要正文，不要加标题、解释或 Markdown 代码围栏。
- 控制在约 ${SUMMARY_MAX_CHARS} 字以内。`

/** 与聊天请求保持一致的工具声明，避免“扩展模式 + 空 tools”的参数组合 */
const SUMMARY_TOOLS: CreateMessageRequest['tools'] = [
  { type: 'deepseek_read_url', name: 'deepseek_read_url' },
]
const SUMMARY_SAFETY = { level: 'high' } as const

export type CompressionProgress = { done: number; total: number }
type CompressionState = { running: Record<string, CompressionProgress> }

/** 压缩进行中的会话；占用环据此显示进度并禁用重复触发 */
export const useCompression = create<CompressionState>(() => ({ running: {} }))

const controllers = new Map<string, AbortController>()
const autoAttempts = new Map<string, number>()

const setProgress = (sessionId: string, progress: CompressionProgress) => {
  useCompression.setState((state) => ({
    running: { ...state.running, [sessionId]: progress },
  }))
}

const clearProgress = (sessionId: string) => {
  useCompression.setState((state) => ({
    running: Object.fromEntries(
      Object.entries(state.running).filter(([id]) => id !== sessionId)
    ),
  }))
}

const canAutoCompress = (sessionId: string) => {
  const last = autoAttempts.get(sessionId)
  return last === undefined || Date.now() - last >= AUTO_COOLDOWN_MS
}

const hasStream = (sessionId: string) =>
  Object.hasOwn(useChatStore.getState().streaming, sessionId)

const isBusy = () => useChatStore.getState().importingHistory

const roundTokens = (round: [UserMessage, AssistantMessage], count: Awaited<ReturnType<typeof loadTokenCounter>>) =>
  countMessageTokens(round[0], count) + countMessageTokens(round[1], count)

/** 把最近轮次留到目标预算内；至少保留最后一轮，返回需要被摘要覆盖的轮次数 */
const planCoveredRounds = (
  rounds: [UserMessage, AssistantMessage][],
  budget: number,
  count: Awaited<ReturnType<typeof loadTokenCounter>>
): { covered: number; coveredTokens: number } | null => {
  const tokens = rounds.map((round) => roundTokens(round, count))
  let kept = 0
  let keptTokens = 0
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    // 最新一轮无论多大都保留，保证摘要之后仍有可用的即时上下文
    if (kept > 0 && keptTokens + tokens[i] > budget) {
      break
    }
    kept += 1
    keptTokens += tokens[i]
  }
  const covered = rounds.length - kept
  return covered > 0
    ? {
        covered,
        coveredTokens: tokens.slice(0, covered).reduce((sum, value) => sum + value, 0),
      }
    : null
}

/** 单轮对话的可读文本；附件只保留名字，图片内容本身不进摘要 */
const renderRound = ([user, reply]: [UserMessage, AssistantMessage], index: number): string => {
  const files =
    user.files.length > 0
      ? `\n[附件：${user.files
          .map((file) => `${file.name}${file.isImage ? '（图片）' : ''}`)
          .join('、')}]`
      : ''
  return `【第 ${index + 1} 轮】\n用户：${user.content || '（无文字）'}${files}\n助手：${getReplyText(reply)}`
}

/** 按 token 分组，避免一次摘要请求塞进接近窗口上限的前缀 */
const chunkRounds = (
  rounds: [UserMessage, AssistantMessage][],
  count: Awaited<ReturnType<typeof loadTokenCounter>>
): string[] => {
  const chunks: string[] = []
  let current = ''
  let currentTokens = 0
  rounds.forEach((round, index) => {
    const text = renderRound(round, index)
    const tokens = count(text)
    if (current && currentTokens + tokens > CHUNK_TOKENS) {
      chunks.push(current)
      current = ''
      currentTokens = 0
    }
    current += `${current ? '\n\n' : ''}${text}`
    currentTokens += tokens
  })
  if (current) {
    chunks.push(current)
  }
  return chunks
}

/** 流式读完一次摘要请求，只累计文本块 */
const requestSummary = async (
  apiKey: string,
  prompt: string,
  signal: AbortSignal
): Promise<string> => {
  const events = streamMessage(
    apiKey,
    {
      model: MODEL,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
      safety_check: SUMMARY_SAFETY,
      tools: SUMMARY_TOOLS,
    },
    signal
  )
  let text = ''
  let refused = false
  for await (const event of events) {
    if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      text += event.content_block.text
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    } else if (event.type === 'message_delta') {
      refused ||= event.delta.stop_reason === 'refusal'
    }
  }
  if (refused) {
    throw new Error('Summary request was refused')
  }
  return text.trim()
}

const summarizeChunks = async (
  apiKey: string,
  chunks: string[],
  previousSummary: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void
): Promise<string> => {
  let summary = previousSummary.trim()
  for (let index = 0; index < chunks.length; index += 1) {
    signal.throwIfAborted()
    onProgress(index, chunks.length)
    const prompt = `${summary ? `已有摘要：\n${summary}\n\n` : ''}新增对话：\n${chunks[index]}\n\n请把以上内容合并成一份新的摘要。`
    summary = await requestSummary(apiKey, prompt, signal)
    if (!summary) {
      throw new Error('Summary is empty')
    }
  }
  onProgress(chunks.length, chunks.length)
  return summary
}

export type CompressionSkipReason =
  | 'running'
  | 'busy'
  | 'no-session'
  | 'too-short'
  | 'below-target'
  | 'nothing-to-compress'
  | 'no-key'
  | 'cooldown'
  | 'stale'

export type CompressionResult =
  | {
      status: 'done'
      rounds: number
      coveredTokens: number
      beforePercent: number
      afterPercent: number
    }
  | { status: 'skipped'; reason: CompressionSkipReason }
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown }

/**
 * 压缩指定会话的较早轮次。
 * - manual：用户从占用卡片发起，低于目标时直接返回；
 * - auto：占用环在超过阈值时调用，带冷却，失败不连环重试。
 */
export const compressSession = async (
  sessionId: string,
  mode: 'manual' | 'auto' = 'manual'
): Promise<CompressionResult> => {
  if (controllers.has(sessionId)) {
    return { status: 'skipped', reason: 'running' }
  }
  if (isBusy()) {
    return { status: 'skipped', reason: 'busy' }
  }
  if (hasStream(sessionId)) {
    return { status: 'skipped', reason: 'busy' }
  }
  const session = getSessionSnapshot(sessionId)
  if (!session) {
    return { status: 'skipped', reason: 'no-session' }
  }
  if (mode === 'auto' && !canAutoCompress(sessionId)) {
    return { status: 'skipped', reason: 'cooldown' }
  }

  const { autoCompress, compressThreshold, compressTarget, apiKey } = useSettings.getState()
  if (mode === 'auto' && !autoCompress) {
    return { status: 'skipped', reason: 'below-target' }
  }

  const path = getVisibleMessages(session)
  const cut = getCompressionCut(session, path)
  const effective = cut ? path.slice(cut.index + 1) : path
  const rounds = getContextRounds(effective)
  if (rounds.length < 2) {
    return { status: 'skipped', reason: 'too-short' }
  }

  const usage = await computeContextUsage(session)
  if (!usage) {
    return { status: 'skipped', reason: 'too-short' }
  }
  const currentPercent = usage.percent * 100
  if (mode === 'auto' && currentPercent < compressThreshold) {
    return { status: 'skipped', reason: 'below-target' }
  }
  if (mode === 'manual' && currentPercent <= compressTarget) {
    return { status: 'skipped', reason: 'below-target' }
  }
  if (!apiKey) {
    return { status: 'skipped', reason: 'no-key' }
  }

  const count = await loadTokenCounter()
  const systemTokens = count(SYSTEM_PROMPT)
  // 目标 = 保留最近轮次 + 摘要；先扣掉服务端开销与摘要预留
  const budget =
    (compressTarget / 100) * CONTEXT_WINDOW - usage.overhead - systemTokens - SUMMARY_RESERVE
  const plan = planCoveredRounds(rounds, budget, count)
  if (!plan) {
    return { status: 'skipped', reason: 'nothing-to-compress' }
  }

  const covered = rounds.slice(0, plan.covered)
  const cutReply = covered.at(-1)?.[1]
  if (!cutReply) {
    return { status: 'skipped', reason: 'nothing-to-compress' }
  }
  const chunks = chunkRounds(covered, count)
  if (chunks.length === 0) {
    return { status: 'skipped', reason: 'nothing-to-compress' }
  }

  // 通过所有可提前返回的检查后才占用会话与冷却名额
  if (mode === 'auto') {
    autoAttempts.set(sessionId, Date.now())
  }
  const controller = new AbortController()
  controllers.set(sessionId, controller)
  holdSessionForCompression(sessionId)
  setProgress(sessionId, { done: 0, total: chunks.length })

  try {
    const summary = await summarizeChunks(
      apiKey,
      chunks,
      cut?.compression.summary ?? '',
      controller.signal,
      (done, total) => setProgress(sessionId, { done, total })
    )
    if (controller.signal.aborted) {
      return { status: 'cancelled' }
    }
    if (!summary) {
      throw new Error('Summary is empty')
    }

    // 摘要生成期间用户可能切换分支、重新生成或删除会话；记录必须仍落在当前路径上
    const fresh = getSessionSnapshot(sessionId)
    const freshPath = fresh ? getVisibleMessages(fresh) : []
    const index = freshPath.findIndex((message) => message.id === cutReply.id)
    if (!fresh || index < 0 || freshPath[index].role !== 'assistant') {
      return { status: 'skipped', reason: 'stale' }
    }

    const record: ContextCompression = {
      summary,
      throughMessageId: cutReply.id,
      coveredRounds: (cut?.compression.coveredRounds ?? 0) + plan.covered,
      coveredTokens: (cut?.compression.coveredTokens ?? 0) + plan.coveredTokens,
      summaryTokens: count(summary),
      createdAt: Date.now(),
    }
    if (!setSessionCompression(sessionId, record)) {
      return { status: 'skipped', reason: 'stale' }
    }

    const updated = getSessionSnapshot(sessionId)
    const after = updated ? await computeContextUsage(updated) : null
    return {
      status: 'done',
      rounds: record.coveredRounds,
      coveredTokens: record.coveredTokens,
      beforePercent: currentPercent,
      afterPercent: after ? after.percent * 100 : currentPercent,
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: 'cancelled' }
    }
    return { status: 'failed', error }
  } finally {
    controllers.delete(sessionId)
    releaseSessionForCompression(sessionId)
    clearProgress(sessionId)
  }
}

export const cancelCompression = (sessionId: string) => {
  controllers.get(sessionId)?.abort()
}

/** 撤销只删除摘要；原始消息从未被修改，下一次请求恢复完整历史 */
export const undoCompression = (sessionId: string): boolean => {
  if (controllers.has(sessionId) || !getSessionSnapshot(sessionId)?.compression) {
    return false
  }
  return setSessionCompression(sessionId, undefined)
}
