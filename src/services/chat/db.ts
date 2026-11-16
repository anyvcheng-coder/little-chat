import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 12

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/**
 * 素材库条目：会话里出现过的图片按原件 id 登记一份，不复制图片本身。
 * 删除会话时一起清理，因此素材库始终等于「现有历史里的图片」。
 */
export type MediaItem = {
  /** 与 files 表同一个 id */
  id: string
  /** upload：用户上传的附件；generated：生图模型产出的图 */
  kind: 'upload' | 'generated'
  createdAt: number
  sessionId: string
  messageId: string
  /** 上传时的原始文件名 */
  name?: string
  /** 生成这张图时用的提示词 */
  prompt?: string
}

/** 素材库缩略图：列表里只加载小图，点开大图时再读原件 */
export type MediaThumb = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

interface ChatDB extends DBSchema {
  /** 当前使用的会话，界面读写都在这里 */
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件 */
  files: { key: string; value: StoredFile }
  /** 素材库索引，按原件 id 去重 */
  media: {
    key: string
    value: MediaItem
    indexes: { createdAt: number; sessionId: string }
  }
  mediaThumbs: { key: string; value: MediaThumb }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后在一个事务中替换正式数据并清空暂存，失败时只清空暂存。
   */
  sessionsStaging: { key: string; value: Session }
  filesStaging: { key: string; value: StoredFile }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

const storedSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user'
          ? message.files.map((file) => file.id)
          : message.blocks.flatMap((block) =>
              // 生成的图片与参考图共用 files 表，这里一起登记引用，删除会话时才能回收原件
              block.type === 'image'
                ? [...block.images.map((image) => image.fileId), ...(block.referenceFileIds ?? [])]
                : []
            )
      )
    ),
  ],
})

/**
 * 从会话里抽出图片清单：用户上传的图片按提问时间，生成图按出图完成时间。
 * 同一张图既被上传又当参考图时只登记一次，因此素材库按原件 id 去重。
 */
