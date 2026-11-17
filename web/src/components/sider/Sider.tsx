import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCloseOutline16,
  IconMultiSelectOutline16,
  IconPanelLeftOutline16,
  IconPinOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  newChat,
  removeSession,
  selectSession,
  setSessionsPinned,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { usePushSider } from './usePushSider.js'
import { SearchResultItem } from './SearchResultItem.js'
import { SessionItem } from './SessionItem.js'
import { SessionSearch } from './SessionSearch.js'
import { useSessionSearch } from './useSessionSearch.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、会话搜索、按时间分组的会话列表、底部浮动新建与设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [query, setQuery] = useState('')
  const searching = query.trim().length > 0
  // 搜索只属于移动端抽屉；桌面端保持原来的全宽新建按钮
  const search = useSessionSearch(mobile ? query : '', sessions)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [confirm, setConfirm] = useState<'pin' | 'delete' | null>(null)
  const [confirmPending, setConfirmPending] = useState(false)
  const selectionActive = mobile && selecting

  const enterSelecting = () => {
    setQuery('')
    setSelecting(true)
    setSelected(new Set())
  }

  const exitSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
    setConfirm(null)
    setConfirmPending(false)
  }

  const toggleSelected = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const confirmPin = async () => {
    setConfirmPending(true)
    const ok = await setSessionsPinned([...selected], true)
    setConfirmPending(false)
    if (ok) {
      exitSelecting()
    } else {
      showToast({ key: 'sessionPinFailed', type: 'error' })
    }
  }

  const confirmDelete = async () => {
    setConfirmPending(true)
    const failed = new Set<string>()
    for (const id of selected) {
      if (!(await removeSession(id))) {
        failed.add(id)
      }
    }
    setConfirmPending(false)
    if (failed.size === 0) {
      exitSelecting()
      return
    }
    setSelected(failed)
    setConfirm(null)
    showToast({ key: 'sessionDeleteFailed', type: 'error' })
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        {selectionActive ? (
          <>
            <div className={styles.selectTitle}>
              {selected.size > 0
                ? t('selectedSessionsCount', { count: selected.size })
                : t('selectSessions')}
            </div>
            <IconButton
              size="xl"
              tone="primary"
              className={styles.selectClose}
              icon={<IconCloseOutline16 />}
              aria-label={t('exitSelectMode')}
              onClick={exitSelecting}
            />
          </>
        ) : (
          <>
            <div className={styles.appName}>{t('appName')}</div>
            <IconButton
              size="m"
              icon={<IconPanelLeftOutline16 />}
              tooltip={t('collapseSiderbarButton')}
              tooltipPlacement="bottom"
              onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
            />
          </>
        )}
      </div>
      {selectionActive ? null : mobile ? (
        <SessionSearch value={query} onChange={setQuery} />
      ) : (
        <button
          type="button"
          className={styles.newChat}
          onClick={() => {
            newChat()
            closeMobileSider()
          }}
        >
          <span className={styles.newChatIcon}>
            <NewChatIcon />
          </span>
          {t('newChat')}
        </button>
      )}
      <div className={clsx(styles.listWrap, selectionActive && styles.selecting)}>
        {mobile && !selectionActive && !searching && sessions.length > 0 ? (
          <button
            type="button"
            className={styles.multiSelect}
            aria-label={t('selectMode')}
            onClick={enterSelecting}
          >
            <IconMultiSelectOutline16 />
          </button>
        ) : null}
        <div className={styles.list}>
          {searching ? (
            search.hits.length === 0 ? (
              <div className={styles.searchEmpty}>
                {search.pending ? t('sessionSearching') : t('sessionSearchEmpty')}
              </div>
            ) : (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  {t('sessionSearchResultsCount', { count: search.total })}
                </div>
                {search.hits.map((hit) => (
                  <SearchResultItem
                    key={hit.id}
                    hit={hit}
                    query={query}
                    active={hit.id === activeId}
                    onSelect={() => {
                      setQuery('')
                      selectSession(hit.id)
                      closeMobileSider()
                    }}
                  />
                ))}
              </div>
            )
          ) : (
            groups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    onDelete={() => setDeleting(session)}
                    selectable={selectionActive}
                    selected={selected.has(session.id)}
                    onToggle={() => toggleSelected(session.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
        {mobile && !selectionActive ? (
          <button
            type="button"
            className={styles.newChatFab}
            onClick={() => {
              setQuery('')
              newChat()
              closeMobileSider()
            }}
          >
            <span className={styles.newChatFabIcon}>
              <NewChatIcon />
            </span>
            {t('newChatShort')}
          </button>
        ) : null}
      </div>
      {selectionActive ? (
        <div className={styles.selectActions}>
          <button
            type="button"
            className={styles.selectAction}
            disabled={selected.size === 0}
            onClick={() => setConfirm('pin')}
          >
            <IconPinOutline16 />
            <span>{t('pinSessions')}</span>
          </button>
          <div className={styles.selectDivider} />
          <button
            type="button"
            className={clsx(styles.selectAction, styles.deleteAction)}
            disabled={selected.size === 0}
            onClick={() => setConfirm('delete')}
          >
            <IconTrashOutline16 />
            <span>{t('delete')}</span>
          </button>
        </div>
      ) : (
        <div className={styles.bottom}>
          <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
            <span className={styles.settingsIcon}>
              <IconSettingsOutline16 />
            </span>
            <span className={styles.settingsLabel}>{t('settings')}</span>
          </button>
        </div>
      )}
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
      {confirm === 'pin' ? (
        <Modal
          title={t('pinSessionsConfirm', { count: selected.size })}
          titleClassName={styles.confirmTitle}
          onClose={() => {
            if (!confirmPending) {
              setConfirm(null)
            }
          }}
          footer={
            <div className={styles.confirmActions}>
              <Button
                variant="outlined"
                size="m"
                className={styles.confirmAction}
                disabled={confirmPending}
                onClick={() => setConfirm(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                className={styles.confirmAction}
                disabled={confirmPending}
                onClick={() => void confirmPin()}
              >
                {t('pinSessions')}
              </Button>
            </div>
          }
        />
      ) : null}
      {confirm === 'delete' ? (
        <Modal
          title={t('deleteSessionsConfirm', { count: selected.size })}
          titleClassName={styles.confirmTitle}
          mainClassName={styles.confirmBody}
          onClose={() => {
            if (!confirmPending) {
              setConfirm(null)
            }
          }}
          footer={
            <div className={styles.deleteConfirmActions}>
              <Button
                variant="danger"
                block
                disabled={confirmPending}
                onClick={() => void confirmDelete()}
              >
                {t('delete')}
              </Button>
              <button
                type="button"
                className={styles.cancelText}
                disabled={confirmPending}
                onClick={() => setConfirm(null)}
              >
                {t('cancel')}
              </button>
            </div>
          }
        >
          {t('deleteSessionsDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/**
 * 移动端推挤式抽屉：常驻 DOM，收起时停在屏幕外，才能从关闭状态跟手滑出；
 * 内容只在打开、拖动或收起动画期间挂载，避免会话列表在屏外空转。
 */
export const MobileSider = ({ frameRef }: { frameRef: RefObject<HTMLDivElement> }) => {
  const open = useMobileSider((state) => state.open)
  const contentMounted = useMobileSider((state) => state.open || state.closing || state.dragging)
  const drawerRef = useRef<HTMLDivElement>(null)
  usePushSider(frameRef, drawerRef)

  useEffect(() => {
    const drawer = drawerRef.current
    if (!drawer) {
      return
    }
    // 屏外内容要从焦点顺序和读屏树里摘掉
    drawer.toggleAttribute('inert', !open)
  }, [open])

  return (
    <>
      <div
        className={clsx(styles.scrim, open && styles.scrimOpen)}
        aria-hidden="true"
        onClick={() => {
          if (open) {
            closeMobileSider()
          }
        }}
      />
      <div ref={drawerRef} className={styles.drawer} aria-hidden={!open}>
        {contentMounted ? <Sider mobile /> : null}
      </div>
    </>
  )
}
