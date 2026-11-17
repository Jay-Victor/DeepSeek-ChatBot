# DeepSeek ChatBot (Android)

English | [简体中文](README.md)

Packs [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 0.1.1 into an installable Android app:
**the upstream web build, wrapped in a thin Kotlin WebView shell**. No UI rewrite, no protocol changes.

<img src="docs/screenshot.png" width="320" alt="Screenshot">

| | |
| --- | --- |
| Application ID | `com.deepseekchatbot` |
| Version | 1.0.0 (versionCode 1) |
| Size | 4.5 MB (release) |
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
permission, file picker, saving exports to disk, opening external links.

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
android/app/build/outputs/apk/release/DeepSeekChatBot-v1.0.0-release.apk
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
adb install -r android/app/build/outputs/apk/release/DeepSeekChatBot-v1.0.0-release.apk
```

On first launch the app asks for an API key (Settings → Data). The key is written only to the on-device WebView
localStorage and is excluded from cloud backup (`allowBackup=false`).

Sideloading: on vivo / OriginOS you have to turn off "Pure Mode" and allow installing from unknown sources.
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

- **Background / lock screen**: the system throttles WebView, so long generations may be interrupted. Keeping it
  running while locked needs a foreground service, which is not implemented.
- **System dark mode**: the page renders with the theme present at launch (`configChanges` includes `uiMode` so the
  activity is never recreated and streaming survives). A system theme switch takes effect on the next launch; the
  in-app Settings → Theme switch applies immediately.
- Large attachments (tens of MB) go through SAF into memory before upload; low-end devices risk OOM (`largeHeap` is
  enabled, which only helps).
- DeepSeek endpoints only (`/anthropic/v1/messages`, `/anthropic/v1/files`, `/v1/tools/asr|tts`). Supporting an
  OpenAI-compatible endpoint means changing `web/src/services/api/`.
- No iOS build: the same six capabilities would need a separate implementation there.

## Verification status

Checked on Android 16 (API 36.1, x86_64 emulator): page origin and secure context, CORS on the streaming endpoint and
401 error mapping, ZIP export written to disk (downloaded file md5 matches the source data), microphone permission
flow, file picker, external links opening in Custom Tabs, all three levels of back button behaviour, light/dark with
status bar inversion, and insets/keyboard without double spacing. On-device confirmation (iQOO 9 / OriginOS) is still
pending.

## License

[MIT](LICENSE). `web/` is a derived copy of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo); its MIT
notice is kept in `web/LICENSE` and ships with the build output. The icon artwork and the DeepSeek name are used for a
personal, side-loaded build only.
