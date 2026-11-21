# 相对上游 chat-demo 0.1.3 的改动

上游：https://github.com/deepseek-ai/chat-demo （v0.1.3）
原则：只新增文件 + 接线，不改业务逻辑；将来同步上游新版本时按本文件回放。

| 文件 | 改动 |
| --- | --- |
| `src/index.html` | 标题改为 DeepSeek ChatBot；`viewport` 加 `viewport-fit=cover`，并设 `maximum-scale=1,user-scalable=no` 禁止双指缩放 |
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
| `src/services/chat/store.ts` | 导出 `SYSTEM_PROMPT` 供统计复用（身份声明功能接入后改由 `identity.ts` 按会话解析） |
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
| `src/components/session/MobileHeader.tsx` / `.module.css` | 会话页顶栏在「新建」左侧新增自动朗读开关（44px，喇叭 / 静音两态，`aria-pressed`）；右侧按钮组 4px 间距；欢迎页与加载页不显示 |
| `src/components/base/icons.tsx` | 新增 `IconVolumeOutline20` / `IconVolumeMuteOutline20` |
| `src/services/settings.ts` | 新增 `autoReadAloud`（默认关闭）并持久化 |
| `src/services/speech/readAloud.ts` | 拆出 `startReadAloud`；创建 AudioContext 后 `resume()` 兜底 |
| `src/services/speech/autoRead.ts`（新增） | 回复 `done` 时按开关 / 当前会话 / 前台 / 是否正在朗读判定，取 `buildReplyView` 的正文自动朗读，同一文本不重复 |
| `src/services/chat/store.ts` | `streamReply` 收尾时调用自动朗读判定 |
| `src/components/base/toastState.ts` / `Toast.tsx` / `Toast.module.css` | `showToast` 支持居中与自定义时长；新增居中胶囊样式（本次提示 1.6s） |
| `src/i18n/zh.ts` / `en.ts` | 自动朗读开关与提示的中英文案 |
| `src/components/sider/SessionItem.tsx` | 会话三点菜单新增「置顶 / 取消置顶」与「多选」；顺序为重命名、置顶、多选、删除，仅移动端传入这两个动作 |
| `src/components/sider/Sider.tsx` | 单条置顶写盘，失败时提示并保持原状；从会话菜单进入多选时预选当前会话 |
| `src/i18n/zh.ts` / `en.ts` | 会话菜单的置顶 / 取消置顶 / 多选文案 |
| `src/components/files/useFileView.ts`（0.1.3 新增） | 壳内不再用 `blob:` 的 `target=_blank` / `download`：图片交给应用内预览，PDF 走原生系统查看器，SVG / 其他文件走 SAF 保存；浏览器里保持上游行为。保留 Blob 以便原生分片读取 |
| `src/components/files/ImageViewer.tsx` / `.module.css` / `imageViewerState.ts`（新增） | 应用内图片预览：全屏遮罩、文件名、关闭按钮、点图片在适应屏幕 / 原始尺寸间切换、Esc 关闭；Blob 由预览自己创建并释放 object URL |
| `src/app/native.ts` | 保存桥增加 MIME；新增 `openBlob`（分片 → cache/attachments → FileProvider）；按块读取 Blob；兼容 Android WebView 从 IndexedDB 读回的 SAF 文件 `size=0`（`arrayBuffer` 仍有数据） |
| `src/app/nativeBridge.ts` | 图片预览计入「有弹层」，返回键先关预览再关设置 / 搜索 / 抽屉 |
| `src/app/App.tsx` | 挂载 `ImageViewer` |
| `src/services/chat/history/zipWriter.ts` | 导出前把 `size=0` 的原件 materialize 成正常 Blob，否则 ZIP 的写入字节校验会失败 |
| `src/i18n/zh.ts` / `en.ts` | 无查看器时回退保存的提示 `attachmentNoViewer` |
| `android/app/src/main/java/.../AttachmentOpener.kt`（新增） | PDF / 图片写入 `cache/attachments/<uuid>/<原名>`，经 FileProvider 交给系统查看器；24 小时清理、100MB 上限、失败返回 false 由页面回退到保存 |
| `android/app/src/main/java/.../MainActivity.kt` | `saveBegin` 接收 MIME（自定义 `CreateDocumentContract`）；新增 `openFileBegin/Chunk/End` 桥；退出时关闭未完成的附件流 |
| `android/app/src/main/res/xml/file_paths.xml` | 暴露 `cache/attachments/` 给系统查看器 |
| `src/components/base/icons.tsx` | 自动朗读开关改为 24 网格描边喇叭：开启为双声波，关闭为同形喇叭 + 叉号，与参考图的细线风格一致 |
| `src/components/base/icons.tsx` | 新增圆圈声波 `IconVoiceCircle20` 与圆圈键盘 `IconKeyboardCircle20`，用于语音输入与切回键盘 |
| `src/components/chatInput/ChatActionButton.tsx` | 空闲态语音入口换成圆圈声波图标；录音 / 转写态保留原光圈反馈 |
| `src/components/chatInput/useVoiceInput.ts` | 拆出 `start` / `finish`，按住说话按 pointerdown / pointerup 驱动；转写结果仍走原有回调 |
| `src/components/chatInput/ChatInput.tsx` | 新增按住说话模式：语音按钮切到「按住说话」行与键盘按钮；按住录音、上滑取消、松手转写并直接发送；转写中保持浮层 |
| `src/components/chatInput/VoiceOverlay.tsx` / `.module.css`（新增） | 录音浮层：底部蓝色（取消时红色）渐变、松手发送 / 上滑取消提示、实时频谱与转写加载态 |
| `src/components/chatInput/Spectrum.tsx` / `.module.css` | 新增 `overlay` 变体：白色柱体、左右淡出，用于录音浮层 |
| `src/components/chatInput/voiceOverlayState.ts`（新增） / `src/app/nativeBridge.ts` | 录音浮层计入弹层状态，返回键先取消录音 / 转写再处理下一页 |
| `src/components/base/icons.tsx` | 新增圆圈加号 `IconPlusCircle20` 与拍照 / 相册 / 文件图标，替换输入框的附件入口 |
| `src/components/chatInput/AttachmentPanel.tsx` / `.module.css`（新增） | 添加附件面板：最近照片缩略图横排 + 拍照 / 相册 / 文件三个按钮；缩略图过滤掉上传白名单外的格式 |
| `src/components/chatInput/attachmentPanelState.ts`（新增） / `src/app/nativeBridge.ts` | 附件面板计入弹层状态，返回键先收起面板 |
| `src/app/media.ts`（新增） | 相册缩略图加载、选中原图分片读取、系统相机拍照的 JS 桥 |
| `src/components/chatInput/ChatInput.tsx` / `ChatInput.module.css` | 附件按钮改为圆圈加号；面板用 `0fr → 1fr` 网格槽展开，输入框随之上滑；新增只选图片的隐藏 input；点输入框 / 发送 / 录音时收起面板 |
| `android/app/src/main/java/.../MediaBridge.kt`（新增） | MediaStore 最近照片查询与 160px 缩略图、按 token 分片读原图、相机结果读取 |
| `android/app/src/main/java/.../MainActivity.kt` / `AndroidManifest.xml` / `res/xml/file_paths.xml` | 相册权限申请（READ_MEDIA_IMAGES / READ_EXTERNAL_STORAGE）、`loadGallery` / `openMedia` / `readMediaChunk` / `takePhoto` 桥、`cache/camera` 拍照输出 |
| `android/app/src/main/java/.../MainActivity.kt` | `WebSettings.setSupportZoom(false)`，关闭 WebView 的双指缩放（`builtInZoomControls=false` 只隐藏控件，不阻止手势） |
| `src/app/App.tsx` | 发现新版本时的提示不再跳 Release 网页，点击整条提示直接打开「设置 → 关于」 |
| `src/components/base/Toast.tsx` / `.module.css` / `toastState.ts` / `src/i18n/index.ts` | 提示支持应用内动作：带 `onClick` 时整条提示可点、可键盘触发，动作完成后自动收起；文字链接保留原行为 |
| `src/components/settings/SettingsDialog.tsx` | 设置分组改为状态库驱动，设置已打开时从更新提示跳转也能切到「关于」 |
| `src/i18n/zh.ts` / `en.ts` | 输入框占位改为「发消息或按住说话」，新增按住说话、松手发送 / 取消、转写中、切换键盘、附件面板、相册权限与拍照失败文案 |
| `src/services/chat/types.ts` | `Session.compression` 与 `ContextCompression`：摘要、覆盖到的 assistant、累计轮数 / token；缺省表示完整上下文 |
| `src/services/chat/branches.ts` | 新增 `getCompressionCut` / `splitCompressedHistory`：按 `throughMessageId` 判断摘要是否在当前分支，并按覆盖点裁剪请求历史 |
| `src/services/chat/reply.ts` | 新增 `buildSystemPrompt`：把摘要放进 system 的 `<earlier_conversation_summary>` 段，不伪造消息轮次 |
| `src/services/chat/store.ts` | 五处请求入口按压缩切点裁剪历史；`setSessionCompression` / `getSessionSnapshot`；压缩不改 `updatedAt` |
| `src/services/chat/compression.ts`（新增） | 压缩规划（目标预算、至少保留一轮）、8 万 token 分块滚动摘要、进度 / 取消 / 撤销、自动压缩冷却与写入前路径校验 |
| `src/services/tokenizer/contextUsage.ts` | 跳过被覆盖轮次、统计摘要 token、导出 `countMessageTokens`；占用卡片新增 `summary` / `compression` |
| `src/services/settings.ts` | 新增 `autoCompress` / `compressThreshold` / `compressTarget`；百分数校验与「目标 < 阈值」收口 |
| `src/components/settings/settingsDialogState.ts` | 设置分组新增 `context` |
| `src/components/settings/SettingsDialog.tsx` / `Settings.module.css` / `.css.d.ts` | 新增「上下文与压缩」分组、百分比输入、交叉校验与窗口换算预览 |
| `src/components/chatInput/ContextUsageRing.tsx` / `.module.css` / `.css.d.ts` | 占用卡片新增压缩按钮 / 进度 / 取消 / 摘要展开 / 撤销；自动压缩触发；`maxHeight` 防溢出 |
| `src/components/messages/CompressionDivider.tsx` / `.module.css` / `.css.d.ts`（新增） | 消息列表的「已压缩 N 轮」分隔条与摘要展开 |
| `src/components/messages/MessageList.tsx` | 在覆盖点后的第一条消息前插入分隔条，保留原有滚动与版本切换逻辑 |
| `src/components/base/icons.tsx` | 新增 `IconContextOutline16`；身份声明接入后新增 `IconIdentityOutline16` |
| `src/services/identity.ts`（新增） | 身份声明方案：localStorage 读写、内置方案、增删改、默认方案、按 id 解析并拼成 `你是{姓名}。{设定}`；最多 20 套 |
| `src/services/chat/types.ts` | `Session.identityId`：当前会话使用的身份方案；缺省表示内置身份（旧会话） |
| `src/services/chat/store.ts` | 新会话写入默认身份；请求的 `system` 改为按当前会话解析；新增 `setSessionIdentity`（只改当前会话、不改变排序） |
| `src/services/tokenizer/contextUsage.ts` | 「系统与模板」按当前会话的身份声明计数 |
| `src/services/chat/compression.ts` | 压缩预算按当前会话的身份声明扣除 |
| `src/components/session/IdentitySwitcher.tsx` / `.module.css`（新增） | 顶栏身份切换器：姓名 + 箭头，菜单列出方案、当前项打勾、管理入口；移动端与桌面共用 |
| `src/components/session/identitySwitcherState.ts`（新增） | 切换器开合状态（带 owner），并登记到原生返回键的弹层白名单 |
| `src/components/session/MobileHeader.tsx` | 菜单按钮右侧插入切换器；加载页隐藏 |
| `src/components/session/SessionView.tsx` / `.module.css` | 移动端传入会话身份；桌面标题旁显示切换器，标题可收缩 |
| `src/components/session/Welcome.tsx` / `.module.css` | 桌面右上角显示切换器；移动端沿用顶栏 |
| `src/components/settings/IdentitySetting.tsx` / `.module.css`（新增） | 身份声明分组：方案列表、新建 / 编辑 / 删除、默认方案、字数校验与内置方案恢复 |
| `src/components/settings/SettingsDialog.tsx` / `settingsDialogState.ts` | 新增第 5 个分组「身份声明」 |
| `src/app/nativeBridge.ts` | 身份切换菜单打开时同步弹层状态，返回键先关闭菜单 |
| `src/components/chatInput/ContextUsageRing.tsx` | 身份方案改动后重新统计上下文占用 |
| `src/i18n/zh.ts` / `en.ts` | 身份声明、顶栏切换、校验与内置方案文案 |
| `src/i18n/zh.ts` / `en.ts` | 上下文与压缩设置、压缩状态 / 错误 / 分隔条文案 |
| `src/services/settings.ts` | 新增 `accentHue` / `wallpaperOverlay` / `wallpaperBlur` / `wallpaperKind`，外观设置持久化与范围收口 |
| `src/app/accent.ts`（新增） | 自定义主题色：按色相生成整套蓝色 ramp（明暗两份），按对比度自动选择主色上的黑 / 白文字，并单独收口 `brand-text` / `brand-primary-invert` 的页面底色对比度；默认不注入样式 |
| `src/services/wallpaper.ts`（新增） | 背景媒体：壳内走原生 SAF 桥，浏览器回退到独立 IndexedDB（不碰聊天主库）；启动恢复、移除、错误回落 |
| `src/app/Wallpaper.tsx` / `.module.css`（新增） | 背景层：图片 / 视频 cover、视频静音循环、切后台暂停、可调蒙层与模糊 |
| `src/app/App.tsx` / `App.module.css` | frame 内挂载背景层；有壁纸时 frame 透明，侧栏与主内容置于背景之上 |
| `src/app/global.css` | `--ds-*` 面板色：默认回落到原色，`wallpaper-active` 时切到 82%–90% 半透明面板 |
| `src/components/sider/Sider.module.css` | 侧边栏、分组标题、底部操作栏改用半透明侧栏底色 |
| `src/components/session/SessionView.module.css` | 会话页顶栏与输入框渐变底改用半透明面板色 |
| `src/components/session/MobileHeader.module.css` | 移动端顶栏使用半透明面板色 |
| `src/components/chatInput/ChatInput.module.css` | 输入框底色改用半透明输入框色 |
| `src/components/sider/Sider.module.css` / `messages/ReplyArea.module.css` / `chatInput/ContextUsageRing.module.css` / `messages/ReadingBars.module.css` | 画在页面底色上的主色文字 / 图标 / 环 / 波形改用 `--dsw-alias-brand-text`，避免浅色主题色下对比度不足 |
| `src/components/base/Segmented.tsx` / `.module.css`（新增） | 分段控制器：等分排列、选中浮起、方向键 / Home / End 切换 |
| `src/components/base/Slider.tsx` / `.module.css`（新增） | 设置滑杆：数值、说明、彩虹色相轨道、实时进度与触控尺寸 |
| `src/components/settings/AppearanceSetting.tsx` / `.module.css`（新增） | 「外观」分组：图片 / 视频切换、预览、移除 / 选择、蒙层、模糊、色相主题色与恢复默认 |
| `src/components/settings/SettingsDialog.tsx` / `settingsDialogState.ts` | 新增第 2 个分组「外观」；「主题」改为「模式」并使用分段控制器 |
| `src/components/settings/Settings.module.css` / `.css.d.ts` | 模式分段控制器的间距；移除旧的三选块样式 |
| `src/components/base/icons.tsx` | 新增调色盘图标 `IconAppearanceOutline16` |
| `src/i18n/zh.ts` / `en.ts` | 外观、背景、蒙层、模糊、主题色、模式与错误提示文案；移除旧主题标签 |
| `android/app/src/main/java/.../BackgroundStore.kt`（新增） | 背景媒体复制到 `filesDir/background/`、两类各保留一份、按 MIME 限制体积、`/userbg/` 同源响应与 Range（206） |
| `android/app/src/main/java/.../MainActivity.kt` | 新增 `pickBackground` / `backgroundInfo` / `clearBackground` 桥；`shouldInterceptRequest` 先处理 `/userbg/` |

