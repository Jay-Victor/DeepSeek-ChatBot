import clsx from 'clsx'
import { useCallback, useRef } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useReadAloudSupported } from '../../services/speech/readAloud.js'
import { useSessionEndpoint } from '../../services/useCapabilities.js'
import { useDoubleTap } from '../../utils/useDoubleTap.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList, type MessageListHandle } from '../messages/MessageList.js'
import { IdentitySwitcher } from './IdentitySwitcher.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const { capabilities } = useSessionEndpoint(session.id)
  // 本地朗读不看端点能力；在线朗读仍要求 DeepSeek 官方端点
  const readAloudSupported = useReadAloudSupported(capabilities)
  const listRef = useRef<MessageListHandle>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const scrollToTop = useCallback(() => listRef.current?.scrollToTop(), [])
  const titleTapHandlers = useDoubleTap(scrollToTop)
  const title = session.title || t('untitledChat')
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader
          title={title}
          autoRead={readAloudSupported}
          sessionId={session.id}
          identityId={session.identityId}
          onTitleDoubleClick={scrollToTop}
        />
      ) : (
        <div className={styles.header}>
          <div
            className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}
            title={t('doubleTapToTop')}
            {...titleTapHandlers}
          >
            {title}
          </div>
          <IdentitySwitcher
            variant="desktop"
            sessionId={session.id}
            identityId={session.identityId}
          />
        </div>
      )}
      <MessageList
        ref={listRef}
        session={session}
        streaming={streaming}
        composerRef={composerRef}
        footer={
          <div ref={composerRef} className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
