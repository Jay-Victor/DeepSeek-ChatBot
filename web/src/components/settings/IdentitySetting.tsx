import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate, type TranslationKey, type TranslationParams } from '../../i18n/index.js'
import {
  BUILTIN_IDENTITY_ID,
  BUILTIN_IDENTITY_NAME,
  BUILTIN_IDENTITY_PROMPT,
  IDENTITY_LIMIT,
  IDENTITY_NAME_MAX,
  IDENTITY_PROMPT_MAX,
  composeIdentityPrompt,
  createIdentity,
  deleteIdentity,
  setDefaultIdentity,
  updateIdentity,
  useIdentities,
  type IdentityProfile,
} from '../../services/identity.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconEditOutline16, IconTrashOutline16 } from '../base/icons.js'
import styles from './IdentitySetting.module.css'

const count = (value: string) => Array.from(value).length

type ErrorState = { key: TranslationKey; params?: TranslationParams } | null

/**
 * 身份声明：多套方案，姓名进入系统提示、设定作为正文。
 * 这里选择的是新会话的默认方案；当前会话在聊天页顶栏切换。
 */
export const IdentitySetting = () => {
  const t = useTranslate()
  const profiles = useIdentities((state) => state.profiles)
  const defaultId = useIdentities((state) => state.defaultId)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState({ name: '', prompt: '' })
  const [error, setError] = useState<ErrorState>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const startEdit = (profile: IdentityProfile) => {
    setDeletingId(null)
    setEditing(profile.id)
    setDraft({ name: profile.name, prompt: profile.prompt })
    setError(null)
  }

  const startNew = () => {
    if (profiles.length >= IDENTITY_LIMIT) {
      return
    }
    setDeletingId(null)
    setEditing('new')
    setDraft({ name: '', prompt: '' })
    setError(null)
  }

  const cancelEdit = () => {
    setEditing(null)
    setError(null)
  }

  const save = () => {
    const name = draft.name.replace(/\s+/g, ' ').trim()
    const prompt = draft.prompt.replace(/\r\n?/g, '\n').trim()
    if (!name) {
      setError({ key: 'identityNameRequired' })
      return
    }
    if (count(name) > IDENTITY_NAME_MAX) {
      setError({ key: 'identityNameTooLong', params: { max: IDENTITY_NAME_MAX } })
      return
    }
    if (count(prompt) > IDENTITY_PROMPT_MAX) {
      setError({ key: 'identityPromptTooLong', params: { max: IDENTITY_PROMPT_MAX } })
      return
    }
    if (editing === 'new') {
      if (!createIdentity(name, prompt)) {
        setError({ key: 'identityLimitReached', params: { max: IDENTITY_LIMIT } })
        return
      }
    } else if (editing) {
      if (!updateIdentity(editing, name, prompt)) {
        setError({ key: 'identitySaveFailed' })
        return
      }
    }
    setEditing(null)
    setError(null)
  }

  const confirmDelete = (id: string) => {
    if (!deleteIdentity(id)) {
      setError({ key: 'identitySaveFailed' })
      return
    }
    setDeletingId(null)
  }

  const fillBuiltin = () => {
    setDraft({ name: BUILTIN_IDENTITY_NAME, prompt: BUILTIN_IDENTITY_PROMPT })
    setError(null)
  }

  const previewName = draft.name.replace(/\s+/g, ' ').trim()
  const previewPrompt = draft.prompt.replace(/\r\n?/g, '\n').trim()
  const preview = previewName
    ? composeIdentityPrompt({ id: '', name: previewName, prompt: previewPrompt })
    : null

  if (editing) {
    const builtin = editing === BUILTIN_IDENTITY_ID
    return (
      <div className={styles.root}>
        <div className={styles.intro}>{t('identityIntro')}</div>
        <div className={styles.form}>
          <div className={styles.formTitle}>
            {editing === 'new' ? t('identityNew') : t('identityEdit')}
            {builtin ? <span className={styles.formHint}>{t('identityBuiltinHint')}</span> : null}
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('identityNameLabel')}</span>
            <input
              type="text"
              className={styles.input}
              value={draft.name}
              placeholder={t('identityNamePlaceholder')}
              aria-invalid={error?.key === 'identityNameRequired' || undefined}
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }))
                setError(null)
              }}
            />
            <span className={styles.counter}>
              {count(previewName)}/{IDENTITY_NAME_MAX}
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('identityPromptLabel')}</span>
            <textarea
              className={styles.textarea}
              value={draft.prompt}
              rows={5}
              placeholder={t('identityPromptPlaceholder')}
              onChange={(event) => {
                setDraft((current) => ({ ...current, prompt: event.target.value }))
                setError(null)
              }}
            />
            <span className={styles.counter}>
              {count(previewPrompt)}/{IDENTITY_PROMPT_MAX}
            </span>
          </label>
          {preview ? (
            <div className={styles.previewBox}>
              {t('identityComposePreview', { text: preview })}
            </div>
          ) : (
            <div className={styles.note}>{t('identityPromptHint')}</div>
          )}
          {builtin ? (
            <button type="button" className={styles.link} onClick={fillBuiltin}>
              {t('identityRestoreDefault')}
            </button>
          ) : null}
          {error ? <div className={styles.error}>{t(error.key, error.params)}</div> : null}
          <div className={styles.formActions}>
            <Button variant="outlined" size="m" onClick={cancelEdit}>
              {t('cancel')}
            </Button>
            <Button size="m" onClick={save}>
              {t('identitySave')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.intro}>{t('identityIntro')}</div>
      <div className={styles.listHeader}>
        <span className={styles.listTitle}>{t('identityListTitle')}</span>
        <Button
          size="m"
          variant="outlined"
          disabled={profiles.length >= IDENTITY_LIMIT}
          onClick={startNew}
        >
          {t('identityNew')}
        </Button>
      </div>
      <div className={styles.list}>
        {profiles.map((profile) => {
          const isDefault = profile.id === defaultId
          const builtin = profile.id === BUILTIN_IDENTITY_ID
          return (
            <div
              key={profile.id}
              className={clsx(styles.item, isDefault && styles.itemDefault)}
            >
              <button
                type="button"
                className={styles.main}
                aria-pressed={isDefault}
                onClick={() => setDefaultIdentity(profile.id)}
              >
                <span className={styles.nameRow}>
                  <span className={styles.name}>{profile.name}</span>
                  {isDefault ? (
                    <span className={styles.badge}>{t('identityDefaultBadge')}</span>
                  ) : null}
                </span>
                <span className={styles.preview}>
                  {profile.prompt || t('identityEmptyPrompt')}
                </span>
              </button>
              <div className={styles.actions}>
                <IconButton
                  size="m"
                  icon={<IconEditOutline16 />}
                  aria-label={t('identityEdit')}
                  onClick={() => startEdit(profile)}
                />
                {builtin ? null : (
                  <IconButton
                    size="m"
                    icon={<IconTrashOutline16 />}
                    aria-label={t('identityDelete')}
                    onClick={() => setDeletingId(profile.id)}
                  />
                )}
              </div>
              {deletingId === profile.id ? (
                <div className={styles.deleteRow}>
                  <span className={styles.deleteText}>
                    {t('identityDeleteConfirm', { name: profile.name })}
                  </span>
                  <div className={styles.deleteActions}>
                    <Button size="m" variant="outlined" onClick={() => setDeletingId(null)}>
                      {t('cancel')}
                    </Button>
                    <Button size="m" variant="danger" onClick={() => confirmDelete(profile.id)}>
                      {t('delete')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className={styles.note}>
        {profiles.length >= IDENTITY_LIMIT
          ? t('identityLimitReached', { max: IDENTITY_LIMIT })
          : t('identityLimitHint', { max: IDENTITY_LIMIT })}
      </div>
      {error ? <div className={styles.error}>{t(error.key, error.params)}</div> : null}
    </div>
  )
}
