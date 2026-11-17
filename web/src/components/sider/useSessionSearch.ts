import { useEffect, useState } from 'react'
import { searchSessions, type SessionSearchHit } from '../../services/chat/sessionSearch.js'
import type { SessionSummary } from '../../services/chat/types.js'

type SearchState = { hits: SessionSearchHit[]; total: number; pending: boolean }

const EMPTY: SearchState = { hits: [], total: 0, pending: false }
const MAX_FALLBACK_HITS = 50

/** 标题匹配不依赖索引；索引读取失败时退回这一层 */
const titleHits = (keyword: string, sessions: SessionSummary[]): SessionSearchHit[] =>
  sessions
    .filter((session) => session.title.toLowerCase().includes(keyword.toLowerCase()))
    .map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      titleMatch: true,
      snippet: null,
    }))

/** 输入 160ms 后搜索；组合输入期间由调用方暂停触发 */
export const useSessionSearch = (query: string, sessions: SessionSummary[]) => {
  const [state, setState] = useState<SearchState>(EMPTY)

  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setState(EMPTY)
      return
    }
    let cancelled = false
    // 标题匹配是同步的，先给一版结果，正文索引回来后替换
    const quick = titleHits(keyword, sessions)
    setState({ hits: quick.slice(0, MAX_FALLBACK_HITS), total: quick.length, pending: true })
    const timer = setTimeout(() => {
      void searchSessions(keyword, sessions)
        .then((result) => {
          if (!cancelled) {
            setState({ ...result, pending: false })
          }
        })
        .catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[search] local session search failed', error)
          if (!cancelled) {
            const hits = titleHits(keyword, sessions)
            setState({ hits: hits.slice(0, MAX_FALLBACK_HITS), total: hits.length, pending: false })
          }
        })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, sessions])

  return state
}
