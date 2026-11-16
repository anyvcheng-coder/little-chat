/* 应用外壳缓存：离线时仍能打开界面、翻看本地历史（数据都在 IndexedDB 里）。 */
const VERSION = 'v1'
const SHELL_CACHE = `shell-${VERSION}`
const ASSET_CACHE = `asset-${VERSION}`

const scope = self.registration.scope
const shellEntries = ['./', './index.html', './manifest.webmanifest'].map(
  (path) => new URL(path, scope).href
)
const indexUrl = new URL('./index.html', scope).href
/** 带内容哈希的构建产物可以直接长期复用 */
const immutable = (pathname) => /\/static\//.test(pathname)

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // 逐个写入，单个资源 404 不影响其它条目
      await Promise.all(shellEntries.map((url) => cache.add(url).catch(() => undefined)))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

const offlinePage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>离线</title>
<style>body{margin:0;height:100vh;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,"PingFang SC",sans-serif;color:#111;background:#fff}
p{margin:0;font-size:14px;color:#666}button{margin-top:8px;padding:10px 22px;border:none;border-radius:999px;
background:#4d6bfe;color:#fff;font-size:15px}</style></head>
<body><p>当前处于离线状态</p><p>联网后重试，或先查看已下载的历史会话。</p>
<button onclick="location.reload()">重新加载</button></body></html>`

const fromCache = async (request) => {
  const cached = await caches.match(request)
  if (cached) {
    return cached
  }
  const shell = await caches.match(indexUrl)
  return (
    shell ||
    new Response(offlinePage, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  )
}

/** 页面导航：先走网络，失败时回落到缓存的界面外壳 */
const handleNavigate = async (request) => {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE)
      // 单页应用的所有导航都返回同一份 index.html，统一用它作为离线入口
      await cache.put(indexUrl, response.clone())
    }
    return response
  } catch {
    return fromCache(request)
  }
}

/** 静态资源：命中缓存直接返回，未命中时请求并写入缓存 */
const handleAsset = async (request, revalidate) => {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)
  if (cached && !revalidate) {
    return cached
  }
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') {
        void cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)
  if (cached) {
    void network
    return cached
  }
  return (await network) || Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) {
    return
  }
  // 断点续传（音频、大文件）交给浏览器处理
  if (request.headers.has('range')) {
    return
  }
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request))
    return
  }
  event.respondWith(handleAsset(request, !immutable(url.pathname)))
})
