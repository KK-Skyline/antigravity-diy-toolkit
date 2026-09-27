const http = require('http');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const weReader = require('./wallpaper_engine_reader');

const PORT = 3210;
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;
const CFG_FILE = path.join(__dirname, 'wallpaper_config.json');

function sendJson(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
            req.resume();
            reject({ status: 415, message: 'Content-Type must be application/json' });
            return;
        }
        let body = '';
        let size = 0;
        let done = false;
        req.on('data', chunk => {
            if (done) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                done = true;
                reject({ status: 413, message: 'Request body too large' });
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            if (done) return;
            try {
                const data = JSON.parse(body);
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid JSON object');
                resolve(data);
            } catch (error) {
                reject({ status: 400, message: 'Invalid JSON object' });
            }
        });
        req.on('error', reject);
    });
}

const NUMBER_RANGES = {
    opacity: [0.15, 1], blur: [0, 25], brightness: [50, 150],
    contrast: [50, 160], saturate: [30, 180], darken: [0, 50]
};

// 读取当前配置
function readConfig() {
    let cfg = {
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
    if (fs.existsSync(CFG_FILE)) {
        try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch(e) {}
    }
    return cfg;
}

// 缓存壁纸列表
let cachedWallpapers = null;
let lastScanTime = 0;

function scanWallpapers(force = false) {
    const now = Date.now();
    if (!force && cachedWallpapers && (now - lastScanTime < 15000)) {
        return cachedWallpapers;
    }

    // 聚合所有可能的 Steam 库
    const candidateDirs = [
        'E:/SteamLibrary/steamapps/workshop/content/431960',
        'C:/SteamLibrary/steamapps/workshop/content/431960',
        'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960',
        'D:/SteamLibrary/steamapps/workshop/content/431960',
        'F:/SteamLibrary/steamapps/workshop/content/431960'
    ];

    const currentCfg = readConfig();
    const map = new Map();

    for (const baseDir of candidateDirs) {
        if (!fs.existsSync(baseDir)) continue;
        try {
            const items = fs.readdirSync(baseDir);
            for (const id of items) {
                if (!/^\d{1,20}$/.test(id)) continue;
                if (map.has(id)) continue;
                const itemDir = path.join(baseDir, id);
                try {
                    const stat = fs.lstatSync(itemDir);
                    if (!stat.isDirectory()) continue;
                    
                    const projectPath = path.join(itemDir, 'project.json');
                    let title = 'Wallpaper ' + id;
                    let type = 'scene';
                    let preview = null;
                    let desc = '';
                    let tags = [];

                    if (fs.existsSync(projectPath)) {
                        try {
                            const p = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
                            if (p.title) title = p.title;
                            if (p.type) type = p.type.toLowerCase();
                            if (p.preview) preview = p.preview;
                            if (p.description) desc = p.description;
                            if (p.tags) tags = Array.isArray(p.tags) ? p.tags : [p.tags];
                        } catch(e) {}
                    }

                    // 检查是否有可用预览文件
                    const hasAnimated = fs.existsSync(path.join(itemDir, 'preview_animated.webp'));
                    const hasGif = fs.existsSync(path.join(itemDir, 'preview.gif'));
                    const hasPreview = fs.existsSync(path.join(itemDir, preview || 'preview.jpg')) ||
                                      fs.existsSync(path.join(itemDir, 'preview.jpg')) ||
                                      fs.existsSync(path.join(itemDir, 'preview.png')) ||
                                      hasGif || hasAnimated;

                    map.set(id, {
                        id,
                        title,
                        type,
                        previewFile: preview || 'preview.jpg',
                        hasAnimated,
                        hasGif,
                        hasPreview,
                        tags,
                        desc: desc.substring(0, 300),
                        dir: itemDir.replace(/\\/g, '/'),
                        baseDir,
                        mtime: stat.mtimeMs,
                        isActive: String(id) === String(currentCfg.workshopId)
                    });
                } catch(e) {}
            }
        } catch(e) {}
    }

    cachedWallpapers = Array.from(map.values()).sort((a, b) => b.mtime - a.mtime);
    lastScanTime = now;
    return cachedWallpapers;
}

// 寻找壁纸目录下的最佳预览图
function getBestPreviewFile(itemDir) {
    const candidates = [
        'preview_animated.webp',
        'preview_hd.jpg',
        'preview_hd.png',
        'preview.gif',
        'preview.jpg',
        'preview.png',
        'preview.jpeg'
    ];
    for (const c of candidates) {
        const full = path.join(itemDir, c);
        if (fs.existsSync(full)) return full;
    }
    return null;
}

// HTTP 服务器
let applyInFlight = false;
const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    const allowedHosts = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
    const allowedOrigins = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
    if (!allowedHosts.has(req.headers.host) ||
        (req.headers.origin && !allowedOrigins.has(req.headers.origin))) {
        res.writeHead(403);
        res.end();
        return;
    }
    let requestUrl;
    try { requestUrl = new URL(req.url, `http://${req.headers.host}`); }
    catch (error) { res.writeHead(400); res.end(); return; }
    if (!allowedOrigins.has(requestUrl.origin)) { res.writeHead(403); res.end(); return; }
    const pathname = requestUrl.pathname;

    // 1. 获取壁纸列表 API
    if (pathname === '/api/wallpapers') {
        const list = scanWallpapers(requestUrl.searchParams.get('refresh') === '1');
        const cfg = readConfig();
        const result = list.map(({ dir, baseDir, ...item }) => ({ ...item, isActive: item.id === String(cfg.workshopId) }));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            count: result.length,
            activeId: cfg.workshopId,
            wallpapers: result
        }));
        return;
    }

    // 2. 获取壁纸预览图 API
    if (pathname.startsWith('/api/preview/')) {
        const id = pathname.replace('/api/preview/', '').split('/')[0];
        const list = scanWallpapers();
        const wp = list.find(w => w.id === id);
        if (!wp) {
            res.writeHead(404);
            res.end('Wallpaper not found');
            return;
        }

        const previewPath = getBestPreviewFile(wp.dir);
        if (!previewPath || !fs.existsSync(previewPath)) {
            res.writeHead(404);
            res.end('Preview not found');
            return;
        }

        const ext = path.extname(previewPath).toLowerCase();
        let mime = 'image/jpeg';
        if (ext === '.webp') mime = 'image/webp';
        else if (ext === '.gif') mime = 'image/gif';
        else if (ext === '.png') mime = 'image/png';

        res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=86400'
        });
        fs.createReadStream(previewPath).pipe(res);
        return;
    }

    // 3. 获取当前配置 API
    if (pathname === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(readConfig()));
        return;
    }

    // 4. 一键应用壁纸 API
    if (pathname === '/api/apply' && req.method === 'POST') {
        readJsonBody(req).then(data => {
            let validated = false;
            let ownsApplyLock = false;
            try {
                for (const [key, [min, max]] of Object.entries(NUMBER_RANGES)) {
                    if (data[key] !== undefined &&
                        (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < min || data[key] > max)) {
                        throw new Error(`Invalid ${key}`);
                    }
                }
                for (const key of ['flipHorizontal', 'autoRestart']) {
                    if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Error(`Invalid ${key}`);
                }
                const id = data.workshopId;
                if (typeof id !== 'string' || !/^\d{1,20}$/.test(id) ||
                    !scanWallpapers().some(item => item.id === id)) {
                    throw new Error('Invalid workshopId');
                }
                validated = true;
                if (applyInFlight) {
                    sendJson(res, 409, { success: false, code: 'APPLY_BUSY', error: '已有应用任务正在执行。' });
                    return;
                }
                applyInFlight = true;
                ownsApplyLock = true;
                const current = readConfig();
                
                current.workshopId = id;
                if (typeof data.opacity === 'number') current.opacity = data.opacity;
                if (typeof data.blur === 'number') current.blur = data.blur;
                if (typeof data.brightness === 'number') current.brightness = data.brightness;
                if (typeof data.contrast === 'number') current.contrast = data.contrast;
                if (typeof data.saturate === 'number') current.saturate = data.saturate;
                if (typeof data.darken === 'number') current.darken = data.darken;
                if (typeof data.flipHorizontal === 'boolean') current.flipHorizontal = data.flipHorizontal;

                // 写入配置文件
                fs.writeFileSync(CFG_FILE, JSON.stringify(current, null, 2), 'utf8');

                // 执行注入打包引擎
                const scriptPath = path.join(__dirname, 'localization_engine.js');
                const args = [scriptPath, '--wallpaper'];
                args.push(data.autoRestart ? '--close-app' : '--no-kill');
                console.log('[Hub] 正在执行应用指令:', process.execPath, args);
                
                child_process.execFile(process.execPath, args, { cwd: __dirname, windowsHide: true, shell: false }, (err, stdout, stderr) => {
                    applyInFlight = false;
                    if (err) {
                        console.error('[Hub] 应用壁纸失败:', stderr || err.message);
                        sendJson(res, 500, { success: false, code: 'APPLY_FAILED', error: '应用失败，请查看服务端日志。' });
                        return;
                    }
                    console.log('[Hub] 壁纸应用成功，输出:\n', stdout);

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: true,
                        message: '壁纸应用成功！' + (data.autoRestart ? ' 客户端正在自动重启...' : ' 请手动重启客户端以生效。'),
                        workshopId: current.workshopId
                    }));
                });
            } catch(e) {
                if (ownsApplyLock) applyInFlight = false;
                console.error('[Hub] 应用请求失败:', e);
                sendJson(res, validated ? 500 : 400, validated
                    ? { success: false, code: 'APPLY_FAILED', error: '应用失败，请查看服务端日志。' }
                    : { success: false, code: 'INVALID_REQUEST', error: '请求参数无效。' });
            }
        }).catch(e => {
            const status = [400, 413, 415].includes(e.status) ? e.status : 400;
            sendJson(res, status, { success: false, code: 'INVALID_REQUEST', error: '请求格式无效。' });
        });
        return;
    }

    // 5. 打开本地文件夹 API
    if (pathname === '/api/open-folder' && req.method === 'POST') {
        readJsonBody(req).then(data => {
            if (typeof data.id !== 'string' || !/^\d{1,20}$/.test(data.id)) {
                sendJson(res, 400, { success: false, code: 'INVALID_REQUEST', error: '壁纸 ID 无效。' });
                return;
            }
            try {
                const wp = scanWallpapers().find(item => item.id === data.id);
                if (!wp) {
                    sendJson(res, 400, { success: false, code: 'INVALID_REQUEST', error: '未找到壁纸。' });
                    return;
                }
                const base = fs.realpathSync(wp.baseDir);
                const dir = fs.realpathSync(wp.dir);
                if (path.dirname(dir) !== base || !fs.statSync(dir).isDirectory()) throw new Error('Invalid wallpaper directory');
                const child = child_process.spawn('explorer.exe', [dir], { shell: false, detached: true, stdio: 'ignore' });
                child.once('spawn', () => { child.unref(); sendJson(res, 200, { success: true }); });
                child.once('error', e => {
                    console.error('[Hub] 打开壁纸目录失败:', e);
                    sendJson(res, 500, { success: false, code: 'OPEN_FOLDER_FAILED', error: '无法打开壁纸目录。' });
                });
            } catch(e) {
                console.error('[Hub] 打开壁纸目录失败:', e);
                sendJson(res, 500, { success: false, code: 'OPEN_FOLDER_FAILED', error: '无法打开壁纸目录。' });
            }
        }).catch(e => {
            const status = [400, 413, 415].includes(e.status) ? e.status : 400;
            sendJson(res, status, { success: false, code: 'INVALID_REQUEST', error: '请求格式无效。' });
        });
        return;
    }

    if (pathname === '/hub.css' || pathname === '/hub.js') {
        try {
            const content = fs.readFileSync(path.join(__dirname, pathname.slice(1)));
            res.writeHead(200, { 'Content-Type': pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' });
            res.end(content);
        } catch (error) {
            res.writeHead(404);
            res.end();
        }
        return;
    }

    // 6. 默认页面：主交互式 Web 控制台
    if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderDashboardHtml());
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

// 前端 SPA 页面 HTML
function renderDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity 壁纸控制中心 · Wallpaper Hub</title>
  <link rel="stylesheet" href="/hub.css">
  <style>
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #0a0d14; }
    ::-webkit-scrollbar-thumb { background: #1e2638; border-radius: 999px; }
    ::-webkit-scrollbar-thumb:hover { background: #3b82f6; }
    .card-zoom:hover img { transform: scale(1.05); }
    .glass { background: rgba(18, 23, 34, 0.75); backdrop-filter: blur(16px); }

    /* 自定义现代丝滑滑块 */
    input[type="range"].hub-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 24px;
      background: transparent;
      outline: none;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      cursor: pointer;
    }
    input[type="range"].hub-slider::-webkit-slider-runnable-track {
      height: 6px;
      border-radius: 999px;
      background: linear-gradient(to right, #3b82f6 0%, #3b82f6 var(--progress, 50%), #1e2638 var(--progress, 50%), #1e2638 100%);
    }
    input[type="range"].hub-slider::-moz-range-track {
      height: 6px;
      border-radius: 999px;
      background: #1e2638;
    }
    input[type="range"].hub-slider::-moz-range-progress {
      height: 6px;
      border-radius: 999px;
      background: #3b82f6;
    }
    input[type="range"].hub-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #3b82f6;
      border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5), 0 0 10px rgba(59, 130, 246, 0.6);
      margin-top: -7px;
      cursor: grab;
      transition: transform 0.1s ease, box-shadow 0.1s ease, background-color 0.1s ease;
    }
    input[type="range"].hub-slider:active::-webkit-slider-thumb {
      cursor: grabbing;
      transform: scale(1.25);
      background: #60a5fa;
      box-shadow: 0 0 16px rgba(59, 130, 246, 0.9), 0 0 4px #ffffff;
    }
    input[type="range"].hub-slider::-moz-range-thumb {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #3b82f6;
      border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5), 0 0 10px rgba(59, 130, 246, 0.6);
      cursor: grab;
      transition: transform 0.1s ease, box-shadow 0.1s ease, background-color 0.1s ease;
    }
    input[type="range"].hub-slider:active::-moz-range-thumb {
      cursor: grabbing;
      transform: scale(1.25);
      background: #60a5fa;
      box-shadow: 0 0 16px rgba(59, 130, 246, 0.9), 0 0 4px #ffffff;
    }
  </style>
