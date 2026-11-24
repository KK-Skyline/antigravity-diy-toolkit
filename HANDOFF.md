# 交接包：Antigravity「失重亚克力」主题 + 壁纸引擎

> 最后更新：2026-11-24（适配 **Antigravity 2.34.0**，分支 `fix/adapt-antigravity-2.34`；当前安装与恢复流程见 [README.md](README.md)，执行前重新核对客户端、Hub、基线与用户授权）
> 目的：让下一个会话（或下一个 AI / 你自己）不用翻旧对话，就能接着干。
> 只写**最终确认正确**的结论；调试过程中被推翻的判断一律不写。

### 🆕 2026-11-24 Antigravity 2.34.0 适配要点（`fix/adapt-antigravity-2.34`）
- **Shell / Sheet 透明穿透**：2.34.0 引入 `body[data-agy-theme]`、`.agy-shell`、`.agy-inset-shell`（`--shell-canvas: var(--shell)`）、`.agy-sheet[data-sheet-inset]`（`[data-main-content-body]` / `[data-side-panel-body]`）与 `.surface-composer > .surface-composer-card`（显式关闭 `backdrop-filter`）。已在 [`theme-acrylic.css`](theme-acrylic.css) 与 `--dark-blue` 中完整覆写，并在内置浏览器挖洞（`body[data-has-browser-hole="true"]`）激活时自动淡出底层壁纸，避免遮挡三层 WCV 浏览器画面。
- **主进程注入修复**：
  - `dist/debugConsole.js`：`isDebugConsoleEnabled()` 统一放开 DevTools；`dist/keybindings.js` 改用 `getHubWebContents(win) ?? win.webContents` 兼容 `BaseWindow`；
  - `dist/tray.js`：正则适配 `createTray(actions, onClick)`，新增 `insertTrayMenuItem` 动态 WSL 项翻译，双击唤起兼容 `BaseWindow`；
  - `dist/menu.js`：新增 WSL 菜单译文，并修复 `addItemToSubmenu(menu, 'File', ...)` 在菜单汉化后找不到“文件”菜单的问题；
  - `dist/loadingOverlay.js`：2.34.0 为纯 SVG 图标加载页，无文本节点时自动跳过。
- **词典与调试工具**：简繁双语增补 114 条 2.34.0 新增高频界面词条（自动化、WSL/远程、扩展包、钩子、底部终端、内置浏览器等）并通过 `tools/compare_dicts.js` 校验；`tools/agcdp.js` 兼容 `DevToolsActivePort` 及 2.34+ `--remote-debugging-port=9222` 提示；`tools/check-wallpaper.js` 增加 `.agy-shell` / `.agy-inset-shell` / `.surface-composer-card` 透明诊断。

---

## 1. 现状一览

| 项目 | 状态 |
|---|---|
| 失重亚克力主题（悬浮侧栏岛、亚克力输入框、吸顶消息、状态色） | ✅ 已安装，已在真实界面验证 |
| 壁纸自动取色（强调色跟壁纸变） | ✅ 已安装 |
| 亮度自适应（亮色壁纸自动加深玻璃 / 遮罩） | ✅ 已安装 |
| 原生窗口按钮区（最小化/最大化/关闭）透明 | ✅ 已安装 |
| 视频壁纸：直接播放原视频（原分辨率、完整时长、原生帧率、GPU 解码） | ✅ 已安装，已验证 |
| 场景壁纸：按 `scene.json` 合成背景层 + 人物层 | ✅ 已安装，已验证（莉可丽丝） |
| 场景下雨特效：画布重绘三层景深雨滴 | ✅ 已安装，已验证 |
| 质量关卡：只剩低清缩略图的壁纸拒绝使用，回退上一张正常壁纸 | ✅ 已安装，已验证（2026-09-27 拒绝了未下载的 Lady Dimitrescu，回退到《莉可丽丝》+ 雨） |

