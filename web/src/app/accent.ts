import { useSettings } from '../services/settings.js'

/** 未自定义时滑杆停在 DeepSeek 蓝的色相位置（只用于展示，不写入设置） */
export const DEFAULT_ACCENT_HUE = 227

/** 与上游蓝色 ramp 对应的饱和度 / 明度，只替换色相 */
const RAMP: Record<string, [number, number]> = {
  '50': [89, 96],
  '100': [86, 94],
  '200': [100, 91],
  '300': [97, 86],
  '400': [99, 70],
  '450': [99, 67],
  '500': [99, 61],
  '600': [41, 49],
  '800': [27, 28],
  '900': [25, 21],
}

const STYLE_ID = 'ds-accent-theme'

type Rgb = { r: number; g: number; b: number }

const hslToRgb = (hue: number, saturation: number, lightness: number): Rgb => {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const section = ((hue % 360) + 360) % 360 / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const offset = l - chroma / 2
  let rgb: [number, number, number]
  if (section < 1) {
    rgb = [chroma, secondary, 0]
  } else if (section < 2) {
    rgb = [secondary, chroma, 0]
  } else if (section < 3) {
    rgb = [0, chroma, secondary]
  } else if (section < 4) {
    rgb = [0, secondary, chroma]
  } else if (section < 5) {
    rgb = [secondary, 0, chroma]
  } else {
    rgb = [chroma, 0, secondary]
  }
  return {
    r: Math.round((rgb[0] + offset) * 255),
    g: Math.round((rgb[1] + offset) * 255),
    b: Math.round((rgb[2] + offset) * 255),
  }
}

const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (value: number) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

const contrast = (first: number, second: number): number =>
  (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)

/** 主色上的文字（按钮 / 发送键）按对比度取黑或白，避免黄绿色主题配白字看不清 */
const foregroundFor = (hue: number, lightness: number): string => {
  const background = luminance(hslToRgb(hue, 99, lightness))
  const white = luminance({ r: 255, g: 255, b: 255 })
  const black = luminance({ r: 27, g: 27, b: 28 })
  return contrast(background, white) >= contrast(background, black) ? '#ffffff' : '#1b1b1c'
}

const declarations = (hue: number, primaryLightness: number): string =>
  Object.entries(RAMP)
    .map(([token, [saturation, lightness]]) => {
      return `--dsw-static-blue-${token}:hsl(${hue},${saturation}%,${lightness}%);`
    })
    .join('') + `--dsw-alias-label-primary-foreground:${foregroundFor(hue, primaryLightness)};`

/**
 * 自定义主题色：覆盖上游整套蓝色 ramp（浅色与深色各一份），
 * 默认色相不注入任何样式，保持原版 DeepSeek 蓝。
 */
export const applyAccent = (hue: number | null) => {
  const existing = document.getElementById(STYLE_ID)
  if (hue === null) {
    existing?.remove()
    return
  }
  const style = existing ?? document.createElement('style')
  style.id = STYLE_ID
  style.textContent =
    `body{${declarations(hue, 61)}}` +
    `body[data-ds-dark-theme]{${declarations(hue, 67)}}`
  if (!existing) {
    document.head.appendChild(style)
  }
}

/** 启动时应用一次，之后随设置变化更新；不经过 React，拖动滑杆不会重渲染聊天树 */
export const setupAccent = () => {
  applyAccent(useSettings.getState().accentHue)
  useSettings.subscribe((state, previous) => {
    if (state.accentHue !== previous.accentHue) {
      applyAccent(state.accentHue)
    }
  })
}
