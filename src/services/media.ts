import * as db from './chat/db.js'

/**
 * 素材库：会话里的图片按原件 id 登记，原件本身仍放在 files 表里，不复制。
 * 列表只读缩略图（长边 480 的 JPEG），点开大图时再取原件，避免手机上一次性解码几十张原图。
 */

/** 缩略图长边 */
const THUMB_SIZE = 480
/** 缩略图质量 */
const THUMB_QUALITY = 0.82

const createThumb = async (blob: Blob): Promise<Blob | undefined> => {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return undefined
    }
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob((result) => resolve(result ?? undefined), 'image/jpeg', THUMB_QUALITY)
    })
  } catch {
    // 解码失败（格式不支持等）时不生成缩略图，列表里退回原图
    return undefined
  }
}

/** 缩略图任务排队执行：一次生成多张图时不会同时解码，界面也不会被抢占 */
let queue: Promise<unknown> = Promise.resolve()
const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
  const task = queue.then(job, job)
  queue = task.catch(() => {})
  return task
}

/** 登记新出现的图片，并顺手生成缩略图；失败只留日志，不影响对话 */
export const rememberImages = (entries: { item: db.MediaItem; blob?: Blob }[]): void => {
  if (entries.length === 0) {
    return
  }
  void db.addMedia(entries.map((entry) => entry.item)).catch(db.reportStorageError('index media'))
  for (const { item, blob } of entries) {
    if (!blob) {
      continue
    }
    void enqueue(async () => {
      const thumb = await createThumb(blob)
      if (thumb) {
        await db.saveMediaThumb(item.id, thumb)
      }
    }).catch(db.reportStorageError('save media thumb'))
  }
}

/** 素材库列表，从新到旧 */
export const readLibrary = (): Promise<db.MediaItem[]> => db.listMedia()

/** 缩略图：优先读缓存，没有时用原图现生成并写回；无法缩略时退回原图 */
export const loadThumb = (id: string): Promise<Blob | undefined> =>
  enqueue(async () => {
    const cached = await db.loadMediaThumb(id)
    if (cached) {
      return cached
    }
    const blob = await db.loadFile(id)
    if (!blob) {
      return undefined
    }
    const thumb = await createThumb(blob)
    if (thumb) {
      await db.saveMediaThumb(id, thumb).catch(db.reportStorageError('save media thumb'))
    }
    return thumb ?? blob
  })

/** 原图，用于预览与下载 */
export const loadOriginal = (id: string): Promise<Blob | undefined> => db.loadFile(id)

/** 文件名：优先用上传时的原名，生成图按时间命名 */
export const mediaFileName = (item: db.MediaItem, blob: Blob): string => {
  if (item.name) {
    return item.name
  }
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
  const time = new Date(item.createdAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    'little-chat-',
    time.getFullYear(),
    pad(time.getMonth() + 1),
    pad(time.getDate()),
    '-',
    pad(time.getHours()),
    pad(time.getMinutes()),
    pad(time.getSeconds()),
    '.',
    ext,
  ].join('')
}
