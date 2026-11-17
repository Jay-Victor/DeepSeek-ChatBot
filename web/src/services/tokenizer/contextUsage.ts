import type { AssistantMessage, Message, Session, UserMessage } from '../chat/types.js'
import { getVisibleMessages } from '../chat/branches.js'
import { getContextRounds } from '../chat/reply.js'
import { SYSTEM_PROMPT } from '../chat/store.js'
import { loadTokenCounter, type TokenCounter } from './index.js'

/**
 * DeepSeek-V4 模型卡与 vLLM 文档给出的上下文长度。API 不返回窗口大小，
 * 只能集中在这里维护；接口实际限制若更小，改这一个常量即可。
 */
export const CONTEXT_WINDOW = 1_000_000

export type ContextUsage = {
  /** 下一次请求大致会占用的 token：本地文本 + 服务端开销 */
  used: number
  window: number
  percent: number
  /** 系统提示之外的本地文本 */
  dialog: number
  /** 服务端模板、工具声明、附件、网页正文等本地看不到的部分 */
  overhead: number
  /** 含附件/网页时为 attachments；没有服务端用量可校准时为 uncalibrated；纯文本且已校准为 null */
  approximate: 'attachments' | 'uncalibrated' | null
  /** 最近一次成功回复的用量，来自接口，不是本地估算 */
  measured: { prompt: number; output: number; cached: number } | null
}

/** 消息对象不可变，编辑/分支会换新对象，WeakMap 缓存随之失效 */
const messageTokens = new WeakMap<Message, number>()

const countUser = (message: UserMessage, count: TokenCounter) => {
  const cached = messageTokens.get(message)
  if (cached !== undefined) {
    return cached
  }
  const tokens = count(message.content)
  messageTokens.set(message, tokens)
  return tokens
}

/** 历史思考、引用、搜索结果不回传；只有正文进上下文 */
const countAssistant = (message: AssistantMessage, count: TokenCounter) => {
  const cached = messageTokens.get(message)
  if (cached !== undefined) {
    return cached
  }
  const text = message.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n\n')
  const tokens = count(text)
  messageTokens.set(message, tokens)
  return tokens
}

const hasOpaqueContent = (message: AssistantMessage) =>
  message.blocks.some(
    (block) =>
      block.type === 'server_tool_use' ||
      block.type === 'web_search_tool_result' ||
      block.type === 'web_fetch_tool_result'
  )

const usagePrompt = (usage: NonNullable<AssistantMessage['usage']>) =>
  usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens

/**
 * 计算当前分支的上下文占用。每个回合结束、切换会话或切分支后调用一次；
 * 历史按消息对象缓存，只有新消息需要重新分词。
 */
export const computeContextUsage = async (session: Session): Promise<ContextUsage | null> => {
  const visible = getVisibleMessages(session)
  const rounds = getContextRounds(visible)
  if (rounds.length === 0) {
    return null
  }

  const count = await loadTokenCounter()
  const systemTokens = count(SYSTEM_PROMPT)
  let total = systemTokens
  let attachments = false
  let opaque = false
  let lastReply: AssistantMessage | null = null
  let lastReplyTokens = 0
  let previousReminder: string | undefined
  let lastYield = performance.now()

  const yieldToUi = async () => {
    if (performance.now() - lastYield <= 12) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    lastYield = performance.now()
  }

  for (const [user, reply] of rounds) {
    if (user.files.length > 0) {
      attachments = true
    }
    if (hasOpaqueContent(reply)) {
      opaque = true
    }
    total += countUser(user, count) + countAssistant(reply, count)
    // 请求里按变化插入最新系统信息快照，体积很小但确实占用上下文
    if (reply.latestReminder && reply.latestReminder !== previousReminder) {
      total += count(reply.latestReminder)
      previousReminder = reply.latestReminder
    }
    lastReply = reply
    lastReplyTokens = countAssistant(reply, count)
    await yieldToUi()
  }

  const tip = visible.at(-1)
  const usage = lastReply?.usage
  let overhead = 0
  let measured: ContextUsage['measured'] = null
  let approximate: ContextUsage['approximate'] = 'uncalibrated'

  // 只有「末条就是这轮回复」时，usage.prompt 才和当前分支对得上。
  // 续写会把多轮文本并进同一条 assistant，此时 prompt 与本地重建不一致，直接放弃校准。
  if (lastReply && usage && tip?.id === lastReply.id) {
    const prompt = usagePrompt(usage)
    measured = {
      prompt,
      output: usage.output_tokens,
      cached: usage.cache_read_input_tokens,
    }
    // 那次请求的 payload = 当前上下文去掉这条回复的正文
    const localBefore = total - lastReplyTokens
    const raw = prompt - localBefore
    // 纯文本时开销只应来自模板/工具声明；比例或绝对值异常说明重建失败（如续写），不采用
    const limit = attachments || opaque ? Math.max(2000, prompt * 0.95) : Math.max(200, prompt * 0.15)
    if (raw >= 0 && raw <= limit) {
      overhead = raw
      approximate = attachments || opaque ? 'attachments' : null
    }
  }

  const used = total + overhead
  return {
    used,
    window: CONTEXT_WINDOW,
    percent: used / CONTEXT_WINDOW,
    dialog: total - systemTokens,
    overhead,
    approximate,
    measured,
  }
}
