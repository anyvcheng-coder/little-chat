/**
 * 参考图预处理。
 *
 * 用户上传的图可能是几 MB 的原图，直接转 base64 塞进 JSON 会让请求体膨胀数倍，
 * 部分接口会直接拒收或超时。这里统一压到 1536 长边、1.5MB 以内再发；
 * 解码失败（格式不支持、画布不可用）时原样返回，宁可让接口报错也不要静默丢图。
 */

/** 参考图长边上限 */
const MAX_EDGE = 1536
/** 超过这个体积就重新编码 */
const MAX_BYTES = 1.5 * 1024 * 1024
const JPEG_QUALITY = 0.92

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

const createCanvas = (width: number, height: number): AnyCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const canvasToBlob = (canvas: AnyCanvas, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    if ('convertToBlob' in canvas) {
      canvas
        .convertToBlob({ type, quality })
        .then((blob) => resolve(blob))
        .catch(() => resolve(null))
      return
    }
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })

/** 缩到上限内并重新编码；原图本来就够小则原样返回 */
export const prepareReference = async (blob: Blob): Promise<Blob> => {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return blob
  }
  try {
    const edge = Math.max(bitmap.width, bitmap.height)
    if (edge <= MAX_EDGE && blob.size <= MAX_BYTES) {
      return blob
    }
    const scale = Math.min(1, MAX_EDGE / edge)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!context) {
      return blob
    }
    // 白底：参考图可能带透明通道，编码成 JPEG 时透明区会变黑
    if (!blob.type.includes('png')) {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(bitmap, 0, 0, width, height)
    // PNG 常见于截图和带透明的素材，重编码成 JPEG 会丢通道，仍按 PNG 输出
    const type = blob.type.includes('png') ? 'image/png' : 'image/jpeg'
    const output = await canvasToBlob(canvas, type, JPEG_QUALITY)
    return output && output.size < blob.size ? output : blob
  } catch {
    return blob
  } finally {
    bitmap.close?.()
  }
}

/** Blob 转 data URL；参考图接口普遍接受 `data:image/png;base64,...` 形式 */
export const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取参考图失败'))
    reader.readAsDataURL(blob)
  })
