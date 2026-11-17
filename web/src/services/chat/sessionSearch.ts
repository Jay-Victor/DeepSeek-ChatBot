import { getVisibleMessages } from './branches.js'
import { iterateSessions, loadSession } from './db.js'
import type { Session, SessionSummary } from './types.js'

/**
 * 会话搜索：标题同步可查，正文走一份懒建的本地索引。
 * 第一次搜索用游标逐条读 sessions（峰值只留一条会话），之后按 updatedAt 增量补齐，
 * 删除的会话在下次搜索时按摘要差集清掉；不新增存储、不改 DB 版本。
 */

/** 单条会话参与搜索的正文上限，防止导入的超大会话撑爆内存 */
const MAX_TEXT_LENGTH = 200_000
/** 渲染上限；超出的只计数 */
const MAX_HITS = 50

type IndexEntry = { updatedAt: number; title: string; text: string }

const index = new Map<string, IndexEntry>()
let indexed = false
let indexing: Promise<void> | null = null
/** 导入历史等整体替换后递增，让在途的建索引结果作废 */
let version = 0

/** 只取当前分支的可见文本：用户正文 + 附件名 + 回复正文，跳过思考与服务端提示 */
const sessionText = (session: Session) => {
  const parts: string[] = []
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      parts.push(message.content)
      for (const file of message.files) {
        parts.push(file.name)
      }
    } else {
      for (const block of message.blocks) {
        if (block.type === 'text' && !block.isTemplate) {
          parts.push(block.text)
        }
      }
    }
  }
  return parts
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
}

const readEntry = (session: Session): IndexEntry => ({
  updatedAt: session.updatedAt,
  title: session.title,
  text: sessionText(session),
})

const ensureIndex = (sessions: SessionSummary[]) => {
  if (indexing) {
    return indexing
  }
  const startVersion = version
  const commit = (id: string, entry: IndexEntry) => {
    if (startVersion === version) {
      index.set(id, entry)
    }
  }
  indexing = (async () => {
    if (!indexed) {
      const fresh = new Map<string, IndexEntry>()
      await iterateSessions((session) => {
        fresh.set(session.id, readEntry(session))
      })
      if (startVersion !== version) {
        return
      }
      index.clear()
      for (const [id, entry] of fresh) {
        index.set(id, entry)
      }
      indexed = true
    }
    const ids = new Set(sessions.map((session) => session.id))
    for (const id of index.keys()) {
      if (!ids.has(id)) {
        index.delete(id)
      }
    }
    for (const summary of sessions) {
      const entry = index.get(summary.id)
      if (entry && entry.updatedAt === summary.updatedAt && entry.title === summary.title) {
        continue
      }
      const session = await loadSession(summary.id)
      if (session) {
        commit(session.id, readEntry(session))
      } else if (startVersion === version) {
        index.delete(summary.id)
      }
    }
  })().finally(() => {
    indexing = null
  })
  return indexing
}

/** 导入历史后整体失效，避免沿用替换前的正文 */
export const invalidateSessionSearch = () => {
  version += 1
  index.clear()
  indexed = false
  indexing = null
}

export type SessionSearchHit = {
  id: string
  title: string
  updatedAt: number
  /** 命中在标题 */
  titleMatch: boolean
  /** 正文命中时的单行片段；仅标题命中为 null */
  snippet: string | null
}

export type SessionSearchResult = { hits: SessionSearchHit[]; total: number }

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const snippetFor = (text: string, keyword: string) => {
  const match = new RegExp(escapeRegExp(keyword), 'i').exec(text)
  if (!match) {
    return null
  }
  const start = Math.max(0, match.index - 30)
  const end = Math.min(text.length, match.index + match[0].length + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** 标题命中优先，其余按更新时间倒序 */
export const searchSessions = async (
  query: string,
  sessions: SessionSummary[]
): Promise<SessionSearchResult> => {
  const keyword = query.trim()
  if (!keyword) {
    return { hits: [], total: 0 }
  }
  await ensureIndex(sessions)
  const pattern = new RegExp(escapeRegExp(keyword), 'i')
  const hits: SessionSearchHit[] = []
  for (const summary of sessions) {
    const entry = index.get(summary.id)
    const titleMatch = pattern.test(summary.title)
    const snippet = entry ? snippetFor(entry.text, keyword) : null
    if (!titleMatch && !snippet) {
      continue
    }
    hits.push({
      id: summary.id,
      title: summary.title,
      updatedAt: summary.updatedAt,
      titleMatch,
      snippet,
    })
  }
  hits.sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.updatedAt - a.updatedAt)
  return { hits: hits.slice(0, MAX_HITS), total: hits.length }
}
