# AGENTS.md

给在本仓库工作的 AI 协作者与人类维护者的约定。**动手前读完本文件**；发布流程（推送、Release 格式）有硬性要求，偏离会直接导致包体或发布不一致。

## 1. 项目速览

把 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 0.1.1 装进 Android：上游前端产物 + 一层 Kotlin WebView 壳。

| 路径 | 职责 | 改动原则 |
| --- | --- | --- |
| `web/` | 上游 chat-demo 源码副本 | 尽量不动业务代码；必须的改动记进 `web/PATCHES.md`，只新增文件 + 接线 |
| `android/` | Kotlin WebView 壳（Gradle） | 全部自己的代码；壳只补浏览器有、WebView 没有的能力 |
| `scripts/` | 构建脚本 | `build-apk.sh` 是唯一入口 |
| `docs/` | 截图、logo、按版本归档的 Release 正文 | `docs/releases/v<tag>.md` |
| `references/` | 上游压缩包与图标素材 | **不进版本库**（gitignored） |

工具链（改动前确认版本一致）：Node 22+ / pnpm 11 / JDK 17+（本机 21）/ Gradle 8.14.4 / AGP 8.13.0 / Kotlin 2.3.0 / compileSdk 36 / buildTools 36.1.0 / minSdk 26。

## 2. 构建与验证

```bash
scripts/build-apk.sh release     # 或 debug
```

它做三件事：`web/` 里 `pnpm build` → 同步 `web/dist` 到 `android/app/src/main/assets/www` → `./gradlew assembleRelease`。

硬性要求：

- 改 `web/` 的 TS/TSX 后必须 `cd web && pnpm type` 通过。
- **构建期间不要用静态服务器占着 `web/dist`**：rspack 会清空输出目录，Windows 下报 `EBUSY`。
- `web/dist`、`android/app/src/main/assets/www`、`web/node_modules` 不进版本库。
- 验收：APK 能装能开会话；改动涉及原生能力时，至少在模拟器上过一遍（origin、权限、导出、返回键、深浅色）。

## 3. 版本号

- 单一来源：`android/app/build.gradle.kts` 的 `versionName` 与 `versionCode`。
- `versionName` 必须等于 tag 去掉 `v`（`v0.1.0` ↔ `0.1.0`），CI 会校验，不一致直接失败。
- **每次发版 `versionCode` 必须比上一版大**（当前 1），否则用户无法覆盖升级。
- 版本号只在发版提交里改，别和功能改动混在一个提交。

## 4. 提交规范

- 中文描述 + Conventional Commits 前缀：`feat:`、`fix:`、`docs:`、`chore:`、`refactor:`、`build:`、`release:`。
- 一个提交一件事；提交信息写"改了什么 + 为什么"，不要写"更新文件"。
- 提交前 `git status --short` 必须只剩预期改动。

**绝对不能提交**：`android/local.properties`、`android/keystore/`、`android/KEYSTORE_INFO.txt`、`references/`、任何 token。

## 5. 推送远程

- remote 固定为 SSH，分支 `main`：`git@github.com:Jay-Victor/DeepSeek-ChatBot.git`。不要改成 HTTPS（本机 HTTPS 需代理，SSH 直连）。
- 推送命令：`GIT_SSH_COMMAND="ssh -o BatchMode=yes" git push origin main`
- **推送后必须校验**，不要凭推送输出下结论：

  ```bash
  echo "local  $(git rev-parse HEAD)"
  echo "remote $(git ls-remote origin refs/heads/main | cut -f1)"
  ```

  两者一致才算完成。
- 不要 force push `main`。

## 6. 发布 Release

优先走 CI；CI 不可用时按 B 手动执行，**格式必须一致**。

### A. CI（推荐）

1. 改 `versionName` / `versionCode`（第 3 节）。
2. 更新 `CHANGELOG.md`：把 `[Unreleased]` 的内容落到新版本小节。
3. 写 `docs/releases/v<tag>.md`（正文格式见 6.3）。CI 会把它当正文，并在缺少「校验」段时自动追加 SHA-256 与字节数。
4. 提交：`release: v0.1.0`。
5. 打并推送附注 tag：

   ```bash
   git tag -a v0.1.0 -m "DeepSeek ChatBot v0.1.0"
   git push origin main && git push origin v0.1.0
   ```

6. `.github/workflows/release.yml` 自动：构建 → 签名 → 校验版本与 tag 一致 → 创建/更新 Release → 上传 APK。之后只需 `git push --tags`。

