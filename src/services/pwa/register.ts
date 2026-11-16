/** 已安装为独立应用时，浏览器地址栏和导航栏都不存在 */
export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  // 旧版 iOS 的 standalone 媒体查询不可靠，用 Safari 的专有属性兜底
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const SERVICE_WORKER_URL = 'sw.js'

/** 注册离线外壳；发布新版本后自动接管并刷新一次页面 */
export const registerServiceWorker = () => {
  if (__DEV__ || !('serviceWorker' in navigator)) {
    return
  }
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 首次注册时 controller 从无到有，此时不需要刷新
    if (!hadController || reloading) {
      return
    }
    reloading = true
    location.reload()
  })
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(new URL(SERVICE_WORKER_URL, document.baseURI).href)
      .catch(() => undefined)
  })
}
