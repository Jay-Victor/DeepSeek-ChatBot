import clsx from 'clsx'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './Segmented.module.css'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: ReactNode
}

/**
 * 分段控制器：一个圆角容器内等分排列，选中项浮起并染主题色。
 * 键盘左右 / 上下方向键切换，Home / End 跳到首尾。
 */
export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    const current = options.findIndex((option) => option.value === value)
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + options.length) % options.length
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (current + 1) % options.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = options.length - 1
    }
    if (next === null) {
      return
    }
    event.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={clsx(styles.root, className)}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={clsx(styles.option, selected && styles.selected)}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <span className={styles.icon}>{option.icon}</span> : null}
            <span className={styles.label}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
