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
const DICTS_FOLDER = USE_TW ? 'dicts_tw' : 'dicts';
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
        "[警告] 客户端启动失败: ": "[警告] 用戶端啟動失敗: "
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

function normalizeText(text) {
    if (!text) return "";
    return text.replace(/\s+/g, ' ')
               .trim()
               .replace(/’/g, "'")
               .replace(/‘/g, "'")
               .replace(/“/g, '"')
               .replace(/”/g, '"')
               .replace(/…/g, '...');
}

function loadDictionary() {
    const totalMap = {};
    const dictsDir = path.join(__dirname, DICTS_FOLDER);
    if (fs.existsSync(dictsDir)) {
        const files = fs.readdirSync(dictsDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(dictsDir, file);
                    const fileContent = fs.readFileSync(filePath, 'utf-8');
                    const data = JSON.parse(fileContent);
                    for (const [k, v] of Object.entries(data)) {
                        const normK = normalizeText(k);
                        if (normK) totalMap[normK] = v;
                    }
                } catch (e) {
                    // ignore
                }
            }
        }
    }
    if (BRAND_TITLE_MODE === 'english') {
        delete totalMap[normalizeText('Antigravity')];
    } else if (BRAND_TITLE_MODE === 'hidden') {
        totalMap[normalizeText('Antigravity')] = '';
    }
    return totalMap;
}

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
    const fullDict = loadDictionary();
    const longEntries = Object.entries(fullDict).sort((a, b) => b[0].length - a[0].length);
    
    const dictJson = JSON.stringify(fullDict, null, 4);
    const entriesJson = JSON.stringify(longEntries);

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
            // 场景 / 图片壁纸：运行 2K 60FPS 超清预设管线。
            // 视频壁纸不再转成动图（会截断时长、放大出颗粒、CPU 解码掉帧），运行时直接播放原视频。
            if (!(wp && wp.type === 'video')) {
                try {
                    const prepScript = path.join(__dirname, 'prepare_hd_wallpaper.py');
                    if (fs.existsSync(prepScript) && userCfg.workshopId) {
                        child_process.execFileSync('python', [prepScript, String(userCfg.workshopId)], { stdio: 'ignore', windowsHide: true, shell: false });
                        wp = weReader.getActiveWallpaper(userCfg.monitor, userCfg.workshopId);
                    }
                } catch (e) {}
            }
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

    const jsSource = `${SIGNATURE_START}
(() => {
    // V12.0 终极隔离版：基于容器回溯的物理隔离引擎
    // 逻辑：不再仅仅检查当前标签，而是向上回溯父级，识别“代码/编辑器”禁区
    const USE_TW = ${USE_TW ? "true" : "false"};
    const map = new Map(Object.entries(DICT_PLACEHOLDER));
    const lowerMap = new Map();
    for (const [k, v] of map.entries()) lowerMap.set(k.toLowerCase(), v);
    
    const longEntries = REPLACEMENT_ENTRIES_PLACEHOLDER;
    const translatedValues = new WeakMap();

    // 轻量级安全隔离：跳过脚本、样式、代码块(pre/code)、编辑器区域以及终端容器
    const SKIP_TAGS = ['SCRIPT', 'STYLE', 'PRE', 'CODE'];

    // 代码及编辑器隔离选择器：排除代码块、编辑器、文件预览器、代码差异区、终端及语法高亮 Token
    const CODE_ISOLATION_SELECTOR = 'pre, code, .monaco-editor, .cm-editor, .cm-line, [contenteditable="true"], .terminal, .xterm, .code-line, .code-block, .line-content, [aria-label="File Viewer"], [data-file-uri], [class*="diffEditor"], .token, .hljs, [class*="mtk"]';

    function isCodeOrEditor(node) {
        try {
            if (!node) return false;
            let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            while (el) {
                if (typeof el.closest === 'function' && el.closest(CODE_ISOLATION_SELECTOR)) {
                    return true;
                }
                const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
                el = (root && root.host) ? root.host : null;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    function norm(s) {
        if (!s) return '';
        return s.replace(/\\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').trim();
    }

    function translateWithShortcut(val) {
        if (!val) return null;
        const match = val.match(/^(.+?)\\s*\\((Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\\+?([^)]*)\\)$/i);
        if (match) {
            const prefix = match[1].trim();
            const normPref = norm(prefix);
            const lowerPref = normPref.toLowerCase();
            let transPref = null;
            if (map.has(normPref)) {
                transPref = map.get(normPref);
            } else if (lowerMap.has(lowerPref)) {
                transPref = lowerMap.get(lowerPref);
            }
            if (transPref) {
                return transPref + " (" + match[2] + (match[3] ? "+" + match[3] : "") + ")";
            }
        }
        return null;
    }

    function translateNode(node) {
        try {
            if (!node) return;
            if (isCodeOrEditor(node)) return;
            
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toUpperCase();
                if (SKIP_TAGS.includes(tag)) return;
                if (node.isContentEditable) return;
                if (node.classList && (node.classList.contains('monaco-editor') || node.classList.contains('terminal') || node.classList.contains('xterm'))) return;

                // 翻译属性：placeholder, title, aria-label
                for (const attr of ['placeholder', 'title', 'aria-label']) {
                    const v = node.getAttribute(attr);
                    if (v) {
                        const t = norm(v);
                        const shortcutTrans = translateWithShortcut(t);
                        if (shortcutTrans) node.setAttribute(attr, shortcutTrans);
                        else if (map.has(t)) node.setAttribute(attr, map.get(t));
                        else if (lowerMap.has(t.toLowerCase())) node.setAttribute(attr, lowerMap.get(t.toLowerCase()));
                        else if (/^Show\\s+(\\d+)\\s+more/i.test(t)) {
                            const trans = t.replace(/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i, (m, num, p2, type) => {
                                if (type) {
                                    if (/result/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個結果...") : ("显示另外 " + num + " 个结果...");
                                    if (/command/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個命令...") : ("显示另外 " + num + " 个命令...");
                                    if (/item/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個項目...") : ("显示另外 " + num + " 个项目...");
                                    if (/option/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個選項...") : ("显示另外 " + num + " 个选项...");
                                }
                                return USE_TW ? ("顯示另外 " + num + " 個...") : ("显示另外 " + num + " 个...");
                            });
                            node.setAttribute(attr, trans);
                        } else if (/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(t)) {
                            const trans = t.replace(/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, del, name, count, dot) => {
                                const delPrefix = del ? (USE_TW ? "永久刪除 " : "永久删除 ") : "";
                                const suffix = dot ? "。" : "";
                                return delPrefix + name + (USE_TW ? ("（包含 " + count + " 個活躍對話）") : ("（包含 " + count + " 个活跃会话）")) + suffix;
                            });
                            node.setAttribute(attr, trans);
                        }
                    }
                }

                if (node.shadowRoot) translateNode(node.shadowRoot);
                for (const child of node.childNodes) translateNode(child);

            } else if (node.nodeType === Node.TEXT_NODE) {
                if (isCodeOrEditor(node)) return;

                let originalVal = node.nodeValue;
                if (!originalVal || originalVal.trim().length < 1) return;

                // 核心：如果是 skeleton 骨架占位文本，强制打上不翻译标记，防止自动翻译（例如 Google Translate 网页翻译）将其翻译为“装。资料。包装。资料。”
                if (originalVal.toLowerCase().includes('pack.info')) {
                    const parent = node.parentElement;
                    if (parent) {
                        if (parent.getAttribute('translate') !== 'no') {
                            parent.setAttribute('translate', 'no');
                        }
                        try {
                            if (!parent.classList.contains('notranslate')) {
                                parent.classList.add('notranslate');
                            }
                        } catch (e) {}
                    }
                    return;
                }

                if (translatedValues.get(node) === originalVal) return;

                let newVal = originalVal;
                const valNorm = norm(originalVal);
                const valLower = valNorm.toLowerCase();
                
                // 1. 精确匹配（含大小写自动纠正与快捷键检测）
                const shortcutTrans = translateWithShortcut(valNorm);
                if (shortcutTrans) {
                    newVal = shortcutTrans;
                } else if (map.has(valNorm)) {
                    newVal = map.get(valNorm);
                } else if (lowerMap.has(valLower)) {
                    newVal = lowerMap.get(valLower);
                } else if (/^The AlloyDB for PostgreSQL remote/i.test(valNorm)) {
                    newVal = USE_TW ? "AlloyDB for PostgreSQL 遠端 MCP 伺服器可讓您存取並執行 AlloyDB 工具，用於管理 AlloyDB 叢集及執行個體、管理使用者，以及建立和復原資料備份。" : "AlloyDB for PostgreSQL 远程 MCP 服务器可让您访问并运行 AlloyDB 工具，用于管理 AlloyDB 集群及实例、管理用户，以及创建和恢复数据备份。";
                } else if (/^The Cloud SQL remote/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud SQL 遠端 MCP 伺服器可讓您存取並執行 Cloud SQL 工具，用於管理 Cloud SQL 執行個體、管理使用者、建立和復原資料備份及資料庫維運。" : "Cloud SQL 远程 MCP 服务器可让您访问并运行 Cloud SQL 工具，用于管理 Cloud SQL 实例、管理用户、创建和恢复数据备份及数据库运维。";
                } else if (/^The Spanner remote/i.test(valNorm)) {
                    newVal = USE_TW ? "Spanner 遠端 MCP 伺服器可讓您從 AI 開發環境中存取並執行 Spanner 工具，以建立、管理和查詢分散式資料庫資源。" : "Spanner 远程 MCP 服务器可让您从 AI 开发环境中访问并运行 Spanner 工具，以创建、管理和查询分布式数据库资源。";
                } else if (/^Ask questions\.\s*Get answers\./i.test(valNorm) || /PostHog data/i.test(valNorm)) {
                    newVal = USE_TW ? "提問，即得答案。該 MCP 是供您的程式設計代理呼叫的伺服器。用英語提出問題，它會針對您的 PostHog 資料執行查詢，結果將直接呈現在您的編輯器中。" : "提问，即得答案。该 MCP 是供您的编程智能体调用的服务器。用英语提出问题，它会针对您的 PostHog 数据运行查询，结果将直接呈现在您的编辑器中。";
                } else if (/^The GKE remote MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "GKE 遠端 MCP 伺服器提供對 GKE Kubernetes 資源的讀寫存取權限。允許 AI 代理檢查並監控您的執行環境。" : "GKE 远程 MCP 服务器提供对 GKE Kubernetes 资源的读写权限。允许 AI 智能体检查并监控您的运行环境。";
                } else if (/^Cloud CLI MCP Server/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud CLI MCP 伺服器提供在遠端沙箱環境中執行 gcloud 與 bq CLI 指令的工具集。" : "Cloud CLI MCP 服务器提供在远程沙箱环境中运行 gcloud 与 bq CLI 命令的工具集。";
                } else if (/^The Apigee API hub remote MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Apigee API hub 遠端 MCP 伺服器可讓您管理註冊在 Apigee API hub 中的 API、版本、規格、操作、部署、屬性、外部 API 以及相依性。" : "Apigee API hub 远程 MCP 服务器可让您管理注册在 Apigee API hub 中的 API、版本、规范、操作、部署、属性、外部 API 以及依赖项。";
                } else if (/^The Google Home Developer MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Google Home Developer MCP 伺服器支援檢索 Google Home 文件、OpenThread 與 Matter 規格文件。" : "Google Home Developer MCP 服务器支持检索 Google Home 文档、OpenThread 与 Matter 规范文档。";
                } else if (/^The Cloud Quotas MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud Quotas MCP 伺服器支援檢視配額分配、申請提升配額以及管理 Quota Adjuster 自動調整設定。" : "Cloud Quotas MCP 服务器支持查看配额分配、申请提升配额以及管理 Quota Adjuster 自动调整配置。";
                } else if (/^Build, edit, deploy, and manage full-stack web apps with Lovable/i.test(valNorm)) {
                    newVal = USE_TW ? "使用自然語言，藉助 AI 應用程式建構工具 Lovable 建構、編輯、部署和管理全端 Web 應用程式。該 MCP 伺服器將您的 AI 用戶端連接至 Lovable，允許您的 AI 代理直接在偏好的編輯器或助手內互動、建立和管理 Lovable 專案。" : "使用自然语言，借助 AI 应用构建工具 Lovable 构建、编辑、部署和管理全栈 Web 应用。该 MCP 服务器将您的 AI 客户端连接至 Lovable，允许您的 AI 智能体直接在偏好的编辑器或助手中交互、创建和管理 Lovable 项目。";
                } else if (/^Build applications with the Gemini Interactions API and Live API/i.test(valNorm)) {
                    newVal = USE_TW ? "使用 Gemini Interactions API 與 Live API 建構應用程式，涵蓋文字生成、多輪對話、串流、函式呼叫、託管代理及即時音訊與視訊互動。" : "使用 Gemini Interactions API 和 Live API 构建应用，涵盖文本生成、多轮对话、流式传输、函数调用、托管智能体以及实时音视频交互。";
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?, (\\d+) hours?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?, (\\d+) hours?\\.?$/i, (match, d, h) => {
                        return USE_TW ? (d + " 天 " + h + " 小時後更新") : (d + " 天 " + h + " 小时后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?, (\\d+) minutes?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?, (\\d+) minutes?\\.?$/i, (match, h, m) => {
                        return USE_TW ? (h + " 小時 " + m + " 分鐘後更新") : (h + " 小时 " + m + " 分钟后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?\\.?$/i, (match, d) => {
                        return USE_TW ? (d + " 天後更新") : (d + " 天后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?\\.?$/i, (match, h) => {
                        return USE_TW ? (h + " 小時後更新") : (h + " 小时后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) minutes?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) minutes?\\.?$/i, (match, m) => {
                        return USE_TW ? (m + " 分鐘後更新") : (m + " 分钟后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in less than a minute\\.?$/i.test(valNorm)) {
                    newVal = USE_TW ? "不到 1 分鐘後更新" : "不到 1 分钟后刷新";
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in a few seconds\\.?$/i.test(valNorm)) {
                    newVal = USE_TW ? "幾秒後更新" : "几秒后刷新";
                } else if (/^Learn more about$/i.test(valNorm)) {
                    newVal = USE_TW ? "瞭解更多關於" : "了解更多关于";
                } else if (/^Learn more about (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Learn more about (.+)$/i, (match, p) => {
                        let translatedPreset = p;
                        const pLow = p.toLowerCase();
                        if (pLow === 'default' || pLow.includes('默认') || pLow.includes('預設')) translatedPreset = USE_TW ? "預設 (Default)" : "默认 (Default)";
                        else if (pLow === 'full machine' || pLow.includes('全机') || pLow.includes('全機')) translatedPreset = USE_TW ? "全機存取 (Full Machine)" : "全机访问 (Full Machine)";
                        else if (pLow === 'turbo mode' || pLow.includes('极速') || pLow.includes('極速')) translatedPreset = USE_TW ? "極速模式 (Turbo Mode)" : "极速模式 (Turbo Mode)";
                        else if (pLow === 'custom' || pLow.includes('自定义') || pLow.includes('自訂')) translatedPreset = USE_TW ? "自訂 (Custom)" : "自定义 (Custom)";
                        return USE_TW ? ("瞭解更多關於 " + translatedPreset + " 的詳細資訊") : ("了解更多关于 " + translatedPreset + " 的信息");
                    });
                } else if (/^Yes, and always allow '(.+)' in this project$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Yes, and always allow '(.+)' in this project$/i, (match, cmd) => {
                        return USE_TW ? ("是，且在此專案中一律允許執行 '" + cmd + "'") : ("是，且在此项目中始终允许运行 '" + cmd + "'");
                    });
                } else if (/^Yes, and always allow '(.+)'$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Yes, and always allow '(.+)'$/i, (match, cmd) => {
                        return USE_TW ? ("是，且一律允許執行 '" + cmd + "'") : ("是，且始终允许运行 '" + cmd + "'");
                    });
                } else if (/^(\\d+) tools? enabled$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+) tools? enabled$/i, (match, num) => {
                        return USE_TW ? (num + " 個工具已啟用") : (num + " 个工具已启用");
                    });
                } else if (/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i, (match, num, p2, type) => {
                        if (type) {
                            if (/result/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個結果...") : ("显示另外 " + num + " 个结果...");
                            if (/command/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個指令...") : ("显示另外 " + num + " 个命令...");
                            if (/item/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個項目...") : ("显示另外 " + num + " 个项目...");
                            if (/option/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個選項...") : ("显示另外 " + num + " 个选项...");
                        }
                        return USE_TW ? ("顯示另外 " + num + " 個...") : ("显示另外 " + num + " 个...");
                    });
                } else if (/^See all\\s*\\((\\d+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^See all\\s*\\((\\d+)\\)$/i, (match, num) => {
                        return USE_TW ? ("顯示全部 (" + num + ")") : ("显示全部 (" + num + ")");
                    });
                } else if (/^Available AI Credits: (\\d+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Available AI Credits: (\\d+)$/i, (match, num) => {
                        return USE_TW ? ("可用 AI 額度: " + num) : ("可用 AI 额度: " + num);
                    });
                } else if (/^Version\\s+([\\d\\.]+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Version\\s+([\\d\\.]+)$/i, (match, v) => {
                        return "版本 " + v;
                    });
                } else if (/^(\\d+)(s|m|h|d|w|mo|yr)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)(s|m|h|d|w|mo|yr)$/i, (match, num, unit) => {
                        const unitLower = unit.toLowerCase();
                        let unitStr = "";
                        if (unitLower === "s") unitStr = USE_TW ? "秒前" : "秒前";
                        else if (unitLower === "m") unitStr = USE_TW ? "分鐘前" : "分钟前";
                        else if (unitLower === "h") unitStr = USE_TW ? "小時前" : "小时前";
                        else if (unitLower === "d") unitStr = USE_TW ? "天前" : "天前";
                        else if (unitLower === "w") unitStr = USE_TW ? "週前" : "周前";
                        else if (unitLower === "mo") unitStr = USE_TW ? "個月前" : "个月前";
                        else if (unitLower === "yr") unitStr = USE_TW ? "年前" : "年前";
                        return num + unitStr;
                    });
                } else if (/^(.+?): context deadline exceeded$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): context deadline exceeded$/i, (match, prefix) => {
                        return prefix + (USE_TW ? ": 要求逾時 (context deadline exceeded)" : ": 请求超时 (context deadline exceeded)");
                    });
                } else if (/^(.+?): i\\/o timeout$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): i\\/o timeout$/i, (match, prefix) => {
                        return prefix + (USE_TW ? ": I/O 逾時 (i/o timeout)" : ": I/O 超时 (i/o timeout)");
                    });
                } else if (/^Are you sure you want to delete (the |this )?project (.+?)\\??$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Are you sure you want to delete (the |this )?project (.+?)\\??$/i, (match, article, name) => {
                        return USE_TW ? ("您確定要刪除專案 " + name + " 嗎？") : ("您确定要删除项目 " + name + " 吗？");
                    });
                } else if (/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, del, name, count, dot) => {
                        const delPrefix = del ? (USE_TW ? "永久刪除 " : "永久删除 ") : "";
                        const suffix = dot ? "。" : "";
                        return delPrefix + name + (USE_TW ? ("（包含 " + count + " 個活躍對話）") : ("（包含 " + count + " 个活跃会话）")) + suffix;
                    });
                } else if (/^including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, count, dot) => {
                        const suffix = dot ? "。" : "";
                        return (USE_TW ? ("包含 " + count + " 個活躍對話") : ("包含 " + count + " 个活跃会话")) + suffix;
                    });
                } else if (/^(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)\\s+active conversations?([.。])?$/i, (match, count, dot) => {
                        const suffix = dot ? "。" : "";
                        return (USE_TW ? (count + " 個活躍對話") : (count + " 个活跃会话")) + suffix;
                    });
                } else if (/^The (.+?) remote MCP server lets you access and run (.+?) tools to (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^The (.+?) remote MCP server lets you access and run (.+?) tools to (.+)$/i, (match, name, tools, action) => {
                        return name + (USE_TW ? " 遠端 MCP 伺服器可讓您存取並執行 " : " 远程 MCP 服务器可让您访问并运行 ") + tools + (USE_TW ? " 工具以進行管理與操作。" : " 工具以进行管理与操作。");
                    });
                } else if (/^The (.+?) remote MCP server lets you manage (.+) resources\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^The (.+?) remote MCP server lets you manage (.+) resources\\.?$/i, (match, name, res) => {
                        return name + (USE_TW ? " 遠端 MCP 伺服器可讓您管理 " : " 远程 MCP 服务器可让您管理 ") + res + (USE_TW ? " 資源。" : " 资源。");
                    });
                } else if (/^Send feedback as(\\s+(.+))?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Send feedback as(\\s+(.+))?$/i, (match, p1, email) => {
                        if (email) {
                            return "以 " + email + (USE_TW ? " 身分傳送意見回饋" : " 身份发送反馈");
                        }
                        return USE_TW ? "以此身分傳送意見回饋：" : "以如下身份发送反馈：";
                    });
                } else {
                    // 2. 长句子串滑动替换与前缀截断智能匹配 (缩短至前 18 字符即可高精度命中)
                    for (const [key, translated] of longEntries) {
                        if (key.length > 15 && valNorm.includes(key)) {
                            newVal = newVal.split(key).join(translated);
                            break;
                        } else if (key.length >= 18 && valNorm.length >= 18 && valLower.slice(0, 18) === key.slice(0, 18).toLowerCase()) {
                            newVal = translated;
                            break;
                        }
                    }
                }

                if (newVal !== originalVal) {
                    translatedValues.set(node, newVal);
                    node.nodeValue = newVal;
                }
            }
        } catch (e) {}
    }

    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const n of m.addedNodes) translateNode(n);
            } else if (m.type === 'characterData') {
                translateNode(m.target);
            }
        }
    });

    const obsOpts = { childList: true, subtree: true, characterData: true };

    const startEngine = () => {
        const target = document.body || document.documentElement;
        if (target) {
            try {
                observer.observe(target, obsOpts);
                translateNode(target);
            } catch (e) {}
        }
    };

    const origAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function() {
        const sr = origAttachShadow.apply(this, arguments);
        try { observer.observe(sr, obsOpts); } catch(e) {}
        return sr;
    };

    // Antigravity 官方质感科技蓝黑皮肤 (Obsidian Dark Blue)
    const USE_DARK_BLUE_THEME = ${USE_DARK_BLUE ? "true" : "false"};
    if (USE_DARK_BLUE_THEME) {
        const injectDarkBlueTheme = () => {
            if (document.getElementById('antigravity-dark-blue-theme')) return;
            const style = document.createElement('style');
            style.id = 'antigravity-dark-blue-theme';
            style.textContent = [
                ':root, .dark, .dark-theme, .vscode-dark {',
                '  --primary: #4176e6 !important;',
                '  --primary-foreground: #ffffff !important;',
                '  --link: #5686fe !important;',
                '  --color-primary: #4176e6 !important;',
                '  --color-primary-foreground: #ffffff !important;',
                '  --background: #0d1117 !important;',
                '  --foreground: #e6edf3 !important;',
                '  --color-background: #0d1117 !important;',
                '  --color-foreground: #e6edf3 !important;',
                '  --sidebar: #090d13 !important;',
                '  --sidebar-secondary: #131722 !important;',
                '  --sidebar-muted: #0d1117 !important;',
                '  --color-sidebar: #090d13 !important;',
                '  --color-sidebar-secondary: #131722 !important;',
                '  --color-sidebar-muted: #0d1117 !important;',
                '  --card: #161b22 !important;',
                '  --card-border: #21262d !important;',
                '  --border: #21262d !important;',
                '  --color-card: #161b22 !important;',
                '  --color-card-border: #21262d !important;',
                '  --color-border: #21262d !important;',
                '  --secondary: #161b22 !important;',
                '  --secondary-foreground: #a0a6b5 !important;',
                '  --muted: #12161f !important;',
                '  --muted-foreground: #7d8590 !important;',
                '  --placeholder: #484f58 !important;',
                '  --success: #22c55e !important;',
                '  --warning: #f59e0b !important;',
                '  --error: #ef4444 !important;',
                '  --code-foreground: #79c0ff !important;',
                '  --editor-selection-background: rgba(65, 118, 230, 0.35) !important;',
                '  --color-selection-background: rgba(65, 118, 230, 0.35) !important;',
                '  --focus-ring-color: rgba(65, 118, 230, 0.45) !important;',
                '}',
                '::-webkit-scrollbar { width: 5px !important; height: 5px !important; }',
                '::-webkit-scrollbar-track { background: transparent !important; }',
                '::-webkit-scrollbar-thumb { background: #282f3d !important; border-radius: 999px !important; }',
                '::-webkit-scrollbar-thumb:hover { background: #4176e6 !important; }',
                '.bg-sidebar-secondary { background-color: #131722 !important; border: 1px solid #21262d !important; }',
                'button[class*="bg-primary"], .bg-primary { background-color: #4176e6 !important; color: #ffffff !important; }',
                'button[class*="bg-primary"]:hover, .bg-primary:hover { background-color: #5686fe !important; box-shadow: 0 0 10px rgba(65, 118, 230, 0.4) !important; }',
                'textarea:focus, input[type="text"]:focus { border-color: #4176e6 !important; box-shadow: 0 0 0 1px #4176e6, 0 0 8px rgba(65, 118, 230, 0.25) !important; }'
            ].join('\\n');
            const head = document.head || document.documentElement;
            if (head) head.appendChild(style);
        };
        injectDarkBlueTheme();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectDarkBlueTheme);
        }
    }

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

    // 强力多阶段触发绑定
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEngine);
    } else {
        startEngine();
    }
    window.addEventListener('load', startEngine);
    setTimeout(startEngine, 100);
    setTimeout(startEngine, 300);
    setTimeout(startEngine, 1000);
    setTimeout(startEngine, 3000);
    setTimeout(startEngine, 6000);
})();
${SIGNATURE_END}`;

    const acrylicCssPath = path.join(__dirname, "theme-acrylic.css");
    const acrylicJson = JSON.stringify(fs.existsSync(acrylicCssPath) ? fs.readFileSync(acrylicCssPath, "utf8") : "");
    return jsSource.replace("DICT_PLACEHOLDER", () => dictJson).replace("REPLACEMENT_ENTRIES_PLACEHOLDER", () => entriesJson).replace("ACRYLIC_CSS_PLACEHOLDER", () => acrylicJson);
}

