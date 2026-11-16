# little chat

English | [简体中文](README.zh-CN.md)

A personal mobile AI chat app, forked from [chat-demo](https://github.com/deepseek-ai/chat-demo). Beyond chat, it wires a second API for image generation: the chat model turns a request into a prompt and hands it off to an image model, with reference-image editing. No application backend is required: the browser connects directly to the configured API service, and conversations, attachments, and generated images stay on the device.

Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Install on a phone

### Android APK (recommended)

**[Download the latest APK](https://github.com/anyvcheng-coder/little-chat/releases/latest/download/little-chat.apk)**

Open that link on the phone and allow "install unknown apps". It is a debug-signed build for personal use, not a store release; enter your API key and image settings on first launch, and everything stays on the device. A build made on another machine carries a different signature, so uninstall the old app before installing it.

Rebuild it locally (JDK 21 and Android SDK 36, or open [android/](android/) in Android Studio):

```sh
pnpm build && npx cap sync android
cd android && ./gradlew assembleDebug     # output in app/build/outputs/apk/debug/
```

The GitHub Actions build lives in [ci/android-apk.yml](ci/android-apk.yml): copy it to `.github/workflows/android.yml` and every push to `main` refreshes the release above. It sits in `ci/` because creating files under `.github/workflows/` needs a token with the `workflow` scope (`gh auth refresh -s workflow`); adding the file through the GitHub web UI works too.

### As a PWA

The `pnpm build` output is also an installable PWA: once added to the home screen it runs full screen without an address bar, and the app shell is cached locally, so it opens and browses history offline (the data itself always lives in IndexedDB).

Installation requires HTTPS or `localhost`. Either of these gets it onto a phone:

```sh
pnpm build && pnpm preview          # serve on port 8090 to try installing in a desktop browser first
```

- Host `dist/` on any static host (GitHub Pages, Cloudflare Pages, Vercel, ...) and open that URL on the phone.
- To host on GitHub Pages, copy [ci/pages.yml](ci/pages.yml) to `.github/workflows/pages.yml` (same `workflow` scope requirement); pushing `main` then publishes automatically.

How to install: on Android Chrome, open the menu → "Install app", or wait for the in-page "Add to Home Screen" hint; on iOS Safari, tap Share → "Add to Home Screen". The hint shows once per device — clear site data or run `localStorage.removeItem('installHintDismissed')` to see it again.

App name, icons, and theme color live in [public/manifest.webmanifest](public/manifest.webmanifest) and [public/icons](public/icons).

### Icons

Icon sources are the SVGs in [public/icons](public/icons); re-render the web icons, Android launcher icons, and splash screens with your local Chrome:

```sh
pnpm icons
```

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Image generation: the chat model writes the prompt, then hands it off to an image API; results stay in the conversation with the prompt, model, and reference images, and can be regenerated after editing the prompt.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command        | Description                       |
| -------------- | --------------------------------- |
| `pnpm dev`     | Start the development server      |
| `pnpm build`   | Build into `dist/`                |
| `pnpm preview` | Preview the build on `localhost`  |
| `pnpm icons`   | Re-render the app icons           |
| `pnpm type`    | Run TypeScript type checks        |
| `pnpm lint`    | Lint with oxlint                  |
| `pnpm format`  | Format with oxfmt                 |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
android/               Capacitor Android project (launcher icons, package, permissions)
public/                Manifest, service worker, and icons (copied to dist as-is)
scripts/               Icon rendering and local preview scripts
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    image/             Image providers, reference preprocessing, and image requests
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    pwa/               Service worker registration and install hint
    speech/            Audio recording and read-aloud playback
    storage/           Local capabilities such as persistent storage
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
