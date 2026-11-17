import { showToast } from '../../components/base/toastState.js'
import { buildReplyView } from '../chat/view.js'
import type { AssistantMessage } from '../chat/types.js'
import { useSettings } from '../settings.js'
import { describeReadAloudError, startReadAloud, useReadAloud } from './readAloud.js'

/** 每条回复最后自动朗读过的正文；续写后文本没变时不重复读 */
const lastAutoRead = new Map<string, string>()

/**
 * 回复结束后自动朗读：只读当前会话、应用在前台、刚完成（done）且不打断已有朗读的回复。
 * 正文与消息上的朗读按钮一致（buildReplyView 的 answer.text），不含思考块；
 * markdown 由 TTS 接口过滤。失败复用现有朗读错误提示。
 */
export const maybeAutoReadReply = (
  sessionId: string,
  activeId: string | null,
  reply: AssistantMessage
) => {
  if (!useSettings.getState().autoReadAloud) {
    return
  }
  if (sessionId !== activeId) {
    return
  }
  if (reply.status !== 'done') {
    return
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return
  }
  // 正在朗读别的内容时不打断，新回复留给用户手动点读
  if (useReadAloud.getState().status !== 'idle') {
    return
  }
  let text: string | undefined
  try {
    text = buildReplyView(reply, false).answer?.text
  } catch {
    return
  }
  if (!text || lastAutoRead.get(reply.id) === text) {
    return
  }
  lastAutoRead.set(reply.id, text)
  try {
    startReadAloud(reply.id, text, (error) => showToast(describeReadAloudError(error)))
  } catch {
    // 自动朗读是附加能力：AudioContext 不可用时不能影响回复收尾
  }
}
