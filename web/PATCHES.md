# 相对上游 chat-demo 0.1.1 的改动

上游：https://github.com/deepseek-ai/chat-demo （v0.1.1）
原则：只新增文件 + 接线，不改业务逻辑；将来同步上游新版本时按本文件回放。

| 文件 | 改动 |
| --- | --- |
| `src/index.html` | 标题改为 DeepSeek ChatBot；`viewport` 加 `viewport-fit=cover` |
| `src/i18n/zh.ts` / `en.ts` | `appName` 改为 DeepSeek ChatBot |
| `src/app/native.ts`（新增） | 导出 ZIP 的原生存盘桥：分片 base64 → `window.DeepSeekNative`；没有桥时回退到原来的 `<a download>` |
| `src/app/nativeBridge.ts`（新增） | 返回键（`window.__closeOverlay`）、弹层状态同步（`setOverlay`）、主题与背景色回传（`setTheme`）；收起动画期间也视为有弹层 |
| `src/components/chatInput/ChatActionButton.tsx` / `.module.css`（新增） | 输入框右侧单按钮：无内容=语音、有内容=发送、输出中=停止，录音与转写沿用原语音按钮的光圈、读秒和加载环 |
| `src/components/chatInput/ChatInput.tsx` | 语音按钮与发送/停止按钮合并为一个 `ChatActionButton`；原 `VoiceButton` 不再被引用（文件保留，方便对照上游） |
| `src/components/chatInput/ChatInput.module.css` / `.css.d.ts` | 移除已不用的 `.sendButton`、`.disabled` |
| `src/components/sider/usePushSider.ts`（新增） | 全屏横向右滑手势与推挤动画：把 0–1 进度写到 `--sider-progress` / `--sider-offset`，抽屉与主内容读同一个值 |
| `src/components/sider/mobileSiderState.ts` | 增加 `closing` / `dragging`：收起动画期间保持内容挂载，并让返回键先等动画结束 |
| `src/components/sider/Sider.tsx` / `Sider.module.css` / `.css.d.ts` | `MobileSider` 常驻 DOM、收起时停在屏外；新增随进度加深的压暗层，抽屉右缘阴影 |
| `src/app/App.tsx` / `App.module.css` | 把 frame ref 传给抽屉；移动端 `main` 用同一条 `--sider-offset` 位移，形成推挤联动 |
| `src/services/update.ts`（新增） | GitHub Release 检查：只用公开 `releases/latest`，12s 超时、每次打开应用检查一次、同一版本只提示一次、结果缓存本地；版本比较与链接白名单 |
| `src/services/settings.ts` | 新增 `autoCheckUpdates`（默认开启）、`autoCollapseThinking`（默认关闭）并持久化 |
| `src/components/base/Switch.tsx` / `Switch.module.css`（新增） | 44px 触控区开关；关于页与通用设置共用 |
| `src/components/messages/ReplyArea.tsx` | 开启自动折叠时，思考结束后收起思考区；历史消息中已结束的思考默认收起 |
| `src/components/settings/AboutSetting.tsx`（新增） | 关于页：应用图标 / 名称 / 版本、检查更新按钮、自动检查开关（复用 Switch） |
| `src/components/settings/SettingsDialog.tsx` / `settingsDialogState.ts` | 设置分「通用设置 / 数据管理 / 关于」三组；通用设置新增「思考内容自动折叠」开关 |
| `src/components/settings/Settings.module.css` / `.css.d.ts` | 关于页品牌区与状态行样式 |
| `src/components/base/icons.tsx` | 新增 `IconInfoOutline16`（关于分组图标） |
| `src/app/App.tsx` | 每次打开应用（含回到前台）自动检查更新，发现新版本用带链接的 toast 提示 |
| `src/i18n/zh.ts` / `en.ts` | 关于页、更新提示与思考折叠的中英文案 |
| `src/assets/app-icon.png`（新增） | 关于页图标，取自 Android 启动图标 |
| `rspack.config.ts` / `src/env.d.ts` | 支持导入 png 等图片资源（输出到 `static/media`） |
| `src/main.tsx` | 调一次 `installNativeBridge()` |
| `src/components/settings/SettingsDialog.tsx` | 导出改用 `saveBlob()`，用户取消保存不算失败 |
| `package.json` | `build` 脚本去掉 `rm -rf dist && NODE_ENV=production`：Windows 下 pnpm 用 cmd 跑脚本会报错，且 rspack CLI 对 `build` 已默认 production（`output.clean` 负责清理） |
| `src/services/tokenizer/bpe.ts`（新增） | byte-level BPE 计数：三段 Split(Isolated) + ByteLevel + merge rank 表；只统计 token 数，不加载 vocab |
| `src/services/tokenizer/index.ts`（新增） | 懒加载 merges / specials 资源，失败可重试，不阻断聊天 |
| `src/services/tokenizer/contextUsage.ts`（新增） | 复用 `getContextRounds` 重建当前分支上下文，按消息对象缓存；用最近一次 `usage.prompt` 校准模板与附件开销；窗口固定 1M |
| `src/components/chatInput/ContextUsageRing.tsx` / `.module.css`（新增） | 输入框功能行右侧的圆形占用环；桌面与移动端点击都打开详情浮层 |
| `src/components/chatInput/ChatInput.tsx` | 在 `.right` 中加入占用环（仅会话页） |
| `src/services/chat/store.ts` | 导出 `SYSTEM_PROMPT` 供统计复用，值不变 |
| `src/i18n/zh.ts` / `en.ts` | 占用环、详情与估算提示的中英文案 |
| `rspack.config.ts` / `src/env.d.ts` | `.txt` 走 `asset/resource`；声明 `*.txt` 模块 |
| `package.json` | 新增 `tokenizer:build` / `tokenizer:verify` 脚本 |
| `scripts/build-tokenizer-asset.mjs`（新增） | 从 `references/` 的 `tokenizer.json` 生成 merges 与 specials 运行时资源 |
| `scripts/verify-tokenizer.mjs` / `scripts/tokenizer-fixtures.json`（新增） | 用 Python `tokenizers` 的夹具校验计数实现 |
| `src/assets/deepseek-v4-merges.txt` / `deepseek-v4-specials.txt`（新增） | 运行时资源约 1.5 MB（gzip 约 0.7 MB）；原始 6.3 MB `tokenizer.json` 仍不进版本库 |
| `src/services/update.ts` | Release 解析补充 APK 的 size、sha256 digest 与 GitHub API 资产入口；受限网络优先走 API 入口 |
| `src/services/updateInstall.ts`（新增） | 应用内更新的 Zustand 状态：下载/校验/权限/安装阶段、进度与错误码 |
| `src/components/settings/AboutSetting.tsx` | 关于页的「下载并安装」按钮、进度条、取消/重试、错误提示与浏览器下载回退 |
| `src/components/settings/Settings.module.css` / `.css.d.ts` | 更新卡片、进度条、链接与错误状态样式 |
| `src/i18n/zh.ts` / `en.ts` | 应用内更新的下载、校验、权限、错误与回退文案 |
| `android/app/src/main/AndroidManifest.xml` | 新增 `REQUEST_INSTALL_PACKAGES` 与 `FileProvider` 声明 |
| `android/app/src/main/res/xml/file_paths.xml`（新增） | 只暴露 `cache/updates/` 给系统安装器 |
| `android/app/src/main/java/.../MainActivity.kt` | 桥接 `downloadUpdate` / `cancelUpdate`，转发进度事件，`onResume` 继续权限后的安装 |
| `android/app/src/main/java/.../UpdateInstaller.kt`（新增） | HTTPS 下载、字节数/SHA-256/包名/签名/versionCode 校验、未知来源权限与系统安装器 |
| `src/components/session/MobileHeader.tsx` | 顶栏改为「菜单 + 标题 + 常驻新建」：标题空着也占位，欢迎页 / 加载页 / 会话页都显示右侧新建按钮，沿用原来的聊天气泡加号图标 |
| `src/components/sider/Sider.tsx` | 移动端：顶部新建按钮改为会话搜索框、列表底部新增浮动「新建」胶囊（点击时清空搜索、新建并关闭抽屉）；桌面端保持原来的全宽新建按钮与列表 |
| `src/components/sider/SessionSearch.tsx` / `.module.css` / `.css.d.ts`（新增） | 侧边栏搜索框：放大镜、清除按钮、`type=search`；拼音组合期间不触发搜索，`compositionend` 后再查，Esc 清空 |
| `src/components/sider/SearchResultItem.tsx` / `.module.css` / `.css.d.ts`（新增） | 搜索结果行：标题 + 命中片段，关键词用 `<mark>` 高亮，点击打开会话 |
| `src/components/sider/useSessionSearch.ts`（新增） | 搜索状态：标题同步先出结果，正文索引异步补齐；120ms 防抖，索引失败退回标题匹配 |
| `src/services/chat/sessionSearch.ts`（新增） | 本地会话搜索：首次用游标逐条读 `sessions` 建正文索引（只取当前分支的用户正文、附件名与回复正文，跳过思考与模板），之后按 `updatedAt` 增量补齐；标题命中优先，最多展示 50 条 |
| `src/services/chat/db.ts` | 新增 `iterateSessions`：逐条遍历会话，避免一次把所有历史读进内存 |
| `src/services/chat/store.ts` | 导入历史替换全部会话后调用 `invalidateSessionSearch()`，避免沿用替换前的正文索引 |
| `src/components/sider/Sider.module.css` / `.css.d.ts` | 保留桌面端全宽新建按钮样式；移动端新增 148px 浮动胶囊（48px 高、20px 图标）与空结果提示，列表底部留出胶囊高度的滚动空间 |
| `src/app/viewport.ts` | 原生壳里跳过 `visualViewport` 跟随：容器已按输入法 inset 缩短 WebView，页面再缩一次会在键盘动画开始时先于容器收缩、露出一帧底色（搜索框聚焦闪烁） |
| `src/components/settings/AboutSetting.tsx` / `Settings.module.css` | 关于页更新卡片去掉「安装前校验签名与版本号…」提示；宽度改为 288px 并计入内边距（原来 320px 之外再加 28px，手机上几乎占满） |
| `src/i18n/zh.ts` / `en.ts` | 新增搜索文案与「新建」短文案；移除 `aboutInstallVerifyHint` |
| `src/components/chatInput/ChatInput.module.css` | 输入框底栏：开关高度 34→32、左右内边距 12→10、按钮间距 10→8，底栏左右留白 12→8（整体外移）；右侧功能组间距 4→2；空间不足时改为收起图标、保留「深度思考 / 智能搜索」文字，避免文字被整段隐藏 |
| `src/components/chatInput/ChatActionButton.module.css` | 发送 / 停止按钮去掉额外的 6px 左边距，和附件、上下文环靠得更紧 |
| `src/services/chat/types.ts` | `Session` / `SessionSummary` 增加可选的 `pinned`，摘要提取时一并带上 |
| `src/services/chat/db.ts` | 新增 `setSessionsPinned`：在同一事务里更新会话详情与摘要 |
| `src/services/chat/store.ts` | 新增 `setSessionsPinned` 动作（写盘、重排、同步缓存）；列表排序改为置顶优先 |
| `src/services/chat/sessionGroups.ts` | 新增「置顶」分组，置顶会话不再落进日期分组 |
| `src/services/chat/history/schema.ts` / `toArchive.ts` / `toLocal.ts` | ZIP 导入导出读写归档里已有的 `pinned` 字段，置顶状态跟历史一起迁移 |
| `src/components/sider/Sider.tsx` | 移动端侧边栏多选模式：列表右上角入口、选择头（计数 / 关闭）、底部置顶 / 删除操作、置顶与批量删除确认弹窗 |
| `src/components/sider/SessionItem.tsx` / `SessionItem.module.css` | 多选时整行变为勾选行（圆形勾选、无重命名 / 删除菜单） |
| `src/components/base/Modal.tsx` | 新增 `titleClassName`，供居中的确认弹窗使用 |
| `src/components/base/icons.tsx` | 新增多选图标 `IconMultiSelectOutline16` 与图钉 `IconPinOutline16` |
| `src/components/sider/Sider.module.css` / `.css.d.ts` | 多选入口、选择头、底部操作栏与确认弹窗的样式 |
| `src/i18n/zh.ts` / `en.ts` | 多选、已选计数、置顶、批量删除与失败提示文案 |

分词器校验：25 条固定夹具（中英日韩阿、emoji ZWJ、代码、数字、空白、控制字符、特殊标记）与
Python `tokenizers` **0 mismatch**；另跑 306 条随机 fuzz 也是 0 mismatch。计数实现见 `bpe.ts`。

同步上游的做法：

```bash
git clone https://github.com/deepseek-ai/chat-demo /tmp/upstream
cd /tmp/upstream && git checkout v0.1.1   # 或目标版本
diff -ru --exclude=node_modules . "E:/ALL_FOR_MY_PROJECTS/DeepSeek ChatBot/web" | less
```

按上表把改动重新应用到新版本，再跑 `scripts/build-apk.sh`。
