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
  /** 默认接口基址，请求发往 `${origin}/v1/images/...`；可在设置里换成中转地址 */
  origin: string
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
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    corsSafe: true,
    sizeField: 'image_size',
    countField: 'batch_size',
    // 默认返回 1 小时有效的外链，这里要求同时返回 base64，拿到后立即落盘
    extraBody: { provider: { enable_image_base64: true } },
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
    consoleUrl: 'https://console.volcengine.com/ark',
    corsSafe: true,
    sizeField: 'size',
    countField: null,
    // Seedream 默认带水印；response_format 指定直接返回 base64
    extraBody: { watermark: false, response_format: 'b64_json' },
    models: [
      {
        id: 'doubao-seedream-4-0-20260415',
        label: 'Seedream 4.0',
        sizes: SEEDREAM_SIZES,
        priceHint: '约 0.2 元/张',
        // image 支持字符串或数组，多图参考合并成数组
        reference: { max: 10, transport: 'json', fields: ['image'], asArray: true },
      },
    ],
    defaultModel: 'doubao-seedream-4-0-20260415',
    defaultSize: '2048x2048',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    origin: 'https://api.openai.com',
    consoleUrl: 'https://platform.openai.com/api-keys',
    // api.openai.com 不返回跨域头，浏览器直连会被拦截，必须填中转地址
    corsSafe: false,
    sizeField: 'size',
    countField: 'n',
    models: [
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
    defaultModel: 'gpt-image-1',
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

/** 模型的参考图能力；不认识的自定义模型按文生图处理 */
export const getImageReferenceSpec = (
  provider: ImageProvider,
  model: string
): ImageReferenceSpec | undefined => provider.models.find((item) => item.id === model)?.reference

/** 模型是否忽略尺寸参数 */
export const isImageSizeIgnored = (provider: ImageProvider, model: string): boolean =>
  provider.models.find((item) => item.id === model)?.ignoresSize === true

/**
 * 按参考图张数挑模型：
 * 当前模型够用就保持不变；吃不下或不吃参考图时，优先换一个能全部吃下的，
 * 都吃不下就换容量最大的；该供应商完全没有参考图模型则保留原模型（按文生图处理）。
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
  if (current?.reference && current.reference.max >= referenceCount) {
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

/** 去掉末尾斜杠，允许用户填 `https://x.com/v1` 这种写法 */
export const normalizeImageOrigin = (value: string): string =>
  value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
