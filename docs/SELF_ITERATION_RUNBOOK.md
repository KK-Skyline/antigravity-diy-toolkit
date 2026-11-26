# Antigravity DIY Toolkit — 版本更新自迭代维护 Runbook

本规程用于指导维护 Agent（或人工）在 Antigravity 客户端发布新版本后，安全、可审计、全自动地完成版本检测、兼容性核验、最小适配修复、强模型 Code Review、双平台 CI 验证与自动合入 `main`。

---

## 一、触发入口

### 1.1 本地只读自检
```bash
npm run check:update
npm run audit:harness
```

### 1.2 一键启动维护对话的 `/goal` 提示词模板
```text
/goal 请严格按照 docs/SELF_ITERATION_RUNBOOK.md 执行一次 Antigravity 新版本自迭代维护：
1. 在独立 git worktree 中操作，绝不触碰主工作区未暂存文件；
2. 全部 gh 命令必须显式带 -R <origin-owner>/<origin-repo>；
3. 若需要修改并合入，必须调用独立只读强模型（Model: "pro"，最低不低于强模型 Medium 档位）完成绑定 HEAD SHA 的 Code Review APPROVE（无法调用时 Fail Closed 停在 Draft PR）；
4. 严禁将未经人工审阅的 untranslatedCandidates 原文粘贴进 PR 正文；
5. 绝不杀掉运行中的 Antigravity 客户端，也不自动重注入本机。
```

### 1.3 未来升级定时巡检（`/automation`）
- 本仓库当前采用手动触发，但全部检查与核验脚本均为纯只读、无交互、退出码明确（`check_harness_update.mjs --fail-on-update` 退出码 `10`），未来可零代码改造直接通过 `/automation` 引用本 Runbook 定时巡检。

---

## 二、标准执行步骤

### Step 0 — 版本检测（主仓库只读预检）
在主仓库根目录先以只读模式执行版本检测（绝不修改任何文件或提前创建分支/worktree）：
```bash
node tools/check_harness_update.mjs --remote --json
```
- 若 `needsMaintenance === false` → 直接汇报当前已是最新并退出；
- 若 `canAuditLocally === false`（例如远端已有新版，但本机尚未升级且未提供 `--asar`）→ 提示用户先更新本机 Antigravity 客户端后再触发；**严禁**在未核验新版 `app.asar` 的情况下提前改大 `harness_compat.json` 的 `lastVerifiedVersion`；
- 仅当 `needsMaintenance === true && canAuditLocally === true` 且拿到精确目标版本号 `version = installed.version` 后，再进入 Step 1。

### Step 1 — 远端解析与隔离 Worktree
1. 动态解析 `origin` 仓库（本仓库同时存在 `origin` 与 `upstream`，**严禁**省略 `-R` 误操作 `upstream`）：
   ```bash
   ORIGIN_URL=$(git remote get-url origin)
   # 解析出 <owner>/<repo>，后续每一条 gh 命令必须显式带 -R <owner>/<repo>
   ```
2. 执行 `gh auth status`、`git fetch origin main`、`git worktree prune`。
3. 目标分支名为 `auto/adapt-antigravity-<version>`（使用 Step 0 获取的精确 `installed.version`）：
   - 先检查 `gh pr list -R <owner>/<repo> --head "<branch>" --state open`；若已有打开的 PR 或 Draft PR，**立即停止**并通知用户接手，防止覆写已有工作；
   - 若仅有残留本地空分支，清理后再建。
4. 在 `os.tmpdir()` 创建隔离 worktree：
   ```bash
   git worktree add -b "<branch>" "<tempWorktree>" origin/main
   ```
5. 依赖准备：优先将主仓库 `node_modules` 以 `fs.cpSync` 复制到 `<tempWorktree>/node_modules`（离线可用且避免 Windows symlink/junction 隐患）；若不存在再运行 `npm ci --omit=dev --prefer-offline`。
6. 结束清理（无论成功/失败）：必须先 `cd` 回主仓库根目录，再执行带重试的 `git worktree remove --force "<tempWorktree>"` 与 `git worktree prune`。

### Step 2 — 官方更新日志核验
检索 `https://antigravity.google/changelog`（覆盖 `repoVerifiedVersion..auditedVersion`），提炼涉及主进程、菜单/托盘、DevTools、Shell/Sheet CSS、内置浏览器及新增 UI 文案的变化。

### Step 3 — Harness 兼容核验
执行：
```bash
node tools/audit_harness_compat.mjs --cdp --json
```
- 核验全部静态锚点（`anchors`）、3 模式沙箱 E2E（`default-i18n`、`wallpaper-full`、`skin-only`）以及可选 CDP 壳层透明与未译词探针结果。
- 严禁把未经人工审阅的 `cdp.untranslatedCandidates` 原文直接粘贴进 PR 正文。

