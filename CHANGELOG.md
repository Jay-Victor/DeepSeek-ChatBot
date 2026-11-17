# 变更记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。
发版时把 `[Unreleased]` 的内容移到新的版本小节，并补上日期。

## [Unreleased]

### 新增

- 「关于」页支持应用内下载并安装更新：优先从 GitHub API 资产入口下载 APK，校验字节数、SHA-256、包名、签名证书与 versionCode 后交给系统安装器；首次安装会引导开启未知来源权限，返回应用后自动继续，失败时可回退到浏览器下载

## [0.1.3] - 2026-11-17

### 新增

- 输入框新增上下文占用环：按 DeepSeek-V4 分词器统计当前分支的文本 token，以 1M 窗口为分母，
  每个回合结束后更新；服务端 `usage` 用于校准模板与附件开销，点击可查看对话 / 系统开销与上次请求用量

## [0.1.2] - 2026-11-17

### 新增

- 通用设置新增「思考内容自动折叠」开关：开启后思考结束自动收起思考过程，历史消息中已结束的思考也默认收起

## [0.1.1] - 2026-11-17

### 新增

- 设置新增「关于」：显示应用图标、名称与版本，可从 GitHub Release 检查更新；自动检查默认开启（每次打开应用时检查一次），也可关闭

### 变更

- 输入框的语音键与发送键合并为一个按钮：无内容时是麦克风，输入后变发送，输出中变停止
- 移动端侧边栏改为推挤式抽屉：展开时主内容被推开并随进度压暗，支持全屏横向右滑打开、左滑或点按关闭
- 移除 GitHub Actions 工作流（`.github/`）与仓库 secrets：发布改为本地构建 + 手动上传，签名私钥只留在本机
- `AGENTS.md` 改为本地文件（已加入 `.gitignore`）

## [0.1.0] - 2026-11-17

首个可安装版本。

### 新增

- Android WebView 壳（Kotlin）：`WebViewAssetLoader` 固定 origin、麦克风授权、SAF 文件选择、
  ZIP 导出桥、Custom Tabs 外链、返回键分层退出、系统栏与输入法避让
- 启动图与自适应图标，浅色 / 深色主题跟随系统
- `scripts/build-apk.sh`：`pnpm build` → 同步 assets → Gradle 出包
- 中英两版 README、根目录 LICENSE、截图与 `AGENTS.md` 协作约定
- GitHub Actions：打 tag 自动构建签名 APK 并发布 Release

### 变更

- `web/package.json` 的 `build` 脚本去掉内联环境变量，兼容 Windows + pnpm
- 应用名与 `appName` 统一为 DeepSeek ChatBot

### 已知问题

- 后台 / 锁屏时 WebView 被系统节流，长时间生成可能中断
- 运行中切换系统深浅色需重启应用（应用内主题开关即时生效）

[Unreleased]: https://github.com/Jay-Victor/DeepSeek-ChatBot/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Jay-Victor/DeepSeek-ChatBot/releases/tag/v0.1.3
[0.1.2]: https://github.com/Jay-Victor/DeepSeek-ChatBot/releases/tag/v0.1.2
[0.1.1]: https://github.com/Jay-Victor/DeepSeek-ChatBot/releases/tag/v0.1.1
[0.1.0]: https://github.com/Jay-Victor/DeepSeek-ChatBot/releases/tag/v0.1.0
