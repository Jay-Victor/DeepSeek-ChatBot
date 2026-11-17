import clsx from 'clsx'
import appIcon from '../../assets/app-icon.png'
import { useTranslate } from '../../i18n/index.js'
import { setAutoCheckUpdates, useSettings } from '../../services/settings.js'
import { appVersion, checkForUpdates, hasUpdate, useUpdate } from '../../services/update.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

/** 开关：关于页的自动检查更新 */
const Switch = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={clsx(styles.switch, checked && styles.switchOn)}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.switchThumb} />
  </button>
)

/**
 * 关于：上方居中放应用图标、名称与版本，下方是检查更新按钮和自动检查开关。
 * 版本来自原生壳的 versionName，更新信息来自 GitHub Release。
 */
export const AboutSetting = () => {
  const t = useTranslate()
  const autoCheck = useSettings((state) => state.autoCheckUpdates)
  const { checking, failed, release } = useUpdate()
  const available = hasUpdate(release)
  const version = appVersion()
  const downloadUrl = release ? (release.apkUrl ?? release.url) : null

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
              <>
                {t('aboutUpdateAvailable', { version: release.version })}
                {downloadUrl ? (
                  <>
                    {' · '}
                    <a
                      className={styles.aboutStatusLink}
                      href={downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('aboutDownloadUpdate')}
                    </a>
                  </>
                ) : null}
              </>
            ) : (
              t('aboutUpToDate')
            )
          ) : (
            ''
          )}
        </div>
      </div>

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
    </div>
  )
}