### Step 4 — 最小适配修复与本地全量验证
1. 若 `verdict === "NEEDS_ADAPTATION"`：最小精确修复受影响的 `plugins/*`、`theme-acrylic.css`、`dicts/*.json` + `dicts_tw/*.json`（保持 100% 简繁对齐），并补充回归断言。
2. 将 `harness_compat.json` 的 `lastVerifiedVersion` 更新为 **`auditedVersion`**（严禁超过 `auditedVersion`），追加 `verifiedHistory`，同步更新 `README.md` / `README_TW.md` / `HANDOFF.md` 已实测版本号。
3. 跑通全部本地测试与 `node --check`：
   - `node tools/compare_dicts.js`
   - `node tools/plugin_architecture_regression.mjs`
   - `node tools/fast_asar_regression.mjs`
   - `node tools/harness_maintenance_regression.mjs`
   - `node tools/adapt_2_34_regression.mjs`
   - `node asar_transaction_regression.mjs`
   - 先只读检查 `127.0.0.1:3210` 是否空闲（**绝不**杀运行中的 `wallpaper_hub_server.js`），空闲则跑 `node security_regression.js`。
4. 逐文件显式 `git add <files>`（**严禁 `git add -A` 或 `git add .`**），并断言 `git diff --name-only origin/main..HEAD` 不包含 `wallpaper_config.json`、`CODEX_AUDIT_BRIEF.md`、`last_good_wallpaper.json`。

### Step 5 — 独立只读强模型 Code Review（强制 `Model: "pro"` + SHA 绑定 + Fail Closed）
1. 调用 `invoke_subagent`，强制传入：
   - `TypeName: "research"`
   - `Role: "Adversarial Code Reviewer"`
   - `Model: "pro"`（最低不得低于**强模型 Medium 档位**；严禁使用 `flash` / `flash_lite`，严禁省略 `Model` 默认 `inherit`）
2. **Fail Closed**：若当前环境无法调用 `invoke_subagent` 或无法启动 `Model: "pro"`，**立即中止自动合入，只推分支创建 Draft PR 并通知用户，严禁自审放行**。
3. 审查报告必须给出明确 `APPROVE` 或 `REQUEST_CHANGES`，以及被审查的 `Reviewed Commit SHA`。
4. 若为 `REQUEST_CHANGES`：修完所有 `[CRITICAL]` / `[HIGH]` / `[MEDIUM]` 问题后发回同一审查子智能体复审（**最多 2 轮**；2 轮后仍未 `APPROVE` → Push 分支建 Draft PR 并停止）。

### Step 6 — 推送 → Draft PR → 精确 SHA 双平台 CI → 自动合入 `main`
1. 核验 `HEAD_SHA=$(git rev-parse HEAD)` 与 `Reviewed Commit SHA` 严格一致。
2. 推送分支并创建 **Draft PR**：
   ```bash
   git push -u origin "<branch>"
   gh pr create -R <owner>/<repo> --draft --base main --head "<branch>" --title "..." --body "..."
   ```
   PR 正文必须包含 **`Review Attestation`** 区块（Reviewer Model、Subagent ID、Reviewed Commit SHA、Verdict）以及脱敏后的 Changelog / Audit / Test 摘要。
3. 按精确 `HEAD_SHA` 监控 CI：
   ```bash
   gh run list -R <owner>/<repo> --commit "$HEAD_SHA" --workflow "CI" --json databaseId,headSha,status,conclusion,event
   gh run watch <runId> -R <owner>/<repo> --exit-status
   gh run view <runId> -R <owner>/<repo> --json jobs
   ```
   必须核对 **`Test (ubuntu-latest, Node 22.12.0)`** 与 **`Test (windows-latest, Node 22.12.0)`** 两个 job 的 `conclusion` 均为 `"success"`。
4. 若 CI 失败：通过 `gh run view <runId> -R <owner>/<repo> --log-failed` 排查，**最多允许 1 轮**修复提交；新提交会作废旧 `APPROVE`，必须重新走 Step 5 强模型复审拿到新 SHA 的 `APPROVE` 后再重跑 CI（总计强模型审查上限 ≤ 3 次）；仍失败则保持 Draft PR 并汇报用户。
5. **仅当**（`Reviewed Commit SHA === HEAD_SHA` 的强模型 `APPROVE` 且双平台 CI 两个 job 均为 `"success"`）时执行合入：
   ```bash
   gh pr ready <prNumber> -R <owner>/<repo>
   gh pr merge <prNumber> -R <owner>/<repo> --merge --match-head-commit "$HEAD_SHA"
   git push origin --delete "<branch>"
   ```
   - **严禁**在 worktree 中传 `--delete-branch`（会尝试 `git checkout main` 报错）；
   - 若因 `main` 前进导致合并冲突，立刻 `gh pr ready --undo <prNumber> -R <owner>/<repo>` 转回 Draft PR 并通知用户。

### Step 7 — 本机非侵入提示
- **绝不**自动杀掉运行中的 Antigravity 客户端；
- 汇报 PR 链接、合入提交 SHA 与一条可供用户手动执行的本机重注入命令（例如 `node localization_engine.js --close-app` 或 `--wallpaper --close-app`）。
