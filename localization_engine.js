const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const child_process = require('child_process');

// --tw 參數：使用繁體中文字典 (dicts_tw/)，否則使用預設簡體字典 (dicts/)
const USE_TW = process.argv.includes('--tw');
// --theme-blue / --dark-blue 參數：啟用 Antigravity 官方質感科技藍黑皮膚 (Obsidian Blue)
const USE_DARK_BLUE = process.argv.includes('--theme-blue') || process.argv.includes('--dark-blue') || process.argv.includes('--deepseek');
// --wallpaper 參數：聯動 Wallpaper Engine 實時桌布換膚
const USE_WALLPAPER = process.argv.includes('--wallpaper') || process.argv.includes('--we');
// --no-i18n / --only-skin 參數：僅換膚與基礎輔助，不注入中文漢化
const NO_I18N = process.argv.includes('--no-i18n') || process.argv.includes('--only-skin');
const BRAND_TITLE_ALIASES = {
    english: 'english',
    en: 'english',
    default: 'english',
    hidden: 'hidden',
    hide: 'hidden',
    none: 'hidden',
    translated: 'translated',
    chinese: 'translated',
    cn: 'translated',
    zh: 'translated'
};

function getOptionValue(name, defaultValue) {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === name) {
            return args[i + 1] || defaultValue;
        }
        if (args[i].startsWith(name + '=')) {
            return args[i].slice(name.length + 1);
        }
    }
    return defaultValue;
}

function hasOption(name) {
    const args = process.argv.slice(2);
    return args.some(a => a === name || a.startsWith(name + '='));
}

const HAS_BRAND_TITLE = hasOption('--brand-title');
const BRAND_TITLE_MODE = BRAND_TITLE_ALIASES[String(getOptionValue('--brand-title', 'english')).toLowerCase()] || 'english';

