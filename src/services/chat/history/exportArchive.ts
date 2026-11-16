import * as db from '../db.js'
import type { Session } from '../types.js'
import { EXPORT_FORMAT_VERSION, type Manifest, type SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, imagePath, sessionPath } from './paths.js'
import { toIndexEntry, toSessionFile } from './toArchive.js'
import { writeArchive } from './zipWriter.js'

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/** 按原件 MIME 给条目名补扩展名：生成图只有编号，导入端也靠字节识别 MIME，扩展名仅便于人工查看。 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
}

const withImageExtension = (name: string, type: string) => {
  const lower = name.toLowerCase()
  const known = Object.values(IMAGE_EXTENSIONS).some((extension) => lower.endsWith(extension))
  const extension = IMAGE_EXTENSIONS[type] ?? IMAGE_EXTENSIONS['image/png']
  return known ? name : `${name}${extension}`
}

/**
 * 按导出格式生成 ZIP：manifest → 全部会话 JSON → index → 全部图片。没有账号信息，不写 user.json。
 * 只写出本地有原件的图片，每个会话目录各写一份；其他附件只有元数据。
 * 生成图与参考图同样带原件；同一文件在一个会话目录里只写一份，重复引用共用条目。
 */
export const exportArchive = async (
  sessions: Iterable<Session> | AsyncIterable<Session>
): Promise<Blob> => {
  const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
  const entries = [{ name: MANIFEST_PATH, blob: json(manifest) }]
  const imageEntries: { name: string; blob: Blob }[] = []
  const index: SessionIndexEntry[] = []
  const originals = new Map<string, Blob | undefined>()
  for await (const session of sessions) {
    // 用户附件、生成图与作为参考图提交的图片都要读原件；参考图可能来自其他会话，按文件 ID 复用。
    const imageIds = new Set<string>()
    for (const message of session.messages) {
      if (message.role === 'user') {
        for (const file of message.files) {
          if (file.isImage) {
            imageIds.add(file.id)
          }
        }
        continue
      }
      for (const block of message.blocks) {
        if (block.type !== 'image') {
          continue
        }
        for (const image of block.images) {
          imageIds.add(image.fileId)
        }
        for (const id of block.referenceFileIds ?? []) {
          imageIds.add(id)
        }
      }
    }
    for (const id of imageIds) {
      if (!originals.has(id)) {
        originals.set(id, await db.loadFile(id))
      }
    }
    const images = new Map<string, Blob>()
    const paths = new Map<string, string>()
    const data = toSessionFile(session, ({ id, name, isImage }) => {
      const cached = paths.get(id)
      if (cached) {
        return cached
      }
      const blob = originals.get(id)
      if (!blob || !isImage) {
        return null
      }
      const path = imagePath(session.id, id, withImageExtension(name, blob.type))
      paths.set(id, path)
      images.set(path, blob)
      return path
    })
    entries.push({ name: sessionPath(session.id), blob: json(data) })
    for (const [name, blob] of images) {
      imageEntries.push({ name, blob })
    }
    index.push(toIndexEntry(data))
  }
  entries.push({ name: INDEX_PATH, blob: json(index) })
  return writeArchive(entries.concat(imageEntries))
}
