# Antigravity 汉化与换肤工具

> 许可状态：上游代码及素材的再发布授权仍待核实；请勿仅凭仓库公开可见或历史 MIT 徽章推定可自由再分发。
>
> 使用边界：本工具会修改 Google Antigravity 的 `app.asar`。Google 通用条款禁止修改其软件；私有仓库不改变该条款。参见 [Google Antigravity 附加条款](https://antigravity.google/terms)及其引用的 [Google 通用条款](https://policies.google.com/terms)。

[繁體中文版說明 (README_TW.md)](README_TW.md)

---

## 这是什么

给 **Google Antigravity 2.0+（当前已实测适配至 2.35.0）** 用的中文汉化与换肤工具。通过向 `app.asar` 注入脚本与样式，实现简繁汉化、主题换肤和 Wallpaper Engine 壁纸背景，支持只换肤不汉化。

- **插件化结构**：汉化（`i18n-zh`）、DevTools（`devtools`）、蓝黑主题（`theme-obsidian-blue`）、Wallpaper Engine 壁纸（`wallpaper-engine`）、亚克力透明层（`theme-acrylic`）、雨滴画布（`fx-rain`）全部拆为 `plugins/*` 独立插件，可按需开关，也支持 `--only-skin` / `--no-i18n` 纯换肤模式。
- **Wallpaper Engine 背景与本地选壁纸网页**：自动读取本地 Steam 创意工坊订阅的壁纸库（支持视频壁纸直放、场景壁纸提取高清图与雨滴粒子），配套本地网页（`http://localhost:3210`）浏览、搜索并调节透明度、模糊、亮度、对比度与饱和度。
- **两套皮肤**：
  - **亚克力透明主题**：从当前壁纸取主色，穿透 2.34+/2.35+ 的 Shell/Sheet 布局与内置浏览器视口（`data-has-browser-hole`），保留透明标题栏与侧栏层次；
  - **蓝黑深色主题**：低对比度深蓝黑配色，可单独使用或与壁纸叠加。
- **简繁中文汉化**：覆盖主界面、顶部菜单、系统托盘（含 WSL 项）、设置面板和更新弹窗；自动跳过代码块、编辑器、终端与内置浏览器区域。
- **极速增量写入与基线备份**：内存增量改写 `app.asar`（只重打包 `dist/` 变更，单次写入约 2 秒），安装前保留带 SHA-256 校验的版本化基线备份，可随时恢复到已保存基线。
  > 说明：基线 pointer 中的元数据摘要可用于发现文件不一致，但不能证明官方签名，也不能抵抗可同时改写本地文件的攻击者。

---

## 效果预览

| 简体中文主界面 | 简体中文菜单 |
| :---: | :---: |
| ![简体中文界面](showimg/showmain.png) | ![简体中文菜单](showimg/showmenu.png) |

---

## 快速开始

### 1. 环境准备

- 安装 **Node.js >= 22.12.0**（处理部分场景壁纸还需本机有 Python 和 Wallpaper Engine）。
- 克隆仓库或下载 ZIP 解压后，在项目根目录安装依赖（运行时不会联网下载 ASAR 工具）：
  ```powershell
  git clone https://github.com/KK-Skyline/antigravity-diy-toolkit.git
  cd antigravity-diy-toolkit
  npm ci --omit=dev
  ```

### 2. 首次安装（建立当前版本基线）

首次使用，或 Antigravity 刚更新新版本后，先退出 Antigravity，核对本机 `app.asar` 来源无误后，在项目根目录执行一次带 `--confirm-unverified-baseline` 的安装命令：

```powershell
# 汉化 + 壁纸换肤
node localization_engine.js --wallpaper --confirm-unverified-baseline

# 只要壁纸换肤，不装汉化
node localization_engine.js --wallpaper --only-skin --confirm-unverified-baseline

# 只要简体中文汉化
node localization_engine.js --confirm-unverified-baseline
```

> 该命令会建立当前版本的基线备份并同时完成本次注入（不是仅备份）；确认标志不代表工具验证了官方签名。未建立基线前，直接运行脚本或网页应用都会停止。

### 3. 打开网页选壁纸（Wallpaper Hub）

建好基线后，可以通过本地网页挑选和微调 Wallpaper Engine 壁纸。

- **客户端入口（Antigravity 2.x）**：用 `--wallpaper` 安装后，点击左上角的图片按钮，或在「文件」菜单选择「壁纸选择库」。快捷键为 Windows 的 `Ctrl+Alt+W` 或 macOS 的 `Cmd+Alt+W`。入口会按需启动 Hub，并在系统浏览器打开 `http://127.0.0.1:3210`。
- **Windows 双击**：在仓库目录直接双击 **`双击打开-壁纸选择库.bat`**，会自动拉起本地服务并打开浏览器 `http://localhost:3210`。
- **命令行启动**：在仓库根目录运行：
  ```powershell
  node wallpaper_hub_server.js
  ```
  终端就绪后，浏览器手动打开 **`http://localhost:3210`**（或 `http://127.0.0.1:3210`）。

**使用与排查**：
- 点任意壁纸卡片展开右侧面板，调好参数点 **「应用」**（勾选自动重启可一键重启客户端生效）；
- 网页应用沿用 Hub 的自动安装目录查找和默认安装选项。从纯换肤模式进入后，应用可能重新启用汉化，也可能重置 `--tw` 和临时插件开关。若安装只能通过 `--install-dir` 定位，网页应用会失败。
- 刚双击 `.bat` 时浏览器可能比 Node 早开半秒导致提示无法连接，等 1 秒按 **F5** 刷新即可；
- 若提示 `3210` 端口被占用，先确认监听该端口的服务，再处理冲突；
- 从终端或批处理启动时，关闭终端或按 `Ctrl+C` 可退出服务。从客户端启动时，Hub 在后台运行，客户端重启后仍可访问。

### 4. Antigravity 更新后汉化或壁纸消失了？（AI 自助检查与修复）

Google 更新 Antigravity 客户端时会覆盖 `app.asar`，导致之前的汉化和壁纸暂时消失。仓库已内置只读兼容核验工具与根目录 [AGENTS.md](AGENTS.md)，任何用户都可以直接用 AI 助手自助处理：

1. 用 Antigravity（或 Claude Code / Cursor / Codex）打开本项目文件夹；
2. 直接对 AI 发送：
   > `Antigravity 更新了，帮我按 AGENTS.md 检查新版本兼容性；如果兼容就给我重注入命令，如果有失效请先在本地修好并跑通回归测试。`
3. AI 会自动运行只读核验（`npm run check:update` + `npm run audit:harness`）：
   - **绝大多数小版本更新**（仅覆盖文件、钩子未变）：直接确认 `COMPATIBLE`，退出客户端执行一次 `--confirm-unverified-baseline` 即可 2 秒恢复；
   - **大版本改了界面壳层或钩子**：AI 会按报错锚点在本地自动修复并跑通全套回归测试，验证通过后即可恢复使用（也欢迎脱敏后提 PR 帮其他用户一起更新，详细规程见 [docs/SELF_ITERATION_RUNBOOK.md](docs/SELF_ITERATION_RUNBOOK.md)）。

---

## 常用脚本（Windows）

| 脚本文件 | 说明 |
| :--- | :--- |
| `双击打开-壁纸选择库.bat` | 启动本地壁纸选择网页（`http://localhost:3210`） |
| `双击安装中文汉化.bat` | 安装简体中文汉化 |
| `双击安装繁体中文.bat` | 安装繁体中文汉化 |
| `双击换肤-联动壁纸引擎背景.bat` | 注入当前配置的 Wallpaper Engine 壁纸与亚克力主题 |
| `双击换肤-切换黑曜石质感蓝黑主题.bat` | 切换到深蓝黑主题 |
| `双击换肤-壁纸引擎+黑曜石质感蓝.bat` | 壁纸背景 + 深蓝黑主题叠加 |
| `双击换肤-还原官方默认主题.bat` | 清除壁纸和皮肤，保留汉化 |
| `双击卸载还原官方英文.bat` | 从已保存基线恢复未注入状态 |
| `一键彻底还原官方英文(保底防炸).bat` | 同上，默认要求先关闭客户端；文件名不代表已验证官方来源 |

---

## 命令行参数与插件配置

```bash
# 简体中文 + 壁纸换肤
node localization_engine.js --wallpaper

# 纯换肤，不装汉化（--only-skin 与 --no-i18n 等价）
node localization_engine.js --wallpaper --only-skin

# 繁体中文
node localization_engine.js --tw

# 蓝黑主题
node localization_engine.js --dark-blue

# 左上角品牌名样式：english / hidden / translated
node localization_engine.js --brand-title english

# 按插件 ID 精确开关（可用：i18n-zh, devtools, theme-obsidian-blue, wallpaper-engine, theme-acrylic, fx-rain, wallpaper-hub-launcher）
node localization_engine.js --enable wallpaper-engine,theme-acrylic --disable fx-rain

# 恢复到已保存基线
node localization_engine.js --huifu
node localization_engine.js --huifu --confirm-unverified-baseline
```

- **持久化插件配置**：复制 `plugins.config.example.json` 为 `plugins.config.json`（已被 `.gitignore` 忽略），按需修改各插件开关和参数后，直接运行 `node localization_engine.js` 即可生效。样例中的 `enabled.wallpaper-hub-launcher` 设为 `false`，会覆盖 `--wallpaper` 的默认启用。
- **壁纸选择库入口**：纯换肤默认隐藏入口。加 `--enable wallpaper-hub-launcher` 可只显示按钮，保留原生菜单。可在插件配置中单独控制按钮和菜单，或用 `openMode: "window"` 在客户端内打开。若要在重启时保留页面，请使用默认的系统浏览器模式。
- **排障回退**：如遇异常可设置环境变量 `AG_DISABLE_FAST_ASAR=1` 回退至全量解包打包模式。
- **版本更新自检与兼容性核验**：运行 `npm run check:update` 检测新版本，运行 `npm run audit:harness` 进行只读静态锚点与三模式沙箱核验；Agent 自迭代维护流程见 [docs/SELF_ITERATION_RUNBOOK.md](docs/SELF_ITERATION_RUNBOOK.md)。

---

## 隐私、安全与运维边界

- Wallpaper Hub 仅监听 `127.0.0.1:3210` 本地回环地址；使用前请自行核对脚本与依赖。
- `wallpaper_config.json` 记录了壁纸 ID 与视觉参数，对外分享仓库或提交前注意不要带上个人配置。
- 安装锁仅凭 PID 判断进程存活，极端情况下（PID 复用）可能保守拒绝写入；请确认无安装器运行并核对锁、待恢复标记与基线备份后再处理，不要盲删。最终进程检查与文件替换之间仍存在竞态窗口，macOS 签名权限及 Windows 文件锁行为均以目标机实测为准。

---

## 致谢与反馈

- 衍生自 [qqxpee/antigravity2-cn](https://github.com/qqxpee/antigravity2-cn)，保留原项目与贡献者归属。上游未提供许可证文件，再发布授权范围待确认。
- 本仓库不包含 Google Antigravity 或 Wallpaper Engine 的任何安装文件，相关商标归各自权利人所有。
- Bug 或建议请在 [Issues](https://github.com/KK-Skyline/antigravity-diy-toolkit/issues) 反馈。
