# AGENTS.md — Antigravity 更新后自助诊断与适配指南

当用户表示 **Antigravity 客户端更新了**、**汉化或壁纸消失/失效了**，或要求**检查兼容性并修复**时，请直接按以下流程执行（无需 `gh` 登录或上游仓库写权限）：

## 1. 先跑只读诊断（绝不直接杀进程或修改本机 `app.asar`）
```bash
node tools/check_harness_update.mjs --remote --json
node tools/audit_harness_compat.mjs --cdp --json
```
- **若 `verdict === "COMPATIBLE"`**（绝大多数小版本更新仅覆盖了 `app.asar`，钩子未变）：
  - 无需修改仓库代码；直接告知用户新版本已兼容，并给出本机重注入命令（需先关闭 Antigravity）：
    - 汉化 + 壁纸：`node localization_engine.js --wallpaper --confirm-unverified-baseline`
    - 只要壁纸换肤：`node localization_engine.js --wallpaper --only-skin --confirm-unverified-baseline`
    - 只要简体汉化：`node localization_engine.js --confirm-unverified-baseline`
- **若 `verdict === "NEEDS_ADAPTATION"`**（新版改了主进程钩子、CSS 壳层或菜单/托盘结构）：
  1. 根据 `anchors.failed`、`sandboxModes` 错误与 `cdp` 结果，只修改受影响的 `plugins/*`、`theme-acrylic.css` 或 `dicts/*.json` + `dicts_tw/*.json`（保持简繁词典 100% 键对齐）。
  2. 跑通全部本地回归测试：
     ```bash
     npm run test:dicts
     npm run test:plugin
     npm run test:hub-launcher
     npm run test:fast-asar
     npm run test:maintenance
     npm run test:adapt
     npm run test:asar
     ```
     （若本机 `127.0.0.1:3210` 未被后台运行的 Wallpaper Hub 占用，再额外运行 `npm run test:security`；切勿强杀正在运行的 `wallpaper_hub_server.js`。）
  3. 重跑 `node tools/audit_harness_compat.mjs --json`，确认 `verdict` 变为 `COMPATIBLE` 且退出码为 `0` 后，再给出上述本机重注入命令。

## 2. 硬性边界与隐私铁律
- **严禁**在后台自动杀掉用户正在使用的 Antigravity 客户端，也不要在未获明确确认时改写本机 `app.asar`。
- **严禁**新增第三方 npm 依赖或改动 `package-lock.json`；所有代码须兼容 Node `>=22.12.0`。
- **严禁**在任何公开 PR、Issue 或日志摘要中泄露本机绝对路径（`C:\Users\`、`/Users/`、`/home/`、`AppData`、`Temp`）、系统用户名、主机名、个人 `wallpaper_config.json`、`plugins.config.json`、`last_good_wallpaper.json` 或未经人工审阅的 `untranslatedCandidates`。
- 如需维护者全自动发 PR、强模型 Code Review 与双平台 CI 自动合入流程，见 [docs/SELF_ITERATION_RUNBOOK.md](docs/SELF_ITERATION_RUNBOOK.md)。
