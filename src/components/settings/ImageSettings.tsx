import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  getImageProvider,
  getImageSizes,
  IMAGE_PROVIDER_IDS,
  PROVIDERS,
} from '../../services/image/providers.js'
import {
  setImageApiKey,
  setImageBaseUrl,
  setImageModel,
  setImageProvider,
  setImageSize,
  useSettings,
} from '../../services/settings.js'
import { IconEditOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

/**
 * 图片生成设置：生图服务的 API Key、接口地址与默认模型、尺寸。
 * Key 按供应商分别保存，切换供应商不会把 A 家的 Key 发给 B 家。
 * Key 不做在线校验——多数生图接口没有免费的校验端点，只能真正出一次图才知道对不对。
 */
export const ImageSettings = () => {
  const t = useTranslate()
  const apiKeys = useSettings((state) => state.imageApiKeys)
  const baseUrls = useSettings((state) => state.imageBaseUrls)
  const providerId = useSettings((state) => state.imageProvider)
  const model = useSettings((state) => state.imageModel)
  const size = useSettings((state) => state.imageSize)
  const provider = getImageProvider(providerId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [baseDraft, setBaseDraft] = useState(baseUrls[providerId] ?? '')

  const apiKey = apiKeys[providerId] ?? ''
  const saved = !!apiKey
  const sizes = getImageSizes(provider, model)
  const modelOptions = provider.models.some((item) => item.id === model)
    ? provider.models.map((item) => ({
        value: item.id,
        label: item.reference
          ? `${item.label} · ${t('imageModelReferenceTag')}`
          : item.label,
      }))
    : [
        { value: model, label: model },
        ...provider.models.map((item) => ({
          value: item.id,
          label: item.reference ? `${item.label} · ${t('imageModelReferenceTag')}` : item.label,
        })),
      ]
  const sizeOptions = sizes.some((item) => item.value === size)
    ? sizes.map((item) => ({ value: item.value, label: item.label }))
    : [{ value: size, label: size }, ...sizes.map((item) => ({ value: item.value, label: item.label }))]

  // 切换供应商后，输入框要跟着换成该供应商已保存的内容
  useEffect(() => {
    setEditing(false)
    setDraft('')
    setBaseDraft(baseUrls[providerId] ?? '')
  }, [providerId, baseUrls])

  const save = () => {
    const value = draft.trim()
    if (!value) {
      return
    }
    setImageApiKey(providerId, value)
    setDraft('')
    setEditing(false)
  }

  const saveBaseUrl = () => {
    if (baseDraft.trim() !== (baseUrls[providerId] ?? '')) {
      setImageBaseUrl(providerId, baseDraft)
    }
  }

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.text}>
          <div className={styles.label}>{t('imageSection')}</div>
          <div className={styles.description}>{t('imageSectionDesc')}</div>
        </div>
      </div>
      <div className={styles.cell}>
        <div className={styles.apiKey}>
          <div className={styles.label}>{t('imageKeyLabel')}</div>
          {saved && !editing ? (
            <div className={styles.apiKeySaved}>
              <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
              <IconButton
                tone="primary"
                icon={<IconEditOutline16 />}
                tooltip={t('apiKeyEdit')}
                onClick={() => {
                  setDraft('')
                  setEditing(true)
                }}
              />
            </div>
          ) : (
            <div className={styles.apiKeyInput}>
              <input
                type="password"
                placeholder={t('imageKeyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    save()
                  }
                }}
              />
              {draft.trim() ? (
                <>
                  <span className={styles.divider} />
                  <button
                    type="button"
                    className={styles.confirm}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={save}
                  >
                    {t('confirm')}
                  </button>
                </>
              ) : null}
            </div>
          )}
          {saved && !editing ? (
            <div className={styles.description}>{t('imageKeySaved')}</div>
          ) : null}
        </div>
      </div>
      <div className={styles.cell}>
        <div className={styles.apiKey}>
          <div className={styles.label}>{t('imageBaseUrlLabel')}</div>
          <div className={styles.apiKeyInput}>
            <input
              type="url"
              placeholder={provider.origin}
              autoComplete="off"
              spellCheck={false}
              value={baseDraft}
              onChange={(event) => setBaseDraft(event.target.value)}
              onBlur={saveBaseUrl}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  saveBaseUrl()
                }
              }}
            />
          </div>
          <div className={styles.description}>{t('imageBaseUrlHint')}</div>
        </div>
      </div>
      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.label}>{t('imageProviderLabel')}</div>
        </div>
        <Select
          ariaLabel={t('imageProviderLabel')}
          value={providerId}
          options={IMAGE_PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].label }))}
          onChange={setImageProvider}
        />
      </div>
      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.label}>{t('imageModelLabel')}</div>
          {provider.models.find((item) => item.id === model)?.priceHint ? (
            <div className={styles.description}>
              {provider.models.find((item) => item.id === model)?.priceHint}
            </div>
          ) : null}
        </div>
        <Select
          ariaLabel={t('imageModelLabel')}
          value={model}
          options={modelOptions}
          onChange={setImageModel}
        />
      </div>
      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.label}>{t('imageSizeLabel')}</div>
          {sizes.length === 0 ? (
            <div className={styles.description}>{t('imageSizeFollowsReference')}</div>
          ) : null}
        </div>
        {sizes.length === 0 ? null : (
          <Select
            ariaLabel={t('imageSizeLabel')}
            value={size}
            options={sizeOptions}
            onChange={setImageSize}
          />
        )}
      </div>
    </>
  )
}