function cleanJsContent(content) {
    const regex = new RegExp(escapeRegExp(SIGNATURE_START) + "[\\s\\S]*?" + escapeRegExp(SIGNATURE_END), "g");
    return content.replace(regex, "");
}

function cleanMenuJsContent(content) {
    const startMark = "// ==========================================";
    const endMark = "translateMenu(menu.items);";
    const startIdx = content.indexOf(startMark);
    const endIdx = content.indexOf(endMark);
    if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
        return content.substring(0, startIdx) + content.substring(endIdx + endMark.length);
    }
    return content;
}

function cleanTrayJsContent(content) {
    const startMark = "/* --- TRAY TRANSLATION START --- */";
    const endMark = "/* --- TRAY TRANSLATION END --- */";
    const startIdx = content.indexOf(startMark);
    const endIdx = content.indexOf(endMark);
    if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
        content = content.substring(0, startIdx) + content.substring(endIdx + endMark.length);
    }
    const dblStartMark = "/* --- TRAY DOUBLE CLICK START --- */";
    const dblEndMark = "/* --- TRAY DOUBLE CLICK END --- */";
    const dblStartIdx = content.indexOf(dblStartMark);
    const dblEndIdx = content.indexOf(dblEndMark);
    if (dblStartIdx !== -1 && dblEndIdx !== -1 && dblStartIdx < dblEndIdx) {
        content = content.substring(0, dblStartIdx) + content.substring(dblEndIdx + dblEndMark.length);
    }
    return content;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let wasAppRunning = false;

