import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { setupAppearance } from './services/appearance.js'
import { ensureKatex } from './services/markdown/katex.js'
import { registerServiceWorker } from './services/pwa/register.js'
import { requestPersistentStorage } from './services/storage/persist.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
// 主题色与聊天背景要早于首屏渲染生效，避免闪一下默认配色
setupAppearance()
registerServiceWorker()
void requestPersistentStorage()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
