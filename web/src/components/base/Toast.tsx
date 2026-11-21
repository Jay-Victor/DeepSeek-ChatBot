import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { IconToastError16 } from './icons.js'
import { hideToast, useToast } from './toastState.js'
import styles from './Toast.module.css'

export const Toast = () => {
  const t = useTranslate()
  const { id, message, placement } = useToast()
  if (!message) {
    return null
  }
  if (typeof message === 'string') {
    return (
      <div
        key={id}
        className={clsx(styles.toast, placement === 'center' && styles.center)}
        role="status"
      >
        {message}
      </div>
    )
  }
  const error = message.type === 'error'
  const link = message.link
  const action = link?.onClick
  const activate = () => {
    if (!action) {
      return
    }
    action()
    hideToast()
  }
  return (
    <div
      key={id}
      className={clsx(
        styles.toast,
        placement === 'center' && styles.center,
        error && styles.error,
        action && styles.action
      )}
      role={action ? 'button' : 'status'}
      tabIndex={action ? 0 : undefined}
      onClick={activate}
      onKeyDown={
        action
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                activate()
              }
            }
          : undefined
      }
    >
      {error ? (
        <span className={styles.icon}>
          <IconToastError16 />
        </span>
      ) : null}
      <span className={styles.content}>
        {t(message.key, message.params)}
        {link ? (
          action ? (
            <span className={styles.link}>{t(link.key)}</span>
          ) : (
            <a className={styles.link} href={link.href} target="_blank" rel="noreferrer">
              {t(link.key)}
            </a>
          )
        ) : null}
      </span>
    </div>
  )
}
