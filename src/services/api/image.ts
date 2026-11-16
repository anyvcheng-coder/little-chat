import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { ImageProvider, ImageReferenceSpec } from '../image/providers.js'
import {
  getImageReferenceSpec,
  isImageSizeIgnored,
  resolveImageEndpoint,
} from '../image/providers.js'
import { prepareReference, toDataUrl } from '../image/references.js'
import { ApiError } from './client.js'

/**
 * 调用供应商的生图接口。
 *
 * 三个必须处理的现实问题：
 * 1. 参数名不统一（`image_size` / `size`），先按配置发完整请求，400 时退回只有必填字段的请求再试一次；
 * 2. 返回的可能是外链而不是 base64，而外链通常 1 小时就失效——拿到后立即下载成 Blob 存本地，
 *    历史里才不会变成裂图；
 * 3. 参考图的投递方式有两套：硅基流动、方舟塞进 JSON 字段，OpenAI 必须走 multipart 的
 *    `/v1/images/edits`。两套都从这里分流，上层只传 Blob。
 */

export type GenerateImagesOptions = {
  provider: ImageProvider
  apiKey: string
  /** 覆盖供应商默认地址（中转或自建代理）；空则用供应商地址 */
  baseUrl?: string | null
  model: string
  prompt: string
  /** 透传给接口；空字符串表示不传 */
  size: string
  n: number
  /** 参考图；非空即走图生图 */
  references?: Blob[]
}

type ImagePayload = { b64_json?: unknown; url?: unknown }

const ERROR_MESSAGE = /"message"\s*:\s*"([^"]+)"/i

/** 报错结构不统一：OpenAI 风格是 error.message，硅基流动是顶层 message，方舟还有 error.code */
const readErrorMessage = (text: string, fallback: string): string => {
  try {
    const body: unknown = JSON.parse(text)
    if (typeof body === 'object' && body !== null) {
      const error = (body as { error?: unknown }).error
      if (typeof error === 'string' && error) {
        return error
      }
      if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string' && message) {
          return message
        }
      }
      const message = (body as { message?: unknown }).message
      if (typeof message === 'string' && message) {
        return message
      }
    }
  } catch {
    // 非 JSON 响应体直接尝试匹配文案
  }
  return ERROR_MESSAGE.exec(text)?.[1] ?? (text.trim() || fallback)
}

/** 按文件头识别图片类型：供应商不一定回传 MIME */
const toImageType = (bytes: Uint8Array): string =>
  bytes[0] === 0x89 && bytes[1] === 0x50
    ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8
      ? 'image/jpeg'
      : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57
        ? 'image/webp'
        : 'image/png'

const fromBase64 = (value: string): Blob => {
  const binary = atob(value)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([buffer], { type: toImageType(bytes) })
}

