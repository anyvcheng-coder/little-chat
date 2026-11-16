/**
 * 生图供应商配置。
 *
 * 各家的接口虽然都叫 `/v1/images/*`，参数名和能力并不统一：
 * 硅基流动用 `image_size` / `batch_size`，参考图放在 `image`、`image2`、`image3`；
 * 火山方舟用 `size`，参考图是 `image` 字符串或数组；
 * OpenAI 的改图走另一个端点 `POST /v1/images/edits`，且必须是 multipart 表单。
 * 因此字段名、参考图投递方式、固定参数都收进配置，调用逻辑只按配置拼请求，
 * 新增一家供应商只需在这里加一条记录。
 */

export type ImageProviderId = 'siliconflow' | 'ark' | 'openai'

export type ImageSize = { value: string; label: string }

/**
 * 参考图（图生图）能力。
 *
 * - json：参考图塞进 JSON body，按 `fields` 顺序对应第 1、2、3 张；
 *   `asArray` 为 true 时多张合并成数组放到单个字段（方舟）。
 * - form：multipart/form-data 上传文件（OpenAI `/v1/images/edits`，字段 `image[]`）。
 */
export type ImageReferenceSpec = {
  /** 最多接受几张参考图 */
  max: number
  transport: 'json' | 'form'
  /** json 方式下的字段名，按顺序使用 */
  fields?: string[]
  /** json 方式下多张参考图合并成一个数组字段 */
  asArray?: boolean
}

export type ImageModel = {
  /** 供应商侧的模型 ID */
  id: string
  label: string
  /** 该模型推荐的尺寸；空数组表示不传尺寸，由服务端决定 */
  sizes: ImageSize[]
  /** 单价提示，仅用于界面展示 */
  priceHint?: string
  /** 参考图能力；缺省表示纯文生图 */
  reference?: ImageReferenceSpec
  /** 编辑类模型忽略尺寸参数（输出尺寸跟随输入图），请求里不要带 */
  ignoresSize?: boolean
}

export type ImageProvider = {
  id: ImageProviderId
  label: string
  /** 默认接口域名；可在设置里换成中转地址 */
  origin: string
  /**
   * 域名后的版本段。方舟是 `/api/v3`（`/v1/...` 不存在，会 404 且错误响应不带跨域头，
   * 浏览器里只会报 Failed to fetch），硅基流动与 OpenAI 是 `/v1`。
   */
  apiPath: string
  /** 申请 API Key 的地址 */
  consoleUrl: string
  /** 浏览器能否直连；false 时界面提示必须填中转地址（否则会被 CORS 拦截） */
  corsSafe: boolean
  /** 尺寸字段名 */
  sizeField: string
  /** 张数字段名；null 表示该供应商不通过该字段控制张数 */
  countField: string | null
  /** 每次请求都附带的字段（如关闭水印、要求返回 base64） */
  extraBody?: Record<string, unknown>
  /**
   * 手填的自定义模型 ID 没有登记参考图能力，按这里的配置处理：
   * 该系列的新版本参数基本延续，能继续吃参考图；留空表示自定义模型只做文生图。
   */
  fallbackReference?: ImageReferenceSpec
  models: ImageModel[]
  defaultModel: string
  defaultSize: string
}

/** Kolors 官方推荐值：1024x1024 / 960x1280 / 768x1024 / 720x1440 / 720x1280 */
const KOLORS_SIZES: ImageSize[] = [
  { value: '1024x1024', label: '1:1 方形' },
  { value: '960x1280', label: '3:4 竖版' },
  { value: '720x1280', label: '9:16 手机竖屏' },
  { value: '720x1440', label: '1:2 长竖图' },
]

const QWEN_SIZES: ImageSize[] = [
  { value: '1328x1328', label: '1:1 方形' },
  { value: '1140x1472', label: '3:4 竖版' },
  { value: '928x1664', label: '9:16 手机竖屏' },
  { value: '1472x1140', label: '4:3 横版' },
  { value: '1664x928', label: '16:9 横屏' },
]

