import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16, IconSearchOutline16 } from '../base/icons.js'
import styles from './SessionSearch.module.css'

/** 侧边栏顶部的会话搜索框；拼音组合期间不触发搜索，等 compositionend 再查 */
export const SessionSearch = ({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const clear = () => {
    setDraft('')
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={styles.field}>
      <span className={styles.icon}>
        <IconSearchOutline16 />
      </span>
      <input
        ref={inputRef}
        className={styles.input}
        type="search"
        value={draft}
        placeholder={t('sessionSearchPlaceholder')}
        aria-label={t('sessionSearchPlaceholder')}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(event) => {
          setDraft(event.target.value)
          if (!composing.current) {
            onChange(event.target.value)
          }
        }}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          onChange(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && draft) {
            event.stopPropagation()
            clear()
          }
        }}
      />
      {draft ? (
        <button
          type="button"
          className={styles.clear}
          aria-label={t('sessionSearchClear')}
          onClick={clear}
        >
          <IconCloseOutline16 />
        </button>
      ) : null}
    </div>
  )
}
