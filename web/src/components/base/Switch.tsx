import clsx from 'clsx'
import styles from './Switch.module.css'

/** 开关：44px 触控区，26px 高的轨道；用于设置里的布尔项 */
export const Switch = ({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean
  /** 无障碍名称；通常与左侧标题一致 */
  label: string
  onChange: (checked: boolean) => void
  disabled?: boolean
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={clsx(styles.switch, checked && styles.on)}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.thumb} />
  </button>
)