</head>
<body class="bg-background text-slate-100 font-sans min-h-screen flex flex-col selection:bg-blue-600 selection:text-white">

  <!-- 顶部导航条 -->
  <header class="sticky top-0 z-40 border-b border-cardBorder glass px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-xl">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
      </div>
      <div>
        <h1 class="text-lg font-bold tracking-tight flex items-center gap-2">
          <span>Antigravity 壁纸控制中心</span>
          <span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono">v2.0</span>
        </h1>
        <p class="text-xs text-slate-400">已深度联动 Wallpaper Engine 创意工坊库</p>
      </div>
    </div>

    <!-- 搜索与类型过滤 -->
    <div class="flex items-center gap-3 flex-1 max-w-xl">
      <div class="relative w-full">
        <input id="searchInput" type="text" placeholder="搜索壁纸名称或工坊 ID..." class="w-full bg-[#161c2a] border border-cardBorder rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-slate-200 placeholder-slate-500" />
        <svg class="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
      </div>
    </div>

    <!-- 状态指示 -->
    <div class="flex items-center gap-3">
      <span id="statBadge" class="text-xs px-3 py-1.5 rounded-lg bg-[#161c2a] border border-cardBorder text-slate-300 font-medium">正在读取壁纸库...</span>
      <button data-action="refresh" class="p-2 rounded-xl bg-[#161c2a] hover:bg-[#1f273a] border border-cardBorder text-slate-300 hover:text-white transition" title="刷新壁纸库">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
      </button>
    </div>
  </header>

  <!-- 二级过滤标签 -->
  <div class="px-6 py-3 border-b border-cardBorder/60 bg-[#0d111a] flex items-center justify-between gap-4 text-xs">
    <div class="flex items-center gap-2 overflow-x-auto py-1">
      <button class="tab-btn active px-3 py-1 rounded-lg bg-blue-600 text-white font-medium transition" data-type="all">全部 (<span id="countAll">0</span>)</button>
      <button class="tab-btn px-3 py-1 rounded-lg bg-[#161c2a] hover:bg-[#1f273a] text-slate-300 font-medium transition" data-type="scene">场景动画 (<span id="countScene">0</span>)</button>
      <button class="tab-btn px-3 py-1 rounded-lg bg-[#161c2a] hover:bg-[#1f273a] text-slate-300 font-medium transition" data-type="video">视频壁纸 (<span id="countVideo">0</span>)</button>
      <button class="tab-btn px-3 py-1 rounded-lg bg-[#161c2a] hover:bg-[#1f273a] text-slate-300 font-medium transition" data-type="web">网页/交互 (<span id="countWeb">0</span>)</button>
      <button class="tab-btn px-3 py-1 rounded-lg bg-[#161c2a] hover:bg-[#1f273a] text-emerald-400 font-medium transition" data-type="active">当前生效</button>
    </div>
    <div class="text-slate-400 text-xs hidden sm:block">
      点击任意卡片展开视觉调参面板
    </div>
  </div>

  <!-- 主网格区 -->
  <main class="flex-1 p-6">
    <div id="grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
      <!-- 动态注入壁纸卡片 -->
    </div>
    <div id="emptyTip" class="hidden text-center py-20">
      <p class="text-slate-500 text-sm">没有匹配到相关的壁纸</p>
    </div>
  </main>

  <!-- 侧边视觉调参抽屉 (Drawer) -->
  <div id="drawer" class="fixed inset-y-0 right-0 w-full sm:w-[460px] bg-[#101522] border-l border-cardBorder shadow-2xl z-50 transform translate-x-full transition-transform duration-300 flex flex-col">
    <!-- 抽屉头部 -->
    <div class="p-5 border-b border-cardBorder flex items-center justify-between">
      <div class="flex items-center gap-2">
        <h2 class="text-base font-bold text-white">壁纸参数微调与应用</h2>
      </div>
      <button data-action="close" class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    </div>

    <!-- 抽屉内容 -->
    <div class="flex-1 overflow-y-auto p-5 space-y-5">
      <!-- 预览大卡片 -->
      <div class="relative rounded-2xl overflow-hidden aspect-video bg-black/40 border border-cardBorder group shadow-inner">
        <img id="drawerPreviewImg" src="" class="w-full h-full object-cover transition-all duration-150" />
        <div id="drawerMask" class="absolute inset-0 pointer-events-none transition-all"></div>
        <div class="absolute bottom-2 left-2 right-2 p-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-between text-xs text-white">
          <span id="drawerTitle" class="font-medium truncate mr-2"></span>
          <span id="drawerTypeBadge" class="px-2 py-0.5 rounded bg-blue-500/30 text-blue-300 font-mono text-[10px]"></span>
        </div>
      </div>

      <!-- 参数微调面板 -->
      <div class="space-y-4 bg-[#141a29] p-4 rounded-xl border border-cardBorder select-none">
        <h3 class="text-xs font-semibold text-slate-300 uppercase tracking-wider">视觉通透度与色彩微调</h3>
        
        <!-- 透明度 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">壁纸透明度 (Opacity)</span>
            <span id="valOpacity" class="font-mono text-blue-400 font-bold">68%</span>
          </div>
          <input id="sliderOpacity" type="range" min="15" max="100" value="68" class="hub-slider w-full cursor-pointer" />
        </div>

        <!-- 磨砂模糊 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">毛玻璃模糊 (Blur)</span>
            <span id="valBlur" class="font-mono text-blue-400 font-bold">0 px</span>
          </div>
          <input id="sliderBlur" type="range" min="0" max="25" value="0" class="hub-slider w-full cursor-pointer" />
        </div>

        <!-- 亮度 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">画面亮度 (Brightness)</span>
            <span id="valBrightness" class="font-mono text-blue-400 font-bold">105%</span>
          </div>
          <input id="sliderBrightness" type="range" min="50" max="150" value="105" class="hub-slider w-full cursor-pointer" />
        </div>

        <!-- 对比度 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">对比度 (Contrast)</span>
            <span id="valContrast" class="font-mono text-blue-400 font-bold">110%</span>
          </div>
          <input id="sliderContrast" type="range" min="50" max="160" value="110" class="hub-slider w-full cursor-pointer" />
        </div>

        <!-- 饱和度 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">色彩饱和度 (Saturate)</span>
            <span id="valSaturate" class="font-mono text-blue-400 font-bold">110%</span>
          </div>
          <input id="sliderSaturate" type="range" min="30" max="180" value="110" class="hub-slider w-full cursor-pointer" />
        </div>

        <!-- 暗化遮罩 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">边缘暗角遮罩 (Darken Mask)</span>
            <span id="valDarken" class="font-mono text-blue-400 font-bold">18%</span>
          </div>
          <input id="sliderDarken" type="range" min="0" max="50" value="18" class="hub-slider w-full cursor-pointer" />
        </div>

        <!-- 重置参数 -->
        <div class="pt-1 flex justify-end">
          <button data-action="reset" class="text-[11px] text-slate-400 hover:text-blue-400 transition">恢复默认参数</button>
        </div>
      </div>

      <!-- 操作与选项 -->
      <div class="space-y-3 pt-2">
        <label class="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer p-2.5 rounded-lg bg-[#141a29] border border-cardBorder">
          <input id="chkAutoRestart" type="checkbox" class="w-4 h-4 rounded text-blue-600 accent-blue-500" />
          <span>允许关闭并重启 Antigravity 客户端（立即生效）</span>
        </label>

        <button id="btnApply" data-action="apply" class="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          <span>一键应用换肤到零重力</span>
        </button>

        <div class="flex items-center justify-between text-xs text-slate-400 px-1 pt-1">
          <button data-action="open-folder" class="hover:text-slate-200 transition underline">打开壁纸本地目录</button>
          <a id="steamLink" href="#" target="_blank" class="hover:text-blue-400 transition flex items-center gap-1">
            <span>在 Steam 工坊中查看</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
          </a>
        </div>
      </div>
    </div>
  </div>

  <!-- 全局 Toast 提示 -->
  <div id="toast" class="fixed bottom-6 right-6 z-50 transform translate-y-20 opacity-0 transition-all duration-300 pointer-events-none px-4 py-3 rounded-xl text-sm font-medium shadow-2xl flex items-center gap-2"></div>

  <script src="/hub.js" defer></script>
</body>
</html>`;
}

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[错误] 端口 ${HOST}:${PORT} 已被占用，请关闭已有 Hub 实例。`);
    } else {
        console.error('[错误] Hub 启动失败:', error);
    }
    process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(`  Antigravity 壁纸控制中心已启动！`);
    console.log(`  访问地址: http://${HOST}:${PORT}`);
    console.log(`====================================================`);
});
