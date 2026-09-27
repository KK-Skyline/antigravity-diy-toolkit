# Antigravity 2.0 终极定制套件 (DIY Customization & Localization Toolkit)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows & macOS](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-brightgreen.svg)]()
[![Antigravity: v2.x Compatible](https://img.shields.io/badge/Antigravity-v2.x-orange.svg)]()

👉 **[繁體中文版說明文件 (Traditional Chinese README)](README_TW.md)**

---

## 🌟 核心特性概览 (Highlights)

本项目不仅是 **Antigravity 2.0+** 的深度汉化包，更是一套**开箱即用、完全离线、高颜值的全能桌面 DIY 定制套件**：

1. **🎨 Wallpaper Engine 创意工坊深度联动 (2K 60FPS 动态引擎)**
   - 自动扫描本地 Steam 创意工坊已订阅壁纸库，无需手动找图；
   - **真 2K（2560×1440）原画重构**：杜绝低清缩略图拉伸，自动提取 `scene.pkg` 核心高清母带；
   - **真 60 帧丝滑动态**：支持 MP4/WebM 视频硬件级解码与粒子烟雾逐帧渲染（120 帧 60.0000 FPS 无缝循环）；
   - **零 DOM 崩塌**：采用全局层级的亚克力穿透渲染，不破坏任何原有编辑器和代码高亮结构。
2. **🌐 独立交互式控制中心：壁纸选择库 (Wallpaper Hub)**
   - 运行于 `http://localhost:3210` 的独立 Web 控制台；
   - 支持实时关键词搜索、类型过滤（视频壁纸 / 场景动画 / 网页交互 / 当前生效）；
   - **现代丝滑调参抽屉**：配备 `setPointerCapture` 连续捕获引擎的流体滑块（透明度、毛玻璃模糊、对比度、亮度、饱和度、边缘暗化）；
   - 一键换肤并自动热重启生效。
3. **💎「失重亚克力」毛玻璃主题 (Weightless Acrylic Glass)**
   - 智能色彩提取算法：动态捕捉当前壁纸主色系，计算悬浮岛磨砂玻璃色调；
   - 全透明系统标题栏 + 悬浮岛式侧边栏 + 呼吸过渡动画；
   - 开启原生 F12 / `Ctrl+Shift+I` 开发者调试控制台。
4. **🖤 极简科技黑曜石蓝黑主题 (Obsidian Tech Blue)**
   - 极客最爱的沉浸式低对比蓝黑质感，长时间编码不疲劳。
5. **🈳 100% 深度中文汉化 (简繁双语)**
   - 全面覆盖主界面、系统菜单、右键托盘、加载语录、设置中心与登录页；
   - 具备智能长句滑动匹配与短词精准锚定，绝不篡改代码块与大模型 Prompt 原文。
6. **🛡️ 纯净安全 & 零隐私依赖**
   - 不修改核心二进制执行文件，纯 JavaScript/CSS 动态注入；
   - 自带安全备份（`app.asar.bak`），随时一键完美还原官方英文原版。

---

## 📸 效果展示

| 壁纸控制中心 (Wallpaper Hub) | 失重亚克力 2K 动态桌面 |
| :---: | :---: |
| 实时流体调参 · 创意工坊秒级扫描 | 2560×1440 60 帧无损动态背景 |

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
| **`双击卸载还原官方英文.bat`** | 一键彻底恢复官方原版纯净英文状态 |
| **`一键彻底还原官方英文(保底防炸).bat`** | 紧急保底恢复脚本（直接从备份还原 app.asar） |

---

## 🚀 极速使用指南

### 1. 下载与解压
- 直接 Clone 本仓库或下载 ZIP 包并解压至任意目录：
  ```bash
  git clone https://github.com/您的用户名/antigravity-toolkit.git
  ```

### 2. 启动壁纸选择库 (Wallpaper Hub)
1. 双击运行 **`双击打开-壁纸选择库.bat`**；
2. 浏览器将自动打开 `http://localhost:3210`；
3. 浏览你订阅的所有 Wallpaper Engine 壁纸，点击任意卡片展开右侧抽屉；
4. 自由拖动调节透明度与模糊度，点击 **【一键应用换肤到零重力】** 即可立即生效！

### 3. 一键安装中文汉化
1. 退出 Antigravity 客户端；
2. 双击运行 **`双击安装中文汉化.bat`**（macOS 运行 `.command`）；
3. 按照提示选择品牌显示偏好；
4. 重新打开 Antigravity，即可畅享全中文界面。

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

# 卸载还原官方英文
node localization_engine.js --huifu
```

---

## 🔒 隐私与安全声明

- **零密钥上传**：本项目代码完全在本地运行，绝不收集或上传任何 API Key、密码、网络凭证或用户代码；
- **文件保护**：本地配置文件 `wallpaper_config.json` 仅保存视觉调参参数（透明度、滤镜、工坊ID），不包含敏感个人信息。

---

## 🤝 致谢与协议

- 本项目基于 MIT 许可证开源；
- 特别鸣谢社区中提供透明代理方案与亚克力设计灵感的所有贡献者！
