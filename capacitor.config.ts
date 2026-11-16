import type { CapacitorConfig } from '@capacitor/cli'

/**
 * 原生壳配置：安卓端把 dist/ 放进 WebView，以 https://localhost 作为源提供服务。
 * 因此接口服务需要允许这个源跨域（DeepSeek 的 API 会回显 Origin）。
 */
const config: CapacitorConfig = {
  appId: 'app.littlechat',
  appName: 'little chat',
  webDir: 'dist',
  android: {
    // 与网页版一致的浅色底，避免启动瞬间黑屏
    backgroundColor: '#ffffff',
  },
}

export default config
