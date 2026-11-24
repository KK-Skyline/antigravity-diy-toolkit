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
    const enable = ['devtools'];
    const disable = ['wallpaper-engine', 'theme-acrylic', 'fx-rain'];
    if (NO_I18N) {
        disable.push('i18n-zh');
    } else {
        enable.push('i18n-zh');
    }
    if (USE_DARK_BLUE) enable.push('theme-obsidian-blue');
    else disable.push('theme-obsidian-blue');

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

    return pluginLoader.resolvePlugins(__dirname, {
        enable,
        disable,
        settings: {
            'i18n-zh': {
                locale: USE_TW ? 'zh-TW' : 'zh-CN',
                brandTitle: BRAND_TITLE_MODE
            }
        }
    });
}

// 注入到 Antigravity 主进程的视频壁纸服务 (dist/agWallpaperVideo.js)
// - 只监听 127.0.0.1、随机端口，只提供 preload 指定的那一个 .mp4 / .webm 文件
// - 支持 Range（循环 / 拖动）与 CORS（渲染进程画布可读像素，用于取色和亮度自适应）
const WALLPAPER_VIDEO_MAIN_MODULE = [
    "'use strict';",
    "// Antigravity 视频壁纸服务（由 antigravity2-cn/localization_engine.js 注入）",
    "const { ipcMain, app } = require('electron');",
    "const http = require('http');",
    "const fs = require('fs');",
    "let current = { path: '', mime: 'video/mp4' };",
    "let server = null;",
    "let urlPromise = null;",
    "function handle(req, res) {",
    "    let size;",
    "    try { size = fs.statSync(current.path).size; } catch (e) { res.writeHead(404); res.end(); return; }",
    "    const headers = { 'Content-Type': current.mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };",
    "    const m = /bytes=(\\d*)-(\\d*)/.exec(req.headers.range || '');",
    "    let start = 0, end = size - 1, status = 200;",
    "    if (m) {",
    "        start = m[1] ? +m[1] : 0;",
    "        end = m[2] ? Math.min(+m[2], size - 1) : size - 1;",
    "        if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); res.end(); return; }",
    "        status = 206;",
    "        headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;",
    "    }",
    "    headers['Content-Length'] = end - start + 1;",
    "    res.writeHead(status, headers);",
    "    const stream = fs.createReadStream(current.path, { start: start, end: end });",
    "    res.on('close', () => stream.destroy());",
    "    stream.pipe(res);",
    "}",
    "function start() {",
    "    if (urlPromise) return urlPromise;",
    "    urlPromise = new Promise((resolve, reject) => {",
    "        server = http.createServer(handle);",
    "        server.on('error', e => { urlPromise = null; reject(e); });",
    "        server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/wallpaper'));",
    "    });",
    "    return urlPromise;",
    "}",
    "ipcMain.handle('antigravity:wallpaper-video-url', async (_event, filePath, mime) => {",
    "    if (typeof filePath !== 'string' || !/\\.(mp4|webm)$/i.test(filePath) || !fs.existsSync(filePath)) {",
    "        throw new Error('invalid wallpaper video: ' + filePath);",
    "    }",
    "    current = { path: filePath, mime: mime === 'video/webm' ? 'video/webm' : 'video/mp4' };",
    "    return start();",
    "});",
    "app.on('will-quit', () => { try { if (server) server.close(); } catch (e) {} });",
    ""
].join('\n');

