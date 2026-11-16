import clsx from 'clsx'
import { memo, useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { TranslationKey } from '../../i18n/index.js'
import { addDraftFiles } from '../../services/chat/drafts.js'
import type { MediaItem } from '../../services/chat/db.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { loadOriginal, loadThumb, mediaFileName, readLibrary } from '../../services/media.js'
import { useSettings } from '../../services/settings.js'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconLibraryOutline16,
  IconLinkOutline14,
  IconRightUpOutline14,
} from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { closeLibrary, useLibraryDialog } from './libraryState.js'
import styles from './MediaLibrary.module.css'

type Filter = 'all' | 'upload' | 'generated'

const filters: { value: Filter; label: TranslationKey }[] = [
  { value: 'all', label: 'libraryFilterAll' },
  { value: 'generated', label: 'libraryFilterGenerated' },
  { value: 'upload', label: 'libraryFilterUpload' },
]

/**
 * 素材库：把历史会话里上传、生成的图片按时间倒序摊开，可以预览大图、下载、复制提示词，
 * 也可以直接丢回输入框当参考图。图片本身仍存在原来的会话里，删除会话时一起消失。
 */
export const MediaLibrary = () => {
  const open = useLibraryDialog((state) => state.open)
  return open ? <LibraryDialog /> : null
}

const LibraryDialog = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [items, setItems] = useState<MediaItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [preview, setPreview] = useState<MediaItem | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setFailed(false)
    void readLibrary()
      .then((list) => {
        if (active) {
          setItems(list)
        }
      })
      .catch(() => {
        if (active) {
          setItems([])
          setFailed(true)
        }
      })
    return () => {
      active = false
    }
  }, [reloadToken])

  const visible = useMemo(
    () => (items ?? []).filter((item) => filter === 'all' || item.kind === filter),
    [items, filter]
  )

  return (
    <>
      <Modal
        title={
          <span className={styles.heading}>
            {t('libraryTitle')}
            {items && items.length > 0 ? (
              <span className={styles.count}>{t('libraryCount', { count: items.length })}</span>
            ) : null}
          </span>
        }
        closable
        className={clsx(styles.dialog, isMobile && styles.dialogMobile)}
        mainClassName={styles.dialogMain}
        onClose={closeLibrary}
      >
        <div className={styles.toolbar}>
          <div role="tablist" aria-label={t('libraryTitle')} className={styles.filters}>
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={filter === item.value}
                className={clsx(styles.filter, filter === item.value && styles.filterActive)}
                onClick={() => setFilter(item.value)}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
        </div>

        {items === null ? (
          <div className={styles.status} role="status">
            {t('libraryLoading')}
          </div>
        ) : failed ? (
          <div className={styles.status}>
            <span>{t('libraryLoadFailed')}</span>
            <button
              type="button"
              className={styles.statusAction}
              onClick={() => setReloadToken((token) => token + 1)}
            >
              {t('retry')}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <IconLibraryOutline16 />
            </span>
            <span className={styles.emptyTitle}>
              {items.length === 0 ? t('libraryEmpty') : t('libraryEmptyFilter')}
            </span>
            {items.length === 0 ? (
              <span className={styles.emptyHint}>{t('libraryEmptyHint')}</span>
            ) : null}
          </div>
        ) : (
          <div className={styles.scroll}>
            <Gallery items={visible} onOpen={setPreview} />
          </div>
        )}
      </Modal>
      {preview ? <Preview item={preview} onClose={() => setPreview(null)} /> : null}
    </>
  )
}

