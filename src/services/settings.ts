import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import {
  getImageProvider,
  getImageSizes,
  migrateImageModel,
  normalizeImageOrigin,
  PROVIDERS,
} from './image/providers.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、生图配置 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /**
   * 各生图供应商各自的 API Key，按供应商 ID 存放：切换供应商不会把 A 家的 Key 发给 B 家。
   * 当前供应商没有 Key 时不声明生图工具，对话模型不会尝试出图。
   */
  imageApiKeys: Record<string, string>
  /** 各供应商的自定义接口地址；留空用默认地址。OpenAI 直连会被跨域拦截，需填中转 */
  imageBaseUrls: Record<string, string>
  imageProvider: string
  imageModel: string
  imageSize: string
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  imageApiKeys: 'chat-demo:image-api-keys',
  imageBaseUrls: 'chat-demo:image-base-urls',
  /** 旧版只存一把 Key，启动时迁移到按供应商存放的结构 */
  legacyImageApiKey: 'chat-demo:image-api-key',
  imageProvider: 'chat-demo:image-provider',
  imageModel: 'chat-demo:image-model',
  imageSize: 'chat-demo:image-size',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 生图供应商只接受已知取值，脏数据回落到默认供应商 */
const initialImageProvider = (): string => {
  const saved = read(KEYS.imageProvider)
  return saved && saved in PROVIDERS ? saved : 'siliconflow'
}

const initialImageModel = (): string => {
  const saved = read(KEYS.imageModel)?.trim()
  return migrateImageModel(saved || getImageProvider(initialImageProvider()).defaultModel)
}

/** 旧模型换成新模型后，原尺寸可能超出新模型的取值范围，回落到该供应商的默认尺寸 */
const initialImageSize = (): string => {
  const provider = getImageProvider(initialImageProvider())
  const saved = read(KEYS.imageSize)?.trim()
  if (!saved) {
    return provider.defaultSize
  }
  const model = initialImageModel()
  const sizes = getImageSizes(provider, model)
  return sizes.length > 0 && !sizes.some((item) => item.value === saved)
    ? provider.defaultSize
    : saved
}

/** 读取「供应商 ID → 字符串」形式的记录，脏数据一律丢掉 */
const readRecord = (key: string): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(read(key) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([id, value]) => [id, value.trim()])
        .filter(([, value]) => !!value)
    )
  } catch {
    return {}
  }
}

const initialImageApiKeys = (): Record<string, string> => {
  const saved = readRecord(KEYS.imageApiKeys)
  if (Object.keys(saved).length > 0) {
    return saved
  }
  const legacy = read(KEYS.legacyImageApiKey)?.trim()
  if (!legacy) {
    return {}
  }
  const migrated = { [initialImageProvider()]: legacy }
  write(KEYS.imageApiKeys, JSON.stringify(migrated))
  write(KEYS.legacyImageApiKey, null)
  return migrated
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  imageApiKeys: initialImageApiKeys(),
  imageBaseUrls: readRecord(KEYS.imageBaseUrls),
  imageProvider: initialImageProvider(),
  imageModel: initialImageModel(),
  imageSize: initialImageSize(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setImageApiKey = (providerId: string, imageApiKey: string | null) => {
  const value = imageApiKey?.trim() ?? ''
  const rest = Object.entries(useSettings.getState().imageApiKeys).filter(
    ([id]) => id !== providerId
  )
  const imageApiKeys = Object.fromEntries(value ? [...rest, [providerId, value]] : rest)
  write(KEYS.imageApiKeys, JSON.stringify(imageApiKeys))
  useSettings.setState({ imageApiKeys })
}

/** 自定义接口地址：留空表示用供应商默认地址，保存时去掉末尾斜杠与多余的 /v1 */
export const setImageBaseUrl = (providerId: string, baseUrl: string) => {
  const normalized = normalizeImageOrigin(baseUrl)
  const rest = Object.entries(useSettings.getState().imageBaseUrls).filter(
    ([id]) => id !== providerId
  )
  const imageBaseUrls = Object.fromEntries(
    normalized ? [...rest, [providerId, normalized]] : rest
  )
  write(KEYS.imageBaseUrls, JSON.stringify(imageBaseUrls))
  useSettings.setState({ imageBaseUrls })
}

/** 切换供应商时把模型与尺寸换成该供应商的默认值，避免残留别家的模型 ID */
export const setImageProvider = (id: string) => {
  const provider = getImageProvider(id)
  write(KEYS.imageProvider, provider.id)
  write(KEYS.imageModel, provider.defaultModel)
  write(KEYS.imageSize, provider.defaultSize)
  useSettings.setState({
    imageProvider: provider.id,
    imageModel: provider.defaultModel,
    imageSize: provider.defaultSize,
  })
}

export const setImageModel = (imageModel: string) => {
  write(KEYS.imageModel, imageModel)
  useSettings.setState({ imageModel })
}

export const setImageSize = (imageSize: string) => {
  write(KEYS.imageSize, imageSize)
  useSettings.setState({ imageSize })
}

/** 取指定供应商的 Key；缺省取当前选中的供应商 */
export const getImageApiKey = (providerId?: string): string | null => {
  const { imageApiKeys, imageProvider } = useSettings.getState()
  return imageApiKeys[providerId ?? imageProvider]?.trim() || null
}

/** 取指定供应商的自定义接口地址；没配置时返回空串，由调用方回落到供应商默认地址 */
export const getImageBaseUrl = (providerId?: string): string => {
  const { imageBaseUrls, imageProvider } = useSettings.getState()
  return imageBaseUrls[providerId ?? imageProvider] ?? ''
}

/** 是否已具备出图条件：缺少 API Key 时对话模型不会声明生图工具 */
export const hasImageKey = () => !!getImageApiKey()
