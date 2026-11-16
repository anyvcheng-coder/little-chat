import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadFile } from '../../services/chat/db.js'
import { regenerateImage } from '../../services/chat/store.js'
import type { ImagePart } from '../../services/chat/types.js'
import { getImageProvider, getImageReferenceSpec } from '../../services/image/providers.js'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconLinkOutline14,
  IconRefreshOutline16,
  IconWarningOutline16,
} from '../base/icons.js'
import styles from './ImageResult.module.css'

/** 把 fileId 读成可显示的本地地址；组件卸载时统一释放 */
const useImageUrls = (fileIds: string[]): Record<string, string> => {
  const key = fileIds.join(',')
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setUrls({})
      return
    }
    let cancelled = false
    const created: string[] = []
    void Promise.all(
      ids.map(async (id) => {
        const blob = await loadFile(id)
        if (!blob) {
          return null
        }
        const url = URL.createObjectURL(blob)
        created.push(url)
        return [id, url] as const
      })
    ).then((entries) => {
      if (cancelled) {
        created.forEach((url) => URL.revokeObjectURL(url))
        return
      }
      setUrls(
        Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => !!entry))
      )
    })
    return () => {
      cancelled = true
      created.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [key])
  return urls
}

/** 文件名带上时间，避免连续下载时被浏览器合并 */
const downloadImage = (url: string, index: number) => {
  const link = document.createElement('a')
  link.href = url
  link.download = `image-${Date.now()}-${index + 1}.png`
  document.body.append(link)
  link.click()
  link.remove()
}

/**
 * 生图结果块：生成中显示等待占位，完成后按张数排成宫格，点击放大。
 * 提示词全程可见、可编辑后重新出图——这是该链路相对直接文生图的差别所在。
 * 参考图（用户上传或某张生成图）会显示在提示词上方，重生成时按这里的顺序提交。
 */
