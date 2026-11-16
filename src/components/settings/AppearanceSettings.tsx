import clsx from 'clsx'
import { useRef, useState, type CSSProperties } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  prepareWallpaper,
  setAccent,
  setWallpaper,
  setWallpaperBlur,
  setWallpaperDim,
  useAppearance,
  WALLPAPER_PRESETS,
  type WallpaperPresetId,
} from '../../services/appearance.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

const WALLPAPER_NAMES: Record<WallpaperPresetId, TranslationKey> = {
  aurora: 'appearanceWallpaperAurora',
  dusk: 'appearanceWallpaperDusk',
  paper: 'appearanceWallpaperPaper',
  mist: 'appearanceWallpaperMist',
  forest: 'appearanceWallpaperForest',
}

/**
 * 个性化：主题色与聊天背景。
 * 改完立刻生效（直接写 body 上的 CSS 变量），不需要确定/保存，
 * 配色与背景都只影响这台设备，不写进导出的历史文件。
 */
export const AppearanceSettings = () => {
  const t = useTranslate()
  const accent = useAppearance((state) => state.accent)
  const wallpaper = useAppearance((state) => state.wallpaper)
  const dim = useAppearance((state) => state.wallpaperDim)
  const blur = useAppearance((state) => state.wallpaperBlur)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const value = await prepareWallpaper(file)
      if (!value) {
        showToast({ key: 'appearanceWallpaperFailed', type: 'error' })
        return
      }
      if (!setWallpaper({ kind: 'image', value })) {
        showToast({ key: 'appearanceWallpaperTooLarge', type: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.text}>
          <div className={styles.label}>{t('appearanceAccent')}</div>
          <div className={styles.description}>{t('appearanceAccentDesc')}</div>
        </div>
        <div className={styles.swatches} role="radiogroup" aria-label={t('appearanceAccent')}>
          {ACCENT_PRESETS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={accent === item.value}
              aria-label={t(item.name)}
              title={t(item.name)}
              className={clsx(styles.swatch, accent === item.value && styles.swatchActive)}
              style={{ '--swatch': item.value } as CSSProperties}
              onClick={() => setAccent(item.value)}
            />
          ))}
          <label
            className={clsx(styles.swatch, styles.swatchCustom)}
            title={t('appearanceAccentCustom')}
          >
            <input
              type="color"
              aria-label={t('appearanceAccentCustom')}
              value={accent ?? DEFAULT_ACCENT}
              onChange={(event) => setAccent(event.target.value)}
            />
          </label>
          {accent ? (
            <button
              type="button"
              className={styles.swatchReset}
              onClick={() => setAccent(null)}
            >
              {t('appearanceAccentReset')}
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.cell}>
        <div className={styles.text}>
          <div className={styles.label}>{t('appearanceWallpaper')}</div>
          <div className={styles.description}>{t('appearanceWallpaperDesc')}</div>
        </div>
        <div className={styles.wallpaperGrid} role="radiogroup" aria-label={t('appearanceWallpaper')}>
          <button
            type="button"
            role="radio"
            aria-checked={wallpaper === null}
            aria-label={t('appearanceWallpaperNone')}
            title={t('appearanceWallpaperNone')}
            className={clsx(
              styles.wallpaperTile,
              styles.wallpaperNone,
              wallpaper === null && styles.wallpaperTileActive
            )}
            onClick={() => setWallpaper(null)}
          />
          {WALLPAPER_PRESETS.map((id) => {
            const selected = wallpaper?.kind === 'preset' && wallpaper.id === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(WALLPAPER_NAMES[id])}
                title={t(WALLPAPER_NAMES[id])}
                className={clsx(styles.wallpaperTile, selected && styles.wallpaperTileActive)}
                style={{ backgroundImage: `var(--wp-${id})` }}
                onClick={() => setWallpaper({ kind: 'preset', id })}
              />
            )
          })}
          <button
            type="button"
            className={clsx(
              styles.wallpaperTile,
              styles.wallpaperUpload,
              wallpaper?.kind === 'image' && styles.wallpaperTileActive
            )}
            style={
              wallpaper?.kind === 'image'
                ? { backgroundImage: `url("${wallpaper.value}")` }
                : undefined
            }
            aria-label={t('appearanceWallpaperUpload')}
            title={t('appearanceWallpaperUpload')}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {wallpaper?.kind === 'image' ? null : busy ? (
              <span className={styles.wallpaperBusy}>{t('appearanceWallpaperBusy')}</span>
            ) : (
              <span className={styles.wallpaperPlus}>+</span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void upload(file)
              }
            }}
          />
        </div>
        {wallpaper ? (
          <div className={styles.wallpaperTools}>
            <button
              type="button"
              className={styles.wallpaperRemove}
              onClick={() => setWallpaper(null)}
            >
              <IconCloseOutline16 />
              {t('appearanceWallpaperRemove')}
            </button>
          </div>
        ) : null}
      </div>
      {wallpaper ? (
        <>
          <div className={styles.cell}>
            <div className={styles.sliderRow}>
              <div className={styles.label}>{t('appearanceWallpaperDim')}</div>
              <span className={styles.sliderValue}>{Math.round(dim * 100)}%</span>
            </div>
            <input
              className={styles.slider}
              type="range"
              min={0}
              max={0.9}
              step={0.02}
              value={dim}
              aria-label={t('appearanceWallpaperDim')}
              onChange={(event) => setWallpaperDim(Number(event.target.value))}
            />
          </div>
          <div className={styles.cell}>
            <div className={styles.sliderRow}>
              <div className={styles.label}>{t('appearanceWallpaperBlur')}</div>
              <span className={styles.sliderValue}>{blur}px</span>
            </div>
            <input
              className={styles.slider}
              type="range"
              min={0}
              max={20}
              step={1}
              value={blur}
              aria-label={t('appearanceWallpaperBlur')}
              onChange={(event) => setWallpaperBlur(Number(event.target.value))}
            />
          </div>
        </>
      ) : null}
    </>
  )
}