| `src/services/endpoints.ts`（新增） | API 接入方案：多方案 localStorage 存储、旧单 Key 迁移、DeepSeek/Anthropic/OpenAI 协议与能力推断、端点地址规范化、模型窗口解析 |
| `src/services/api/protocols.ts`（新增） | 三协议请求适配：DeepSeek 保留 safety_check/title/服务端搜索；Anthropic 去掉 DeepSeek 扩展并按 budget_tokens 发 thinking；OpenAI 兼容把 chat/completions 的 SSE 合成为统一事件；`listModels` 统一解析 `data[]` 元数据 |
| `src/services/useCapabilities.ts`（新增） | 按会话绑定的方案/模型返回 `{ profile, model, capabilities }`，供输入框、附件、语音、朗读门控 |
| `src/services/api/client.ts` | 抽出 `streamMessageAt` / `uploadFileAt`，消息请求可带自定义端点与额外鉴权头；默认 DeepSeek 入口保留 |
| `src/services/chat/types.ts` | `Session.endpointId` / `modelId` 会话级绑定；`AssistantMessage.model` 改为任意模型 ID 字符串 |
| `src/services/chat/store.ts` | 新会话写入当前方案与模型；请求按会话方案构造；能力不足时静默去掉 thinking/search/title；非 DeepSeek 协议用首条提问生成本地标题；附件上传按会话方案与 Files 地址 |
| `src/services/chat/reply.ts` | `toRequestMessages` 增加 `{ protocol, filesCapable }`：非 DeepSeek 剥离 latest_reminder、DeepSeek 工具块与文件块，OpenAI 不传 thinking 块 |
| `src/services/chat/compression.ts` | 摘要请求按会话方案/模型发；窗口改用 `usage.window`；不再固定 DeepSeek 模型与 safety_check |
| `src/services/tokenizer/contextUsage.ts` | 占用环分母改为会话模型窗口；DeepSeek 默认 1,048,576 |
| `src/services/attachments.ts` / `src/services/chat/drafts.ts` | 上传可指定 Files API 地址，支持自定义 DeepSeek 协议端点 |
| `src/components/settings/EndpointSetting.tsx` / `.module.css` / `.css.d.ts`（新增） | 数据管理里的「接入方案」：方案列表切换、新建/编辑/删除、获取模型、模型下拉与手动 ID、上下文窗口 |
| `src/components/settings/SettingsDialog.tsx` | 数据管理改用 `EndpointSetting`；压缩百分比预览按当前会话模型窗口换算 |
| `src/components/settings/settingsDialogState.ts` | `ensureProfileKey` 按会话方案校验 Key；`ensureEndpoint` 用于新会话 |
| `src/components/chatInput/ChatInput.tsx` | 深度思考/智能搜索按能力置灰；附件与语音按能力隐藏/提示；上传与转写使用会话方案的 Key；v4-pro 等无视觉模型拒绝图片 |
| `src/components/chatInput/AttachmentPanel.tsx` | `allowImages`：无视觉模型只保留「文件」入口 |
| `src/components/chatInput/useVoiceInput.ts` | 转写 Key 改为调用方传入，按会话方案取值 |
| `src/services/speech/readAloud.ts` / `autoRead.ts` / `src/components/messages/ReadAloudButton.tsx` | 手动朗读与自动朗读按会话方案的 Key 调用 TTS；非 DeepSeek 官方端点隐藏朗读入口 |
| `src/components/chatInput/ContextUsageRing.tsx` | 占用卡片显示当前接入方案与模型；窗口取 `usage.window` |
| `src/components/session/SessionView.tsx` / `src/components/messages/UserMessage.tsx` | 自动朗读按语音能力显示；编辑提问按会话方案校验 Key |
| `src/components/session/Welcome.tsx` / `Welcome.module.css`（新增 chip） | 欢迎页显示当前接入方案与模型，点击进入「设置 → 数据管理」 |
| `src/app/App.tsx` | 首启改为 `ensureEndpoint()` |
| `src/i18n/zh.ts` / `en.ts` | 接入方案、模型、协议、能力降级与错误文案 |

分词器校验：25 条固定夹具（中英日韩阿、emoji ZWJ、代码、数字、空白、控制字符、特殊标记）与
Python `tokenizers` **0 mismatch**；另跑 306 条随机 fuzz 也是 0 mismatch。计数实现见 `bpe.ts`。

**接入方案的行为约定**：方案配置是设备级设置，不随 ZIP 导出 / 导入迁移；会话创建时记录 `endpointId` 与 `modelId`，
之后切换当前方案不会改变旧会话的请求目标；方案被删除时旧会话回落到当前方案。非 DeepSeek 协议第一版只支持纯文本 + 思考，
搜索、附件、语音、服务端标题按能力降级（附件入口隐藏，语音与搜索开关置灰）。



同步上游的做法：

```bash
git clone https://github.com/deepseek-ai/chat-demo /tmp/upstream
cd /tmp/upstream && git checkout v0.1.3   # 或目标版本
diff -ru --exclude=node_modules . "E:/ALL_FOR_MY_PROJECTS/DeepSeek ChatBot/web" | less
```

按上表把改动重新应用到新版本，再跑 `scripts/build-apk.sh`。
