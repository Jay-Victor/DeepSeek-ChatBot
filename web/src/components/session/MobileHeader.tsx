import {
  IconMenuOutline20,
  IconNewChatOutline20,
  IconVolumeMuteOutline20,
  IconVolumeOutline20,
} from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { setAutoReadAloud, useSettings } from '../../services/settings.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { IdentitySwitcher } from './IdentitySwitcher.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 自动朗读开关的状态提示：短到不挡内容，又够看清 */
const HINT_DURATION = 1600

/**
 * 移动端顶栏：左侧菜单打开侧边栏，右侧常驻新建会话。
 * 会话页在新建左侧额外显示自动朗读开关；欢迎页与加载页不显示。
 */
export const MobileHeader = ({
  title,
  autoRead = false,
  sessionId,
  identityId,
  showIdentity = true,
}: {
  title?: string
  autoRead?: boolean
  /** 会话页传入：切换只改这个会话 */
  sessionId?: string
  /** 会话使用的身份；缺省表示内置身份 */
  identityId?: string
  /** 会话加载中还没有身份可显示时隐藏切换器 */
  showIdentity?: boolean
}) => {
  const t = useTranslate()
  const autoReadOn = useSettings((state) => state.autoReadAloud)
  const toggleAutoRead = () => {
    const next = !useSettings.getState().autoReadAloud
    setAutoReadAloud(next)
    if (!next) {
      stopReadAloud()
    }
    showToast(
      { key: next ? 'autoReadEnabled' : 'autoReadDisabled' },
      { placement: 'center', duration: HINT_DURATION }
    )
  }
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {showIdentity ? (
        <IdentitySwitcher sessionId={sessionId} identityId={identityId} />
      ) : null}
      <div className={styles.title}>{title ?? ''}</div>
      <div className={styles.actions}>
        {autoRead ? (
          <IconButton
            size="xl"
            tone="primary"
            icon={autoReadOn ? <IconVolumeOutline20 /> : <IconVolumeMuteOutline20 />}
            tooltip={t(autoReadOn ? 'autoReadDisable' : 'autoReadEnable')}
            aria-pressed={autoReadOn}
            onClick={toggleAutoRead}
          />
        ) : null}
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconNewChatOutline20 />}
          aria-label={t('newChat')}
          onClick={newChat}
        />
      </div>
    </div>
  )
}
