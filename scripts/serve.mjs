// 本地预览构建产物：用于在 localhost 下验证安装、离线外壳等只在安全上下文生效的能力。
// 用法：node scripts/serve.mjs [--port 8090] [--host 0.0.0.0]
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const port = Number(argValue('--port', process.env.PORT ?? 8090))
const host = argValue('--host', '127.0.0.1')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const resolveFile = (pathname) => {
  const decoded = decodeURIComponent(pathname)
  const target = path.join(root, path.normalize(decoded).replace(/^([/\\])+/, ''))
  if (!target.startsWith(root)) {
    return null
  }
  try {
    const stats = statSync(target)
    if (stats.isFile()) {
      return target
    }
    const index = path.join(target, 'index.html')
    return statSync(index).isFile() ? index : null
  } catch {
    return null
  }
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host}`)
  // 单页应用：找不到静态文件时统一回落到 index.html
  const file = resolveFile(pathname) ?? path.join(root, 'index.html')
  const headers = {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
  }
  if (file.includes(`${path.sep}static${path.sep}`)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  } else {
    // Service Worker、清单、index.html 每次都要回源，便于本地调试
    headers['Cache-Control'] = 'no-cache'
  }
  response.writeHead(200, headers)
  createReadStream(file).pipe(response)
})

server.listen(port, host, () => {
  console.log(`预览地址： http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
})