export const ImageResult = ({
  sessionId,
  messageId,
  part,
  partIndex,
  busy,
}: {
  sessionId: string
  messageId: string
  part: ImagePart
  partIndex: number
  /** 该会话正在生成时禁用重新出图等操作 */
  busy: boolean
}) => {
  const t = useTranslate()
  const fileIds = useMemo(() => part.images.map((image) => image.fileId), [part.images])
  const referenceIds = useMemo(() => part.referenceFileIds ?? [], [part.referenceFileIds])
  const urls = useImageUrls(useMemo(() => [...fileIds, ...referenceIds], [fileIds, referenceIds]))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(part.prompt)
  const [draftRefs, setDraftRefs] = useState<string[]>(referenceIds)
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const generating = part.status === 'generating'
  const provider = getImageProvider(part.provider)
  const canReference = !!getImageReferenceSpec(provider, part.model)
  const meta = [part.model, part.size].filter(Boolean).join(' · ')
  const elapsed = part.endedAt
    ? Math.max(1, Math.round((part.endedAt - part.startedAt) / 1000))
    : null
  const errorText = part.error
    ? (part.error.localMessage ? t(part.error.localMessage.key, part.error.localMessage.params) : '') ||
      part.error.message ||
      t('imageFailed')
    : null

  const copyPrompt = () => {
    void navigator.clipboard?.writeText(part.prompt).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const startEdit = () => {
    setDraft(part.prompt)
    setDraftRefs(referenceIds)
    setEditing(true)
  }

  /** 以某张生成图作参考再改：打开编辑框，提示词沿用本次的，用户只需写要改的地方 */
  const startEditWithReference = (fileId: string) => {
    setDraft(part.prompt)
    setDraftRefs([fileId])
    setEditing(true)
  }

  const submitEdit = () => {
    if (!draft.trim()) {
      return
    }
    setEditing(false)
    regenerateImage(sessionId, messageId, partIndex, draft, draftRefs)
  }

  const references = editing ? draftRefs : referenceIds
  const missingReference = referenceIds.length > 0 && referenceIds.every((id) => !urls[id])

  return (
    <div className={styles.card}>
      {generating ? (
        <div className={styles.header}>
          <span className={styles.spinner} aria-hidden="true" />
          <span>{t('imageGenerating')}</span>
        </div>
      ) : errorText ? (
        <div className={`${styles.header} ${styles.headerError}`}>
          <IconWarningOutline16 />
          <span>{errorText}</span>
        </div>
      ) : null}

      {generating ? <div className={styles.placeholder} aria-hidden="true" /> : null}

      {!generating && fileIds.length > 0 ? (
        <div className={fileIds.length > 1 ? styles.grid : `${styles.grid} ${styles.gridSingle}`}>
          {fileIds.map((fileId) => {
            const url = urls[fileId]
            return (
              <div key={fileId} className={styles.thumbWrap}>
                <button
                  type="button"
                  className={styles.thumb}
                  aria-label={t('imageDownload')}
                  disabled={!url}
                  onClick={() => url && setPreview(url)}
                >
                  {url ? <img src={url} alt={part.prompt} /> : null}
                </button>
                {canReference && url && !busy ? (
                  <button
                    type="button"
                    className={styles.thumbUse}
                    title={t('imageUseAsReference')}
                    aria-label={t('imageUseAsReference')}
                    onClick={() => startEditWithReference(fileId)}
                  >
                    <IconLinkOutline14 />
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {editing ? (
        <div className={styles.prompt}>
          <span className={styles.promptLabel}>{t('imageEditPrompt')}</span>
          <textarea
            className={styles.textarea}
            value={draft}
            rows={4}
            onChange={(event) => setDraft(event.target.value)}
          />
          {draftRefs.length > 0 ? (
            <div className={styles.references}>
              <span className={styles.referencesLabel}>{t('imageReferenceLabel')}</span>
              <div className={styles.refList}>
                {draftRefs.map((id) => (
                  <div key={id} className={styles.refItem}>
                    {urls[id] ? <img src={urls[id]} alt={t('imageReferenceLabel')} /> : null}
                    <button
                      type="button"
                      className={styles.refRemove}
                      title={t('imageRemoveReference')}
                      aria-label={t('imageRemoveReference')}
                      onClick={() => setDraftRefs((ids) => ids.filter((item) => item !== id))}
                    >
                      <IconCloseOutline16 />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <span className={styles.hint}>{t('imageReferenceWrap')}</span>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={busy || !draft.trim()}
              onClick={submitEdit}
            >
              <IconCheckOutline16 />
              {t('imageSavePrompt')}
            </button>
            <button type="button" className={styles.action} onClick={() => setEditing(false)}>
              {t('imageCancelEdit')}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.prompt}>
          <div className={styles.promptHead}>
            <span className={styles.promptLabel}>{t('imagePromptLabel')}</span>
            {elapsed ? (
              <span className={styles.elapsed}>{t('imageElapsed', { seconds: elapsed })}</span>
            ) : null}
          </div>
          {references.length > 0 ? (
            <div className={styles.references}>
              <span className={styles.referencesLabel}>
                {t('imageReferenceLabel')} · {references.length}
              </span>
              <div className={styles.refList}>
                {references.map((id) => (
                  <div key={id} className={styles.refItem}>
                    {urls[id] ? <img src={urls[id]} alt={t('imageReferenceLabel')} /> : null}
                  </div>
                ))}
              </div>
              {missingReference ? (
                <span className={styles.hint}>{t('imageReferenceMissing')}</span>
              ) : null}
            </div>
          ) : null}
          <p className={styles.promptText}>{part.prompt}</p>
          {meta ? <span className={styles.meta}>{meta}</span> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.action} onClick={copyPrompt}>
              {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
              {copied ? t('imageCopied') : t('imageCopyPrompt')}
            </button>
            <button
              type="button"
              className={styles.action}
              disabled={busy || generating}
              onClick={() => regenerateImage(sessionId, messageId, partIndex)}
            >
              <IconRefreshOutline16 />
              {t('imageRegenerate')}
            </button>
            <button
              type="button"
              className={styles.action}
              disabled={busy || generating}
              onClick={startEdit}
            >
              <IconEditOutline16 />
              {t('imageEditPrompt')}
            </button>
            {fileIds.length > 0 ? (
              <button
                type="button"
                className={styles.action}
                disabled={!urls[fileIds[0]]}
                onClick={() => {
                  fileIds.forEach((fileId, index) => {
                    const url = urls[fileId]
                    if (url) {
                      downloadImage(url, index)
                    }
                  })
                }}
              >
                <IconDownloadOutline16 />
                {t('imageDownload')}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {preview ? (
        <div className={styles.preview} onClick={() => setPreview(null)} role="presentation">
          <img className={styles.previewImage} src={preview} alt={part.prompt} />
          <button
            type="button"
            className={styles.previewClose}
            aria-label={t('imageCancelEdit')}
            onClick={() => setPreview(null)}
          >
            <IconCloseOutline16 />
          </button>
          <div className={styles.previewBar} onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => downloadImage(preview, 0)}>
              {t('imageDownload')}
            </button>
            {canReference && !busy ? (
              <button
                type="button"
                onClick={() => {
                  const entry = fileIds.find((fileId) => urls[fileId] === preview)
                  setPreview(null)
                  if (entry) {
                    startEditWithReference(entry)
                  }
                }}
              >
                {t('imageUseAsReference')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
