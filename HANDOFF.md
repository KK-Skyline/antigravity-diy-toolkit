# 工程交接与架构备忘（HANDOFF）

> 当前已验证基线：**Antigravity 2.36.0**（更新于 2026-11-28）。面向用户的安装、恢复与排障步骤统一见 [README.md](README.md)，版本升级诊断与维护规程见 [AGENTS.md](AGENTS.md) 与 [docs/SELF_ITERATION_RUNBOOK.md](docs/SELF_ITERATION_RUNBOOK.md)。本文档只保留接手开发必须知道的现役架构与踩坑红线。

---

## 1. 核心模块地图

| 路径 | 职责 |
|---|---|
| `localization_engine.js` | CLI 安装入口：解析参数、获取事务锁、调用插件编排并写回 `app.asar`（默认 `noKill = true`，运行中重装需传 `--close-app`） |
| `asar_transaction.mjs` | 安装事务与安全护栏：单实例锁、基线来源确认（`--confirm-unverified-baseline`）、单遍 `inspectArchive` SHA-256 校验、崩溃恢复与外置基线仓库 |
| `core/asar_fast_patch.mjs` | 内存增量 ASAR 引擎：仅解包 `dist/` 并在内存中重写二进制头部与分块 `integrity.blocks`（单次打包约 2s；设 `AG_DISABLE_FAST_ASAR=1` 可回退全量路径） |
| `core/host_env.js` / `plugin_loader.js` / `injector.js` | 跨平台安装目录探测、插件清单与配置 Schema 校验、按 `layerOrder` 注入与私有 `__agBus` 错误隔离 |
| `plugins/i18n-zh` | 简繁 UI 翻译运行时（`dicts/` 与 `dicts_tw/` 100% 键对齐）及主进程菜单、托盘、更新弹窗补丁 |
| `plugins/devtools` | 放开 `dist/debugConsole.js` 门控，并在 `dist/keybindings.js` 兼容 `BaseWindow` 的 `F12` / `Ctrl+Shift+I` |
| `plugins/wallpaper-engine` | 读取本地 Steam 创意工坊壁纸（视频直放、场景合成或提取嵌入 MP4、低清缩略图拦截回退 `last_good_wallpaper.json`），单源去重注入壁纸数据并挂载 `agWallpaperVideo.js` |
| `plugins/theme-acrylic` / `theme-acrylic.css` | 失重亚克力主题：穿透 2.34+–2.36+ Shell/Sheet（`body[data-agy-theme]`、`.agy-shell`、`.agy-inset-shell`、`.surface-composer-card`），并在内置浏览器三层视口激活（`body[data-has-browser-hole="true"]`）时自动让出透明挖洞 |
| `plugins/theme-obsidian-blue` | 黑曜石深蓝黑主题，可单独启用或与壁纸叠加 |
| `plugins/fx-rain` | 场景壁纸三层景深实时雨滴 Canvas（支持 `auto` / `always` / `off`） |
| `plugins/wallpaper-hub-launcher` | 顶栏「窗口」（`Window` / `視窗`）右侧同高「壁纸 / 桌布 / Wallpaper」胶囊按钮 + `File` 菜单项 + `Ctrl/Cmd+Alt+W`，按需通过独立进程拉起并探测 `127.0.0.1:3210` |
| `wallpaper_hub_server.js` | 本地选壁纸服务（`127.0.0.1:3210`）：严格校验 Host/Origin/CSP，通过 `--hub-config` 委托安装器在锁内写入 `wallpaper_config.json` |
| `prepare_hd_wallpaper.py` / `extract_scene_pkg.py` | 场景壁纸 `scene.pkg` LZ4 解包、`preview_hd.jpg` 多图层合成、嵌入 `.tex` MP4 提取与跳过黑场的视频封面抽帧 |
| `harness_compat.json` / `tools/check_harness_update.mjs` / `tools/audit_harness_compat.mjs` | 14 项主进程钩子锚点清单、只读版本更新检测与三模式沙箱（`default-i18n` / `wallpaper-full` / `skin-only`）兼容审计 |
| `tools/agcdp.js` / `tools/check-wallpaper.js` | CDP 调试工具（2.34+ 需带 `--remote-debugging-port=9222` 启动客户端）与壳层透明/壁纸状态自检脚本 |

