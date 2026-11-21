import clsx from 'clsx'
import type { CSSProperties } from 'react'
import styles from './Slider.module.css'

/**
 * 设置里的滑杆：标题行（左标题、右实时数值）+ 可选说明 + 原生 range。
 * rainbow 用于色相条；thumbColor 让滑块显示当前选中的颜色。
 */
export const Slider = ({
  value,
  min,
  max,
  step = 1,
  label,
  valueText,
  hint,
  rainbow = false,
  thumbColor,
  disabled = false,
  className,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  label: string
  valueText: string
  hint?: string
  rainbow?: boolean
  thumbColor?: string
  disabled?: boolean
  className?: string
  onChange: (value: number) => void
}) => {
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0
  const style = {
    '--slider-progress': `${Math.min(100, Math.max(0, progress))}%`,
    ...(thumbColor ? { '--slider-thumb': thumbColor } : {}),
  } as CSSProperties

  return (
    <div className={clsx(styles.root, disabled && styles.disabled, className)}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{valueText}</span>
      </div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
      <input
        type="range"
        className={clsx(styles.input, rainbow && styles.rainbow)}
        style={style}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  )
}
