import { useState } from 'react'
import clsx from 'clsx'
import { IconEditOutline16, IconTrashOutline16 } from '../base/icons.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { listModels } from '../../services/api/protocols.js'
import {
  addProfile,
  cacheModels,
  DEFAULT_WINDOWS,
  normalizeBaseUrl,
  removeProfile,
  setActiveProfile,
  updateProfile,
  useEndpoints,
  type EndpointModel,
  type EndpointProfile,
  type EndpointProtocol,
} from '../../services/endpoints.js'
import styles from './EndpointSetting.module.css'

type FormState = {
  name: string
  baseUrl: string
  protocol: EndpointProtocol
  apiKey: string
  modelId: string
  contextWindow: string
}

type Message = {
  key: TranslationKey
  params?: Record<string, string | number>
  error?: boolean
} | null

const EMPTY_FORM: FormState = {
  name: '',
  baseUrl: '',
  protocol: 'deepseek',
  apiKey: '',
  modelId: '',
  contextWindow: '',
}

const protocolLabel = (protocol: EndpointProtocol): TranslationKey => {
  switch (protocol) {
    case 'deepseek':
      return 'endpointProtocolDeepSeek'
    case 'anthropic':
      return 'endpointProtocolAnthropic'
    case 'openai':
      return 'endpointProtocolOpenAI'
  }
}

/**
 * 数据管理里的 API 接入：
 * 方案列表负责切换，表单负责新建 / 编辑、拉取模型与保存；Key 只留在本机。
 */
