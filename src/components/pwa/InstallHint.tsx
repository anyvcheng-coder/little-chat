import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  canPromptInstall,
  isIosDevice,
  promptInstall,
  subscribeInstallPrompt,
} from '../../services/pwa/install.js'
import { isStandalone } from '../../services/pwa/register.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { useSettingsDialog } from '../settings/settingsDialogState.js'
import styles from './InstallHint.module.css'

const DISMISS_KEY = 'installHintDismissed'

/** 桌面端留出两秒观察安装事件，移动端稍晚再引导，避免抢首屏 */
const HINT_DELAY = 2000

/**
 * 添加到主屏幕的引导：安卓走系统安装弹窗，iOS 只能给出分享菜单的指引。
 * 每台设备只出现一次，关掉后不再打扰。
 */
export const InstallHint = () => {
  const t = useTranslate()
  // 首次打开会先弹设置填 API Key，这时不叠加安装引导
  const settingsOpen = useSettingsDialog((state) => state.open)
  const [visible, setVisible] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) !== null) {
      return
    }
    const show = () => {
      // 浏览器支持一键安装，或 iOS 需要手动指引；两者都不满足就不打扰
      const canInstall = canPromptInstall()
      if (!canInstall && !isIosDevice()) {
        return
      }
      setIos(!canInstall)
      setVisible(true)
    }
    const timer = window.setTimeout(show, HINT_DELAY)
    const unsubscribe = subscribeInstallPrompt(show)
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  if (!visible || settingsOpen) {
    return null
  }

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setVisible(false)
  }

  const install = async () => {
    const accepted = await promptInstall()
    if (!accepted) {
      dismiss()
    }
  }

  return (
    <section className={styles.hint} role="dialog" aria-label={t('installHintTitle')}>
      <img className={styles.icon} src="icons/icon-192.png" alt="" width="40" height="40" />
      <div className={styles.body}>
        <p className={styles.title}>{t('installHintTitle')}</p>
        <p className={styles.desc}>{t(ios ? 'installHintIos' : 'installHintAndroid')}</p>
      </div>
      {ios ? (
        <Button size="s" variant="outlined" onClick={dismiss}>
          {t('installLater')}
        </Button>
      ) : (
        <Button size="s" onClick={() => void install()}>
          {t('installAction')}
        </Button>
      )}
      <IconButton
        className={styles.close}
        size="xs"
        icon={<IconCloseOutline16 />}
        aria-label={t('close')}
        onClick={dismiss}
      />
    </section>
  )
}