const ERNIE_SIZES: ImageSize[] = [
  { value: '1024x1024', label: '1:1 方形' },
  { value: '768x1024', label: '3:4 竖版' },
  { value: '1024x768', label: '4:3 横版' },
]

/**
 * Seedream 5.x（5.5 / 5.0 Pro / 5.0 Flash）的范围是 1K～2K，
 * 像素值直接写各档位的映射，所以同一套尺寸在 5.x 上仍然可用。
 */
const SEEDREAM_5_SIZES: ImageSize[] = [
  { value: '1024x1024', label: '1K 方形' },
  { value: '2048x2048', label: '2K 方形' },
  { value: '1776x2368', label: '2K 3:4 竖版' },
  { value: '1584x2816', label: '2K 9:16 手机竖屏' },
  { value: '2368x1776', label: '2K 4:3 横版' },
  { value: '2816x1584', label: '2K 16:9 横屏' },
]

/** Seedream 4.x 支持到 4K */
const SEEDREAM_SIZES: ImageSize[] = [
  { value: '2048x2048', label: '2K 方形' },
  { value: '1728x2304', label: '2K 3:4 竖版' },
  { value: '1600x2848', label: '2K 9:16 手机竖屏' },
  { value: '2304x1728', label: '2K 4:3 横版' },
  { value: '2848x1600', label: '2K 16:9 横屏' },
  { value: '4096x4096', label: '4K 方形' },
]

/** gpt-image 系列只接受这三档 */
const GPT_IMAGE_SIZES: ImageSize[] = [
  { value: '1024x1024', label: '1:1 方形' },
  { value: '1536x1024', label: '3:2 横版' },
  { value: '1024x1536', label: '2:3 竖版' },
]

