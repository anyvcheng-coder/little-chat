// 从 public/icons/app-icon.jpg 生成网页图标、PWA 图标、安卓启动器图标与启动图。
// 用本机 Chrome 的无头模式做栅格化：画布裁掉源图四周的白边，再按各平台需要的形状输出，
// 避免引入图像处理依赖。
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
const source = path.join(iconDir, 'app-icon.jpg')

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

if (!existsSync(source)) {
  throw new Error(`找不到图标源图：${path.relative(root, source)}`)
}

/** 需要生成的图标：kind 决定画法，size 是正方形边长（像素） */
const jobs = [
  { file: 'public/icons/icon-512.png', kind: 'rounded', size: 512 },
  { file: 'public/icons/icon-192.png', kind: 'rounded', size: 192 },
  { file: 'public/icons/apple-touch-icon.png', kind: 'rounded', size: 180 },
  { file: 'public/icons/favicon-32.png', kind: 'rounded', size: 32 },
  // maskable 允许系统裁成任意形状，必须铺满整块画布，不留透明角
  { file: 'public/icons/icon-maskable-512.png', kind: 'full', size: 512 },
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

if (existsSync(androidRes)) {
  for (const { dir, launcher, foreground } of densities) {
    const target = `android/app/src/main/res/${dir}`
    jobs.push(
      { file: `${target}/ic_launcher.png`, kind: 'rounded', size: launcher },
      { file: `${target}/ic_launcher_round.png`, kind: 'circle', size: launcher },
      // 自适应图标的前景层铺满 108dp，由启动器套用形状裁切
      { file: `${target}/ic_launcher_foreground.png`, kind: 'full', size: foreground }
    )
  }
  for (const { dir, width, height } of splashes) {
    jobs.push({ file: `android/app/src/main/res/${dir}/splash.png`, kind: 'splash', width, height })
  }
} else {
  console.log('未找到 android/ 工程，跳过安卓资源')
}

const base64 = readFileSync(source).toString('base64')
const page = `<!doctype html><meta charset="utf-8"><pre id="out">pending</pre><script>
const jobs = ${JSON.stringify(jobs)}
const SRC = 'data:image/jpeg;base64,${base64}'

const loadImage = () =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('icon image failed to load'))
    image.src = SRC
  })

const canvasOf = (width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** 逐级缩小，避免一次缩到 32px 时出现锯齿 */
const downscale = (source, size) => {
  let current = source
  while (current.width / 2 >= size * 1.5) {
    const half = Math.max(size, Math.round(current.width / 2))
    const next = canvasOf(half, half)
    const ctx = next.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(current, 0, 0, next.width, next.height)
    current = next
  }
  return current
}

const main = async () => {
  const image = await loadImage()

  // 源图四周是白底：以「不够白」的像素为界，裁出图标本身
  const probe = canvasOf(512, 512)
  const probeCtx = probe.getContext('2d', { willReadFrequently: true })
  probeCtx.drawImage(image, 0, 0, probe.width, probe.height)
  const pixels = probeCtx.getImageData(0, 0, probe.width, probe.height).data
  let left = probe.width
  let top = probe.height
  let right = 0
  let bottom = 0
  for (let y = 0; y < probe.height; y++) {
    for (let x = 0; x < probe.width; x++) {
      const index = (y * probe.width + x) * 4
      if (pixels[index] > 244 && pixels[index + 1] > 244 && pixels[index + 2] > 244) {
        continue
      }
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right <= left || bottom <= top) {
    throw new Error('无法从源图识别图标边界')
  }
  const ratio = image.width / probe.width
  const boxX = left * ratio
  const boxY = top * ratio
  const boxW = (right - left) * ratio
  const boxH = (bottom - top) * ratio
  // 源图四周还有一圈浅白描边，向外裁掉 1.8%，否则缩放后图标边上会留白
  const trim = Math.min(boxW, boxH) * 0.018
  const cropX = boxX + trim
  const cropY = boxY + trim
  const cropW = boxW - trim * 2
  const cropH = boxH - trim * 2

  const artSize = 1024
  const art = canvasOf(artSize, artSize)
  const artCtx = art.getContext('2d', { willReadFrequently: true })
  artCtx.imageSmoothingQuality = 'high'
  artCtx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, artSize, artSize)

  // 源图是白底上的圆角方图：从四角向内泛洪，把白底逐步变透明，圆角边缘按白度做羽化。
  // 泛洪遇到有颜色的像素就停，机器人身上的白色不会被吃掉。
  const artImage = artCtx.getImageData(0, 0, artSize, artSize)
  const pixelsData = artImage.data
  const seen = new Uint8Array(artSize * artSize)
  const stack = [0, artSize - 1, artSize * (artSize - 1), artSize * artSize - 1]
  while (stack.length > 0) {
    const index = stack.pop()
    if (seen[index]) {
      continue
    }
    seen[index] = 1
    const offset = index * 4
    const min = Math.min(pixelsData[offset], pixelsData[offset + 1], pixelsData[offset + 2])
    if (min < 236) {
      continue
    }
    // 纯白（255）完全透明，接近白的过渡色按比例保留一点，避免圆角出现硬边
    pixelsData[offset + 3] = Math.round(((255 - min) / 19) * 255)
    const x = index % artSize
    const y = (index - x) / artSize
    if (x > 0) stack.push(index - 1)
    if (x < artSize - 1) stack.push(index + 1)
    if (y > 0) stack.push(index - artSize)
    if (y < artSize - 1) stack.push(index + artSize)
  }
  artCtx.putImageData(artImage, 0, 0)

  // 边缘中点的颜色，作为补齐圆角缺口的底色
  const edgeColor = (x, y) => {
    const d = artCtx.getImageData(Math.round(x), Math.round(y), 1, 1).data
    return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')'
  }
  const baseColor = edgeColor(artSize * 0.04, artSize * 0.5)

  const paintArt = (ctx, size) => {
    const scaled = downscale(art, size)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(scaled, 0, 0, size, size)
  }

  /** 铺满画布：先垫底色，再垫一层放大模糊的同图，缺口处的颜色与边缘自然衔接 */
  const paintFull = (ctx, size) => {
    ctx.fillStyle = baseColor
    ctx.fillRect(0, 0, size, size)
    ctx.save()
    ctx.filter = 'blur(' + Math.max(2, size * 0.05) + 'px)'
    ctx.drawImage(art, -size * 0.05, -size * 0.05, size * 1.1, size * 1.1)
    ctx.restore()
    paintArt(ctx, size)
  }

  const render = (job) => {
    if (job.kind === 'splash') {
      const canvas = canvasOf(job.width, job.height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, job.width, job.height)
      const size = Math.round(Math.min(job.width, job.height) * 0.22)
      ctx.drawImage(downscale(art, size), (job.width - size) / 2, (job.height - size) / 2, size, size)
      return canvas.toDataURL('image/png')
    }
    const canvas = canvasOf(job.size, job.size)
    const ctx = canvas.getContext('2d')
    if (job.kind === 'circle') {
      ctx.beginPath()
      ctx.arc(job.size / 2, job.size / 2, job.size / 2, 0, Math.PI * 2)
      ctx.clip()
      paintArt(ctx, job.size)
    } else if (job.kind === 'full') {
      paintFull(ctx, job.size)
    } else {
      // 圆角已经在透明化时做好了，直接画即可
      paintArt(ctx, job.size)
    }
    return canvas.toDataURL('image/png')
  }

  const output = {}
  for (const job of jobs) {
    output[job.file] = render(job)
  }
  document.getElementById('out').textContent = btoa(JSON.stringify(output))
}

main().catch((error) => {
  document.getElementById('out').textContent = 'error:' + error.message
})
</script>`

const browser = findBrowser()
const workDir = mkdtempSync(path.join(tmpdir(), 'app-icons-'))
try {
  const pagePath = path.join(workDir, 'icons.html')
  writeFileSync(pagePath, page)
  const { stdout } = await run(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--virtual-time-budget=30000',
      '--dump-dom',
      pathToFileURL(pagePath).href,
    ],
    { maxBuffer: 128 * 1024 * 1024 }
  )
  const match = stdout.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  const payload = match?.[1]?.trim() ?? ''
  if (!payload || payload === 'pending') {
    throw new Error('无头浏览器没有在超时前完成渲染')
  }
  if (payload.startsWith('error:')) {
    throw new Error(payload.slice('error:'.length))
  }
  const output = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  for (const job of jobs) {
    const dataUrl = output[job.file]
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error(`生成失败：${job.file}`)
    }
    const target = path.join(root, job.file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'))
    console.log(
      `${job.file}  ${job.kind === 'splash' ? `${job.width}×${job.height}` : `${job.size}×${job.size}`}`
    )
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
