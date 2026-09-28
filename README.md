# Antigravity 2.0 终极定制套件 (DIY Customization & Localization Toolkit)

> 许可状态：上游代码及素材的再发布授权仍待核实；请勿仅凭仓库公开可见或历史 MIT 徽章推定可自由再分发。
>
> 使用边界：本工具会修改 Google Antigravity 的 `app.asar`。Google 通用条款禁止修改其软件；私有仓库不改变该条款。参见 [Google Antigravity 附加条款](https://antigravity.google/terms)及其引用的 [Google 通用条款](https://policies.google.com/terms)。

👉 **[繁體中文版說明文件 (Traditional Chinese README)](README_TW.md)**

---

## 🌟 核心特性概览 (Highlights)

本项目不仅是 **Antigravity 2.0+** 的深度汉化包，也提供桌面定制功能。运行时不下载 ASAR 工具；首次使用需 Node.js >=22.12.0 并执行 `npm ci --omit=dev` 安装锁定依赖。

1. **🎨 Wallpaper Engine 创意工坊联动**
   - 自动扫描本地 Steam 创意工坊已订阅壁纸库，无需手动找图；
   - 可尝试从 `scene.pkg` 提取较高清素材；效果取决于壁纸资源；
   - 支持 MP4/WebM 视频及场景动画，帧率和画质取决于素材与设备；
   - 通过 CSS 和页面注入呈现亚克力效果。
2. **🌐 独立交互式控制中心：壁纸选择库 (Wallpaper Hub)**
   - 运行于 `http://localhost:3210` 的独立 Web 控制台；
   - 支持实时关键词搜索、类型过滤（视频壁纸 / 场景动画 / 网页交互 / 当前生效）；
   - **现代丝滑调参抽屉**：配备 `setPointerCapture` 连续捕获引擎的流体滑块（透明度、毛玻璃模糊、对比度、亮度、饱和度、边缘暗化）；
   - 应用换肤并重新启动客户端生效。
3. **💎「失重亚克力」毛玻璃主题 (Weightless Acrylic Glass)**
   - 智能色彩提取算法：动态捕捉当前壁纸主色系，计算悬浮岛磨砂玻璃色调；
   - 全透明系统标题栏 + 悬浮岛式侧边栏 + 呼吸过渡动画；
   - 开启原生 F12 / `Ctrl+Shift+I` 开发者调试控制台。
4. **🖤 极简科技黑曜石蓝黑主题 (Obsidian Tech Blue)**
   - 极客最爱的沉浸式低对比蓝黑质感，长时间编码不疲劳。
5. **🈳 深度中文汉化 (简繁双语)**
   - 全面覆盖主界面、系统菜单、右键托盘、加载语录、设置中心与登录页；
   - 具备长句与短词匹配；聊天正文与模型输出的隔离仍待完善。
6. **🛡️ 备份与恢复**
   - 不修改核心二进制执行文件，纯 JavaScript/CSS 动态注入；
   - 安装前保留版本化、带 SHA-256 校验的基线备份；恢复前验证备份并保留原件。pointer 中的元数据摘要可发现元数据不一致，但不能证明官方签名，也不能抵抗可同时改写所有本地文件的攻击者或保证零风险。

---

## 📸 效果展示

| 简体中文主界面 | 简体中文菜单 |
| :---: | :---: |
| ![简体中文界面](showimg/showmain.png) | ![简体中文菜单](showimg/showmenu.png) |

---

## 📂 开箱即用脚本清单

| 脚本文件 | 功能说明 |
| :--- | :--- |
| **`双击打开-壁纸选择库.bat`** | **【推荐】** 启动 Wallpaper Hub（端口 3210）并在浏览器中打开控制中心 |
| **`双击安装中文汉化.bat`** | 一键安装简体中文汉化语言包 |
| **`双击安装繁体中文.bat`** | 一键安装繁体中文（台灣/香港習慣用語）语言包 |
| **`双击换肤-联动壁纸引擎背景.bat`** | 快速注入当前 Wallpaper Engine 壁纸与失重亚克力背景 |
| **`双击换肤-切换黑曜石质感蓝黑主题.bat`** | 切换至极客黑曜石科技蓝黑皮肤 |
| **`双击换肤-壁纸引擎+黑曜石质感蓝.bat`** | 动态壁纸背景与黑曜石主题双重叠加 |
| **`双击换肤-还原官方默认主题.bat`** | 清除壁纸与自定义主题，恢复默认黑色 |
| **`双击卸载还原官方英文.bat`** | 从已保存基线恢复英文状态；基线来源需自行核对 |
| **`一键彻底还原官方英文(保底防炸).bat`** | 调用统一的备份验证与恢复流程；默认要求先关闭客户端，文件名不代表已验证官方来源 |

---

## 🚀 极速使用指南

### 1. 准备环境与下载
- 安装 Node.js >=22.12.0；在项目目录执行 `npm ci --omit=dev`。壁纸素材处理的部分功能还需要 Python 和 Wallpaper Engine。
- 直接 Clone 本仓库或下载 ZIP 包并解压至任意目录：
  ```bash
  git clone https://github.com/KK-Skyline/antigravity-diy-toolkit.git
  ```

### 2. 启动壁纸选择库 (Wallpaper Hub)
1. Windows 双击运行 **`双击打开-壁纸选择库.bat`**；
2. 浏览器将自动打开 `http://localhost:3210`；
3. 浏览你订阅的所有 Wallpaper Engine 壁纸，点击任意卡片展开右侧抽屉；
4. 选择壁纸并调节视觉参数，按界面提示应用；首次使用前配置为禁用状态，不预选其他用户的创意工坊作品。

### 3. 一键安装中文汉化
1. 退出 Antigravity 客户端；
2. 首次安装或客户端升级后，先自行核对当前 `app.asar` 的来源与哈希；确认接受其来源后，运行 `node localization_engine.js --confirm-unverified-baseline`。该命令会建立版本化基线并**同时完成本次简体安装**，不是仅备份；此确认不等于工具已验证官方签名。未经确认时安装会停止，Wallpaper Hub 也不会自动建立基线；
3. 后续可双击运行 **`双击安装中文汉化.bat`**（macOS 运行 `.command`）；
4. 按照提示选择品牌显示偏好；
5. 重新打开 Antigravity。

运维边界：锁文件仅凭 PID 判断存活，PID 被复用时可能保守地拒绝安装；先确认没有安装器进程，再核对锁、待恢复标记和基线备份，不要盲删。最终进程检查与写入之间仍有竞态。macOS 的实际权限、签名及文件系统断电恢复，Windows 的文件锁与磁盘故障，均需在目标机器上验证；合成回归不替代实机演练。

---

## 🛠️ 高级参数说明 (CLI)

核心引擎 `localization_engine.js` 支持直接通过 Node.js 命令行调用：

```bash
# 安装简体中文 + 联动当前壁纸
node localization_engine.js --wallpaper

# 安装繁体中文
node localization_engine.js --tw

# 安装黑曜石科技蓝黑主题
node localization_engine.js --dark-blue

# 自定义左上角品牌名展示 (english / hidden / translated)
node localization_engine.js --brand-title english

# 从已保存基线恢复英文状态
node localization_engine.js --huifu

# 仅在旧版基线 pointer 缺少确认标志或元数据摘要、且已自行核对来源时，显式确认后恢复
node localization_engine.js --huifu --confirm-unverified-baseline
```

---

## 🔒 隐私与安全声明

- Wallpaper Hub 仅监听本机回环地址；使用前仍应自行审查脚本及依赖。
- `wallpaper_config.json` 会保存视觉参数、创意工坊 ID 和壁纸描述；该文件当前由 Git 跟踪，分享修改后的仓库或补丁前请检查其中内容。

---

## 🤝 致谢与协议

- 本项目衍生自 [qqxpee/antigravity2-cn](https://github.com/qqxpee/antigravity2-cn)，保留原项目及贡献者的归属。上游目前未提供许可证文件，再发布及本仓库整体授权范围待确认。
- 此仓库未包含 Google Antigravity 或 Wallpaper Engine 的安装文件，相关商标归各自权利人所有。
- 问题反馈请使用本仓库的 [Issues](https://github.com/KK-Skyline/antigravity-diy-toolkit/issues)。