export const PROVIDERS: Record<ImageProviderId, ImageProvider> = {
  siliconflow: {
    id: 'siliconflow',
    label: '硅基流动',
    origin: 'https://api.siliconflow.cn',
    apiPath: '/v1',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    corsSafe: true,
    sizeField: 'image_size',
    countField: 'batch_size',
    // 默认返回 1 小时有效的外链，这里要求同时返回 base64，拿到后立即落盘
    extraBody: { provider: { enable_image_base64: true } },
    fallbackReference: { max: 1, transport: 'json', fields: ['image'] },
    models: [
      {
        id: 'Kwai-Kolors/Kolors',
        label: 'Kolors',
        sizes: KOLORS_SIZES,
        priceHint: '约 0.1 元/张',
        // 传 image 即按参考图改写，只支持单张
        reference: { max: 1, transport: 'json', fields: ['image'] },
      },
      {
        id: 'Qwen/Qwen-Image',
        label: 'Qwen Image',
        sizes: QWEN_SIZES,
        priceHint: '按张计费',
        reference: { max: 1, transport: 'json', fields: ['image'] },
      },
      {
        id: 'Qwen/Qwen-Image-Edit-2509',
        label: 'Qwen Image Edit 2509',
        sizes: [],
        priceHint: '按张计费',
        reference: { max: 3, transport: 'json', fields: ['image', 'image2', 'image3'] },
        ignoresSize: true,
      },
      {
        id: 'Qwen/Qwen-Image-Edit',
        label: 'Qwen Image Edit',
        sizes: [],
        priceHint: '按张计费',
        reference: { max: 1, transport: 'json', fields: ['image'] },
        ignoresSize: true,
      },
      {
        id: 'baidu/ERNIE-Image-Turbo',
        label: 'ERNIE Image Turbo',
        sizes: ERNIE_SIZES,
        priceHint: '约 0.11 元/张',
      },
    ],
    defaultModel: 'Kwai-Kolors/Kolors',
    defaultSize: '1024x1024',
  },
  ark: {
    id: 'ark',
    label: '火山方舟',
    origin: 'https://ark.cn-beijing.volces.com',
    apiPath: '/api/v3',
    consoleUrl: 'https://console.volcengine.com/ark',
    corsSafe: true,
    sizeField: 'size',
    countField: null,
    // Seedream 默认带水印；response_format 指定直接返回 base64
    extraBody: { watermark: false, response_format: 'b64_json' },
    // 自定义模型默认按 Seedream 系列的图生图参数发送
    fallbackReference: { max: 10, transport: 'json', fields: ['image'], asArray: true },
    models: [
      {
        id: 'doubao-seedream-5-5-261028',
        label: 'Seedream 5.5',
        sizes: SEEDREAM_5_SIZES,
        // image 支持字符串或数组，多图参考合并成数组
        reference: { max: 10, transport: 'json', fields: ['image'], asArray: true },
      },
      {
        id: 'doubao-seedream-5-0-pro-260628',
        label: 'Seedream 5.0 Pro',
        sizes: SEEDREAM_5_SIZES,
        reference: { max: 10, transport: 'json', fields: ['image'], asArray: true },
      },
      {
        id: 'doubao-seedream-5-0-flash-260915',
        label: 'Seedream 5.0 Flash',
        sizes: SEEDREAM_5_SIZES,
        reference: { max: 10, transport: 'json', fields: ['image'], asArray: true },
      },
      {
        id: 'doubao-seedream-4-5-251128',
        label: 'Seedream 4.5（旧版）',
        sizes: SEEDREAM_SIZES,
        reference: { max: 14, transport: 'json', fields: ['image'], asArray: true },
      },
      {
        id: 'doubao-seedream-4-0-250828',
        label: 'Seedream 4.0（旧版）',
        sizes: SEEDREAM_SIZES,
        priceHint: '约 0.2 元/张',
        reference: { max: 14, transport: 'json', fields: ['image'], asArray: true },
      },
    ],
    defaultModel: 'doubao-seedream-5-5-261028',
    defaultSize: '2048x2048',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    origin: 'https://api.openai.com',
    apiPath: '/v1',
    consoleUrl: 'https://platform.openai.com/api-keys',
    // api.openai.com 不返回跨域头，浏览器直连会被拦截，必须填中转地址
    corsSafe: false,
    sizeField: 'size',
    countField: 'n',
    fallbackReference: { max: 16, transport: 'form' },
    models: [
      {
        id: 'gpt-image-2',
        label: 'GPT Image 2（最新）',
        sizes: GPT_IMAGE_SIZES,
        priceHint: '按 token 计费，输出较贵',
        reference: { max: 16, transport: 'form' },
      },
      {
        id: 'gpt-image-1.5',
        label: 'GPT Image 1.5',
        sizes: GPT_IMAGE_SIZES,
        priceHint: '比 GPT Image 1 便宜约 20%',
        reference: { max: 16, transport: 'form' },
      },
      {
        id: 'gpt-image-1',
        label: 'GPT Image 1',
        sizes: GPT_IMAGE_SIZES,
        priceHint: '按质量计费，较贵',
        reference: { max: 16, transport: 'form' },
      },
      {
        id: 'gpt-image-1-mini',
        label: 'GPT Image 1 mini',
        sizes: GPT_IMAGE_SIZES,
        priceHint: '比 gpt-image-1 便宜',
        reference: { max: 16, transport: 'form' },
      },
    ],
    defaultModel: 'gpt-image-2',
    defaultSize: '1024x1024',
  },
}

export const IMAGE_PROVIDER_IDS = Object.keys(PROVIDERS) as ImageProviderId[]

export const getImageProvider = (id: string): ImageProvider =>
  PROVIDERS[id as ImageProviderId] ?? PROVIDERS.siliconflow

/** 取某个供应商下模型的尺寸选项；不认识的模型沿用该供应商默认模型的尺寸表 */
export const getImageSizes = (provider: ImageProvider, model: string): ImageSize[] => {
  const found = provider.models.find((item) => item.id === model)
  if (found) {
    return found.sizes
  }
  return provider.models.find((item) => item.id === provider.defaultModel)?.sizes ?? []
}