const fromUrl = async (url: string, signal: AbortSignal): Promise<Blob> => {
  // 接口只回外链时（例如不认识 response_format），图床一般不允许跨域读取，原生壳里改走系统网络栈
  const native = nativeHttp()
  if (native) {
    try {
      const response = await withAbort(
        native.get({
          url,
          responseType: 'arraybuffer',
          connectTimeout: 30_000,
          readTimeout: 120_000,
        }),
        signal
      )
      if (response.status < 200 || response.status >= 300) {
        throw new ApiError('http', `图片下载失败（HTTP ${response.status}）`, response.status)
      }
      const data: unknown = response.data
      // 安卓侧 arraybuffer 会以 base64 字符串返回
      if (typeof data === 'string') {
        return fromBase64(data)
      }
      return new Blob([data as BlobPart], { type: 'image/png' })
    } catch (error) {
      if (error instanceof ApiError || signal.aborted) {
        throw error
      }
      // 系统请求也失败时退回到 fetch 再试一次
    }
  }
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    // 图床不允许跨域读取时走到这里，提示比原始 TypeError 更有用
    throw new ApiError(
      'network',
      `图片地址无法直接下载（可能是跨域限制）：${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!response.ok) {
    throw new ApiError('http', `图片下载失败（HTTP ${response.status}）`, response.status)
  }
  return new Blob([await response.arrayBuffer()], {
    type: response.headers.get('Content-Type') ?? 'image/png',
  })
}

const extensionOf = (blob: Blob): string =>
  blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('webp') ? 'webp' : 'png'

/** JSON 方式：按 fields 顺序逐张放，或合并成一个数组字段 */
const attachJsonReferences = (
  body: Record<string, unknown>,
  spec: ImageReferenceSpec,
  dataUrls: string[]
): void => {
  const field = spec.fields?.[0]
  if (!field) {
    return
  }
  if (spec.asArray) {
    body[field] = dataUrls
    return
  }
  dataUrls.forEach((url, index) => {
    const name = spec.fields?.[index]
    if (name) {
      body[name] = url
    }
  })
}

/** 统一的响应结果：原生与 fetch 两条通道都归一成「状态码 + 原始文本」 */
type PostResult = { ok: boolean; status: number; text: string }

/**
 * 原生壳里可用的系统网络栈。
 *
 * WebView 里的 fetch 受跨域限制，而方舟、硅基流动的**错误响应不带跨域头**，
 * 于是 401/404 这类真正的报错在浏览器里一律显示成 `Failed to fetch`，用户和我们都看不到原因。
 * 安卓壳里改走 CapacitorHttp（系统网络栈），既没有跨域限制，也能读到接口返回的真实错误体。
 */
const nativeHttp = () => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CapacitorHttp')
      ? CapacitorHttp
      : null
  } catch {
    return null
  }
}

/** 原生请求无法中途中止，用赛跑让「停止」立刻生效，晚到的结果直接丢掉 */
const withAbort = <T>(task: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('请求已中止', 'AbortError'))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })

/** 连不上时给出可操作的提示，而不是干巴巴一句 Failed to fetch */
const networkError = (url: string, error: unknown): ApiError => {
  const message = error instanceof Error ? error.message : String(error)
  return new ApiError(
    'network',
    `请求没能完成：${url}。常见原因：Key 不是你选的那家（各家 Key 不通用）、模型没在控制台开通、接口地址填错。原始错误：${message}`
  )
}

const postJson = async (
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal
): Promise<PostResult> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  const native = nativeHttp()
  if (native) {
    try {
      const response = await withAbort(
        native.post({
          url,
          headers,
          data: body,
          // 直接要原始文本：既能自己解析，也能读到错误响应体
          responseType: 'text',
          // 出图慢（2K 常见 20 秒以上），连接与读取都给足时间
          connectTimeout: 30_000,
          readTimeout: 300_000,
        }),
        signal
      )
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        text:
          typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? ''),
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }
      throw networkError(url, error)
    }
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw networkError(url, error)
  }
  return { ok: response.ok, status: response.status, text: await response.text().catch(() => '') }
}

/** multipart（OpenAI 改图）只能走 fetch：系统网络栈不收 FormData */
const postForm = async (
  url: string,
  form: FormData,
  apiKey: string,
  signal: AbortSignal
): Promise<PostResult> => {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw networkError(url, error)
  }
  return { ok: response.ok, status: response.status, text: await response.text().catch(() => '') }
}

/** 生成图片；返回按接口顺序排列的原图 Blob，任一环节失败都抛出 ApiError */
export const generateImages = async (
  { provider, apiKey, baseUrl, model, prompt, size, n, references = [] }: GenerateImagesOptions,
  signal: AbortSignal
): Promise<Blob[]> => {
  // 手填的自定义模型走供应商的 fallbackReference，仍可带参考图
  const spec = getImageReferenceSpec(provider, model)
  // 参考图只在模型声明支持时使用；否则按文生图提交，避免接口报“未知字段”
  const usable = spec ? references.slice(0, spec.max) : []
  const prepared = await Promise.all(usable.map((blob) => prepareReference(blob)))
  const usesForm = !!spec && spec.transport === 'form' && prepared.length > 0
  const dataUrls = usesForm ? [] : await Promise.all(prepared.map(toDataUrl))

  const url = resolveImageEndpoint(provider, baseUrl, usesForm ? 'edits' : 'generations')

  /** minimal 只保留必填字段，用于供应商不认识可选参数时回退重试 */
  const buildBody = (minimal: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = { model, prompt }
    if (size && !isImageSizeIgnored(provider, model)) {
      body[provider.sizeField] = size
    }
    if (provider.countField && n > 0) {
      body[provider.countField] = n
    }
    if (spec && prepared.length > 0) {
      attachJsonReferences(body, spec, dataUrls)
    }
    return minimal ? body : { ...body, ...provider.extraBody }
  }

  const buildForm = (minimal: boolean): FormData => {
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', prompt)
    if (size && !isImageSizeIgnored(provider, model)) {
      form.append(provider.sizeField, size)
    }
    if (provider.countField && n > 0) {
      form.append(provider.countField, String(n))
    }
    if (!minimal) {
      for (const [key, value] of Object.entries(provider.extraBody ?? {})) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          form.append(key, String(value))
        }
      }
    }
    prepared.forEach((blob, index) => {
      // 字段名必须是 image[]，OpenAI 用它区分多张参考图
      form.append('image[]', blob, `reference-${index + 1}.${extensionOf(blob)}`)
    })
    return form
  }

  const post = (minimal: boolean) =>
    usesForm
      ? postForm(url, buildForm(minimal), apiKey, signal)
      : postJson(url, buildBody(minimal), apiKey, signal)

  let result = await post(false)
  if (!result.ok) {
    if (result.status === 400) {
      // 供应商不认识可选字段时，用只有必填项的请求体再试一次（参考图保留，否则会静默变成文生图）
      const fallback = await post(true)
      if (!fallback.ok) {
        throw new ApiError(
          'http',
          readErrorMessage(fallback.text, `HTTP ${fallback.status}`),
          fallback.status
        )
      }
      result = fallback
    } else {
      throw new ApiError(
        'http',
        readErrorMessage(result.text, `HTTP ${result.status}`),
        result.status
      )
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(result.text)
  } catch {
    throw new ApiError('protocol', '生图接口返回的不是 JSON')
  }
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) {
    throw new ApiError('protocol', '生图接口没有返回图片')
  }
  const blobs: Blob[] = []
  for (const item of data as ImagePayload[]) {
    if (typeof item?.b64_json === 'string' && item.b64_json) {
      blobs.push(fromBase64(item.b64_json))
    } else if (typeof item?.url === 'string' && item.url) {
      blobs.push(await fromUrl(item.url, signal))
    }
  }
  if (blobs.length === 0) {
    throw new ApiError('protocol', '生图接口没有返回可用的图片数据')
  }
  return blobs
}