// 是否是 Wallpaper Engine 自带的低清缩略图（preview.gif / preview.jpg 等，通常只有 200px 左右）。
// 我们自己生成的 preview_hd.jpg / preview_animated.webp 不算。
function isLowResThumbnail(file) {
    if (!file || !fs.existsSync(file)) return true;
    const base = path.basename(file).toLowerCase();
    if (base.startsWith('preview_hd') || base.startsWith('preview_animated')) return false;
    try {
        const buf = Buffer.alloc(64 * 1024);
        const fd = fs.openSync(file, 'r');
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        let w = 0, h = 0;
        if (buf.toString('ascii', 0, 3) === 'GIF') { w = buf.readUInt16LE(6); h = buf.readUInt16LE(8); }
        else if (buf.readUInt32BE(0) === 0x89504e47) { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
        else if (buf[0] === 0xff && buf[1] === 0xd8) {
            // JPEG：找 SOF0/SOF2 段读尺寸
            for (let i = 2; i + 9 < n;) {
                if (buf[i] !== 0xff) { i++; continue; }
                const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
                if (marker === 0xc0 || marker === 0xc2) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
                i += 2 + len;
            }
        }
        if (!w || !h) return false;
        return Math.min(w, h) < 720;
    } catch (e) {
        return false;
    }
}

// 场景壁纸里由 Wallpaper Engine 实时渲染的粒子特效（静态原画里没有），运行时用画布重绘。
// 目前识别"下雨"：场景包里有 rain 粒子，且壁纸设置里的下雨开关没有关掉。
function detectSceneEffects(dir) {
    const effects = {};
    try {
        const pkg = path.join(dir, "scene.pkg");
        if (!fs.existsSync(pkg)) return effects;
        // scene.pkg 开头是明文文件名目录，读前 256KB 就够
        const fd = fs.openSync(pkg, "r");
        const buf = Buffer.alloc(Math.min(fs.statSync(pkg).size, 256 * 1024));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        const names = buf.toString("latin1").toLowerCase();
        let rainOn = /particles\/[^\x00]*rain/.test(names);
        try {
            const proj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
            const prop = proj.general && proj.general.properties && proj.general.properties.rain;
            if (prop && Array.isArray(prop.options)) {
                const opt = prop.options.find(o => String(o.value) === String(prop.value));
                if (opt && /off|关/i.test(String(opt.label))) rainOn = false;
            } else if (prop && prop.type === "bool" && prop.value === false) {
                rainOn = false;
            }
        } catch (e) {}
        if (rainOn) effects.rain = { intensity: /down_?pour|heavy|storm/.test(names) ? 1 : 0.6 };
    } catch (e) {}
    return effects;
}

function generateJs(configOverride = null) {
    let bakedWallpaper = null;
    if (USE_WALLPAPER) {
        try {
            let userCfg = {
                enabled: true,
                workshopId: "3284620554",
                monitor: "Monitor0",
                opacity: 0.68,
                blur: 0,
                brightness: 105,
                contrast: 110,
                saturate: 110,
                darken: 18,
                flipHorizontal: false,
                caretColor: "#4f8cff"
            };
            const cfgFile = path.join(__dirname, 'wallpaper_config.json');
            if (fs.existsSync(cfgFile)) {
                try { Object.assign(userCfg, JSON.parse(fs.readFileSync(cfgFile, 'utf8'))); } catch(e) {}
            }
            if (configOverride) Object.assign(userCfg, configOverride);
            if (!/^\d{1,20}$/.test(String(userCfg.workshopId))) throw new Error('Invalid workshopId');
            const weReader = require('./wallpaper_engine_reader');
            let wp = weReader.getActiveWallpaper(userCfg.monitor, userCfg.workshopId);
            // 预处理：场景壁纸合成高清原画（或提取嵌入视频），视频壁纸只补一张有内容的封面。
            // 视频本身不再转成动图（会截断时长、放大出颗粒、CPU 解码掉帧），运行时直接播放原视频。
            try {
                const prepScript = path.join(__dirname, 'prepare_hd_wallpaper.py');
                if (fs.existsSync(prepScript) && userCfg.workshopId) {
                    child_process.execFileSync('python', [prepScript, String(userCfg.workshopId)], { stdio: 'ignore', windowsHide: true, shell: false });
                    wp = weReader.getActiveWallpaper(userCfg.monitor, userCfg.workshopId);
                }
            } catch (e) {}
            // 质量关卡：选中的壁纸如果只剩 Wallpaper Engine 自带的低清缩略图（视频没下载完、也没有场景原画），
            // 铺满窗口只会是一片马赛克 —— 拒绝使用，继续保留上一张正常的壁纸。
            const lastGoodFile = path.join(__dirname, 'last_good_wallpaper.json');
            if (wp && !wp.videoPath && isLowResThumbnail(wp.mediaPath)) {
                const reason = wp.videoMissing ? '视频文件还没下载完成（请在 Wallpaper Engine / Steam 里让它下载完整）' : '只有低清预览图，没有可用的高清原画';
                console.warn(`[壁纸引擎] ⚠ "${wp.title}" ${reason}，本次不使用它。`);
                let lastGood = null;
                try { lastGood = JSON.parse(fs.readFileSync(lastGoodFile, 'utf8')); } catch (e) {}
                const fallback = lastGood && lastGood.workshopId ? weReader.getWallpaperById(lastGood.workshopId) : null;
                if (fallback && (fallback.videoPath || fallback.mediaPath)) {
                    console.warn(`[壁纸引擎] 继续使用上一张正常的壁纸: "${fallback.title}"`);
                    wp = fallback;
                } else {
                    console.warn(`[壁纸引擎] 没有可回退的壁纸记录，暂时使用低清预览图（主题照常加载）。`);
                }
            } else if (wp && userCfg.workshopId && (wp.videoPath || wp.mediaPath)) {
                try { fs.writeFileSync(lastGoodFile, JSON.stringify({ workshopId: String(userCfg.workshopId), title: wp.title }, null, 2), 'utf8'); } catch (e) {}
            }
            const hasPoster = wp && wp.mediaPath && fs.existsSync(wp.mediaPath);
            if (hasPoster || (wp && wp.videoPath)) {
                const buf = hasPoster ? fs.readFileSync(wp.mediaPath) : null;
                bakedWallpaper = {
                    title: wp.title || 'Wallpaper Engine',
                    type: wp.type || 'image',
                    mediaType: wp.mediaType || 'image/jpeg',
                    dataUrl: buf ? `data:${wp.mediaType || 'image/jpeg'};base64,${buf.toString('base64')}` : '',
                    videoPath: wp.videoPath || '',
                    videoMime: wp.videoMime || '',
                    effects: wp.dir && wp.type !== 'video' ? detectSceneEffects(wp.dir) : {},
                    config: userCfg
                };
                if (bakedWallpaper.effects.rain) console.log(`[壁纸引擎] 检测到场景下雨特效，将用画布实时绘制雨滴 (强度 ${bakedWallpaper.effects.rain.intensity})`);
                console.log(wp.videoPath
                    ? `[壁纸引擎] 成功识别视频壁纸: "${wp.title}"，将直接播放原视频: ${wp.videoPath}`
                    : `[壁纸引擎] 成功提取当前激活壁纸: "${wp.title}" (${wp.type}, ${(buf.length / 1024).toFixed(1)} KB)`);
            } else {
                console.warn(`[壁纸引擎] 未能找到激活壁纸的有效预览文件。`);
            }
        } catch (err) {
            console.warn(`[壁纸引擎] 提取壁纸异常: ${err.message}`);
        }
    }

    const jsInnerSource = `
    // Wallpaper Engine 实时动态联动换肤引擎 (零依赖、防沙箱拦截)
    const USE_WE_WALLPAPER = ${USE_WALLPAPER ? "true" : "false"};
    const BAKED_WE_DATA = ${JSON.stringify(bakedWallpaper)};
    if (USE_WE_WALLPAPER && BAKED_WE_DATA && (BAKED_WE_DATA.dataUrl || BAKED_WE_DATA.videoPath)) {
        (function initWallpaperEngine() {
            let currentWp = BAKED_WE_DATA;

            // 失重亚克力主题 CSS（打包时从 theme-acrylic.css 读入）
            const ACRYLIC_CSS = ACRYLIC_CSS_PLACEHOLDER;

            // ---------- 颜色工具（与 design/acrylic_preview.html 同一套算法） ----------
            function rgb2hsl(r, g, b) {
                r /= 255; g /= 255; b /= 255;
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
                if (mx === mn) return [0, 0, l];
                const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
                const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
                return [h * 60, s, l];
            }
            function hsl2rgb(h, s, l) {
                const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
                const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
                return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
            }
            function luminance(c) {
                const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
                return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
            }
            // 调成适合深色 UI 的强调色：饱和度夹在 0.5~0.85，明度固定 0.66
            function tuneAccent(c) {
                const hsl = rgb2hsl(c[0], c[1], c[2]);
                return hsl2rgb(hsl[0], Math.min(0.85, Math.max(0.5, hsl[1])), 0.66);
            }

            // ---------- 画面分析：色相分布（取色用）+ 平均亮度（自适应用） ----------
            // 36 个色相桶（每桶 10°），按"饱和度² × 中间调权重"累加
            function analyzeFrame(src, sw, sh) {
                const w = 120, h = Math.max(1, Math.round(120 * sh / sw));
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                const ctx = cv.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(src, 0, 0, w, h);
                const d = ctx.getImageData(0, 0, w, h).data;
                const bins = [];
                for (let i = 0; i < 36; i++) bins.push({ w: 0, r: 0, g: 0, b: 0 });
                let lumSum = 0, n = 0;
                for (let i = 0; i < d.length; i += 4) {
                    lumSum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++;
                    const hsl = rgb2hsl(d[i], d[i + 1], d[i + 2]);
                    if (hsl[1] < 0.18 || hsl[2] < 0.1 || hsl[2] > 0.93) continue;
                    const wt = hsl[1] * hsl[1] * (1 - Math.abs(hsl[2] - 0.5) * 1.3);
                    if (wt <= 0) continue;
                    const bn = bins[Math.floor(hsl[0] / 10) % 36];
                    bn.w += wt; bn.r += d[i] * wt; bn.g += d[i + 1] * wt; bn.b += d[i + 2] * wt;
                }
                return { bins: bins, lum: n ? lumSum / n : 0 };
            }
            function mergeBins(a, b) {
                return a.map((x, i) => ({ w: x.w + b[i].w, r: x.r + b[i].r, g: x.g + b[i].g, b: x.b + b[i].b }));
            }
            function accentFromBins(bins) {
                const top = bins.filter(b => b.w > 0).sort((a, b) => b.w - a.w)[0];
                if (!top) return null;   // 黑白壁纸：保留默认强调色
                return tuneAccent([Math.round(top.r / top.w), Math.round(top.g / top.w), Math.round(top.b / top.w)]);
            }
            function manualAccent(wp) {
                const m = wp && wp.config && wp.config.accent;
                if (typeof m === 'string' && /^#[0-9a-f]{6}$/i.test(m)) return tuneAccent([1, 3, 5].map(i => parseInt(m.slice(i, i + 2), 16)));
                return null;
            }
            function setAccent(c) {
                const root = document.documentElement;
                if (!root || !c) return;
                root.style.setProperty('--ag-accent', c.join(' '));
                root.style.setProperty('--ag-tint-h', String(Math.round(rgb2hsl(c[0], c[1], c[2])[0])));
                root.style.setProperty('--ag-accent-ink', luminance(c) > 0.35 ? '6 14 16' : '255 255 255');
            }

            // ---------- 亮度自适应 ----------
            // 深色壁纸保持设计 Token 原值；越亮的壁纸，玻璃越不透明、阅读遮罩越深、壁纸压得越暗，保证文字可读。
            // 用指数平滑（EMA）+ CSS @property 过渡，视频画面明暗变化时不会闪。
            let adaptBase = null, lumEma = null;
            function setAdaptive(lum) {
                const root = document.documentElement;
                if (!root) return;
                if (!adaptBase) {
                    const cs = getComputedStyle(root);
                    const num = (p, d) => { const v = parseFloat(cs.getPropertyValue(p)); return isNaN(v) ? d : v; };
                    adaptBase = { glass: num('--ag-glass-a', 0.32), bright: num('--ag-wp-bright', 0.91), scrim: num('--ag-scrim', 0.34) };
                }
                lumEma = lumEma === null ? lum : lumEma * 0.7 + lum * 0.3;
                const t = Math.min(1, Math.max(0, (lumEma - 0.30) / 0.40));
                root.style.setProperty('--ag-glass-a', (adaptBase.glass + Math.max(0, 0.72 - adaptBase.glass) * t).toFixed(3));
                root.style.setProperty('--ag-wp-bright', (adaptBase.bright - Math.max(0, adaptBase.bright - 0.6) * t).toFixed(3));
                root.style.setProperty('--ag-scrim', (adaptBase.scrim + Math.max(0, 0.62 - adaptBase.scrim) * t).toFixed(3));
            }

            // 静态 / 动图壁纸：取色 + 亮度只需分析一次
            function analyzeImage(wp) {
                try {
                    const manual = manualAccent(wp);
                    if (manual) setAccent(manual);
                    if (!wp.dataUrl) return;
                    const img = new Image();
                    img.onload = () => {
                        try {
                            const r = analyzeFrame(img, img.naturalWidth, img.naturalHeight);
                            if (!manual) setAccent(accentFromBins(r.bins));
                            setAdaptive(r.lum);
                        } catch (e) { console.warn('[Antigravity] 壁纸分析失败，使用默认参数:', e); }
                    };
                    img.src = wp.dataUrl;
                } catch (e) {}
            }

            // ---------- 视频壁纸：直接播放原视频 ----------
            // preload 处于 Electron 沙箱中（不能用 http / fs），视频由注入主进程的 agWallpaperVideo.js 提供：
            // 只监听 127.0.0.1、随机端口，支持 Range 与 CORS。这里通过 IPC 取播放地址。
            const videoSource = { path: '', mime: 'video/mp4' };
            function startVideoServer() {
                const electron = require('electron');
                return electron.ipcRenderer.invoke('antigravity:wallpaper-video-url', videoSource.path, videoSource.mime);
            }

            let videoEl = null, sampleTimer = null, accentBins = null, accentSamples = 0;
            function sampleVideo() {
                try {
                    if (!videoEl || videoEl.readyState < 2 || document.hidden || !videoEl.videoWidth) return;
                    const r = analyzeFrame(videoEl, videoEl.videoWidth, videoEl.videoHeight);
                    setAdaptive(r.lum);
                    // 前 6 次采样（约 15 秒）合并色相分布后定下强调色，之后不再变，避免界面颜色跟着画面乱跳
                    if (!manualAccent(currentWp) && accentSamples < 6) {
                        accentBins = accentBins ? mergeBins(accentBins, r.bins) : r.bins;
                        accentSamples++;
                        const c = accentFromBins(accentBins);
                        if (c) setAccent(c);
                    }
                } catch (e) {}
            }
            function unmountVideo() {
                if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
                if (videoEl) { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); videoEl.remove(); videoEl = null; }
            }
            function mountVideo(wp, filter) {
                if (!document.body) {
                    document.addEventListener('DOMContentLoaded', () => mountVideo(wp, filter), { once: true });
                    return;
                }
                if (!videoEl) {
                    videoEl = document.createElement('video');
                    videoEl.id = 'ag-wallpaper-video';
                    videoEl.muted = true; videoEl.loop = true; videoEl.autoplay = true; videoEl.playsInline = true;
                    videoEl.crossOrigin = 'anonymous';
                    videoEl.setAttribute('aria-hidden', 'true');
                    // 放在 body 最前面（#root 之外），不碰 React 管理的 DOM
                    document.body.insertBefore(videoEl, document.body.firstChild);
                    // Chromium 会在窗口被遮挡时暂停静音视频省电，但恢复可见后不会自动续播
                    const resume = () => { if (videoEl && !document.hidden && videoEl.paused) videoEl.play().catch(() => {}); };
                    document.addEventListener('visibilitychange', resume);
                    window.addEventListener('focus', resume);
                    sampleTimer = setInterval(sampleVideo, 2500);
                }
                videoEl.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover;z-index:0;pointer-events:none;filter:' + filter + ';';
                if (videoSource.path !== wp.videoPath) {
                    videoSource.path = wp.videoPath;
                    videoSource.mime = wp.videoMime || 'video/mp4';
                    accentBins = null; accentSamples = 0; lumEma = null;
                    const manual = manualAccent(wp);
                    if (manual) setAccent(manual);
                    startVideoServer().then(url => {
                        if (!videoEl) return;
                        videoEl.src = url + '?v=' + Date.now();
                        videoEl.play().catch(() => {});
                    }).catch(e => console.warn('[Antigravity] 视频壁纸服务启动失败，保留静态封面:', e));
                }
            }

            // ---------- 场景特效：下雨 ----------
            // Wallpaper Engine 的雨是粒子系统实时渲染的，静态原画里没有。这里用一层透明画布重绘：
            // 远 / 中 / 近三个景深层（远处细、慢、淡，近处长、快、亮），统一带风向倾斜。
            // 窗口不可见时不绘制；系统开启"减少动态效果"时不启用。
            const RAIN_LAYERS = [
                { len: [10, 16], speed: [700, 900], alpha: [0.10, 0.18], width: 0.8, share: 0.5 },
                { len: [16, 26], speed: [1000, 1300], alpha: [0.16, 0.28], width: 1.0, share: 0.35 },
                { len: [28, 44], speed: [1500, 1900], alpha: [0.24, 0.38], width: 1.4, share: 0.15 }
            ];
            const RAIN_SLANT = 0.12;   // 风向：每下落 1px 向右横移 0.12px
            let rainCanvas = null, rainRaf = 0, rainDrops = [], rainLast = 0, rainOpts = null;
            function rainRange(r) { return r[0] + Math.random() * (r[1] - r[0]); }
            function newDrop(anywhere) {
                const p = Math.random();
                let acc = 0, layer = RAIN_LAYERS[0];
                for (const l of RAIN_LAYERS) { acc += l.share; if (p <= acc) { layer = l; break; } }
                const W = innerWidth, H = innerHeight, len = rainRange(layer.len);
                return {
                    x: Math.random() * (W + H * RAIN_SLANT) - H * RAIN_SLANT,
                    y: anywhere ? Math.random() * H : -len - Math.random() * 80,
                    len: len, speed: rainRange(layer.speed), alpha: rainRange(layer.alpha), width: layer.width
                };
            }
            function resizeRain() {
                if (!rainCanvas) return;
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                rainCanvas.width = Math.round(innerWidth * dpr);
                rainCanvas.height = Math.round(innerHeight * dpr);
                const count = Math.round(innerWidth * innerHeight / 3200 * (rainOpts ? rainOpts.intensity : 0.6));
                rainDrops = [];
                for (let i = 0; i < count; i++) rainDrops.push(newDrop(true));
            }
            function drawRain(t) {
                rainRaf = requestAnimationFrame(drawRain);
                if (!rainCanvas || document.hidden) { rainLast = t; return; }
                const dt = Math.min(0.05, (t - (rainLast || t)) / 1000);
                rainLast = t;
                const ctx = rainCanvas.getContext('2d');
                const dpr = rainCanvas.width / innerWidth;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, innerWidth, innerHeight);
                ctx.lineCap = 'round';
                const H = innerHeight;
                for (let i = 0; i < rainDrops.length; i++) {
                    const d = rainDrops[i];
                    const dy = d.speed * dt;
                    d.y += dy; d.x += dy * RAIN_SLANT;
                    if (d.y - d.len > H) { rainDrops[i] = newDrop(false); continue; }
                    ctx.strokeStyle = 'rgba(214, 232, 240, ' + d.alpha + ')';
                    ctx.lineWidth = d.width;
                    ctx.beginPath();
                    ctx.moveTo(d.x, d.y);
                    ctx.lineTo(d.x - d.len * RAIN_SLANT, d.y - d.len);
                    ctx.stroke();
                }
            }
            function unmountRain() {
                if (rainRaf) cancelAnimationFrame(rainRaf);
                rainRaf = 0;
                window.removeEventListener('resize', resizeRain);
                if (rainCanvas) { rainCanvas.remove(); rainCanvas = null; }
            }
            function mountRain(opts) {
                rainOpts = opts || { intensity: 0.6 };
                if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                if (!document.body) {
                    document.addEventListener('DOMContentLoaded', () => mountRain(opts), { once: true });
                    return;
                }
                // 启动时页面会重新加载一次：旧页面上的画布已经脱离文档，要重建
                if (rainCanvas && !rainCanvas.isConnected) unmountRain();
                if (rainCanvas) return;
                rainCanvas = document.createElement('canvas');
                rainCanvas.id = 'ag-rain-canvas';
                rainCanvas.setAttribute('aria-hidden', 'true');
                rainCanvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none;';
                // 放在视频壁纸之上、#root 之下，不碰 React 管理的 DOM
                const video = document.getElementById('ag-wallpaper-video');
                document.body.insertBefore(rainCanvas, video ? video.nextSibling : document.body.firstChild);
                window.addEventListener('resize', resizeRain);
                resizeRain();
                rainRaf = requestAnimationFrame(drawRain);
            }

            function applyWallpaper(wp) {
                try {
                    if (!wp || !(wp.dataUrl || wp.videoPath)) return;
                    const cfg = wp.config || {};
                    if (cfg.enabled === false) return;

                    const blurVal = cfg.blur ? cfg.blur + 'px' : '0px';
                    const contVal = typeof cfg.contrast === 'number' ? cfg.contrast : 105;
                    const satVal = typeof cfg.saturate === 'number' ? cfg.saturate : 110;
                    const artFilter = 'brightness(var(--ag-wp-bright, .91)) contrast(' + contVal + '%) saturate(' + satVal + '%) blur(' + blurVal + ')';

                    // 1. 注入或更新样式：L0 壁纸层 + 失重亚克力主题（theme-acrylic.css）
                    let styleEl = document.getElementById('antigravity-we-style');
                    if (!styleEl) {
                        styleEl = document.createElement('style');
                        styleEl.id = 'antigravity-we-style';
                        const head = document.head || document.documentElement;
                        if (head) head.appendChild(styleEl);
                    }

                    styleEl.textContent = [
                        'html, body {',
                        '  background-color: #05080a !important;',
                        '  overflow: hidden !important;',
                        '  width: 100% !important;',
                        '  height: 100% !important;',
                        '  margin: 0 !important;',
                        '  padding: 0 !important;',
                        '}',
                        '/* L0 艺术层：静态壁纸 / 视频壁纸加载前的封面，满铺且不整体压暗（亮度由 --ag-wp-bright 控制） */',
                        'body::before {',
                        '  content: "" !important;',
                        '  position: fixed !important;',
                        '  inset: -10px !important;',
                        '  z-index: 0 !important;',
                        '  pointer-events: none !important;',
                        wp.dataUrl ? '  background: url(\"' + wp.dataUrl + '\") center / cover no-repeat !important;' : '  background: none !important;',
                        '  filter: ' + artFilter + ' !important;',
                        '}',
                        '/* 局部遮罩：只压暗顶部、底部、左侧，保证文字可读；深度跟随 --ag-scrim（亮色壁纸自动加深） */',
                        'body::after {',
                        '  content: "" !important;',
                        '  position: fixed !important;',
                        '  inset: 0 !important;',
                        '  z-index: 0 !important;',
                        '  pointer-events: none !important;',
                        '  background:',
                        '    linear-gradient(180deg, rgb(0 0 0 / calc(var(--ag-scrim, .34) * .94)) 0, rgb(0 0 0 / calc(var(--ag-scrim, .34) * .41)) 60px, transparent 140px),',
                        '    linear-gradient(0deg, rgb(0 0 0 / calc(var(--ag-scrim, .34) * 1.24)) 0, transparent 240px),',
                        '    linear-gradient(90deg, rgb(0 0 0 / calc(var(--ag-scrim, .34) * .88)) 0, transparent 380px) !important;',
                        '}',
                        '#root {',
                        '  position: relative !important;',
                        '  z-index: 1 !important;',
                        '  width: 100% !important;',
                        '  height: 100% !important;',
                        '  overflow: hidden !important;',
                        '  background-color: transparent !important;',
                        '}',
                        ACRYLIC_CSS
                    ].join('\\n');

                    // 2. 视频壁纸挂载 <video> 播放原视频；其他壁纸分析一次画面（取色 + 亮度自适应）
                    if (wp.type === 'video' && wp.videoPath) {
                        mountVideo(wp, artFilter);
                    } else {
                        unmountVideo();
                        // 启动时页面会重新加载一次，写在旧 <html> 上的结果会丢：换了壁纸，或者当前页面上还没有分析结果，就（重新）分析
                        if (wp !== analyzeImage.last || !document.documentElement.style.getPropertyValue('--ag-glass-a')) { analyzeImage.last = wp; analyzeImage(wp); }
                    }

                    // 3. 场景特效（下雨）：Wallpaper Engine 实时渲染的粒子，用画布重绘
                    if (wp.effects && wp.effects.rain) mountRain(wp.effects.rain); else unmountRain();

                    console.log('[Antigravity] 联动 Wallpaper Engine 渲染成功: ' + (wp.title || '壁纸已应用') + (wp.videoPath ? '（原视频播放）' : ''));
                } catch(e) {
                    console.error('[Antigravity] Wallpaper Engine 渲染异常:', e);
                }
            }

            // 多时机挂载保证无论 DOM 加载早晚均能成功绘制
            applyWallpaper(currentWp);
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => applyWallpaper(currentWp));
            }
            window.addEventListener('load', () => applyWallpaper(currentWp));
            setTimeout(() => applyWallpaper(currentWp), 100);
            setTimeout(() => applyWallpaper(currentWp), 500);

            // 尝试注册 IPC 监听（若主进程开启了实时推送）
            try {
                const electron = require('electron');
                if (electron && electron.ipcRenderer) {
                    electron.ipcRenderer.on('antigravity:wallpaper-update', (_e, newWp) => {
                        if (newWp) {
                            currentWp = newWp;
                            applyWallpaper(currentWp);
                        }
                    });
                }
            } catch(e) {}

            // 原生窗口按钮区（最小化/最大化/关闭）：主进程把背景写死成 #131313，CSS 改不到。
            // 拦截前端发出的 set-title-bar-overlay 请求，统一改成透明，切换主题后也不会变回深灰。
            try {
                const electron = require('electron');
                const ipc = electron && electron.ipcRenderer;
                if (ipc && process.platform === 'win32') {
                    const TITLE_BAR_OVERLAY = { color: '#00000000', symbolColor: '#dde7e9' };
                    const origInvoke = ipc.invoke.bind(ipc);
                    ipc.invoke = (channel, ...args) => channel === 'window:set-title-bar-overlay'
                        ? origInvoke(channel, TITLE_BAR_OVERLAY)
                        : origInvoke(channel, ...args);
                    origInvoke('window:set-title-bar-overlay', TITLE_BAR_OVERLAY).catch(() => {});
                }
            } catch(e) {}
        })();
    }
`;

    const acrylicCssPath = path.join(__dirname, "theme-acrylic.css");
    const acrylicJson = JSON.stringify(fs.existsSync(acrylicCssPath) ? fs.readFileSync(acrylicCssPath, "utf8") : "");
    const resolvedInner = jsInnerSource.replace("ACRYLIC_CSS_PLACEHOLDER", () => acrylicJson);

    const { active, allConfigs } = getActivePlugins();
    const baseCtx = injector.buildContextBase({
        rootDir: __dirname,
        isV2: false,
        cliFlags: { USE_TW, USE_DARK_BLUE, USE_WALLPAPER, BRAND_TITLE_MODE, NO_I18N },
        allConfigs,
        shared: {},
        hostHelpers: {}
    });
    injector.runPrepare(active, baseCtx);
    return injector.buildPreloadPayload(active, baseCtx, resolvedInner);
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
async function install20(resourcesDir, transaction, confirmUnverified, configPlan) {
    const asarPath = path.join(resourcesDir, "app.asar");
    if (!fs.existsSync(asarPath)) {
        console.error(`[错误] 未在资源目录中找到 app.asar: ${resourcesDir}`);
        return false;
    }
    const baseline = transaction.prepareBaseline(resourcesDir, { confirmUnverified });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-asar-'));
    try {
        transaction.extractBaseline(baseline, tempDir);

    // 3. 注入 preload.js
    const preloadPath = path.join(tempDir, "dist", "preload.js");
    if (!fs.existsSync(preloadPath)) {
        console.error(`[错误] 解压后未能在指定路径找到 preload.js: ${preloadPath}`);
        return false;
    }

    console.log(`[修改] 正在向 preload.js 注入汉化代码...`);
    let content = fs.readFileSync(preloadPath, 'utf-8');

    // 清理已有的汉化，重新注入
    const cleanedContent = cleanJsContent(content);
    const translationJs = generateJs(configPlan?.value);
    const newContent = cleanedContent + "\n" + translationJs;

    fs.writeFileSync(preloadPath, newContent, 'utf-8');
    console.log(`[修改] 注入成功！`);

    // 3.0 视频壁纸服务：preload 处于 Electron 沙箱中，不能用 http / fs，
    //     所以把"只监听 127.0.0.1 的单文件视频服务"放进主进程，preload 通过 IPC 取播放地址。
    if (USE_WALLPAPER) {
        const mainPath = path.join(tempDir, "dist", "main.js");
        const videoModulePath = path.join(tempDir, "dist", "agWallpaperVideo.js");
        if (fs.existsSync(mainPath)) {
            fs.writeFileSync(videoModulePath, WALLPAPER_VIDEO_MAIN_MODULE, 'utf-8');
            const mainContent = fs.readFileSync(mainPath, 'utf-8');
            if (!mainContent.includes("require('./agWallpaperVideo')")) {
                fs.writeFileSync(mainPath, mainContent + "\n" + SIGNATURE_START + "\ntry { require('./agWallpaperVideo'); } catch (e) { console.error('[Antigravity] 视频壁纸服务加载失败:', e); }\n" + SIGNATURE_END + "\n", 'utf-8');
            }
            console.log(`[修改] 视频壁纸服务已注入主进程 (dist/agWallpaperVideo.js)`);
        } else {
            console.warn(`[警告] 未找到 dist/main.js，视频壁纸将只显示静态封面。`);
        }
    }

    // 3.1-3.5 主进程补丁（由 plugins/i18n-zh 与 plugins/devtools 统一处理）
    const { active, allConfigs } = getActivePlugins();
    const mainCtx = injector.buildContextBase({
        rootDir: __dirname,
        tempDir,
        distDir: path.join(tempDir, 'dist'),
        isV2: true,
        cliFlags: { USE_TW, USE_DARK_BLUE, USE_WALLPAPER, BRAND_TITLE_MODE, NO_I18N },
        allConfigs,
        shared: {},
        hostHelpers: {}
    });
    injector.runPrepare(active, mainCtx);
    injector.runPatchMain(active, mainCtx);

    // 4. 重新打包
    console.log(`[打包] 正在将修改后的内容打包回 app.asar...`);
    await transaction.packAndReplace(resourcesDir, tempDir, baseline, configPlan);

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
    if (isV2) transaction.preflightBaselineConsent(resourcesDir, { confirmUnverified });
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
            configFile: path.join(__dirname, 'wallpaper_config.json'), confirmUnverified });
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
            success = await install20(resourcesDir, transaction, confirmUnverified, configPlan);
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