| 场景壁纸的主画面是**嵌入视频**（`.tex` 里装着 MP4）：提取成 `scene_video.mp4` 按视频播放 | ✅ 已安装，已验证（2026-10-05，星野 4K 60 帧） |
| 视频壁纸封面：从约 1 秒处开始、跳过黑场截取 | ✅（2026-10-05，修好了电锯人的纯黑封面） |
| 空白图检测：合成结果只看"变化幅度"，纯色才算空白 | ✅（Codex 原作，2026-10-05 改为不按亮度判断，避免误伤暗色壁纸） |
| 选择库把安装器的警告（如"本次不使用它"）显示到网页 | ✅ |
| 官方原版备份放在安装目录**外面**（`%LOCALAPPDATA%\antigravity2-cn\baselines\`） | ✅（官方更新不会再卡"无法关闭"） |

**当前没有待办的安装。** 如果想用 Lady Dimitrescu，先在 Wallpaper Engine / Steam 里让它的视频下载完整，再从选择库里重新选。

**合并安全加固后的变化（2026-10-05）：**
- 安装走 `asar_transaction.mjs`：有安装锁、来源确认、可恢复的事务。**第一次**运行新安装器时需要确认"未验证来源的官方备份"（`--confirm-unverified-baseline`）。
- 选择库勾选"自动重启"时传 `--close-app`，由安装器**先关闭 → 再安装 → 再打开**；选择库自己不再杀进程（Codex 那版"运行中改写 asar 再重启"的做法在合并时舍弃了）。
- 选择库把新配置通过 `--hub-config` 交给安装器，在锁内写入 `wallpaper_config.json`。

---

## 2. 文件地图

| 文件 | 作用 |
|---|---|
| `theme-acrylic.css` | **主题本体**。所有设计 Token 和样式都在这里；调颜色、圆角、透明度只改这个文件 |
| `localization_engine.js` | 安装器。`--wallpaper` 模式下：选壁纸 → 生成注入代码 → 改 `app.asar` → 打包 |
| `wallpaper_engine_reader.js` | 读 Wallpaper Engine 的壁纸目录，判断类型（视频 / 场景 / 图片），挑选素材 |
| `prepare_hd_wallpaper.py` | 预处理：场景壁纸合成 `preview_hd.jpg` 或提取嵌入视频 `scene_video.mp4`；视频壁纸只补一张有内容的封面（不再转动图） |
| `asar_transaction.mjs` | 安全加固的安装事务：锁、来源确认、备份仓库、回滚 / 恢复。测试：`asar_transaction_regression.mjs` |
| `security_regression.js` | 壁纸选择库的安全测试（需要 3210 端口空闲） |
| `wallpaper_config.json` | 当前选中的壁纸（`workshopId`）。可选字段 `"accent": "#7dd4cb"` 固定强调色 |
| `last_good_wallpaper.json` | 上一张正常壁纸的记录，质量关卡回退用（安装成功时自动更新） |
| `wallpaper_hub_server.js` | 你的壁纸选择库（localhost:3210）。选壁纸时会改 config 并运行安装器 |
| `design/acrylic_preview.html` | 设计预览稿（可调参数），用 `python -m http.server` 打开才能取色 |
| `tools/agcdp.js` | 调试工具：读 DOM、截图、看日志、正常关闭 Antigravity |
| `tools/check-wallpaper.js` | 一键查看当前壁纸 / 视频 / 雨 / 自适应变量的状态 |
| 历史安装器副本 | 原文提及的 before-acrylic 文件已不在当前工作树。恢复前核对实际基线和版本。 |

### 安装后，Antigravity 里被改动的地方（`app.asar` 内）
- `dist/preload.js` 末尾：汉化 + 主题 + 壁纸运行时代码
- `dist/agWallpaperVideo.js`（新文件）：主进程里的本机视频服务
- `dist/main.js` 末尾：一行 `require('./agWallpaperVideo')`
- 官方原包备份：`%LOCALAPPDATA%\antigravity2-cn\baselines\<安装路径哈希前16位>\`（安装目录里**不能**放备份，见第 5 节第 11 条）

---

## 3. 运行时架构

```
body
├── (body::before)        L0 静态壁纸 / 视频封面，filter 亮度受 --ag-wp-bright 控制
├── video#ag-wallpaper-video   视频壁纸（只有视频类型才有）
├── canvas#ag-rain-canvas      下雨特效（只有检测到雨才有）
├── (body::after)         顶部 / 底部 / 左侧遮罩，深度跟随 --ag-scrim
└── #root                 React 界面（z-index 1），亚克力都在这一层
```

- **视频播放链路**：preload 通过 IPC `antigravity:wallpaper-video-url` 向主进程要地址 → 主进程 `agWallpaperVideo.js` 在 `127.0.0.1` 随机端口提供该文件（只接受 `.mp4/.webm`，支持 Range + CORS）→ `<video>` 播放。
- **取色 + 亮度自适应**：图片壁纸分析一次；视频每 2.5 秒采样一帧。强调色只在前 6 次采样里定，之后不变（避免界面颜色乱跳）。亮度用 EMA 平滑 + CSS `@property` 过渡。
- **窗口按钮区**：preload 拦截 `window:set-title-bar-overlay`，统一改成透明。

---

## 4. 常用操作

```bash
# 安装 / 重新安装（必须先关闭 Antigravity）
cd D:\antigravity2-cn
node tools/agcdp.js close
node localization_engine.js --wallpaper