function macClientPids(installDir) {
    let output;
    try { output = child_process.execFileSync('/usr/bin/pgrep', ['-x', 'Antigravity'], { encoding: 'utf8' }); }
    catch (error) { if (error.status === 1) return []; throw error; }
    const values = output.trim().split(/\s+/).filter(Boolean);
    if (values.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
        throw new Error('无法核验 macOS 客户端 PID。');
    }
    const pids = values.map(Number).filter(pid => pid !== process.pid);
    if (!pids.length) return [];
    let app = fs.realpathSync(installDir);
    while (!app.endsWith('.app') && path.dirname(app) !== app) app = path.dirname(app);
    if (!app.endsWith('.app')) throw new Error('无法定位 macOS 客户端应用包。');
    const expected = fs.realpathSync(path.join(app, 'Contents', 'MacOS', 'Antigravity'));
    return pids.filter(pid => {
        // ponytail: AppKit supplies the main executable; unavailable identity stops rather than guessing from argv or mappings.
        const script = `ObjC.import('AppKit'); function run(args) {
            const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(args[0]));
            if (!app) return 'null';
            return JSON.stringify({ pid: Number(app.processIdentifier), path: ObjC.unwrap(app.executableURL.path) });
        }`;
        const output = child_process.execFileSync('/usr/bin/osascript',
            ['-l', 'JavaScript', '-e', script, String(pid)], { encoding: 'utf8' });
        const identity = JSON.parse(output.trim());
        if (identity?.pid !== pid || typeof identity.path !== 'string' ||
            !path.isAbsolute(identity.path) || /[\r\n]/.test(identity.path)) {
            throw new Error(`无法核验 macOS 客户端进程 ${pid} 的可执行路径。`);
        }
        return fs.realpathSync(identity.path) === expected;
    });
}