/** 按天分组：今天、昨天，更早的直接写日期 */
const Gallery = ({ items, onOpen }: { items: MediaItem[]; onOpen: (item: MediaItem) => void }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)

  const groups = useMemo(() => {
    const startOfDay = (time: number) => {
      const date = new Date(time)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }
    const today = startOfDay(Date.now())
    const result: { key: string; label: string; items: MediaItem[] }[] = []
    for (const item of items) {
      const day = startOfDay(item.createdAt)
      const key = String(day)
      const last = result.at(-1)
      if (last?.key === key) {
        last.items.push(item)
        continue
      }
      const days = Math.round((today - day) / 86_400_000)
      const label =
        days <= 0
          ? t('libraryToday')
          : days === 1
            ? t('libraryYesterday')
            : new Intl.DateTimeFormat(locale, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              }).format(new Date(item.createdAt))
      result.push({ key, label, items: [item] })
    }
    return result
  }, [items, locale, t])

  return (
    <>
      {groups.map((group) => (
        <section key={group.key} className={styles.group}>
          <h3 className={styles.groupLabel}>{group.label}</h3>
          <div className={styles.grid}>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.cell}
                onClick={() => onOpen(item)}
                aria-label={item.name ?? item.prompt ?? t('libraryTitle')}
              >
                <Thumb id={item.id} />
                {item.kind === 'generated' ? (
                  <span className={styles.badge}>{t('libraryGeneratedBadge')}</span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

/** 列表里的小图：只在挂载时读一次缩略图，卸载时释放地址 */
const Thumb = memo(function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    let active = true
    let created: string | undefined
    void loadThumb(id)
      .then((blob) => {
        if (!blob || !active) {
          return
        }
        created = URL.createObjectURL(blob)
        setUrl(created)
      })
      .catch(() => {})
    return () => {
      active = false
      if (created) {
        URL.revokeObjectURL(created)
      }
    }
  }, [id])

  return url ? (
    <img className={styles.thumb} src={url} alt="" decoding="async" />
  ) : (
    <span className={styles.thumbEmpty} aria-hidden="true" />
  )
})

const Preview = ({ item, onClose }: { item: MediaItem; onClose: () => void }) => {
  const t = useTranslate()
  const [url, setUrl] = useState<string>()
  const [blob, setBlob] = useState<Blob>()
  const [copied, setCopied] = useState(false)
  const sessions = useChatStore((state) => state.sessions)
  const sessionTitle = sessions.find((session) => session.id === item.sessionId)?.title

  useEffect(() => {
    let active = true
    let created: string | undefined
    void loadOriginal(item.id)
      .then((result) => {
        if (!result || !active) {
          return
        }
        created = URL.createObjectURL(result)
        setBlob(result)
        setUrl(created)
      })
      .catch(() => {})
    return () => {
      active = false
      if (created) {
        URL.revokeObjectURL(created)
      }
    }
  }, [item.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const download = () => {
    if (!url || !blob) {
      return
    }
    const link = document.createElement('a')
    link.href = url
    link.download = mediaFileName(item, blob)
    document.body.append(link)
    link.click()
    link.remove()
  }

  const copyPrompt = () => {
    if (!item.prompt) {
      return
    }
    void navigator.clipboard?.writeText(item.prompt).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  /** 把这张图放回输入框：作为新消息的参考图，直接沿用原来的生图链路 */
  const useAsReference = async () => {
    const apiKey = useSettings.getState().apiKey
    if (!apiKey) {
      showToast({ key: 'libraryNeedKey', type: 'error' })
      return
    }
    const source = blob ?? (await loadOriginal(item.id))
    if (!source) {
      return
    }
    const file = new File([source], mediaFileName(item, source), {
      type: source.type || 'image/png',
    })
    const error = addDraftFiles(useChatStore.getState().activeId, [file], apiKey)
    if (error) {
      showToast({ ...error, type: 'error' })
      return
    }
    showToast({ key: 'libraryAddedToInput' })
    onClose()
    closeLibrary()
  }

  const time = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(item.createdAt))

  return (
    <div
      className={styles.preview}
      role="dialog"
      aria-modal="true"
      aria-label={t('libraryPreview')}
    >
      <button
        type="button"
        className={styles.previewBackdrop}
        aria-label={t('close')}
        onClick={onClose}
      />
      <div className={styles.previewBody}>
        {url ? (
          <img className={styles.previewImage} src={url} alt={item.prompt ?? item.name ?? ''} />
        ) : (
          <div className={styles.previewLoading}>{t('libraryLoading')}</div>
        )}
        <div className={styles.previewInfo}>
          <div className={styles.previewMeta}>
            <span>{time}</span>
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <span>
              {sessionTitle === undefined
                ? t('librarySessionGone')
                : t('libraryFromSession', { title: sessionTitle || t('untitledChat') })}
            </span>
          </div>
          {item.prompt ? <p className={styles.previewPrompt}>{item.prompt}</p> : null}
        </div>
        <div className={styles.previewActions}>
          <button type="button" className={styles.action} disabled={!url} onClick={download}>
            <IconDownloadOutline16 />
            {t('imageDownload')}
          </button>
          {item.prompt ? (
            <button type="button" className={styles.action} onClick={copyPrompt}>
              {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
              {copied ? t('imageCopied') : t('imageCopyPrompt')}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.action}
            disabled={!url}
            onClick={() => void useAsReference()}
          >
            <IconLinkOutline14 />
            {t('libraryUseAsReference')}
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={sessionTitle === undefined}
            onClick={() => {
              selectSession(item.sessionId)
              closeLibrary()
            }}
          >
            <IconRightUpOutline14 />
            {t('libraryOpenSession')}
          </button>
        </div>
      </div>
      <button
        type="button"
        className={styles.previewClose}
        aria-label={t('close')}
        onClick={onClose}
      >
        <IconCloseOutline16 />
      </button>
    </div>
  )
}
