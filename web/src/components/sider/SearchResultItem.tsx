import clsx from 'clsx'
import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { escapeRegExp, type SessionSearchHit } from '../../services/chat/sessionSearch.js'
import styles from './SearchResultItem.module.css'

/** 命中片段与标题里的关键词都包一层 mark；大小写不敏感，保留原字符 */
const highlight = (text: string, query: string) => {
  const keyword = query.trim()
  if (!keyword) {
    return text
  }
  return text
    .split(new RegExp(`(${escapeRegExp(keyword)})`, 'gi'))
    .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))
}

export const SearchResultItem = memo(function SearchResultItem({
  hit,
  query,
  active,
  onSelect,
}: {
  hit: SessionSearchHit
  query: string
  active: boolean
  onSelect: () => void
}) {
  const t = useTranslate()
  return (
    <button
      type="button"
      className={clsx(styles.item, active && styles.active)}
      onClick={onSelect}
    >
      <span className={styles.title}>{highlight(hit.title || t('untitledChat'), query)}</span>
      {hit.snippet ? (
        <span className={styles.snippet}>{highlight(hit.snippet, query)}</span>
      ) : null}
    </button>
  )
})
