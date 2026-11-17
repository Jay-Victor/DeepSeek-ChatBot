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

分词器校验：25 条固定夹具（中英日韩阿、emoji ZWJ、代码、数字、空白、控制字符、特殊标记）与
Python `tokenizers` **0 mismatch**；另跑 306 条随机 fuzz 也是 0 mismatch。计数实现见 `bpe.ts`。

同步上游的做法：

```bash
git clone https://github.com/deepseek-ai/chat-demo /tmp/upstream
cd /tmp/upstream && git checkout v0.1.1   # 或目标版本
diff -ru --exclude=node_modules . "E:/ALL_FOR_MY_PROJECTS/DeepSeek ChatBot/web" | less
```

按上表把改动重新应用到新版本，再跑 `scripts/build-apk.sh`。
