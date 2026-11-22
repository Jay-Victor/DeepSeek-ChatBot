import clsx from 'clsx'
import { useEffect, useState } from 'react'
import appIcon from '../../assets/app-icon.png'
import tipAlipay from '../../assets/tip-alipay.jpg'
import tipWechat from '../../assets/tip-wechat.png'
import { saveImageToAlbum } from '../../app/native.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { setAutoCheckUpdates, useSettings } from '../../services/settings.js'
import { appVersion, checkForUpdates, hasUpdate, useUpdate } from '../../services/update.js'
import { canInstallInApp, useUpdateInstall } from '../../services/updateInstall.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { Switch } from '../base/Switch.js'
import { useImageViewer } from '../files/imageViewerState.js'
import styles from './Settings.module.css'

const formatSize = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`

const ERROR_KEYS: Record<string, TranslationKey> = {
  start_failed: 'aboutInstallErrorGeneric',
  bad_url: 'aboutInstallErrorGeneric',
  network: 'aboutInstallErrorNetwork',
  storage: 'aboutInstallErrorNetwork',
  no_space: 'aboutInstallErrorSpace',
  too_large: 'aboutInstallErrorSpace',
  http_403: 'aboutInstallErrorRateLimit',
  http_429: 'aboutInstallErrorRateLimit',
  digest_mismatch: 'aboutInstallErrorVerify',
  size_mismatch: 'aboutInstallErrorVerify',
  signature_mismatch: 'aboutInstallErrorVerify',
  package_mismatch: 'aboutInstallErrorVerify',
  version_mismatch: 'aboutInstallErrorVerify',
  invalid_apk: 'aboutInstallErrorVerify',
  not_newer: 'aboutInstallErrorVerify',
  permission_denied: 'aboutInstallErrorPermission',
  installer_missing: 'aboutInstallErrorInstaller',
}

const errorKey = (code: string | null): TranslationKey => {
  if (code && ERROR_KEYS[code]) {
    return ERROR_KEYS[code]
  }
  if (code?.startsWith('http_')) {
    return 'aboutInstallErrorNetwork'
  }
  return 'aboutInstallErrorGeneric'
}

type TipKind = 'wechat' | 'alipay'

const TIPS: Record<TipKind, { src: string; file: string; mime: string }> = {
  wechat: { src: tipWechat, file: 'DeepSeekChatBot-wechat-tip.png', mime: 'image/png' },
  alipay: { src: tipAlipay, file: 'DeepSeekChatBot-alipay-tip.jpg', mime: 'image/jpeg' },
}

/**
 * 关于：上方居中放应用图标、名称与版本，下方是检查更新按钮和自动检查开关。
 * 有更新时在原生壳里直接下载、校验并调起系统安装器；浏览器预览退回普通下载链接。
 */
export const AboutSetting = () => {
  const t = useTranslate()
  const autoCheck = useSettings((state) => state.autoCheckUpdates)
  const { checking, failed, release } = useUpdate()
  const phase = useUpdateInstall((state) => state.phase)
  const received = useUpdateInstall((state) => state.received)
  const total = useUpdateInstall((state) => state.total)
  const code = useUpdateInstall((state) => state.code)
  const start = useUpdateInstall((state) => state.start)
  const cancel = useUpdateInstall((state) => state.cancel)

  const available = hasUpdate(release)
  const version = appVersion()
  const installable = Boolean((release?.apkApiUrl ?? release?.apkUrl) && canInstallInApp())
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null
  const [savingTip, setSavingTip] = useState<TipKind | null>(null)

  useEffect(() => {
    // 只清理旧的失败/空闲状态；正在下载或等待安装时不要丢掉 requestId
    const state = useUpdateInstall.getState()
    if (state.phase === 'idle' || state.phase === 'error') {
      state.reset()
    }
  }, [release?.version])

  // 从系统安装器返回（用户取消）时复位，否则按钮会一直停在「正在打开安装程序」
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      if (useUpdateInstall.getState().phase !== 'installing') {
        return
      }
      window.setTimeout(() => {
        if (useUpdateInstall.getState().phase === 'installing') {
          useUpdateInstall.getState().reset()
        }
      }, 1200)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const buttonLabel =
    phase === 'downloading'
      ? percent !== null
        ? t('aboutDownloading', { percent })
        : t('aboutDownloadingWait')
      : phase === 'verifying'
        ? t('aboutVerifying')
        : phase === 'permission'
          ? t('aboutInstallPermission')
          : phase === 'installing'
            ? t('aboutOpeningInstaller')
            : phase === 'ready'
              ? t('aboutInstallReady')
              : phase === 'error'
                ? t('aboutInstallRetry')
                : t('aboutInstallUpdate')

  const buttonDisabled =
    phase === 'verifying' || phase === 'permission' || phase === 'installing'

  const loadTip = async (kind: TipKind) => {
    const response = await fetch(TIPS[kind].src)
    if (!response.ok) {
      throw new Error('tip fetch failed')
    }
    return response.blob()
  }

  const openTip = async (kind: TipKind) => {
    try {
      const blob = await loadTip(kind)
      useImageViewer.getState().openImage({
        blob,
        name: t(kind === 'wechat' ? 'aboutSupportWechat' : 'aboutSupportAlipay'),
      })
    } catch {
      showToast({ key: 'aboutSupportImageFailed', type: 'error' })
    }
  }

  const saveTip = async (kind: TipKind) => {
    if (savingTip) {
      return
    }
    setSavingTip(kind)
    try {
      const blob = await loadTip(kind)
      const result = await saveImageToAlbum(TIPS[kind].file, blob, TIPS[kind].mime)
      if (result === 'saved') {
        showToast({ key: 'aboutSupportSaved' })
      } else if (result === 'downloaded') {
        showToast({ key: 'aboutSupportDownloaded' })
      } else {
        showToast({ key: 'aboutSupportSaveFailed', type: 'error' })
      }
    } catch {
      showToast({ key: 'aboutSupportSaveFailed', type: 'error' })
    } finally {
      setSavingTip(null)
    }
  }

  return (
    <div className={styles.about}>
      <div className={styles.aboutBrand}>
        <img className={styles.aboutLogo} src={appIcon} alt="" width={64} height={64} />
        <div className={styles.aboutName}>{t('appName')}</div>
        <div className={styles.aboutVersion}>{t('aboutVersion', { version })}</div>
      </div>

      <div className={styles.aboutUpdate}>
        <Button
          variant="outlined"
          size="m"
          disabled={checking}
          onClick={() => void checkForUpdates()}
        >
          {t(checking ? 'aboutChecking' : 'aboutCheckUpdate')}
        </Button>
        <div
          className={clsx(styles.aboutStatus, failed && styles.aboutStatusError)}
          role="status"
          aria-live="polite"
        >
          {checking ? (
            ''
          ) : failed ? (
            t('aboutCheckFailed')
          ) : release ? (
            available ? (
              t('aboutUpdateAvailable', { version: release.version })
            ) : (
              t('aboutUpToDate')
            )
          ) : (
            ''
          )}
        </div>
      </div>

      {available && release ? (
        <div className={styles.aboutUpdateCard}>
          <div className={styles.aboutUpdateTitle}>{release.name}</div>
          {release.apkSize > 0 ? (
            <div className={styles.aboutUpdateMeta}>
              <span>{t('aboutUpdateSize', { size: formatSize(release.apkSize) })}</span>
            </div>
          ) : null}

          {installable ? (
            <>
              <div className={styles.aboutActions}>
                <Button
                  variant="primary"
                  size="m"
                  disabled={buttonDisabled}
                  onClick={() => {
                    void start(release)
                  }}
                >
                  {buttonLabel}
                </Button>
                {phase === 'downloading' ? (
                  <button type="button" className={styles.aboutTextButton} onClick={cancel}>
                    {t('aboutInstallCancel')}
                  </button>
                ) : null}
              </div>

              {phase === 'downloading' ? (
                <div
                  className={styles.aboutProgress}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent ?? undefined}
                >
                  <span
                    className={clsx(
                      styles.aboutProgressBar,
                      percent === null && styles.aboutProgressIndeterminate
                    )}
                    style={percent !== null ? { width: `${percent}%` } : undefined}
                  />
                </div>
              ) : null}

              {phase === 'downloading' && total > 0 ? (
                <div className={styles.aboutProgressText}>
                  {t('aboutDownloadingBytes', {
                    received: formatSize(received),
                    total: formatSize(total),
                  })}
                </div>
              ) : null}

              {phase === 'error' ? (
                <div className={styles.aboutError} role="alert">
                  {t(errorKey(code))}
                </div>
              ) : null}

              <div className={styles.aboutLinks}>
                <a
                  className={styles.aboutStatusLink}
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('aboutReleaseNotes')}
                </a>
                <a
                  className={styles.aboutStatusLink}
                  href={release.apkUrl ?? release.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('aboutOpenInBrowser')}
                </a>
              </div>
            </>
          ) : release.apkUrl ? (
            <a
              className={styles.aboutActionLink}
              href={release.apkUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('aboutDownloadUpdate')}
            </a>
          ) : (
            <a
              className={styles.aboutActionLink}
              href={release.url}
              target="_blank"
              rel="noreferrer"
            >
              {t('aboutOpenRelease')}
            </a>
          )}
        </div>
      ) : null}

      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.label}>{t('aboutAutoCheck')}</div>
          <div className={styles.description}>{t('aboutAutoCheckDescription')}</div>
        </div>
        <Switch
          checked={autoCheck}
          label={t('aboutAutoCheck')}
          onChange={setAutoCheckUpdates}
        />
      </div>

      <div className={styles.aboutSupport}>
        <div className={styles.aboutSupportTitle}>{t('aboutSupportTitle')}</div>
        <div className={styles.aboutSupportDesc}>{t('aboutSupportDesc')}</div>
        <div className={styles.aboutSupportGrid}>
          {(['wechat', 'alipay'] as const).map((kind) => {
            const label = t(kind === 'wechat' ? 'aboutSupportWechat' : 'aboutSupportAlipay')
            return (
              <div className={styles.aboutSupportItem} key={kind}>
                <button
                  type="button"
                  className={styles.aboutSupportThumb}
                  aria-label={t('aboutSupportEnlarge', { name: label })}
                  onClick={() => void openTip(kind)}
                >
                  <img src={TIPS[kind].src} alt="" />
                </button>
                <div className={styles.aboutSupportLabel}>{label}</div>
                <button
                  type="button"
                  className={styles.aboutSupportSave}
                  disabled={savingTip !== null}
                  onClick={() => void saveTip(kind)}
                >
                  <IconDownloadOutline16 />
                  {savingTip === kind ? t('aboutSupportSaving') : t('aboutSupportSave')}
                </button>
              </div>
            )
          })}
        </div>
        <div className={styles.aboutSupportHint}>{t('aboutSupportHint')}</div>
      </div>
    </div>
  )
}