export const EndpointSetting = () => {
  const t = useTranslate()
  const profiles = useEndpoints((state) => state.profiles)
  const activeId = useEndpoints((state) => state.activeId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [models, setModels] = useState<EndpointModel[]>([])
  const [fetching, setFetching] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [deleteTarget, setDeleteTarget] = useState<EndpointProfile | null>(null)

  const startNew = () => {
    setEditingId('new')
    setForm(EMPTY_FORM)
    setModels([])
    setMessage(null)
  }

  const startEdit = (profile: EndpointProfile) => {
    setEditingId(profile.id)
    setForm({
      name: profile.name,
      baseUrl: profile.baseUrl,
      protocol: profile.protocol,
      apiKey: profile.apiKey,
      modelId: profile.modelId,
      contextWindow: String(profile.contextWindow),
    })
    setModels(profile.models)
    setMessage(null)
  }

  const closeForm = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModels([])
    setMessage(null)
  }

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const chooseProtocol = (protocol: EndpointProtocol) => {
    setForm((current) => ({ ...current, protocol, modelId: '' }))
    // 换协议后旧模型列表没有意义；模型 ID 也清空，避免把旧协议的模型发到新端点
    setModels([])
  }

  const chooseModel = (modelId: string) => {
    const model = models.find((item) => item.id === modelId)
    setForm((current) => ({
      ...current,
      modelId,
      contextWindow: model?.contextWindow ? String(model.contextWindow) : current.contextWindow,
    }))
  }

  const errorText = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        return t('apiKeyInvalid')
      }
      if (error.kind === 'network') {
        return t('endpointFetchNetwork')
      }
      return error.localMessage
        ? t(error.localMessage.key, error.localMessage.params)
        : error.message
    }
    return error instanceof Error ? error.message : String(error)
  }

  const draftProfile = (): EndpointProfile => {
    const baseUrl = normalizeBaseUrl(form.baseUrl, form.protocol)
    return {
      id: editingId ?? 'draft',
      name: form.name,
      baseUrl: baseUrl ?? form.baseUrl,
      protocol: form.protocol,
      apiKey: form.apiKey.trim(),
      modelId: form.modelId,
      contextWindow: Number(form.contextWindow) > 0 ? Number(form.contextWindow) : 0,
      models: [],
      createdAt: 0,
      updatedAt: 0,
    }
  }

  const fetchModels = async () => {
    if (fetching) {
      return
    }
    const baseUrl = normalizeBaseUrl(form.baseUrl, form.protocol)
    if (!baseUrl) {
      setMessage({ key: 'endpointUrlInvalid', error: true })
      return
    }
    if (!form.apiKey.trim()) {
      setMessage({ key: 'endpointKeyRequired', error: true })
      return
    }
    setFetching(true)
    setMessage(null)
    try {
      const list = await listModels({ ...draftProfile(), baseUrl })
      setModels(list)
      const nextModel = list.some((model) => model.id === form.modelId) ? form.modelId : list[0].id
      const modelWindow = list.find((model) => model.id === nextModel)?.contextWindow
      setForm((current) => ({
        ...current,
        modelId: nextModel,
        contextWindow: modelWindow ? String(modelWindow) : current.contextWindow,
      }))
      setMessage({ key: 'endpointModelsFetched', params: { count: list.length } })
    } catch (error) {
      setMessage({
        key: 'endpointFetchFailed',
        params: { message: errorText(error) },
        error: true,
      })
    } finally {
      setFetching(false)
    }
  }

  const save = () => {
    const name = form.name.trim()
    const baseUrl = normalizeBaseUrl(form.baseUrl, form.protocol)
    const modelId = form.modelId.trim()
    if (!name) {
      setMessage({ key: 'endpointNameRequired', error: true })
      return
    }
    if (!baseUrl) {
      setMessage({ key: 'endpointUrlInvalid', error: true })
      return
    }
    if (!form.apiKey.trim()) {
      setMessage({ key: 'endpointKeyRequired', error: true })
      return
    }
    if (!modelId) {
      setMessage({ key: 'endpointModelRequired', error: true })
      return
    }
    const modelWindow = models.find((model) => model.id === modelId)?.contextWindow
    const contextWindow =
      Number(form.contextWindow) > 0
        ? Math.round(Number(form.contextWindow))
        : (modelWindow ?? DEFAULT_WINDOWS[form.protocol])
    const draft = {
      name,
      baseUrl,
      protocol: form.protocol,
      apiKey: form.apiKey.trim(),
      modelId,
      contextWindow,
    }
    if (editingId === 'new') {
      const id = addProfile(draft)
      cacheModels(id, models)
    } else if (editingId) {
      updateProfile(editingId, draft)
      cacheModels(editingId, models)
    }
    closeForm()
  }

  const confirmDelete = () => {
    if (!deleteTarget) {
      return
    }
    if (!removeProfile(deleteTarget.id)) {
      setMessage({ key: 'endpointLastProfile', error: true })
      setDeleteTarget(null)
      return
    }
    if (editingId === deleteTarget.id) {
      closeForm()
    }
    setDeleteTarget(null)
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.label}>{t('endpointProfiles')}</div>
          <div className={styles.description}>{t('endpointAddDescription')}</div>
        </div>
        <Button size="m" variant="outlined" onClick={startNew}>
          {t('endpointAdd')}
        </Button>
      </div>

      <div className={styles.list}>
        {profiles.map((profile) => {
          const active = profile.id === activeId
          return (
            <div key={profile.id} className={clsx(styles.profile, active && styles.profileActive)}>
              <button
                type="button"
                className={styles.profileMain}
                onClick={() => {
                  setActiveProfile(profile.id)
                  if (editingId) {
                    closeForm()
                  }
                }}
              >
                <span className={styles.profileTitle}>
                  <span className={styles.profileName}>{profile.name}</span>
                  <span className={clsx(styles.badge, active && styles.badgeActive)}>
                    {t(active ? 'endpointCurrent' : 'endpointSwitch')}
                  </span>
                </span>
                <span className={styles.profileMeta}>
                  {t(protocolLabel(profile.protocol))} · {profile.baseUrl} ·{' '}
                  {profile.modelId || t('endpointModelsEmpty')}
                </span>
              </button>
              <div className={styles.profileActions}>
                {!profile.apiKey ? (
                  <Button size="s" variant="primary" onClick={() => startEdit(profile)}>
                    {t('endpointFillKey')}
                  </Button>
                ) : null}
                {profile.apiKey ? (
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`${t('endpointEdit')} ${profile.name}`}
                    onClick={() => startEdit(profile)}
                  >
                    <IconEditOutline16 />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={clsx(styles.iconButton, styles.deleteButton)}
                  aria-label={`${t('endpointDelete')} ${profile.name}`}
                  disabled={profiles.length <= 1}
                  onClick={() => setDeleteTarget(profile)}
                >
                  <IconTrashOutline16 />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {editingId ? (
        <div
          className={styles.form}
          role="group"
          aria-label={t(editingId === 'new' ? 'endpointAdd' : 'endpointEdit')}
        >
          <div className={styles.formTitle}>
            {t(editingId === 'new' ? 'endpointAdd' : 'endpointEdit')}
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('endpointName')}</span>
            <input
              className={styles.input}
              value={form.name}
              placeholder={t('endpointName')}
              autoComplete="off"
              onChange={(event) => updateField('name', event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('endpointBaseUrl')}</span>
            <input
              className={styles.input}
              value={form.baseUrl}
              placeholder="https://api.deepseek.com"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              onChange={(event) => updateField('baseUrl', event.target.value)}
            />
            <span className={styles.hint}>{t('endpointBaseUrlHint')}</span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('endpointProtocol')}</span>
            <select
              className={styles.select}
              value={form.protocol}
              onChange={(event) => chooseProtocol(event.target.value as EndpointProtocol)}
            >
              <option value="deepseek">{t('endpointProtocolDeepSeek')}</option>
              <option value="anthropic">{t('endpointProtocolAnthropic')}</option>
              <option value="openai">{t('endpointProtocolOpenAI')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('endpointApiKey')}</span>
            <input
              className={styles.input}
              type="password"
              value={form.apiKey}
              placeholder={t('apiKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => updateField('apiKey', event.target.value)}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('endpointModel')}</span>
            <div className={styles.modelRow}>
              <input
                className={styles.input}
                value={form.modelId}
                placeholder={t('endpointModelPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => updateField('modelId', event.target.value)}
              />
              <Button
                size="m"
                variant="outlined"
                disabled={fetching}
                onClick={() => void fetchModels()}
              >
                {t(fetching ? 'endpointFetchingModels' : 'endpointFetchModels')}
              </Button>
            </div>
            {models.length > 0 ? (
              <select
                className={styles.select}
                value={models.some((model) => model.id === form.modelId) ? form.modelId : ''}
                onChange={(event) => {
                  if (event.target.value) {
                    chooseModel(event.target.value)
                  }
                }}
              >
                <option value="">{t('endpointModel')}</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name ? `${model.name} · ${model.id}` : model.id}
                    {model.contextWindow
                      ? ` · ${new Intl.NumberFormat().format(model.contextWindow)}`
                      : ''}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('endpointContextWindow')}</span>
            <input
              className={styles.input}
              value={form.contextWindow}
              placeholder={t('endpointAuto')}
              inputMode="numeric"
              onChange={(event) =>
                updateField('contextWindow', event.target.value.replace(/[^\d]/g, ''))
              }
            />
            <span className={styles.hint}>{t('endpointContextWindowHint')}</span>
          </label>

          {message ? (
            <div className={clsx(styles.message, message.error && styles.messageError)}>
              {t(message.key, message.params)}
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button size="m" variant="outlined" onClick={closeForm}>
              {t('endpointCancel')}
            </Button>
            <Button size="m" onClick={save}>
              {t('endpointSave')}
            </Button>
          </div>
        </div>
      ) : message ? (
        <div className={clsx(styles.message, message.error && styles.messageError)}>
          {t(message.key, message.params)}
        </div>
      ) : null}

      {deleteTarget ? (
        <Modal
          title={t('endpointDeleteTitle')}
          onClose={() => setDeleteTarget(null)}
          footer={
            <div className={styles.deleteActions}>
              <Button variant="outlined" size="m" autoFocus onClick={() => setDeleteTarget(null)}>
                {t('endpointCancel')}
              </Button>
              <Button variant="danger" size="m" onClick={confirmDelete}>
                {t('endpointDelete')}
              </Button>
            </div>
          }
        >
          {t('endpointDeleteDescription', { name: deleteTarget.name })}
        </Modal>
      ) : null}
    </div>
  )
}
