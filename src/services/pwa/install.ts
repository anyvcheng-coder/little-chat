/** Chrome/Edge 提供的安装事件，需要先拦截默认横幅再自行决定何时弹出 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const listeners = new Set<() => void>()
let deferredPrompt: InstallPromptEvent | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // 拦住浏览器的默认提示，由界面决定展示时机
    event.preventDefault()
    deferredPrompt = event as InstallPromptEvent
    listeners.forEach((listener) => listener())
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
  })
}

/** 订阅「可以安装」的时机；返回取消订阅函数 */
export const subscribeInstallPrompt = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const canPromptInstall = () => deferredPrompt !== null

/** 触发系统安装弹窗，已安装或无法安装时返回 false */
export const promptInstall = async (): Promise<boolean> => {
  const event = deferredPrompt
  if (!event) {
    return false
  }
  deferredPrompt = null
  await event.prompt()
  const choice = await event.userChoice
  return choice?.outcome === 'accepted'
}

export const isIosDevice = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ 的 UA 与桌面 Safari 一致，用触摸点数区分
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