export const collectSessionMedia = (session: Session): MediaItem[] => {
  const items = new Map<string, MediaItem>()
  for (const message of session.messages) {
    if (message.role === 'user') {
      for (const file of message.files) {
        if (file.isImage && !items.has(file.id)) {
          items.set(file.id, {
            id: file.id,
            kind: 'upload',
            createdAt: message.createdAt,
            sessionId: session.id,
            messageId: message.id,
            name: file.name,
          })
        }
      }
      continue
    }
    for (const block of message.blocks) {
      if (block.type !== 'image') {
        continue
      }
      const createdAt = block.endedAt ?? block.startedAt ?? message.createdAt
      for (const image of block.images) {
        if (!items.has(image.fileId)) {
          items.set(image.fileId, {
            id: image.fileId,
            kind: 'generated',
            createdAt,
            sessionId: session.id,
            messageId: message.id,
            prompt: block.prompt,
          })
        }
      }
    }
  }
  return [...items.values()]
}

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of ['sessions', 'files', 'sessionsStaging', 'filesStaging'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
      if (!db.objectStoreNames.contains('media')) {
        const media = db.createObjectStore('media', { keyPath: 'id' })
        media.createIndex('createdAt', 'createdAt')
        media.createIndex('sessionId', 'sessionId')
      }
      if (!db.objectStoreNames.contains('mediaThumbs')) {
        db.createObjectStore('mediaThumbs', { keyPath: 'id' })
      }
      // 从旧版本升级时补一份素材索引，之前聊过的图片也能出现在素材库里
      if (oldVersion < 12) {
        const sessions = await tx.objectStore('sessions').getAll()
        const media = tx.objectStore('media')
        for (const session of sessions) {
          for (const item of collectSessionMedia(session)) {
            await media.put(item)
          }
        }
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

export const loadSessionSummaries = async (): Promise<SessionSummary[]> =>
  (await (await getDB()).getAll('sessionSummaries')).map(toSessionSummary)

export const loadSession = async (id: string): Promise<Session | undefined> =>
  (await getDB()).get('sessions', id)

/** 读取全部会话（不含文件原件），用于统计等批量场景 */
export const loadAllSessions = async (): Promise<Session[]> => (await getDB()).getAll('sessions')

export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  const summary = storedSummary(session)
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(session)
        await tx.objectStore('sessionSummaries').put(summary)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。 */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          session.title = title
          await sessions.put(session)
          await tx.objectStore('sessionSummaries').put(storedSummary(session))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。素材库条目随会话一起清掉。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'media', 'mediaThumbs'],
    'readwrite'
  )
  await Promise.all([
    (async () => {
      try {
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(sessionId)
        await tx.objectStore('sessions').delete(sessionId)
        await summaries.delete(sessionId)
        const media = tx.objectStore('media')
        const mediaIds = await media.index('sessionId').getAllKeys(sessionId)
        for (const id of mediaIds) {
          await media.delete(id)
          await tx.objectStore('mediaThumbs').delete(id)
        }
        for (const id of summary?.fileIds ?? []) {
          if ((await summaries.index('fileIds').count(id)) === 0) {
            await tx.objectStore('files').delete(id)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const saveFiles = (files: StoredFile[]): Promise<void> => putFiles('files', files)

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('files', id))?.blob

/** 登记素材库条目：重复登记同一 id 时更新元数据，不产生副本。 */
export const addMedia = async (items: MediaItem[]): Promise<void> => {
  if (items.length === 0) {
    return
  }
  const tx = (await getDB()).transaction('media', 'readwrite')
  await Promise.all([...items.map((item) => tx.store.put(item)), tx.done])
}

/** 素材库列表，按时间从新到旧 */
export const listMedia = async (): Promise<MediaItem[]> => {
  const items = await (await getDB()).getAll('media')
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export const saveMediaThumb = async (id: string, blob: Blob): Promise<void> => {
  await (await getDB()).put('mediaThumbs', { id, blob })
}

export const loadMediaThumb = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('mediaThumbs', id))?.blob

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

export const addStagingSession = async (session: Session): Promise<void> => {
  await (await getDB()).add('sessionsStaging', session)
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。 */
export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>): Promise<void> => {
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([
    (async () => {
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        const session = cursor.value
        let changed = false
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const file of message.files) {
            const type = types.get(file.id) ?? ''
            if (file.mimeType !== type) {
              file.mimeType = type
              changed = true
            }
          }
        }
        if (changed) {
          await cursor.update(session)
        }
      }
    })(),
    tx.done,
  ])
}

/**
 * 导入完成后用暂存替换正式数据：同一事务中替换会话、摘要和原件，并清空暂存。
 * 逐条游标复制，同一时间只读取一条记录；事务失败时整体回滚，正式数据不变。
 */
export const commitStaging = async (): Promise<SessionSummary[]> => {
  const summaries: SessionSummary[] = []
  const tx = (await getDB()).transaction(
    [
      'sessions',
      'sessionSummaries',
      'files',
      'media',
      'mediaThumbs',
      'sessionsStaging',
      'filesStaging',
    ],
    'readwrite'
  )
  const move = async (from: 'sessionsStaging' | 'filesStaging', to: 'sessions' | 'files') => {
    try {
      const target = tx.objectStore(to)
      await target.clear()
      if (to === 'sessions') {
        await tx.objectStore('sessionSummaries').clear()
        // 素材库与历史一一对应，换一批历史就整批重建
        await tx.objectStore('media').clear()
        await tx.objectStore('mediaThumbs').clear()
      }
      for (
        let cursor = await tx.objectStore(from).openCursor();
        cursor;
        cursor = await cursor.continue()
      ) {
        await target.put(cursor.value)
        if (to === 'sessions') {
          const session = cursor.value as Session
          const summary = storedSummary(session)
          await tx.objectStore('sessionSummaries').put(summary)
          for (const item of collectSessionMedia(session)) {
            await tx.objectStore('media').put(item)
          }
          summaries.push(toSessionSummary(summary))
        }
      }
      await tx.objectStore(from).clear()
    } catch (error) {
      // 同步抛出的错误不会让事务自动回滚，需显式中止，避免只提交清空和部分移入。
      abortTransaction(tx)
      throw error
    }
  }
  await Promise.all([move('sessionsStaging', 'sessions'), move('filesStaging', 'files'), tx.done])
  // 直接返回本次提交的列表，调用方无需在替换成功后再发起可能失败的读取。
  return summaries
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}
