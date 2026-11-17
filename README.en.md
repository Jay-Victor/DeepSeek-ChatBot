# DeepSeek ChatBot (Android)

English | [简体中文](README.md)

<p align="center">
  <img src="docs/logo.png" width="132" alt="DeepSeek ChatBot logo">
</p>

[![Latest release](https://img.shields.io/github/v/release/Jay-Victor/DeepSeek-ChatBot?label=release&color=4D6BFE)](https://github.com/Jay-Victor/DeepSeek-ChatBot/releases/latest)
[![Download APK](https://img.shields.io/badge/download-APK-3DDC84?logo=android&logoColor=white)](https://github.com/Jay-Victor/DeepSeek-ChatBot/releases/latest)

Packs [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 0.1.1 into an installable Android app:
**the upstream web build, wrapped in a thin Kotlin WebView shell**. No UI rewrite, no protocol changes.

<p align="center">
  <img src="docs/screenshot.png" width="300" alt="Screenshot">
</p>

| | |
| --- | --- |
| Application ID | `com.deepseekchatbot` |
| Version | 0.1.8 (versionCode 9) |
| Size | 5.32 MB (release) |
| SDK | minSdk 26 / targetSdk 36 / compileSdk 36 |
| Native deps | androidx only (webkit / browser / activity / core-splashscreen), no third-party runtime |
| Toolchain | Gradle 8.14.4 · AGP 8.13.0 · Kotlin 2.3.0 · JDK 17+ |

## Why a WebView shell

The upstream project is a pure static SPA: `rspack` emits static files, there is no backend, all state lives in
localStorage and IndexedDB, and requests go straight to the DeepSeek API. Getting it into a WebView only needs the six
capabilities a browser has and a WebView does not. Rewriting it in Kotlin would mean reimplementing Markdown, KaTeX,
Mermaid, and the whole history import/export layer for no gain.

## Features

Everything in the UI comes from upstream: multiple sessions with auto-generated titles, edit / regenerate / branch
switching, streaming answers, deep thinking, web search with source citations, attachments (paste and drag-drop),
voice input and read-aloud, Markdown with syntax highlighting, KaTeX math and Mermaid diagrams, Chinese and English,
light and dark themes, ZIP history import/export.

Added by the shell: system back button, status bar appearance, safe areas and keyboard avoidance, microphone
permission, file picker, saving exports to disk, opening external links, an optional "collapse thinking
automatically" switch, version info / GitHub Release update checks in Settings → About (automatic checks can be
turned off), a context-usage ring in the composer (DeepSeek-V4 tokenizer, 1M window, refreshed after each
turn), and in-app update installation from Settings → About (SHA-256, signature and version are verified before
handing the APK to the system installer). On mobile, the sidebar gains local session search (titles plus the
current branch's text and attachment names, with highlighted hits), a floating New button at the bottom, and
multi-select with batch pin/delete, and the session header's new-chat button is always visible; the desktop sidebar
is unchanged.

## Requirements

- Node.js 22+ and pnpm
- JDK 17+ (this repository was built with 21)
- Android SDK: platform `android-36`, build-tools `36.1.0`

## Build

```bash
scripts/build-apk.sh release        # or scripts/build-apk.sh debug
```

The script does three things: `pnpm build` inside `web/`, sync `web/dist` into
`android/app/src/main/assets/www`, then `./gradlew assembleRelease`. Output:

```
android/app/build/outputs/apk/release/DeepSeekChatBot-v0.1.8-release.apk
```

Step by step:

```bash
cd web && pnpm install && pnpm build
rm -rf ../android/app/src/main/assets/www && mkdir -p ../android/app/src/main/assets/www
cp -r dist/. ../android/app/src/main/assets/www/
cd ../android && ./gradlew assembleRelease
```

> Do not serve `web/dist` from a static server while building: rspack cleans the output directory and fails with
> `EBUSY` on Windows.

## Install

```bash
adb install -r android/app/build/outputs/apk/release/DeepSeekChatBot-v0.1.8-release.apk
```

If you would rather not build it yourself, the signed APK is attached to the
[latest release](https://github.com/Jay-Victor/DeepSeek-ChatBot/releases/latest).

On first launch the app asks for an API key (Settings → Data). The key is written only to the on-device WebView
localStorage and is excluded from cloud backup (`allowBackup=false`).

**The same `applicationId` must always be signed with the same keystore** — otherwise the only option is uninstall and
reinstall, which wipes local sessions and the API key.

## Signing

`android/local.properties` (gitignored, template at `android/local.properties.template`) supplies four values:

```
KEYSTORE_FILE / KEYSTORE_PASSWORD / KEYSTORE_ALIAS / KEY_PASSWORD
```

If any of them is missing, `assembleRelease` still produces an APK, just unsigned. The keystore generated for this
repository is recorded in `android/KEYSTORE_INFO.txt` (also gitignored) — back it up, or you lose the ability to
upgrade in place.

## What the shell implements

| Problem | Solution |
| --- | --- |
| Page origin | `WebViewAssetLoader` serves `assets/www` from the fixed `https://appassets.androidplatform.net/assets/www/index.html`. `file://` is not usable: Chromium disables IndexedDB there, and `crypto.randomUUID`, `navigator.clipboard`, `getUserMedia` all require a secure context |
| Microphone | `onPermissionRequest` plus a runtime `RECORD_AUDIO` request |
| File picker | `onShowFileChooser` + `ACTION_OPEN_DOCUMENT`, mapping the page's extension allow-list to MIME types |
| ZIP export | A WebView silently drops `<a download>` on `blob:` URLs; the shell exposes a JS→native bridge that streams base64 chunks into SAF `ACTION_CREATE_DOCUMENT` |
| External links | `window.open` / `target=_blank` / plain links all open in Custom Tabs instead of a second WebView |
| Back button | The page pushes its "overlay open" state to native, which decides synchronously whether to close or exit (no async JS callback) |
| System bars and keyboard | Container padding reserves status bar, navigation bar and IME height; status bar icons follow the page theme |
| Light/dark | `values/` uses a light base theme, `values-night/` a dark one — WebView derives `prefers-color-scheme` from the app theme, not from system uiMode |

## Repository layout

```
web/        upstream chat-demo 0.1.1 sources; see web/PATCHES.md for local changes
android/    Kotlin WebView shell (Gradle project)
scripts/    build-apk.sh: build web → sync assets → build APK
docs/       screenshots
references/ upstream archive and icon assets (not tracked)
```

## Known limitations

- **Session search and multi-select are mobile-only**: search matches titles, the current branch's text and
  attachment names, but not thinking blocks. The first search builds a local index, so a large history may pause
  briefly. Multi-select supports batch pin/delete; pinned state is stored locally and kept through ZIP export/import.
  The desktop sidebar keeps its original full-width New button and list.
- **Background / lock screen**: the system throttles WebView, so long generations may be interrupted. Keeping it
  running while locked needs a foreground service, which is not implemented.
- **System dark mode**: the page renders with the theme present at launch (`configChanges` includes `uiMode` so the
  activity is never recreated and streaming survives). A system theme switch takes effect on the next launch; the
  in-app Settings → Theme switch applies immediately.
- Large attachments (tens of MB) go through SAF into memory before upload; low-end devices risk OOM (`largeHeap` is
  enabled, which only helps).
- DeepSeek endpoints only (`/anthropic/v1/messages`, `/anthropic/v1/files`, `/v1/tools/asr|tts`). Supporting an
  OpenAI-compatible endpoint means changing `web/src/services/api/`.
- In-app updates need access to GitHub release assets (the `api.github.com` asset endpoint is preferred). On
  restricted networks the download may fail; use "Download in browser" instead. The first install also requires
  allowing unknown sources in system settings. Keep the app in the foreground while downloading; if the process is
  reclaimed, the download starts over.
- No iOS build: the same six capabilities would need a separate implementation there.

## Verification status

Checked on Android 16 (API 36.1, x86_64 emulator): page origin and secure context, CORS on the streaming endpoint and
401 error mapping, ZIP export written to disk (downloaded file md5 matches the source data), microphone permission
flow, file picker, external links opening in Custom Tabs, all three levels of back button behaviour, light/dark with
status bar inversion, insets/keyboard without double spacing, and in-app update download progress / SHA-256 and
signature verification / unknown-sources permission / system installer upgrade. On-device confirmation is still
pending. This version's mobile sidebar (search, multi-select, pinned group, batch delete, floating New, persistent
header button) was checked in a 390×844 viewport; the Android IME behaviour still needs an on-device check.

## License

[MIT](LICENSE). `web/` is a derived copy of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo); its MIT
notice is kept in `web/LICENSE` and ships with the build output. The icon artwork and the DeepSeek name are used for a
personal, side-loaded build only.

See [CHANGELOG.md](CHANGELOG.md) for history.
