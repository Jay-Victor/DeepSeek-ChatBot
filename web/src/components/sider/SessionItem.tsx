import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconMultiSelectOutline16,
  IconPinOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
  onPin,
  onStartSelect,
  selectable = false,
  selected = false,
  onToggle,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
  /** 移动端菜单里的单条置顶 / 取消置顶；桌面端不传 */
  onPin?: () => void
  /** 移动端菜单里的「多选」，进入选择模式并选中当前会话 */
  onStartSelect?: () => void
  /** 多选模式：整行变成勾选行，不再显示重命名 / 删除菜单 */
  selectable?: boolean
  selected?: boolean
  onToggle?: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')
  const options: MenuOption[] = [
    {
      key: 'rename',
      label: t('sessionItemMenuRenameOption'),
      icon: <IconEditOutline16 />,
      onSelect: () => setEditing(true),
    },
    ...(onPin
      ? [
          {
            key: 'pin',
            label: t(session.pinned ? 'sessionItemMenuUnpinOption' : 'sessionItemMenuPinOption'),
            icon: <IconPinOutline16 />,
            onSelect: onPin,
          },
        ]
      : []),
    ...(onStartSelect
      ? [
          {
            key: 'select',
            label: t('sessionItemMenuSelectOption'),
            icon: <IconMultiSelectOutline16 />,
            onSelect: onStartSelect,
          },
        ]
      : []),
    {
      key: 'delete',
      label: t('delete'),
      icon: <IconTrashOutline16 />,
      danger: true,
      onSelect: onDelete,
    },
  ]

  if (selectable) {
    return (
      <button
        type="button"
        className={clsx(styles.item, styles.selectable)}
        aria-pressed={selected}
        onClick={onToggle}
      >
        <span className={clsx(styles.checkbox, selected && styles.checkboxChecked)} aria-hidden>
          {selected ? <IconCheckOutline16 /> : null}
        </span>
        <span className={styles.title}>{displayTitle}</span>
      </button>
    )
  }

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      <div className={styles.title}>{displayTitle}</div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu options={options}>
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </div>
    </div>
  )
})
