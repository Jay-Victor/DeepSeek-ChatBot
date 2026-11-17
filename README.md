# DeepSeek ChatBot（Android）

把 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 0.1.1 打包成可安装的 Android 应用：
**原样使用上游前端产物 + 一薄层原生 WebView 壳**，不重写 UI，也不改协议。

- 应用名：DeepSeek ChatBot ｜ `applicationId`：`com.deepseekchatbot`
- `minSdk 26` / `targetSdk 36` / `compileSdk 36`，APK 约 4.5 MB
- 首次打开需在「设置 → 数据管理」里填入自己的 DeepSeek API Key（Key 只存在本机 WebView 的 localStorage，不上传）

## 目录

```
web/        chat-demo 上游源码（只加了 5 处改动，见 web/PATCHES.md）
android/    Kotlin WebView 壳（Gradle 工程）
scripts/    build-apk.sh：构建 Web → 同步 assets → 出 APK
references/ 上游原始压缩包与图标素材（不进版本库）
```

## 构建

需要：Node 22+、pnpm、JDK 17+（本机 21）、Android SDK（platform 36 + build-tools 36.1）。

```bash
scripts/build-apk.sh release     # 或 debug
```

等价于：

```bash
cd web && pnpm install && pnpm build          # → web/dist
rm -rf ../android/app/src/main/assets/www
cp -r dist/. ../android/app/src/main/assets/www/
cd ../android && ./gradlew assembleRelease    # → app/build/outputs/apk/release/
```

> `web/dist` 被别的进程占用（例如用它起静态服务器）时 rspack 清目录会 EBUSY，构建前先停掉。

签名参数在 `android/local.properties`（已被 gitignore）：`KEYSTORE_FILE` / `KEYSTORE_PASSWORD` / `KEYSTORE_ALIAS` / `KEY_PASSWORD`。
缺任一项时 `assembleRelease` 产出的是未签名 APK。密钥与口令另见 `android/KEYSTORE_INFO.txt`（同样不进版本库）。

## 安装

```bash
adb install -r android/app/build/outputs/apk/release/DeepSeekChatBot-v1.0.0-release.apk
```

侧载注意（vivo / OriginOS 等）：需要关闭「纯净模式」并允许安装未知来源应用。**同一 `applicationId` 必须始终用同一 keystore 签名**，否则只能卸载重装，本地会话与 API Key 会一起清空。

## 原生壳做了什么

上游页面需要、浏览器里不需要、WebView 里必须补的六件事：

| 能力 | 做法 |
| --- | --- |
| 页面 origin | `WebViewAssetLoader` 把 `assets/www` 挂到固定的 `https://appassets.androidplatform.net/assets/www/index.html`。不能用 `file://`：Chromium 在 file 下禁用 IndexedDB，且 `crypto.randomUUID`、`navigator.clipboard`、`getUserMedia` 都要安全上下文 |
| 麦克风 | `onPermissionRequest` + 运行时 `RECORD_AUDIO` 授权 |
| `<input type=file>` | `onShowFileChooser` + `ACTION_OPEN_DOCUMENT`，把页面上的扩展名白名单映射成 MIME |
| 导出 ZIP | WebView 会静默丢弃 `blob:` 的 `<a download>`：改为 JS→原生桥，分片 base64 交给 SAF `ACTION_CREATE_DOCUMENT` 写入用户选定的位置 |
| 外链 | `window.open` / `target=_blank` / 普通外链统一用 Custom Tabs 打开，不在壳里开新 WebView |
| 返回键、系统栏、键盘 | 返回键先问页面关弹层；安全区与输入法由容器 padding 提供；状态栏字色随页面主题反色 |

## 已知限制

- **后台/锁屏**：WebView 会被系统节流，长时间生成可能中断；「锁屏继续跑」需要前台服务，未做。
- **系统深色模式**：应用按启动时的系统主题渲染（WebView 的 `prefers-color-scheme` 取自应用主题），运行中切换系统主题需重启应用；应用内「设置 → 主题」可立即切换。
- 大附件（几十 MB）经 SAF 进内存再上传，低端机有 OOM 风险（已开 `largeHeap`）。
- 只支持 DeepSeek 官方接口：`/anthropic/v1/messages`、`/anthropic/v1/files`、`/v1/tools/asr|tts`，换成 OpenAI 兼容端点需要改 `web/src/services/api/`。
- 长按文本菜单由系统 WebView 提供（中文系统下为中文）。

## 许可证

上游为 MIT，`web/LICENSE` 会随构建产物一并打包；二创图标与 DeepSeek 品牌仅用于个人侧载，上架应用商店前请自行评估授权。
