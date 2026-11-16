import { create } from 'zustand'

/**
 * 外观个性化：主题色与聊天背景。
 *
 * 两者都只影响观感，不参与会话数据，因此直接存 localStorage：
 * 主题色是一个色值，背景图是压缩后的 data URL（长边 1440、JPEG，通常 200~600KB），
 * 不会挤占 IndexedDB 里存会话与生成图的空间。
 * 真正生效的是写在 body 上的 CSS 变量——主题切换时变量不用重算，只有数值变化才重新写入。
 */

export type Wallpaper =
  | { kind: 'preset'; id: WallpaperPresetId }
  | { kind: 'image'; value: string }

export type WallpaperPresetId = 'aurora' | 'dusk' | 'paper' | 'mist' | 'forest'

export const WALLPAPER_PRESETS: WallpaperPresetId[] = [
  'aurora',
  'dusk',
  'paper',
  'mist',
  'forest',
]

/** 主题色预设；都是白底上可读、深色下提亮后仍然清楚的色调 */
export const ACCENT_PRESETS = [
  { value: '#4D6BFE', name: 'appearanceAccentBlue' },
  { value: '#12B5A5', name: 'appearanceAccentTeal' },
  { value: '#22A06B', name: 'appearanceAccentGreen' },
  { value: '#E08A00', name: 'appearanceAccentAmber' },
  { value: '#E24B4B', name: 'appearanceAccentRed' },
  { value: '#E2559B', name: 'appearanceAccentPink' },
  { value: '#8B5CF6', name: 'appearanceAccentViolet' },
  { value: '#5B6472', name: 'appearanceAccentGraphite' },
] as const

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].value
/** 背景遮罩默认不透明度：预设渐变很淡，遮罩太重会看不出背景 */
export const DEFAULT_WALLPAPER_DIM = 0.38

type AppearanceState = {
  /** null 表示用主题自带的蓝 */
  accent: string | null
  wallpaper: Wallpaper | null
  /** 0~0.92，越大背景越淡、文字越清楚 */
  wallpaperDim: number
  /** 0~24px */
  wallpaperBlur: number
}

const KEYS = {
  accent: 'chat-demo:appearance-accent',
  wallpaper: 'chat-demo:appearance-wallpaper',
  wallpaperDim: 'chat-demo:appearance-wallpaper-dim',
  wallpaperBlur: 'chat-demo:appearance-wallpaper-blur',
} as const

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 返回是否写入成功：图片过大时 localStorage 会抛配额错误，界面要能给出提示 */
const write = (key: string, value: string | null): boolean => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
    return true
  } catch {
    return false
  }
}

const isHexColor = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value)

const initialAccent = (): string | null => {
  const saved = read(KEYS.accent)
  return saved && isHexColor(saved) ? saved : null
}

const initialWallpaper = (): Wallpaper | null => {
  const saved = read(KEYS.wallpaper)
  if (!saved) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const { kind, id, value } = parsed as { kind?: unknown; id?: unknown; value?: unknown }
    if (
      kind === 'preset' &&
      typeof id === 'string' &&
      (WALLPAPER_PRESETS as string[]).includes(id)
    ) {
      return { kind: 'preset', id: id as WallpaperPresetId }
    }
    if (kind === 'image' && typeof value === 'string' && value.startsWith('data:image/')) {
      return { kind: 'image', value }
    }
  } catch {
    // 脏数据当作没有背景
  }
  return null
}