if (USE_TW) {
    const logTranslations = {
        "====== 正在安装 Antigravity 中文汉化 ======": "====== 正在安裝 Antigravity 繁體中文漢化 ======",
        "====== 正在卸载中文汉化，恢复官方原版 ======": "====== 正在卸載中文漢化，恢復官方原版 ======",
        "====== 检测到 Antigravity 1.0 架构，正在使用 HTML 注入引擎 ======": "====== 偵測到 Antigravity 1.0 架構，正在使用 HTML 注入引擎 ======",
        "====== 正在恢复 Antigravity 1.0 官方原版 ======": "====== 正在恢復 Antigravity 1.0 官方原版 ======",
        "[1] 检测到 Antigravity 客户端正在运行，正在关闭以解除文件锁...": "[1] 偵測到 Antigravity 用戶端正在執行，正在關閉以解除檔案鎖...",
        "[1] 正在关闭 Antigravity 运行进程以解除文件锁...": "[1] 正在關閉 Antigravity 執行進程以解除檔案鎖...",
        "[备份] 正在创建官方原始包备份: app.asar.bak ...": "[備份] 正在建立官方原始包備份: app.asar.bak ...",
        "[备份] 备份成功！": "[備份] 備份成功！",
        "[备份] 已创建旧版 HTML 备份: ": "[備份] 已建立舊版 HTML 備份: ",
        "[解包] 正在使用 npx 提取 app.asar...": "[解包] 正在使用 npx 提取 app.asar...",
        "[修改] 正在向 preload.js 注入汉化代码...": "[修改] 正在向 preload.js 注入漢化程式碼...",
        "[修改] 注入成功！": "[修改] 注入成功！",
        "[修改] 正在向 menu.js 注入菜单汉化代码...": "[修改] 正在向 menu.js 注入選單漢化程式碼...",
        "[修改] 菜单汉化注入成功！": "[修改] 選單漢化注入成功！",
        "[修改] 正在向 tray.js 注入任务栏菜单汉化...": "[修改] 正在向 tray.js 注入系統匣選單漢化...",
        "[修改] 任务栏菜单汉化注入成功！": "[修改] 系統匣選單漢化注入成功！",
        "[修改] 正在向 loadingOverlay.js 注入加载页汉化...": "[修改] 正在向 loadingOverlay.js 注入載入頁漢化...",
        "[修改] 加载页汉化注入成功！": "[修改] 載入頁漢化注入成功！",
        "[修改] 正在向 updater.js 注入更新弹窗汉化...": "[修改] 正在向 updater.js 注入更新彈出視窗漢化...",
        "[修改] 更新弹窗汉化注入成功！": "[修改] 更新彈出視窗漢化注入成功！",
        "[打包] 正在将修改后的内容打包回 app.asar...": "[打包] 正在將修改後的內容打包回 app.asar...",
        "[√] Antigravity 2.0 汉化部署完成！": "[√] Antigravity 2.0 繁體中文化套用完成！",
        "[√] Antigravity 1.0 汉化部署完成！": "[√] Antigravity 1.0 繁體中文化套用完成！",
        "[!] 未找到备份文件 app.asar.bak，可能尚未安装过汉化或备份被删除。": "[!] 未找到備份檔案 app.asar.bak，可能尚未安裝過繁中化或備份已被刪除。",
        "[还原] 正在用官方备份文件恢复...": "[還原] 正在使用官方備份檔案還原...",
        "[还原] 已重置当前 app.asar 为官方原始备份包，以进行全新注入...": "[還原] 已重設目前 app.asar 為官方原始備份包，以進行全新注入...",
        "[权限] 检测到当前用户对 macOS 应用目录缺少写入权限，正在尝试请求管理员权限 (sudo) 重新运行...": "[權限] 偵測到目前使用者對 macOS 應用程式目錄缺少寫入權限，正在嘗試請求管理員權限 (sudo) 重新執行...",
        "[提示] 当前 app.asar 被锁定（可能是客户端正在运行），将使用当前包进行增量注入。": "[提示] 目前 app.asar 被鎖定（可能是應用程式正在執行），將使用目前包進行增量注入。",
        "[还原] 已恢复 HTML: ": "[還原] 已還原 HTML: ",
        "[还原] 已删除汉化脚本": "[還原] 已刪除中文化腳本",
        "[√] 官方 app.asar 已成功恢复！": "[√] 官方 app.asar 已成功還原！",
        "[√] 校验值已同步，1.0 软件恢复至原始状态。": "[√] 校驗值已同步，1.0 軟體已還原至原始狀態。",
        "[错误] 手动指定的路径不存在:": "[錯誤] 手動指定的路徑不存在:",
        "[错误] 未在资源目录中找到 app.asar:": "[錯誤] 未在資源目錄中找到 app.asar:",
        "[错误] 解压后未能在指定路径找到 preload.js:": "[錯誤] 解壓後未能在指定路徑找到 preload.js:",
        "[错误] 无法定位有效的资源(resources)目录:": "[錯誤] 無法定位有效的資源(resources)目錄:",
        "[错误] 无法定位有效的资源(resources)目录: ": "[錯誤] 無法定位有效的資源(resources)目錄: ",
        "[错误] 解包失败，可能是由于系统未安装 Node.js/npm 或者网络限制。": "[錯誤] 解包失敗，可能是由於系統未安裝 Node.js/npm 或者網路限制。",
        "[错误] 打包失败。": "[錯誤] 打包失敗。",
        "[警告] 未能在 menu.js 中找到设定的插入点。": "[警告] 未能在 menu.js 中找到設定的插入點。",
        "[签名] 检测到 macOS 平台，正在对应用包进行本地 ad-hoc 深度重签名: ": "[簽名] 偵測到 macOS 平台，正在對應用程式包進行本機 ad-hoc 深度重新簽名: ",
        "[签名] 重新签名成功！": "[簽名] 重新簽名成功！",
        "[警告] 重新签名失败。可能会导致应用无法打开。": "[警告] 重新簽名失敗。可能會導致應用程式無法開啟。",
        "[警告] 未能从路径 ": "[警告] 未能從路徑 ",
        " 识别到有效的 .app 路径，跳过重新签名。": " 識別到有效的 .app 路徑，跳過重新簽名。",
        "[探测] 成功自动识别到 Antigravity 安装目录: ": "[偵測] 成功自動識別到 Antigravity 安裝目錄: ",
        "[错误] 未找到默认安装目录，请使用 --install-dir 手动指定您的安装路径！": "[錯誤] 未找到預設安裝目錄，請使用 --install-dir 手動指定您的安裝路徑！",
        "[!] 未找到 1.0 备份文件。": "[!] 未找到 1.0 備份檔案。",
        "详情: ": "詳情: ",
        "[√] 注入成功: ": "[√] 注入成功: ",
        "[跳过] 检测到 --no-kill 参数，跳过关闭 Antigravity 运行进程。": "[跳過] 偵測到 --no-kill 參數，跳過關閉 Antigravity 執行進程。",
        "[启动] 检测到安装前反重力客户端处于开启状态，正在重新启动客户端...": "[啟動] 偵測到安裝前反重力用戶端處於開啟狀態，正在重新啟動用戶端...",
        "[启动] 客户端启动成功！": "[啟動] 用戶端啟動成功！",
        "[警告] 未找到客户端主程序: ": "[警告] 未找到用戶端主程式: ",
        "[警告] 客户端启动失败: ": "[警告] 用戶端啟動失敗: ",
        "[修改] 已通过 debugConsole.js 开启开发者工具权限。": "[修改] 已透過 debugConsole.js 開啟開發人員工具權限。",
        "[跳过] 当前版本的 loadingOverlay.js 为纯图标加载页，无需文本汉化。": "[跳過] 目前版本的 loadingOverlay.js 為純圖示載入頁，無需文字漢化。"
    };
    const translateMsg = (args) => {
        return args.map(arg => {
            if (typeof arg === 'string') {
                let res = arg;
                for (const [k, v] of Object.entries(logTranslations)) {
                    if (res.includes(k)) {
                        res = res.split(k).join(v);
                    }
                }
                return res;
            }
            return arg;
        });
    };
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args) => origLog(...translateMsg(args));
    console.error = (...args) => origError(...translateMsg(args));
    console.warn = (...args) => origWarn(...translateMsg(args));
}