function checkIfAppIsRunning(installDir) {
    if (process.platform === 'win32') {
        const stdout = child_process.execFileSync('tasklist', ['/fi', 'imagename eq Antigravity.exe', '/nh'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
        });
        return stdout.split(/\r?\n/).some(line => /^Antigravity\.exe\s/i.test(line.trim()));
    }
    if (process.platform === 'darwin') {
        return macClientPids(installDir).length > 0;
    }
    return false;
}

function closeAntigravityProcesses(installDir) {
    console.log("[1] 检测到 Antigravity 客户端正在运行，正在关闭以解除文件锁...");
    try {
        if (process.platform === 'win32') {
            child_process.execFileSync('taskkill', ['/f', '/im', 'Antigravity.exe', '/t'], { stdio: 'ignore', windowsHide: true });
        } else if (process.platform === 'darwin') {
            for (const pid of macClientPids(installDir)) process.kill(pid, 'SIGTERM');
        }
    } catch (e) {
        // ignore
    }
    const start = Date.now();
    while (Date.now() - start < 1500) {}
}

function detectInstallationDir(manualDir) {
    if (manualDir) {
        if (fs.existsSync(manualDir)) {
            let resolved = process.platform === 'darwin' ? fs.realpathSync(manualDir) : path.resolve(manualDir);
            if (fs.statSync(resolved).isFile() && resolved.endsWith('app.asar')) {
                resolved = path.dirname(resolved);
            }
            return resolved;
        } else {
            console.error(`[错误] 手动指定的路径不存在: ${manualDir}`);
            process.exit(1);
        }
    }

    const candidates = [];
    const seenCandidates = new Set();
    const addCandidate = (candidate) => {
        if (!candidate) return;
        const normalized = path.resolve(candidate);
        const key = normalized.toLowerCase();
        if (!seenCandidates.has(key)) {
            candidates.push(normalized);
            seenCandidates.add(key);
        }
    };
    const hasAntigravityResources = (candidate) => {
        return fs.existsSync(path.join(candidate, "resources", "app.asar")) ||
            fs.existsSync(path.join(candidate, "resources", "app.asar.rollback")) ||
            fs.existsSync(path.join(candidate, "resources", "app.asar.baseline.json")) ||
            fs.existsSync(path.join(candidate, "app.asar")) ||
            fs.existsSync(path.join(candidate, "app.asar.rollback")) ||
            fs.existsSync(path.join(candidate, "Contents", "Resources", "app.asar")) ||
            fs.existsSync(path.join(candidate, "Contents", "Resources", "app.asar.rollback")) ||
            fs.existsSync(path.join(candidate, "resources", "app", "product.json"));
    };

    if (process.platform === 'win32') {
        addCandidate(process.env.ANTIGRAVITY_INSTALL_DIR);
        addCandidate(process.env.ANTIGRAVITY_HOME);

        const registryRoots = [
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        ];
        for (const root of registryRoots) {
            try {
                const output = child_process.execFileSync('reg', ['query', root, '/s', '/f', 'Antigravity', '/d'], { encoding: 'utf-8', stdio: 'pipe' });
                for (const line of output.split(/\r?\n/)) {
                    const match = line.match(/^\s*(InstallLocation|DisplayIcon)\s+REG_\w+\s+(.+)$/i);
                    if (!match) continue;
                    let value = match[2].trim().replace(/^"|"$/g, '');
                    if (/Antigravity\.exe/i.test(value)) {
                        value = path.dirname(value);
                    }
                    addCandidate(value);
                }
            } catch (e) {
                // Registry probing is best-effort; fall back to common locations below.
            }
        }

        const driveLetters = ['C', 'D', 'E', 'F'];
        for (const drive of driveLetters) {
            addCandidate(`${drive}:\\Programs\\Antigravity`);
            addCandidate(`${drive}:\\Antigravity`);
        }
        addCandidate("C:\\Program Files\\Antigravity");

        const localAppdata = process.env.LOCALAPPDATA;
        if (localAppdata) {
            addCandidate(path.join(localAppdata, 'Programs', 'antigravity'));
        }
    } else if (process.platform === 'darwin') {
        addCandidate("/Applications/Antigravity.app");
        addCandidate(path.join(process.env.HOME || '', 'Applications', 'Antigravity.app'));
    }

    for (const p of candidates) {
        if (fs.existsSync(p) && hasAntigravityResources(p)) {
            console.log(`[探测] 成功自动识别到 Antigravity 安装目录: ${p}`);
            return path.resolve(p);
        }
    }

    console.error("[错误] 未找到默认安装目录，请使用 --install-dir 手动指定您的安装路径！");
    process.exit(1);
}

