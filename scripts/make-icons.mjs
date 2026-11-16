// 从 public/icons 下的 SVG 渲染网页图标、安卓启动器图标与启动图。
// 用本机 Chrome 的无头模式做栅格化，避免引入图像处理依赖。
// 用法：node scripts/make-icons.mjs [--chrome <可执行文件路径>]
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconDir = path.join(root, 'public', 'icons')
const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res')

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const findBrowser = () => {
  const argIndex = process.argv.indexOf('--chrome')
  const fromArg = argIndex === -1 ? undefined : process.argv[argIndex + 1]
  const found = [fromArg, ...candidates].find((item) => item && existsSync(item))
  if (!found) {
    throw new Error('找不到 Chrome/Edge，请用 --chrome 指定可执行文件路径')
  }
  return found
}

const browser = findBrowser()
const workDir = mkdtempSync(path.join(tmpdir(), 'app-icons-'))
let counter = 0

/** 用无头浏览器把一段 HTML 截成指定尺寸的 PNG */
const renderPage = async (html, width, height, output) => {
  const page = path.join(workDir, `${counter++}.html`)
  writeFileSync(page, html)
  mkdirSync(path.dirname(output), { recursive: true })
  await run(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${output}`,
    pathToFileURL(page).href,
  ])
  console.log(`${path.relative(root, output)}  ${width}×${height}`)
}

const readIcon = (name) => readFileSync(path.join(iconDir, name), 'utf8')

/** 按目标尺寸重写 SVG 的宽高，再铺满整个页面 */
const renderIcon = async (source, size, output) => {
  const svg = readIcon(source)
    .replace(/width="1024"/, `width="${size}"`)
    .replace(/height="1024"/, `height="${size}"`)
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;overflow:hidden;background:transparent}
    svg{display:block;width:${size}px;height:${size}px}
  </style>${svg}`
  await renderPage(html, size, size, output)
}

/** 启动图：白底 + 居中的应用图标 */
const renderSplash = async (width, height, output) => {
  const size = Math.round(Math.min(width, height) * 0.22)
  const svg = readIcon('app-icon.svg')
    .replace(/width="1024"/, `width="${size}"`)
    .replace(/height="1024"/, `height="${size}"`)
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;overflow:hidden;background:#ffffff;height:100vh;
      display:flex;align-items:center;justify-content:center}
    svg{display:block;border-radius:${Math.round(size * 0.22)}px}
  </style>${svg}`
  await renderPage(html, width, height, output)
}

const webIcons = [
  { source: 'app-icon.svg', file: 'icon-512.png', size: 512 },
  { source: 'app-icon.svg', file: 'icon-192.png', size: 192 },
  { source: 'app-icon.svg', file: 'apple-touch-icon.png', size: 180 },
  { source: 'app-icon.svg', file: 'favicon-32.png', size: 32 },
  { source: 'app-icon-maskable.svg', file: 'icon-maskable-512.png', size: 512 },
]

const densities = [
  { dir: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
]

const splashes = [
  { dir: 'drawable', width: 480, height: 320 },
  { dir: 'drawable-land-mdpi', width: 480, height: 320 },
  { dir: 'drawable-land-hdpi', width: 800, height: 480 },
  { dir: 'drawable-land-xhdpi', width: 1280, height: 720 },
  { dir: 'drawable-land-xxhdpi', width: 1600, height: 960 },
  { dir: 'drawable-land-xxxhdpi', width: 1920, height: 1280 },
  { dir: 'drawable-port-mdpi', width: 320, height: 480 },
  { dir: 'drawable-port-hdpi', width: 480, height: 800 },
  { dir: 'drawable-port-xhdpi', width: 720, height: 1280 },
  { dir: 'drawable-port-xxhdpi', width: 960, height: 1600 },
  { dir: 'drawable-port-xxxhdpi', width: 1280, height: 1920 },
]

try {
  for (const { source, file, size } of webIcons) {
    await renderIcon(source, size, path.join(iconDir, file))
  }

  if (existsSync(androidRes)) {
    for (const { dir, launcher, foreground } of densities) {
      const target = path.join(androidRes, dir)
      await renderIcon('app-icon.svg', launcher, path.join(target, 'ic_launcher.png'))
      await renderIcon('app-icon-round.svg', launcher, path.join(target, 'ic_launcher_round.png'))
      await renderIcon('app-icon-foreground.svg', foreground, path.join(target, 'ic_launcher_foreground.png'))
    }
    for (const { dir, width, height } of splashes) {
      await renderSplash(width, height, path.join(androidRes, dir, 'splash.png'))
    }
  } else {
    console.log('未找到 android/ 工程，跳过安卓资源')
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