const readNumber = (key: string, fallback: number, min: number, max: number): number => {
  const raw = read(key)
  // 没存过时 read 返回 null，直接 Number(null) 会得到 0，把默认值吃掉
  if (raw === null || raw.trim() === '') {
    return fallback
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

export const useAppearance = create<AppearanceState>(() => ({
  accent: initialAccent(),
  wallpaper: initialWallpaper(),
  wallpaperDim: readNumber(KEYS.wallpaperDim, DEFAULT_WALLPAPER_DIM, 0, 0.92),
  wallpaperBlur: readNumber(KEYS.wallpaperBlur, 0, 0, 24),
}))

/** 把 #rgb / #rrggbb 拆成三个通道值 */
const parseHex = (hex: string): [number, number, number] => {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ]
}

/** 往白色方向混，得到悬停态、深色模式文字色与浅底色 */
const lighten = (hex: string, ratio: number): string => {
  const [r, g, b] = parseHex(hex)
  const mix = (channel: number) => Math.round(channel + (255 - channel) * ratio)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

/** 往黑色方向混；深色模式下的气泡底色需要压暗而不是提亮 */
const darken = (hex: string, ratio: number): string => {
  const [r, g, b] = parseHex(hex)
  const mix = (channel: number) => Math.round(channel * (1 - ratio))
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

const presetToCss = (id: WallpaperPresetId): string => `var(--wp-${id})`

/** 把设置写成 body 上的 CSS 变量；主题色留空时移除覆盖，回到主题自带的蓝 */
const applyAppearance = ({ accent, wallpaper, wallpaperDim, wallpaperBlur }: AppearanceState) => {
  if (typeof document === 'undefined') {
    return
  }
  const { style, dataset } = document.body
  if (accent && isHexColor(accent)) {
    style.setProperty('--app-accent', accent)
    style.setProperty('--app-accent-hover', lighten(accent, 0.14))
    style.setProperty('--app-accent-soft', lighten(accent, 0.34))
    // 气泡、选中项的浅底色：浅色模式往白里调，深色模式往黑里调
    style.setProperty('--app-accent-tint', lighten(accent, 0.9))
    style.setProperty('--app-accent-tint-dark', darken(accent, 0.72))
    dataset.appAccent = 'custom'
  } else {
    style.removeProperty('--app-accent')
    style.removeProperty('--app-accent-hover')
    style.removeProperty('--app-accent-soft')
    style.removeProperty('--app-accent-tint')
    style.removeProperty('--app-accent-tint-dark')
    delete dataset.appAccent
  }
  if (wallpaper) {
    style.setProperty(
      '--app-wallpaper',
      wallpaper.kind === 'image' ? `url("${wallpaper.value}")` : presetToCss(wallpaper.id)
    )
    style.setProperty('--app-wallpaper-dim', String(wallpaperDim))
    style.setProperty('--app-wallpaper-blur', `${wallpaperBlur}px`)
    dataset.appWallpaper = wallpaper.kind
  } else {
    style.removeProperty('--app-wallpaper')
    delete dataset.appWallpaper
  }
}

/** 首屏渲染前应用一次，之后跟随设置变化（包括自定义图片） */
export const setupAppearance = () => {
  applyAppearance(useAppearance.getState())
  useAppearance.subscribe(applyAppearance)
}

export const setAccent = (accent: string | null) => {
  const value = accent && isHexColor(accent) ? accent.toLowerCase() : null
  write(KEYS.accent, value)
  useAppearance.setState({ accent: value })
}

export const setWallpaper = (wallpaper: Wallpaper | null) => {
  const saved = write(KEYS.wallpaper, wallpaper ? JSON.stringify(wallpaper) : null)
  // 存储失败（多为超出配额）时不做切换，界面据此提示
  if (!saved && wallpaper) {
    return false
  }
  useAppearance.setState({ wallpaper })
  return true
}

export const setWallpaperDim = (value: number) => {
  const wallpaperDim = Math.min(0.92, Math.max(0, value))
  write(KEYS.wallpaperDim, String(wallpaperDim))
  useAppearance.setState({ wallpaperDim })
}

export const setWallpaperBlur = (value: number) => {
  const wallpaperBlur = Math.min(24, Math.max(0, Math.round(value)))
  write(KEYS.wallpaperBlur, String(wallpaperBlur))
  useAppearance.setState({ wallpaperBlur })
}

/** 背景图长边上限与体积上限：手机上 1440 足够铺满，再大只是白占存储 */
const WALLPAPER_EDGE = 1440
const WALLPAPER_MAX_BYTES = 1.8 * 1024 * 1024

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const encodeJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality))

/**
 * 用户选的原图可能十几 MB，先缩到 1440 长边再落地；
 * 仍然太大时降一档重编码，避免把 localStorage 撑爆。
 */
export const prepareWallpaper = async (file: Blob): Promise<string | null> => {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    const edge = Math.max(bitmap.width, bitmap.height)
    const attempts = [
      { edge: WALLPAPER_EDGE, quality: 0.82 },
      { edge: 1024, quality: 0.74 },
      { edge: 768, quality: 0.7 },
    ]
    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.edge / edge)
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) {
        return null
      }
      // JPEG 没有透明通道，先铺底色，否则透明区域会变黑
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)
      const blob = await encodeJpeg(canvas, attempt.quality)
      if (!blob) {
        return null
      }
      if (blob.size <= WALLPAPER_MAX_BYTES) {
        return await toDataUrl(blob)
      }
    }
    return null
  } finally {
    bitmap.close?.()
  }
}

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