const SIGNATURE_START = "/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */";
const SIGNATURE_END = "/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */";

const hostEnv = require(path.join(__dirname, 'core', 'host_env'));
const pluginLoader = require(path.join(__dirname, 'core', 'plugin_loader'));
const injector = require(path.join(__dirname, 'core', 'injector'));

function parseIdListOption(name) {
    const raw = getOptionValue(name, '');
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const CLI_ENABLE_PLUGINS = parseIdListOption('--enable');
const CLI_DISABLE_PLUGINS = parseIdListOption('--disable');

function getActivePlugins() {
    const enable = [];
    const disable = [];
    if (NO_I18N) disable.push('i18n-zh');
    if (USE_DARK_BLUE) enable.push('theme-obsidian-blue');
    if (USE_WALLPAPER) enable.push('wallpaper-engine', 'theme-acrylic', 'fx-rain');

    for (const id of CLI_ENABLE_PLUGINS) {
        const idx = disable.indexOf(id);
        if (idx !== -1) disable.splice(idx, 1);
        if (!enable.includes(id)) enable.push(id);
    }
    for (const id of CLI_DISABLE_PLUGINS) {
        const idx = enable.indexOf(id);
        if (idx !== -1) enable.splice(idx, 1);
        if (!disable.includes(id)) disable.push(id);
    }

    const settings = {};
    const i18nSettings = {};
    if (USE_TW) i18nSettings.locale = 'zh-TW';
    if (HAS_BRAND_TITLE) i18nSettings.brandTitle = BRAND_TITLE_MODE;
    if (Object.keys(i18nSettings).length > 0) {
        settings['i18n-zh'] = i18nSettings;
    }

    return pluginLoader.resolvePlugins(__dirname, {
        enable,
        disable,
        settings
    });
}

const hostHelpers = {
    runPrepareHdWallpaper(prepScript, userCfg) {
        child_process.execFileSync('python', [prepScript, String(userCfg.workshopId)], { stdio: 'ignore', windowsHide: true, shell: false });
    }
};

function generateJs(configOverride = null) {
    const { active, allConfigs } = getActivePlugins();
    const baseCtx = injector.buildContextBase({
        rootDir: __dirname,
        isV2: false,
        cliFlags: { USE_TW, USE_DARK_BLUE, USE_WALLPAPER, BRAND_TITLE_MODE, NO_I18N },
        allConfigs,
        shared: { configOverride },
        hostHelpers
    });
    injector.runPrepare(active, baseCtx);
    return injector.buildPreloadPayload(active, baseCtx);
}

function cleanJsContent(content) {
    const regex = new RegExp(escapeRegExp(SIGNATURE_START) + "[\\s\\S]*?" + escapeRegExp(SIGNATURE_END), "g");
    return content.replace(regex, "");
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let wasAppRunning = false;
const {
    checkIfAppIsRunning,
    closeAntigravityProcesses,
    detectInstallationDir,
    cleanElectronCache,
    resignAppOnMac,
    ensureWritePermission
} = hostEnv;

// ==========================================
// Antigravity 2.0 汉化引擎 (ASAR打包注入模式)
// ==========================================
async function install20(resourcesDir, transaction, confirmUnverified, configPlan, txCtx = null) {
    const asarPath = path.join(resourcesDir, "app.asar");
    if (!fs.existsSync(asarPath)) {
        console.error(`[错误] 未在资源目录中找到 app.asar: ${resourcesDir}`);
        return false;
    }
    const baseline = transaction.prepareBaseline(resourcesDir, { confirmUnverified, txCtx });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-asar-'));
    try {
        transaction.extractBaseline(baseline, tempDir);

    // 3. 注入 preload.js
    const preloadPath = path.join(tempDir, "dist", "preload.js");
    if (!fs.existsSync(preloadPath)) {
        console.error(`[错误] 解压后未能在指定路径找到 preload.js: ${preloadPath}`);
        return false;
    }

    const { active, allConfigs } = getActivePlugins();
    const ctx = injector.buildContextBase({
        rootDir: __dirname,
        tempDir,
        distDir: path.join(tempDir, 'dist'),
        isV2: true,
        cliFlags: { USE_TW, USE_DARK_BLUE, USE_WALLPAPER, BRAND_TITLE_MODE, NO_I18N },
        allConfigs,
        shared: { configOverride: configPlan?.value || null },
        hostHelpers
    });
    injector.runPrepare(active, ctx);

    console.log(`[修改] 正在向 preload.js 注入汉化代码...`);
    let content = fs.readFileSync(preloadPath, 'utf-8');

    // 清理已有的汉化，重新注入
    const cleanedContent = cleanJsContent(content);
    const translationJs = injector.buildPreloadPayload(active, ctx);
    const newContent = cleanedContent + "\n" + translationJs;

    fs.writeFileSync(preloadPath, newContent, 'utf-8');
    console.log(`[修改] 注入成功！`);

    // 3.0-3.5 主进程补丁（由 plugins/wallpaper-engine、plugins/i18n-zh、plugins/devtools 统一处理）
    injector.runPatchMain(active, ctx);

    // 4. 重新打包
    console.log(`[打包] 正在将修改后的内容打包回 app.asar...`);
    await transaction.packAndReplace(resourcesDir, tempDir, baseline, configPlan, txCtx);

    cleanElectronCache();
    resignAppOnMac(resourcesDir);
    console.log(`[√] Antigravity 2.0 汉化部署完成！`);
    return true;
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function restore20(resourcesDir, transaction, confirmUnverified) {
    console.log("[还原] 正在用已保存的基线备份恢复...");
    try {
        transaction.restore(resourcesDir, { confirmUnverified });
    } catch (e) {
        console.error(`[错误] 恢复备份失败: ${e.message}`);
        if (process.platform === 'darwin' && e.code === 'EPERM') {
            console.error(`[提示] macOS 写入受限，请使用管理员权限运行脚本。`);
        }
        return false;
    }
    resignAppOnMac(resourcesDir);
    console.log("[√] 已保存的基线 app.asar 已成功恢复！");
    return true;
}

// ==========================================
// Antigravity 1.0 汉化引擎 (旧版 HTML 注入模式)
// ==========================================
const OLD_TARGET_FILES = [
    path.join("resources", "app", "out", "vs", "code", "electron-browser", "workbench", "workbench-jetski-agent.html"),
    path.join("resources", "app", "out", "vs", "code", "electron-browser", "workbench", "workbench.html")
];

function backupFiles10(installDir) {
    for (const relPath of OLD_TARGET_FILES) {
        const absPath = path.join(installDir, relPath);
        const bakPath = absPath + ".bak";
        if (fs.existsSync(absPath) && !fs.existsSync(bakPath)) {
            fs.copyFileSync(absPath, bakPath);
            console.log(`[备份] 已创建旧版 HTML 备份: ${path.basename(absPath)}.bak`);
        }
    }
}

function injectHtml10(installDir, htmlRelPath) {
    const absPath = path.join(installDir, htmlRelPath);
    if (!fs.existsSync(absPath)) return false;
    
    let content = fs.readFileSync(absPath, 'utf-8');
    
    const injectStr = '<script src="../../../../ag_agent_hanhua.js"></script>';
    content = content.replace(/<script.*ag_agent_hanhua\.js.*><\/script>/g, '');
    
    if (content.includes('</body>')) {
        content = content.replace('</body>', `${injectStr}</body>`);
    } else {
        content += injectStr;
    }
        
    fs.writeFileSync(absPath, content, 'utf-8');
    return true;
}

function updateChecksums10(installDir) {
    const productJsonPath = path.join(installDir, "resources", "app", "product.json");
    if (!fs.existsSync(productJsonPath)) return;
    
    const data = JSON.parse(fs.readFileSync(productJsonPath, 'utf-8'));
    
    for (const relPath of OLD_TARGET_FILES) {
        const absPath = path.join(installDir, relPath);
        if (fs.existsSync(absPath)) {
            const key = relPath.replace(/\\/g, "/").replace("resources/app/out/", "");
            
            const fileBuffer = fs.readFileSync(absPath);
            const hash = crypto.createHash('sha256').update(fileBuffer).digest();
            data.checksums[key] = hash.toString('base64').replace(/=/g, '');
        }
    }
    
    fs.writeFileSync(productJsonPath, JSON.stringify(data, null, '\t'), 'utf-8');
}

function install10(installDir) {
    console.log("====== 检测到 Antigravity 1.0 架构，正在使用 HTML 注入引擎 ======");
    backupFiles10(installDir);
    
    // 生成单独的 js 汉化文件
    const hanhuaJsPath = path.join(installDir, "resources", "app", "out", "ag_agent_hanhua.js");
    fs.mkdirSync(path.dirname(hanhuaJsPath), { recursive: true });
    
    const jsContent = generateJs();
    fs.writeFileSync(hanhuaJsPath, jsContent, 'utf-8');
        
    for (const html of OLD_TARGET_FILES) {
        if (injectHtml10(installDir, html)) {
            console.log(`[√] 注入成功: ${path.basename(html)}`);
        }
    }
            
    updateChecksums10(installDir);
    resignAppOnMac(installDir);
    console.log("[√] Antigravity 1.0 汉化部署完成！");
    return true;
}

function restore10(installDir) {
    console.log("====== 正在恢复 Antigravity 1.0 官方原版 ======");
    let changed = false;
    for (const relPath of OLD_TARGET_FILES) {
        const absPath = path.join(installDir, relPath);
        const bakPath = absPath + ".bak";
        if (fs.existsSync(bakPath)) {
            fs.copyFileSync(bakPath, absPath);
            fs.unlinkSync(bakPath);
            console.log(`[还原] 已恢复 HTML: ${path.basename(absPath)}`);
            changed = true;
        }
    }
    
    const hanhuaJsPath = path.join(installDir, "resources", "app", "out", "ag_agent_hanhua.js");
    if (fs.existsSync(hanhuaJsPath)) {
        fs.unlinkSync(hanhuaJsPath);
        console.log(`[还原] 已删除汉化脚本`);
        changed = true;
    }
        
    if (changed) {
        updateChecksums10(installDir);
        resignAppOnMac(installDir);
        console.log("[√] 校验值已同步，1.0 软件恢复至原始状态。");
    } else {
        console.log("[!] 未找到 1.0 备份文件。");
    }
    return true;
}

// ==========================================
// 入口
// ==========================================
async function main() {
    let huifu = false;
    let manualDir = "";
    let noKill = true; // 默认不主动杀死客户端，防止中断用户当前的智能体配对会话
    let hubConfig = null;
    let confirmUnverified = false;

    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--huifu') {
            huifu = true;
        } else if (args[i] === '--install-dir') {
            manualDir = args[i + 1] || "";
            i++;
        } else if (args[i] === '--no-kill') {
            noKill = true;
        } else if (args[i] === '--close-app') {
            noKill = false;
        } else if (args[i] === '--brand-title' || args[i] === '--enable' || args[i] === '--disable') {
            i++;
        } else if (args[i] === '--confirm-unverified-baseline') {
            confirmUnverified = true;
        } else if (args[i] === '--hub-config') {
            if (hubConfig || !args[i + 1] || args[i + 1].length > 2048) throw new Error('Invalid Hub config');
            const candidate = JSON.parse(args[++i]);
            const ranges = { opacity: [0.15, 1], blur: [0, 25], brightness: [50, 150],
                contrast: [50, 160], saturate: [30, 180], darken: [0, 50] };
            if (!USE_WALLPAPER || huifu || !candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
                typeof candidate.workshopId !== 'string' || !/^\d{1,20}$/.test(candidate.workshopId) ||
                Object.keys(candidate).some(key => key !== 'workshopId' && key !== 'flipHorizontal' && !ranges[key]) ||
                (candidate.flipHorizontal !== undefined && typeof candidate.flipHorizontal !== 'boolean') ||
                Object.entries(ranges).some(([key, [min, max]]) => candidate[key] !== undefined &&
                    (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key]) ||
                        candidate[key] < min || candidate[key] > max))) throw new Error('Invalid Hub config');
            hubConfig = candidate;
        }
    }
    if (hubConfig && huifu) throw new Error('Invalid Hub config');

    // 1. 探测路径
    const installDir = detectInstallationDir(manualDir);
    
    // 2. 找到 resources 资源目录
    let resourcesDir = "";
    if (fs.existsSync(path.join(installDir, "resources"))) {
        resourcesDir = path.join(installDir, "resources");
    } else if (fs.existsSync(path.join(installDir, "Contents", "Resources"))) {
        resourcesDir = path.join(installDir, "Contents", "Resources");
    } else if (installDir.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase().endsWith("/resources")) {
        resourcesDir = installDir;
    } else {
        if (fs.existsSync(path.join(installDir, "app.asar"))) {
            resourcesDir = installDir;
        } else {
            resourcesDir = path.join(installDir, "resources");
        }
    }

    if (!fs.existsSync(resourcesDir)) {
        console.error(`[错误] 无法定位有效的资源(resources)目录: ${resourcesDir}`);
        throw new Error(`无法定位有效的资源目录: ${resourcesDir}`);
    }

    ensureWritePermission(resourcesDir);

    // 3. 根据架构执行
    const asarPath = path.join(resourcesDir, "app.asar");
    let isV2 = fs.existsSync(asarPath) || fs.existsSync(`${asarPath}.rollback`) ||
        fs.existsSync(path.join(resourcesDir, 'app.asar.baseline.json'));
    let success = false;
    let transaction = isV2 || hubConfig ? await import('./asar_transaction.mjs') : null;
    if (!isV2) {
        // 官方原版备份已移到安装目录外的仓库（见 asar_transaction.mjs 的 baselineStoreDir）
        const tx = transaction || await import('./asar_transaction.mjs');
        if (fs.existsSync(tx.baselinePointerPath(resourcesDir))) {
            isV2 = true;
            transaction = tx;
        }
    }
    const releaseLock = transaction ? transaction.acquireLock(resourcesDir) : null;
    try {
    const txCtx = transaction && transaction.createTransactionContext ? transaction.createTransactionContext() : null;
    if (isV2) transaction.preflightBaselineConsent(resourcesDir, { confirmUnverified, txCtx });
    wasAppRunning = checkIfAppIsRunning(installDir);
    if (wasAppRunning && noKill) {
        throw new Error('Antigravity 正在运行；请先手动关闭，或明确使用 --close-app。');
    }
    if (wasAppRunning) {
        closeAntigravityProcesses(installDir);
        if (checkIfAppIsRunning(installDir)) throw new Error('Antigravity 未能关闭，已停止写入。');
    }
    if (isV2) {
        if (checkIfAppIsRunning(installDir)) throw new Error('Antigravity 在锁定后重新启动，已停止写入。');
        transaction.recover(resourcesDir, { rescueSidecar: huifu,
            configFile: path.join(__dirname, 'wallpaper_config.json'), confirmUnverified, txCtx });
        transaction.cleanupOrphanStages(resourcesDir, path.join(__dirname, 'wallpaper_config.json'));
    }
    let configPlan = null;
    if (hubConfig) {
        if (!isV2) throw new Error('Hub config transaction requires ASAR installation');
        const configFile = path.join(__dirname, 'wallpaper_config.json');
        let current = {};
        if (fs.existsSync(configFile)) {
            try { current = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
            catch (error) { if (!(error instanceof SyntaxError)) throw error; }
        }
        if (!current || typeof current !== 'object' || Array.isArray(current)) current = {};
        configPlan = { file: configFile, value: { ...current, ...hubConfig } };
    }
    if (huifu) {
        console.log("====== 正在卸载中文汉化，恢复官方原版 ======");
        if (isV2) {
            success = restore20(resourcesDir, transaction, confirmUnverified);
        } else {
            success = restore10(installDir);
        }
    } else {
        console.log("====== 正在安装 Antigravity 中文汉化 ======");
        if (isV2) {
            success = await install20(resourcesDir, transaction, confirmUnverified, configPlan, txCtx);
        } else {
            success = install10(installDir);
        }
    }
    } finally {
        if (releaseLock) releaseLock();
    }

    // 5. 校验通过且原来客户端被关闭，则自动重新启动客户端
    if (success && wasAppRunning && !noKill) {
        console.log("\n[启动] 检测到安装前反重力客户端处于开启状态，正在重新启动客户端...");
        try {
            if (process.platform === 'win32') {
                const exePath = path.join(installDir, 'Antigravity.exe');
                if (fs.existsSync(exePath)) {
                    const child = child_process.spawn(exePath, [], {
                        detached: true,
                        stdio: 'ignore'
                    });
                    child.unref();
                    console.log("[启动] 客户端启动成功！");
                } else {
                    console.warn(`[警告] 未找到客户端主程序: ${exePath}`);
                }
            } else if (process.platform === 'darwin') {
                child_process.execFileSync('open', [installDir], { stdio: 'ignore', shell: false });
                console.log("[启动] 客户端启动成功！");
            }
        } catch (e) {
            console.warn(`[警告] 客户端启动失败: ${e.message}`);
        }
    }

    if (!success) process.exitCode = 1;
}

main().catch(error => {
    console.error(`[错误] ${error.code === 'ASAR_BUSY' ? 'ASAR_BUSY: ' : ''}${error.message}`);
    process.exitCode = error.code === 'ASAR_BUSY' ? 75 : 1;
});