### 注入后 `app.asar` 内的实际改动范围
- `dist/preload.js`：末尾包裹 `SIGNATURE_START .. SIGNATURE_END` 的单 IIFE（样式层 + 各启用插件的渲染层运行时）
- `dist/agWallpaperVideo.js`（`wallpaper-engine` 启用时新增）：主进程 `127.0.0.1` 随机端口 `.mp4/.webm` Range 视频流服务
- `dist/agWallpaperHubLauncher.js`（`wallpaper-hub-launcher` 启用时新增）：主进程 `/api/config` 存活探测、后台拉起与导航白名单守卫
- `dist/main.js`：末尾按需加载上述两个主进程模块
- `dist/menu.js` / `dist/tray.js` / `dist/updater.js` / `dist/debugConsole.js` / `dist/keybindings.js`：按启用插件打补丁（`--only-skin --disable wallpaper-hub-launcher` 时 `menu.js`、`tray.js`、`updater.js` 保持字节零改动）
- 外置基线备份：`%LOCALAPPDATA%\antigravity2-cn\baselines\<安装路径哈希前16位>\`（严禁放进客户端 `resources\` 目录）

---

## 2. 渲染层叠与关键机制

```text
body
├── (body::before)              静态壁纸 / 视频首帧封面（受 --ag-wp-bright 等滤镜控制）
├── video#ag-wallpaper-video    原生 GPU 解码视频壁纸（仅视频壁纸挂载）
├── canvas#ag-rain-canvas       实时雨滴粒子层（仅检测到雨效或 mode=always 时挂载）
├── (body::after)               边缘暗角遮罩（深度跟随 --ag-scrim）
├── #root                       React 主界面（z-index: 1，亚克力毛玻璃作用层）
└── button#ag-hub-launcher-btn  fixed 顶栏胶囊入口（挂在 body 外层，几何锚定「窗口」右侧 +8px）
```

- **自动取色与亮度平滑**：静态壁纸采样一次，视频每 2.5s 采样一帧；强调色仅在前 6 次采样内锁定以防界面色跳变，亮度经 EMA 平滑与 CSS `@property` 过渡（`wallpaper_config.json` 中可设 `"accent": "#7dd4cb"` 固定强调色）。
- **2.36+ 无 `testid` 顶栏锚定**：`plugins/wallpaper-hub-launcher/renderer.js` 组合选择器、`elementsFromPoint`（含 Open Shadow DOM 穿透）与有界顶栏剪枝遍历（`r.top > 48 || (r.top >= 26 && r.height > 60)` 一步剪除侧栏和聊天区），配合未锁定时 `500ms`、锁定后 `2500ms` 纯布尔健康检查应对冷启动延迟挂载。

---

## 3. 常用开发与调试命令

```bash
# 只读检测新版本与三模式兼容审计（绝不杀进程或改写实机 app.asar）
npm run check:update
npm run audit:harness

# 全套本地回归验证（运行 test:security 前先确认 127.0.0.1:3210 未被后台 Hub 占用）
npm run test:dicts
npm run test:plugin
npm run test:hub-launcher
npm run test:fast-asar
npm run test:maintenance
npm run test:adapt
npm run test:asar
npm run test:security

# CDP 实时检查（需客户端带 --remote-debugging-port=9222 启动）
node tools/agcdp.js eval tools/check-wallpaper.js
node tools/agcdp.js logs "Antigravity|Wallpaper Hub|error"
node tools/agcdp.js shot now.png
```

---

## 4. 踩坑红线（改动前必读）

1. **Preload 沙箱限制**：渲染层 `preload.js` 只能 `require('electron')`，不可直接用 `fs` / `http` / `child_process`；任何本地文件、端口探测与子进程拉起必须放在主进程模块并通过无参或白名单 IPC 调用。
2. **亚克力祖先禁区**：毛玻璃元素的祖先节点不能带 `mask`、`filter`、`opacity < 1` 或 `clip-path`，否则会变成 Chromium backdrop root 导致 `backdrop-filter` 失效透字（如分屏失焦 `opacity-75` 已在 CSS 覆写）。
3. **禁止用单次初始化布尔锁死 DOM 挂载**：Antigravity 启动阶段可能发生端口切换重载或路由重绘，挂载节点必须检查 `isConnected`。
4. **禁止对 `document.body` 开启高频全子树布局读取**：流式对话每帧都会触发深层 DOM 变更；`renderer.js` 对 `body` 必须保持 `{ childList: true, subtree: false }`，仅对锁定的顶栏容器做窄域观察与 `requestAnimationFrame` 合帧，且兼容高分屏 `-6px` 以内的亚像素负 `top`。
5. **后台节能逻辑不可删**：窗口最小化或隐藏时 Chromium 会暂停静音视频与动画，保留可见性恢复续播与失焦暂停逻辑。
6. **壁纸画质与多层合成**：视频壁纸一律走原生 `<video>`，严禁转 GIF；场景壁纸须按 `scene.json` 的 `origin / size / scale`（Y 轴向上）合成或提取嵌入视频，只剩低清缩略图（`preview.jpg`/`gif`）时必须拦截并回退 `last_good_wallpaper.json`；空白图检测按像素方差而非平均亮度判定，避免误伤暗色壁纸。
7. **Windows 进程树误杀防护**：安装器关闭客户端会执行 `taskkill /f /im Antigravity.exe /t`；从客户端内部拉起需要跨重启存活的后台服务（如 `start-hub.js`）或外部自动重装脚本时，必须脱离客户端进程树，否则会被 `/t` 一并杀死。
8. **严禁向客户端 `resources\` 目录写入备份文件夹**：NSIS 官方升级程序移动旧目录时遇到超长路径（>259 字符，如 `.unpacked` 备份）会报“无法关闭 Antigravity”假错；基线备份必须存放在 `%LOCALAPPDATA%\antigravity2-cn\baselines\`。
9. **原生窗口控制按钮不是 DOM**：右上角最小化/最大化/关闭色块由 Electron `titleBarOverlay`（或 `2.35+` Insiders 自定义窗口控件开关）控制，需走 `window:set-title-bar-overlay` IPC 拦截而非纯 CSS。
10. **勿用宽泛 `[class*="backdrop"]` 选择器**：会误伤宿主自带的 `backdrop-blur-*` 组件。

---

## 5. 可选后续演进（尚未排期）

- 花哨浅亮壁纸下，输入框占位符与顶栏菜单文字（「工作区 视图 窗口」）对比度可进一步细分调优。
- 场景壁纸粒子目前仅重绘了雨滴（`fx-rain`），后续可按需扩展樱花、光点或雾气层。
