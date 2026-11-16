# little chat

[English](README.md) | 简体中文

自用的手机端 AI 聊天应用，fork 自 [chat-demo](https://github.com/deepseek-ai/chat-demo)。在对话之外多接了一路生图接口：聊天模型先把需求写成提示词，再交棒给生图模型出图，支持带参考图改图。无需应用后端，浏览器直接请求配置的 API 服务；会话、附件与生成图都只存在本机。

首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 装到手机上

### 安卓安装包（推荐）

**[下载 latest APK](https://github.com/anyvcheng-coder/little-chat/releases/latest/download/little-chat.apk)**

手机浏览器打开上面的链接直接下载，安装时允许「安装未知来源应用」即可。这是 debug 签名的自用包，不上应用商店；首次打开在设置里填 API Key 和生图接口，之后所有会话与图片都存在手机本地。换了机器重新构建的包签名不同，覆盖安装前要先卸载旧版。

重新出包（本机需要 JDK 21 与 Android SDK 36，或用 Android Studio 打开 [android/](android/)）：

```sh
pnpm build && npx cap sync android
cd android && ./gradlew assembleDebug     # 产物在 app/build/outputs/apk/debug/
```

GitHub Actions 的自动构建写在 [ci/android-apk.yml](ci/android-apk.yml)：把它复制到 `.github/workflows/android.yml` 后，每次推 `main` 都会重新构建并更新上面这个发布。放在 `ci/` 是因为创建 `.github/workflows/` 下的文件需要带 `workflow` 权限的 token（`gh auth refresh -s workflow`），网页端新建文件同样可以。

### 装成 PWA

`pnpm build` 的产物同时是一个可安装的 PWA：装到主屏幕后没有地址栏，以独立窗口全屏运行，界面外壳会缓存到本地，断网也能打开并翻看历史会话（数据本身一直在 IndexedDB 里）。

安装需要 HTTPS 或 `localhost`。任选一种方式把它放到手机上：

```sh
pnpm build && pnpm preview          # 本机 8090 端口预览，可在电脑浏览器里先装一遍试试
```

- 放到任意静态托管（GitHub Pages、Cloudflare Pages、Vercel 等），手机浏览器打开该地址。
- 想用 GitHub Pages 托管：把 [ci/pages.yml](ci/pages.yml) 复制到 `.github/workflows/pages.yml`（同上，需要 `workflow` 权限），推到 `main` 即自动发布。

装法：Android Chrome 打开右上角菜单 →「安装应用」，或等页面上的「添加到主屏幕」提示；iOS Safari 点底部「分享」→「添加到主屏幕」。关掉提示后不再出现，想再看一次可清除站点数据或在控制台执行 `localStorage.removeItem('installHintDismissed')`。

应用名、图标、主题色分别在 [public/manifest.webmanifest](public/manifest.webmanifest) 与 [public/icons](public/icons)。

### 图标

图标源文件是 [public/icons](public/icons) 下的 SVG，改动后用本机 Chrome 一次性重渲网页图标、安卓启动器图标与启动图：

```sh
pnpm icons
```

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 生图：对话模型先写提示词再交棒给生图接口，结果连同提示词、模型与参考图留在对话里，可改词后重新出图。模型内置常用版本（火山方舟 Seedream 5.5 / 5.0、OpenAI GPT Image 2 / 1.5 等），厂商出新版时也可以直接填模型 ID，不用等应用更新。
- 简体中文与英文、浅色与深色主题、主题色与聊天背景（预设渐变或上传自己的图片，遮罩与模糊可调）、移动端布局、位置设置、历史导入导出。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

主题色与聊天背景（包括自己上传的背景图，会先压到 1440 长边再存）也只存在这台设备的 localStorage，不随历史导出，换设备需要重新设置。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令           | 用途                          |
| -------------- | ----------------------------- |
| `pnpm dev`     | 启动开发服务器                |
| `pnpm build`   | 构建到 `dist/`                |
| `pnpm preview` | 预览构建产物（localhost）     |
| `pnpm icons`   | 重新渲染应用图标              |
| `pnpm type`    | TypeScript 类型检查           |
| `pnpm lint`    | oxlint 检查                   |
| `pnpm format`  | oxfmt 格式化                  |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
android/               Capacitor 安卓工程（启动器图标、包名、权限）
public/                清单、Service Worker 与图标（原样复制到 dist）
scripts/               图标渲染与本地预览脚本
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    image/             生图供应商、参考图预处理与出图请求
    markdown/          Markdown 解析、代码高亮与图表
    pwa/               Service Worker 注册与安装引导
    speech/            录音与朗读
    storage/           持久化存储申请等本地能力
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