function runCommandSync(file, args) {
    try {
        const out = child_process.execFileSync(file, args, { encoding: 'utf-8', stdio: 'pipe' });
        return { success: true, stdout: out, stderr: '' };
    } catch (e) {
        return { success: false, stdout: e.stdout || '', stderr: e.stderr || e.message };
    }
}

function cleanElectronCache() {
    let appSupportDir = "";
    if (process.platform === 'darwin') {
        appSupportDir = path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity');
    } else if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        appSupportDir = path.join(appData, 'Antigravity');
    } else {
        appSupportDir = path.join(os.homedir(), '.config', 'Antigravity');
    }

    if (!fs.existsSync(appSupportDir)) return;

    const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache'];
    let cleanedCount = 0;
    for (const c of cacheDirs) {
        const p = path.join(appSupportDir, c);
        if (fs.existsSync(p)) {
            try {
                fs.rmSync(p, { recursive: true, force: true });
                cleanedCount++;
            } catch (e) {}
        }
    }
    if (cleanedCount > 0) {
        console.log(`[缓存] 已自动清理 ${cleanedCount} 个应用缓存目录，避免新旧版本字节码冲突。`);
    }
}

function resignAppOnMac(anyPath) {
    if (process.platform !== 'darwin') return;
    
    let targetApp = "";
    let current = path.resolve(anyPath);
    for (let i = 0; i < 10; i++) {
        if (current.endsWith(".app")) {
            targetApp = current;
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    
    if (targetApp && fs.existsSync(targetApp)) {
        try {
            runCommandSync('xattr', ['-d', '-r', 'com.apple.quarantine', targetApp]);
        } catch (e) {}
        console.log(`[签名] 检测到 macOS 平台，正在对应用包进行本地 ad-hoc 深度重签名: ${targetApp} ...`);
        const signRes = runCommandSync('codesign', ['--force', '--deep', '--sign', '-', targetApp]);
        if (signRes.success) {
            console.log(`[签名] 重新签名成功！`);
        } else {
            console.warn(`[警告] 重新签名失败。可能会导致应用无法打开。详情:\n${signRes.stderr}\n${signRes.stdout}`);
        }
    } else {
        console.warn(`[警告] 未能从路径 ${anyPath} 识别到有效的 .app 路径，跳过重新签名。`);
    }
}

function ensureWritePermission(targetDir) {
    if (process.platform !== 'darwin') return true;
    try {
        fs.accessSync(targetDir, fs.constants.W_OK);
        return true;
    } catch (err) {
        if (process.getuid && process.getuid() !== 0) {
            console.log("[权限] 检测到当前用户对 macOS 应用目录缺少写入权限，正在尝试请求管理员权限 (sudo) 重新运行...");
            const args = process.argv.slice(1);
            const res = child_process.spawnSync('sudo', [process.execPath, ...args], {
                stdio: 'inherit'
            });
            if (res.status === 0) {
                process.exit(0);
            } else {
                console.error("\n[错误] 管理员提权执行失败或用户取消了密码输入。");
                process.exit(res.status || 1);
            }
        }
        return false;
    }
}

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

    // 3.1 注入 menu.js (系统菜单汉化)
    const menuPath = path.join(tempDir, "dist", "menu.js");
    if (fs.existsSync(menuPath)) {
        console.log(`[修改] 正在向 menu.js 注入菜单汉化代码...`);
        let menuContent = fs.readFileSync(menuPath, 'utf-8');
        
        const menuCleaned = cleanMenuJsContent(menuContent);
        
        const menuTranslationJs = `
    // ==========================================
    // Antigravity Native Menu Chinese Translation
    // ==========================================
    const translations = ${USE_TW ? `{
        'File': '檔案',
        'Edit': '編輯',
        'View': '檢視',
        'Window': '視窗',
        'Help': '說明',
        'New Window': '開新視窗',
        'Create Project': '建立專案',
        'Command Palette': '命令選擇區',
        'Docs': '說明文件',
        'Check for Updates': '檢查更新',
        'Toggle Developer Tools': '切換開發人員工具',
        'Undo': '復原',
        'Redo': '重做',
        'Cut': '剪下',
        'Copy': '複製',
        'Paste': '貼上',
        'Select All': '全選',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '關閉',
        'Zoom': '縮放',
        'Reset Zoom': '重設縮放',
        'Zoom In': '放大',
        'Zoom Out': '縮小',
        'Toggle Full Screen': '切換全螢幕',
        'Split Terminal': '分割終端機',
        'Split Conversation Horizontally': '水平分割對話',
        'Split Conversation Vertically': '垂直分割對話',
        'Find in conversation': '在對話中尋找',
        'Version': '版本'
    }` : `{
        'File': '文件',
        'Edit': '编辑',
        'View': '视图',
        'Window': '窗口',
        'Help': '帮助',
        'New Window': '新建窗口',
        'Create Project': '创建项目',
        'Command Palette': '命令面板',
        'Docs': '文档',
        'Check for Updates': '检查更新',
        'Toggle Developer Tools': '切换开发者工具',
        'Undo': '撤销',
        'Redo': '重做',
        'Cut': '剪切',
        'Copy': '复制',
        'Paste': '粘贴',
        'Select All': '全选',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '关闭',
        'Zoom': '缩放',
        'Reset Zoom': '重置缩放',
        'Zoom In': '放大',
        'Zoom Out': '缩小',
        'Toggle Full Screen': '切换全屏',
        'Split Terminal': '拆分终端',
        'Split Conversation Horizontally': '水平拆分会话',
        'Split Conversation Vertically': '垂直拆分会话',
        'Find in conversation': '在会话中查找',
        'Version': '版本'
    }`};
    function translateMenu(items) {
        for (const item of items) {
            let label = item.label || '';
            let mnemonic = '';
            let cleanLabel = label;
            const m = label.match(/&([a-zA-Z])/);
            if (m) {
                mnemonic = "(&" + m[1] + ")";
                cleanLabel = label.replace('&', '');
            }
            if (translations[cleanLabel]) {
                item.label = translations[cleanLabel] + mnemonic;
            } else if (translations[label]) {
                item.label = translations[label];
            } else if (/^Version\\s*([\\d\\.]*)$/i.test(cleanLabel)) {
                item.label = cleanLabel.replace(/^Version\\s*([\\d\\.]*)$/i, (match, v) => v ? "版本 " + v : "版本");
            }
            if (item.submenu && item.submenu.items) {
                translateMenu(item.submenu.items);
            }
        }
    }
    translateMenu(menu.items);
    `;

        const targetStr = "electron_1.Menu.setApplicationMenu(menu);";
        const idx = menuCleaned.indexOf(targetStr);
        if (idx !== -1) {
            const patchedMenuContent = menuCleaned.substring(0, idx) + menuTranslationJs + "\n    " + menuCleaned.substring(idx);
            fs.writeFileSync(menuPath, patchedMenuContent, 'utf-8');
            console.log(`[修改] 菜单汉化注入成功！`);
        } else {
            console.warn(`[警告] 未能在 menu.js 中找到设定的插入点。`);
        }
    }

    // 3.2 注入 tray.js (任务栏右键菜单汉化)
    const trayPath = path.join(tempDir, "dist", "tray.js");
    if (fs.existsSync(trayPath)) {
        console.log(`[修改] 正在向 tray.js 注入任务栏菜单汉化...`);
        let trayContent = fs.readFileSync(trayPath, 'utf-8');
        
        // 先清理已有的汉化块
        let trayCleaned = cleanTrayJsContent(trayContent);
        
        // 1. 注入 createTray 里的翻译块 (带标记)
        const targetCreate = "function createTray(actions) {";
        const replacementCreate = `function createTray(actions) {
    /* --- TRAY TRANSLATION START --- */
    const translations = ${USE_TW ? `{
        'No agents running': '無執行中的代理',
        'Open Antigravity': '開啟 Antigravity',
        'Quit': '結束'
    }` : `{
        'No agents running': '无运行中的智能体',
        'Open Antigravity': '打开反重力智能编程',
        'Quit': '退出'
    }`};
    for (const item of actions) {
        if (translations[item.label]) {
            item.label = translations[item.label];
        }
    }
    /* --- TRAY TRANSLATION END --- */`;
        
        let trayPatched = trayCleaned.replace(targetCreate, replacementCreate);
        
        // 2. 注入系統匣圖示點兩下彈出/聚焦 Antigravity 介面事件
        const dblClickTarget = /tray\.setContextMenu\(contextMenu\);/;
        const dblClickReplacement = `tray.setContextMenu(contextMenu);
    /* --- TRAY DOUBLE CLICK START --- */
    const openAction = actions.find(item => item && typeof item.click === 'function' && !['Quit', '退出', '結束'].includes(item.label));
    if (openAction) {
        tray.on('double-click', () => {
            const wins = electron_1.BrowserWindow.getAllWindows();
            if (wins.length > 0 && wins[0].isMinimized()) {
                wins[0].restore();
            }
            openAction.click();
        });
    }
    /* --- TRAY DOUBLE CLICK END --- */`;
        trayPatched = trayPatched.replace(dblClickTarget, dblClickReplacement);

        // 3. 使用正则替换 updateTrayAgentCount 里的动态显示文本
        const countRegex = /countItem\.label\s*=\s*\([\s\S]*?' running';/g;
        const replacementCount = USE_TW 
            ? "countItem.label = count > 0 ? `${count} 個代理執行中` : '無執行中的代理';"
            : "countItem.label = count > 0 ? `${count} 个智能体运行中` : '无运行中的智能体';";
        trayPatched = trayPatched.replace(countRegex, replacementCount);
        
        fs.writeFileSync(trayPath, trayPatched, 'utf-8');
        console.log(`[修改] 任务栏菜单汉化注入成功！`);
    }

    // 3.3 注入 loadingOverlay.js (加载页汉化)
    const loadingPath = path.join(tempDir, "dist", "loadingOverlay.js");
    if (fs.existsSync(loadingPath)) {
        console.log(`[修改] 正在向 loadingOverlay.js 注入加载页汉化...`);
        let loadingContent = fs.readFileSync(loadingPath, 'utf-8');
        
        const replacementText = USE_TW
            ? '<div class="text">正在載入 Antigravity…</div>'
            : '<div class="text">正在加载 Antigravity…</div>';
        
        loadingContent = loadingContent
            .replace('<div class="text">Loading Antigravity</div>', replacementText)
            .replace('<div class="text">反重力引擎已啟動，正在努力擺脫地心引力...</div>', replacementText)
            .replace('<div class="text">反重力引擎已启动，正在努力摆脱地心引力...</div>', replacementText);
        
        fs.writeFileSync(loadingPath, loadingContent, 'utf-8');
        console.log(`[修改] 加载页汉化注入成功！`);
    }

    // 3.4 注入 updater.js (更新弹窗汉化)
    const updaterPath = path.join(tempDir, "dist", "updater.js");
    if (fs.existsSync(updaterPath)) {
        console.log(`[修改] 正在向 updater.js 注入更新弹窗汉化...`);
        let updaterContent = fs.readFileSync(updaterPath, 'utf-8');
        
        // 替换 Check for Updates 弹窗的属性
        const targetOptions = `                title: 'Check for Updates',
                message: 'No updates available',
                buttons: ['OK'],`;
        const replacementOptions = USE_TW
            ? `                title: '檢查更新',
                message: '目前沒有可用的更新',
                buttons: ['好'],`
            : `                title: '检查更新',
                message: '暂无可用更新',
                buttons: ['确定'],`;
        
        updaterContent = updaterContent.replace(targetOptions, replacementOptions);
        fs.writeFileSync(updaterPath, updaterContent, 'utf-8');
        console.log(`[修改] 更新弹窗汉化注入成功！`);
    }

    // 3.5 注入 utils.js (开启 DevTools)
    const utilsPath = path.join(tempDir, "dist", "utils.js");
    if (fs.existsSync(utilsPath)) {
        let utilsContent = fs.readFileSync(utilsPath, 'utf-8');
        utilsContent = utilsContent.replace('devTools: !electron_1.app.isPackaged', 'devTools: true');
        fs.writeFileSync(utilsPath, utilsContent, 'utf-8');
    }

    // 3.6 注入 keybindings.js (支持 F12 或 Ctrl+Shift+I 快捷键打开控制台)
    const kbPath = path.join(tempDir, "dist", "keybindings.js");
    if (fs.existsSync(kbPath)) {
        let kbContent = fs.readFileSync(kbPath, 'utf-8');
        if (!kbContent.includes('toggleDevTools')) {
            const kbTarget = "if (isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'n') {";
            const kbReplacement = `if ((isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
                win.webContents.toggleDevTools();
                event.preventDefault();
            }
            if (isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'n') {`;
            kbContent = kbContent.replace(kbTarget, kbReplacement);
            fs.writeFileSync(kbPath, kbContent, 'utf-8');
        }
    }

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
        } else if (args[i] === '--brand-title') {
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