# 查看当前状态（Antigravity 2.34+ 需带 --remote-debugging-port=9222 启动以开启 CDP）
node tools/agcdp.js eval tools/check-wallpaper.js
node tools/agcdp.js logs "Antigravity|壁纸|error"
node tools/agcdp.js shot now.png

# 单独预处理某张场景壁纸
python prepare_hd_wallpaper.py <创意工坊ID>
```

双击 `双击换肤-联动壁纸引擎背景.bat` 等价于运行安装命令。

---

## 5. 踩过的坑（全部写成规则）

1. **preload 有 Electron 沙箱。** 虽然 Antigravity 带 `--no-sandbox` 启动，preload 里依然只能 `require('electron')`，不能用 `http` / `fs`。需要 Node 能力的事放进主进程，走 IPC。
2. **亚克力元素的祖先不能有 `mask` / `filter` / `opacity<1` / `clip-path`。** 否则成为 Chromium 的 backdrop root，`backdrop-filter` 失效（表现为透字）。Antigravity 输入区外层有 `group-data-[pane-unfocused]/pane:opacity-75`，已在 CSS 里覆盖。
3. **Antigravity 启动时会重新加载一次页面**（日志 "Port changed! Reloading"）。写在第一个页面上的东西会丢，不要用"只执行一次"的标记保护初始化逻辑；DOM 元素要检查 `isConnected`。
4. **窗口在后台时 Chromium 会暂停静音视频和 `requestAnimationFrame`。** 视频已加"恢复可见时续播"；测试雨或视频时，Antigravity 窗口要在前台，否则会看到"没在动"。
5. **视频壁纸不要转成动图。** 动图只能 CPU 解码，还会被截断、放大出颗粒。
6. **场景壁纸是多图层的。** 不能"挑像素最多的材质"，更不能放大创意工坊的 `preview.gif`（通常只有 160~250px）。已改为按 `scene.json` 的 `origin / size / scale`（y 轴向上）合成。`preview_hd.meta.json` 的 `version` 控制是否需要重新生成。
7. **"视频壁纸又糊了"先查视频文件在不在。** 创意工坊可能只下载了预览图。用 `check-wallpaper.js` 看 `video` 是否为 `null`、`staticWallpaper` 是不是 `image/gif`。
8. **不要在 Agent 工作时重启 / 重装。** 选择库换壁纸会 `taskkill /F`（你自己会先确认，这点不用改）。自动操作前先看 `language_server.log` 最近有没有真实活动。
9. **原生窗口按钮区不是 DOM**，是 Electron 的 `titleBarOverlay`，CSS 改不到。
11. **不要往安装目录（`resources\`）里放额外的文件夹。** 官方更新会先运行旧版卸载程序，把所有文件挪到 `%TEMP%\nsiXXXX.tmp\old-install`。只要有路径超过 259 个字符，就会失败，并弹出误导性的"Antigravity 无法关闭，请手动关闭"，即使根本没在运行。2026-10-05 就是被 `fix/h03-h05-security` 分支生成的 `app.asar.baseline-<64位哈希>.bak.unpacked` 卡住的（已挪到 `%LOCALAPPDATA%\antigravity-baseline-backup`）。**已修复并合入 `main`（2026-10-05，提交 `b1d5a6e`）**：备份移到 `%LOCALAPPDATA%\antigravity2-cn\baselines\<安装路径哈希前16位>\`，旧位置的备份会被自动迁移；测试可用环境变量 `AG_BASELINE_STORE` 指定仓库。回归测试里有断言保证安装目录里没有任何 baseline 文件。
12. **官方每次更新都会覆盖注入**，更新后重新运行一次安装即可。2.19.1 已验证：主题依赖的界面元素全部还在。

10. **旧主题的 `[class*="backdrop"]` 选择器会误伤** Antigravity 自带的 `backdrop-blur-*` 元素，已删除，不要再加回来。

---

## 6. 还可以做的事（未开始）

- 输入框占位文字、左上角"文件 视图 窗口"在花哨壁纸上偏淡，可以再加强一点对比度
- 雨滴目前没有地面水花；需要的话可以加
- 场景壁纸的其他粒子（烟雾、光点、樱花等）目前只识别了"雨"
- 如果以后经常做这种交接，可以把本文档做成一个"交接包" skill
