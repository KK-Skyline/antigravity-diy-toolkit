# Antigravity 2.0 DIY 定制套件 - Codex 跨模型复核与协查指南 (Audit Brief)

## 📌 项目基本信息与本地路径

- **本地项目根目录**：`D:\antigravity2-cn`
- **关联 GitHub 开源仓库**：`https://github.com/KK-Skyline/antigravity-diy-toolkit`
- **目标宿主应用**：Google Antigravity 2.0+ (基于 Electron / VS Code 架构的智能 AI 编程客户端)
- **客户端本地安装目录**：`%LOCALAPPDATA%\Programs\antigravity` (Windows)
- **核心注入目标**：`resources\app.asar` (解包 -> 动态注入预加载脚本与 CSS -> 重新打包)

---

## 📂 核心代码架构与文件清单

请在 `D:\antigravity2-cn` 目录下审查以下关键模块：

```text
D:\antigravity2-cn\
├── localization_engine.js      # [核心] ASAR解包/注入/打包引擎、汉化词典匹配、壁纸自适应色系计算
├── wallpaper_engine_reader.js  # [核心] Steam 创意工坊扫描器、2K 原画提取、视频/场景多级回退
├── wallpaper_hub_server.js     # [独立服务] 运行于 localhost:3210 的 Web 控制台，提供流体调参与换肤
├── theme-acrylic.css           # [样式] 失重亚克力毛玻璃主题（半透明标题栏、磨砂悬浮岛）
├── dicts/ & dicts_tw/          # [词典] 简体/繁体中文高保真 JSON 翻译对照表
├── prepare_hd_wallpaper.py     # [工具] 高清帧提取脚本（scene.pkg / MP4 抽帧）
├── extract_scene_pkg.py        # [工具] Wallpaper Engine 专用 LZ4 解压与纹理提取工具
├── 双击打开-壁纸选择库.bat       # [Windows入口] 启动 Web Hub 并自动拉起浏览器
├── 双击换肤-*.bat              # [Windows入口] 各类预设主题/壁纸切换脚本（GBK 编码）
├── 双击安装*.bat / 双击卸载*.bat # [Windows入口] 汉化安装与一键卸载（支持 app.asar.bak 保底还原）
├── .gitignore                  # [安全过滤] 排除敏感配置、临时转储与缓存
└── README.md / README_TW.md    # [文档] 详细中英文开源文档
```

---

## 🔍 请 Codex 重点协查的 5 大维度

### 1. 🛡️ 安全性、隐私与凭证泄露审查 (Security & Zero-Leak Audit)
- [ ] **敏感信息排查**：全局扫描所有代码、文档、配置，确认**绝无**硬编码的 API Key、Bearer Token、个人密码、私有 Cookie、内网凭据。
- [ ] **路径泛化**：确认所有路径均通过环境变量（如 `process.env.LOCALAPPDATA`、`os.homedir()`）动态探测，不存在硬编码特定用户名（如特定主机名或私人账户路径）。
- [ ] **`.gitignore` 覆盖完整性**：确认 `last_good_wallpaper.json`、`wallpaper_custom.json`、`proxy_config/`、`node_modules/`、`*.log`、`__pycache__/` 等用户状态与敏感目录均被有效忽略，防止用户本地私有数据误提交。

### 2. ⚡ ASAR 解包与注入稳定性 (Injection & Code Isolation)
- [ ] **防 DOM 崩塌与编辑器保护**：
  - 检查 `localization_engine.js` 中的 `CODE_ISOLATION_SELECTOR`。
  - 确认代码块、Monaco 编辑器、终端（`xterm`）、Diff 差异对比区、代码语法高亮 Token 等节点被严格排除，**绝对不被汉化引擎篡改**。
  - 确认大模型 Prompt 与用户输入区域不发生误翻译。
- [ ] **备份与保底恢复机制**：
  - 检查首次运行时 `app.asar.bak` 的创建逻辑，确认当发生异常中断或解包错误时，是否存在可靠的还原保障。
  - 检查 `一键彻底还原官方英文(保底防炸).bat` 是否能够绝对无损地救砖。

### 3. 🌐 Wallpaper Engine 解析器与 Web 服务健壮性
- [ ] **异常与未就绪文件容错 (`wallpaper_engine_reader.js`)**：
  - 当 Steam 创意工坊壁纸正在下载、文件锁死、视频损坏或缺少 `scene.pkg` 时，检查是否具备安全 `try-catch` 和自动回退（Fallback）到备用壁纸的保护，防止主程序崩溃。
  - 检查低清缩略图拦截逻辑（`isLowResThumbnail`），确保不会因 200px 的 `preview.jpg` 导致高分屏上全屏马赛克。
- [ ] **Web 控制台安全性 (`wallpaper_hub_server.js`)**：
  - 检查静态文件托管（如 `/preview/...`、`/api/...`）是否存在目录穿越（Directory Traversal，如 `../` 漏洞）隐患。
  - 检查端口冲突保护（默认 3210 端口被占用时的提示或容错）。
  - 检查换肤 API (`/api/apply`) 接收参数（透明度、滤镜、工坊ID）的边界值校验。

### 4. 🪟 Windows 批处理与跨环境兼容性
- [ ] **批处理编码规范**：
  - 确认所有 `.bat` 批处理文件均为 **GBK / ANSI** 编码并采用 **CRLF** 换行，防止在中文 Windows CMD 运行环境下出现乱码或闪退。
- [ ] **Node.js 跨版本兼容**：
  - 确认核心代码使用的 Node API 兼容主流版本（Node.js 16.x / 18.x / 20.x / 22.x），不依赖实验性或非通用特性。

### 5. 🧹 品牌与开源规范一致性
- [ ] **去残留验证**：全局检查是否还有旧项目代码或提示遗留的“DeepSeek Harness”、“dsh”等非 Antigravity 专有字样。
- [ ] **规范统一**：确认项目各模块统一命名为 **Antigravity 2.0 定制套件**、**失重亚克力 (Weightless Acrylic)** 与 **黑曜石科技蓝黑 (Obsidian Tech Blue)**。

---

## 💡 Codex 审查结果输出建议模板

请 Codex 按照以下格式给出审查反馈：

```markdown
### 1. 审查结论
- [通过 / 需整改 / 存在高危风险]

### 2. 发现的问题与优化建议 (按严重级别排序)
- 🔴 **高危 / 阻断性问题** (如有)：文件与行号 + 漏洞描述 + 修复建议
- 🟡 **中危 / 健壮性缺陷** (如异常捕获缺失、路径容错)：文件与行号 + 改进方案
- 🟢 **低危 / 体验与代码风格建议**：代码规范或边缘情况优化

### 3. 具体修改代码 Diff (如有)
```
