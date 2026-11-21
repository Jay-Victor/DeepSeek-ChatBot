import clsx from 'clsx'
import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import {
  resolveIdentity,
  setDefaultIdentity,
  useIdentities,
} from '../../services/identity.js'
import { setSessionIdentity } from '../../services/chat/store.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from '../base/icons.js'
import { openSettings, useSettingsDialog } from '../settings/settingsDialogState.js'
import { useMobileSider } from '../sider/mobileSiderState.js'
import {
  closeIdentitySwitcher,
  openIdentitySwitcher,
  useIdentitySwitcher,
} from './identitySwitcherState.js'
import styles from './IdentitySwitcher.module.css'

/**
 * 身份声明切换器：顶栏显示当前方案姓名，点开切换。
 * 会话页切换只改当前会话；欢迎页（没有 sessionId）改的是新会话默认方案。
 */
export const IdentitySwitcher = ({
  sessionId = null,
  identityId,
  variant = 'mobile',
}: {
  sessionId?: string | null
  identityId?: string
  variant?: 'mobile' | 'desktop'
}) => {
  const t = useTranslate()
  const owner = useId()
  const profiles = useIdentities((state) => state.profiles)
  const defaultId = useIdentities((state) => state.defaultId)
  const settingsOpen = useSettingsDialog((state) => state.open)
  const siderOpen = useMobileSider((state) => state.open)
  const open = useIdentitySwitcher((state) => state.open && state.owner === owner)
  const active = resolveIdentity(sessionId ? identityId : defaultId)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, {
    align: variant === 'desktop' ? 'end' : 'start',
  })
  useDismiss(open, [anchorRef, floatingRef], () => closeIdentitySwitcher(owner), {
    captureEscape: true,
  })

  // 会话切换、设置打开或组件卸载时收起，避免全局弹层状态残留
  useEffect(() => () => closeIdentitySwitcher(owner), [owner])
  useEffect(() => {
    closeIdentitySwitcher(owner)
  }, [owner, sessionId, identityId])
  useEffect(() => {
    if (settingsOpen || siderOpen) {
      closeIdentitySwitcher(owner)
    }
  }, [owner, settingsOpen, siderOpen])

  const choose = (id: string) => {
    if (sessionId) {
      setSessionIdentity(sessionId, id)
    } else {
      setDefaultIdentity(id)
    }
    closeIdentitySwitcher(owner)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(
          styles.trigger,
          variant === 'desktop' && styles.desktop,
          open && styles.open
        )}
        aria-label={t('identitySwitcherLabel')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeIdentitySwitcher(owner) : openIdentitySwitcher(owner))}
      >
        <span className={styles.name}>{active.name}</span>
        <span className={styles.chevron}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
            >
              <div className={styles.options} role="listbox" aria-label={t('identitySwitcherLabel')}>
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    role="option"
                    aria-selected={profile.id === active.id}
                    className={clsx(
                      styles.option,
                      profile.id === active.id && styles.optionActive
                    )}
                    onClick={() => choose(profile.id)}
                  >
                    <span className={styles.optionText}>
                      <span className={styles.optionName}>{profile.name}</span>
                      <span className={styles.optionPreview}>
                        {profile.prompt || t('identityEmptyPrompt')}
                      </span>
                    </span>
                    {profile.id === active.id ? (
                      <span className={styles.check}>
                        <IconCheckOutline16 />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.manage}
                  onClick={() => {
                    closeIdentitySwitcher(owner)
                    openSettings('identity')
                  }}
                >
                  {t('identityManage')}
                </button>
                <div className={styles.hint}>
                  {t(sessionId ? 'identityMenuHintSession' : 'identityMenuHintDefault')}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
