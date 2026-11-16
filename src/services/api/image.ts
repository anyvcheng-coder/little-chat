import type { ImageProvider, ImageReferenceSpec } from '../image/providers.js'
import { isImageSizeIgnored } from '../image/providers.js'
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

/** 生成图片；返回按接口顺序排列的原图 Blob，任一环节失败都抛出 ApiError */
export const generateImages = async (
  { provider, apiKey, baseUrl, model, prompt, size, n, references = [] }: GenerateImagesOptions,
  signal: AbortSignal
): Promise<Blob[]> => {
  const spec = provider.models.find((item) => item.id === model)?.reference
  // 参考图只在模型声明支持时使用；否则按文生图提交，避免接口报“未知字段”
  const usable = spec ? references.slice(0, spec.max) : []
  const prepared = await Promise.all(usable.map((blob) => prepareReference(blob)))
  const usesForm = !!spec && spec.transport === 'form' && prepared.length > 0
  const dataUrls = usesForm ? [] : await Promise.all(prepared.map(toDataUrl))

  const origin = (baseUrl?.trim() || provider.origin).replace(/\/+$/, '').replace(/\/v1$/, '')
  const endpoint = usesForm ? '/v1/images/edits' : '/v1/images/generations'

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
    fetch(`${origin}${endpoint}`, {
      method: 'POST',
      headers: usesForm
        ? { Authorization: `Bearer ${apiKey}` }
        : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: usesForm ? buildForm(minimal) : JSON.stringify(buildBody(minimal)),
      signal,
    }).catch((error: unknown) => {
      if (signal.aborted) {
        throw error
      }
      throw new ApiError('network', error instanceof Error ? error.message : String(error))
    })

  let response = await post(false)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    if (response.status === 400) {
      // 供应商不认识可选字段时，用只有必填项的请求体再试一次（参考图保留，否则会静默变成文生图）
      const fallback = await post(true)
      if (!fallback.ok) {
        const fallbackText = await fallback.text().catch(() => '')
        throw new ApiError(
          'http',
          readErrorMessage(fallbackText, fallback.statusText),
          fallback.status
        )
      }
      response = fallback
    } else {
      throw new ApiError('http', readErrorMessage(text, response.statusText), response.status)
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
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