/** 是否登记过的模型；false 表示用户手填的自定义模型 */
export const isPresetImageModel = (provider: ImageProvider, model: string): boolean =>
  provider.models.some((item) => item.id === model)

/** 取模型的展示名；自定义模型直接显示 ID */
export const getImageModelLabel = (provider: ImageProvider, model: string): string =>
  provider.models.find((item) => item.id === model)?.label ?? model

/**
 * 模型的参考图能力。
 * 自定义模型没有登记，按供应商的 fallbackReference 处理——同系列新版本参数通常不变，
 * 完全不吃参考图的接口也没有这个字段，此时退化成文生图。
 */
export const getImageReferenceSpec = (
  provider: ImageProvider,
  model: string
): ImageReferenceSpec | undefined =>
  provider.models.find((item) => item.id === model)?.reference ?? provider.fallbackReference

/** 模型是否忽略尺寸参数 */
export const isImageSizeIgnored = (provider: ImageProvider, model: string): boolean =>
  provider.models.find((item) => item.id === model)?.ignoresSize === true

/**
 * 按参考图张数挑模型：
 * 当前模型够用就保持不变；吃不下或不吃参考图时，优先换一个能全部吃下的，
 * 都吃不下就换容量最大的；该供应商完全没有参考图模型则保留原模型（按文生图处理）。
 * 手填的自定义模型一律不动——用户明确指定了版本，替它换模型反而会画错。
 */
export const resolveImageModel = (
  provider: ImageProvider,
  model: string,
  referenceCount: number
): string => {
  if (referenceCount <= 0) {
    return model
  }
  const current = provider.models.find((item) => item.id === model)
  if (!current) {
    return model
  }
  if (current.reference && current.reference.max >= referenceCount) {
    return model
  }
  const capable = provider.models.filter((item) => item.reference)
  if (capable.length === 0) {
    return model
  }
  const exact = capable.find((item) => (item.reference?.max ?? 0) >= referenceCount)
  if (exact) {
    return exact.id
  }
  return capable.reduce((best, item) =>
    (item.reference?.max ?? 0) > (best.reference?.max ?? 0) ? item : best
  ).id
}

/** 老版本写进本机设置的模型 ID 已下线或本就写错，启动时换成当前版本 */
const LEGACY_MODEL_IDS: Record<string, string> = {
  'doubao-seedream-4-0-20260415': 'doubao-seedream-5-5-261028',
}

export const migrateImageModel = (model: string): string => LEGACY_MODEL_IDS[model] ?? model

/** 去掉末尾斜杠，允许用户填 `https://x.com`、`https://x.com/v1` 或整条接口地址 */
export const normalizeImageOrigin = (value: string): string =>
  value
    .trim()
    .replace(/\/+$/, '')
    // 直接粘贴文档里的完整接口地址时，把路径也去掉，只留基址
    .replace(/\/images\/(?:generations|edits)$/i, '')
    .replace(/\/+$/, '')

/** 基址里是否已经带了版本段（`/v1`、`/api/v3` 之类） */
const VERSION_SEGMENT = /\/(?:v\d+|api\/v\d+)$/i

/**
 * 拼出真正要请求的地址。
 *
 * 各家的版本段不一样：方舟是 `/api/v3/images/generations`，硅基流动与 OpenAI 是 `/v1/images/...`。
 * 自填地址已经带版本段（中转常见写法）就按原样拼，否则补上该供应商的版本段。
 */
export const resolveImageEndpoint = (
  provider: ImageProvider,
  baseUrl: string | null | undefined,
  kind: 'generations' | 'edits' = 'generations'
): string => {
  const path = kind === 'edits' ? '/images/edits' : '/images/generations'
  const custom = normalizeImageOrigin(baseUrl ?? '')
  if (!custom) {
    return `${provider.origin}${provider.apiPath}${path}`
  }
  return VERSION_SEGMENT.test(custom) ? `${custom}${path}` : `${custom}${provider.apiPath}${path}`
}