### B. 手动（与 v0.1.0 的实际操作一致）

1. 推送 `main` 并校验 SHA（第 5 节）。
2. 打并推送附注 tag：`git tag -a v0.1.0 -m "DeepSeek ChatBot v0.1.0" && git push origin v0.1.0`。
3. 创建 Release（`gh release create`，或 `POST /repos/{owner}/{repo}/releases`）：
   - **Title**：`DeepSeek ChatBot v0.1.0`（固定格式：`DeepSeek ChatBot ` + tag）
   - **Body**：`docs/releases/v0.1.0.md` 原文；若没有该文件，按 6.3 现场写
   - **Asset**：`DeepSeekChatBot-v0.1.0-release.apk`，Content-Type 用 `application/vnd.android.package-archive`
   - `draft = false`、`prerelease = false`（除非是 `-rc.N`）
4. 校验（必做）：
   - 重新下载已发布的 asset，`sha256sum` 与本地 APK 一致；
   - 字节数与本地一致；
   - `gh release view v0.1.0`（或 `GET /releases/tags/v0.1.0`）确认 `draft=false`、asset `state=uploaded`。

### 6.3 Release 正文格式（顺序固定）

````markdown
<一句话定位：把 chat-demo 打包成的 Android 版本，第几个可安装版本>

## 应用
- 包名 `com.deepseekchatbot`，`versionCode N`
- minSdk 26 / targetSdk 36 / compileSdk 36
- Release APK X.XX MB，v2 签名

## 功能（来自上游）
…上游能力清单…

## 壳补的能力
…这一版新增或修正的原生能力…

## 安装
```bash
adb install -r DeepSeekChatBot-vX.Y.Z-release.apk
```
首次启动在「设置 → 数据管理」填入自己的 DeepSeek API Key；Key 只存本机 WebView 的 localStorage，不进云备份。

## 校验
```
SHA-256  <sha256>
size     <bytes> bytes
```

## 已知限制
…

## English
3–5 行英文摘要 + README 链接
````

### 6.4 禁止

- 复用或强推已发布的 tag；改已发布 Release 的 asset 文件名。
- 发完 Release 再改版本号（版本号必须在发版提交里）。
- 在正文或 body 里写本机路径（`E:\...`）、token、keystore 口令。
- 只 push tag 不 push `main`（会发布一个不在 main 上的版本）。

## 7. 密钥与凭据

- 本地签名：`android/keystore/deepseekchatbot.jks`，参数在 `android/local.properties`，口令另记在 `android/KEYSTORE_INFO.txt`（三者都 gitignored）。
- CI 签名：仓库 secrets `KEYSTORE_BASE64`（jks 的 base64）、`KEYSTORE_PASSWORD`、`KEYSTORE_ALIAS`、`KEY_PASSWORD`。
- 同一 `applicationId` 必须始终用同一 keystore，否则用户只能卸载重装、本地历史与 Key 一起丢。
- GitHub API 凭据：本机 Windows 凭据管理器里已有 OAuth 令牌，用 `git credential fill` 取；不要写进文件、不要打印到日志。

## 8. 已知坑（都已实际踩过）

- Windows + pnpm：scripts 走 cmd，脚本里不能写 `NODE_ENV=production cmd`。
- WebView **忽略自身 padding**：安全区/键盘要留白在容器上。
- WebView 的 `prefers-color-scheme` 取自**应用主题**（`values/` 浅色、`values-night/` 深色），不是系统 uiMode。
- `configChanges` 含 `uiMode` → 运行中切系统主题需重启应用（换来的是不重建 Activity、不丢流式回复）。
- `window.open` 的 `onCreateWindow` 探针 WebView 要延时销毁，否则每次泄漏一个。
- WebView 会静默丢弃 `blob:` 的 `<a download>`，导出走原生 SAF 桥。
- 返回键必须同步决策（页面把弹层开合状态推给原生），不要用异步 JS 回调。

## 9. 发版前检查清单

- [ ] `pnpm type` 通过
- [ ] `scripts/build-apk.sh release` 成功，APK 在模拟器/真机可安装可运行
- [ ] `versionName` == tag 去 `v`，`versionCode` 已递增
- [ ] `CHANGELOG.md` 与 `docs/releases/v<tag>.md` 已写
- [ ] 没有 secret 进入暂存区
- [ ] push 后本地 / 远端 SHA 一致
- [ ] Release 标题、正文、asset 符合 6.3；重新下载校验 SHA-256
