const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const child_process = require('child_process');

const weReader = require('./wallpaper_engine_reader');

const PORT = 3210;
const CFG_FILE = path.join(__dirname, 'wallpaper_config.json');

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

    const roots = weReader.findWallpaperEngineConfig ? [path.dirname(path.dirname(path.dirname(weReader.findWallpaperEngineConfig())))] : [];
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
                if (map.has(id)) continue;
                const itemDir = path.join(baseDir, id);
                try {
                    const stat = fs.statSync(itemDir);
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

// 重启 Antigravity 客户端
function restartAntigravityClient() {
    try {
        child_process.execSync('taskkill /F /IM Antigravity.exe', { windowsHide: true });
    } catch(e) {}
    setTimeout(() => {
        const candidates = [
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'Antigravity.exe') : null,
            'C:\\Program Files\\Antigravity\\Antigravity.exe',
            'D:\\Programs\\Antigravity\\Antigravity.exe',
        ].filter(Boolean);
        for (const exe of candidates) {
            if (fs.existsSync(exe)) {
                child_process.spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
                break;
            }
        }
    }, 800);
}

// HTTP 服务器
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // 1. 获取壁纸列表 API
    if (pathname === '/api/wallpapers') {
        const list = scanWallpapers(parsedUrl.query.refresh === '1');
        const cfg = readConfig();
        const result = list.map(item => ({
            ...item,
            isActive: String(item.id) === String(cfg.workshopId)
        }));
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
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const current = readConfig();
                
                if (data.workshopId) current.workshopId = String(data.workshopId);
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
                const killArg = data.autoRestart ? '' : '--no-kill';
                const cmd = `node "${scriptPath}" --wallpaper ${killArg}`;
                console.log('[Hub] 正在执行应用指令:', cmd);
                
                child_process.exec(cmd, { cwd: __dirname }, (err, stdout, stderr) => {
                    if (err) {
                        console.error('[Hub] 应用壁纸失败:', stderr || err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ success: false, error: err.message, details: stderr }));
                        return;
                    }
                    console.log('[Hub] 壁纸应用成功，输出:\n', stdout);
                    
                    if (data.autoRestart) {
                        restartAntigravityClient();
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: true,
                        message: '壁纸应用成功！' + (data.autoRestart ? ' 客户端正在自动重启...' : ' 请手动重启客户端以生效。'),
                        workshopId: current.workshopId
                    }));
                });
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // 5. 打开本地文件夹 API
    if (pathname === '/api/open-folder' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.dir && fs.existsSync(data.dir)) {
                    child_process.exec(`explorer.exe "${data.dir.replace(/\//g, '\\')}"`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                    return;
                }
            } catch(e) {}
            res.writeHead(400);
            res.end();
        });
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
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            background: '#0a0d14',
            card: '#121722',
            cardBorder: '#1e2638',
            primary: '#3b82f6',
            primaryHover: '#2563eb'
          }
        }
      }
    }
  </script>
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
      <button onclick="fetchWallpapers(true)" class="p-2 rounded-xl bg-[#161c2a] hover:bg-[#1f273a] border border-cardBorder text-slate-300 hover:text-white transition" title="刷新壁纸库">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
      </button>
    </div>
  </header>

  <!-- 二级过滤标签 -->
  <div class="px-6 py-3 border-b border-cardBorder/60 bg-[#0d111a] flex items-center justify-between gap-4 text-xs">
    <div class="flex items-center gap-2 overflow-x-auto py-1">
      <button onclick="setFilter('all')" class="tab-btn active px-3 py-1 rounded-lg bg-blue-600 text-white font-medium transition" data-type="all">全部 (<span id="countAll">0</span>)</button>
      <button onclick="setFilter('scene')" class="tab-btn px-3 py-1 rounded-lg bg-[#161c2a] hover:bg-[#1f273a] text-slate-300 font-medium transition" data-type="scene">场景动画 (<span id="countScene">0</span>)</button>
      <button onclick="setFilter('video')" class="tab-btn px-3 py-1 rounded-lg bg-[#161c2a] hover:bg-[#1f273a] text-slate-300 font-medium transition" data-type="video">视频壁纸 (<span id="countVideo">0</span>)</button>
      <button onclick="setFilter('web')" class="tab-btn px-3 py-1 rounded-lg bg-[#161c2a] hover:bg-[#1f273a] text-slate-300 font-medium transition" data-type="web">网页/交互 (<span id="countWeb">0</span>)</button>
      <button onclick="setFilter('active')" class="tab-btn px-3 py-1 rounded-lg bg-[#161c2a] hover:bg-[#1f273a] text-emerald-400 font-medium transition" data-type="active">当前生效</button>
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
      <button onclick="closeDrawer()" class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition">
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
          <input id="sliderOpacity" type="range" min="15" max="100" value="68" class="hub-slider w-full cursor-pointer" oninput="updatePreview()" />
        </div>

        <!-- 磨砂模糊 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">毛玻璃模糊 (Blur)</span>
            <span id="valBlur" class="font-mono text-blue-400 font-bold">0 px</span>
          </div>
          <input id="sliderBlur" type="range" min="0" max="25" value="0" class="hub-slider w-full cursor-pointer" oninput="updatePreview()" />
        </div>

        <!-- 亮度 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">画面亮度 (Brightness)</span>
            <span id="valBrightness" class="font-mono text-blue-400 font-bold">105%</span>
          </div>
          <input id="sliderBrightness" type="range" min="50" max="150" value="105" class="hub-slider w-full cursor-pointer" oninput="updatePreview()" />
        </div>

        <!-- 对比度 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">对比度 (Contrast)</span>
            <span id="valContrast" class="font-mono text-blue-400 font-bold">110%</span>
          </div>
          <input id="sliderContrast" type="range" min="50" max="160" value="110" class="hub-slider w-full cursor-pointer" oninput="updatePreview()" />
        </div>

        <!-- 饱和度 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">色彩饱和度 (Saturate)</span>
            <span id="valSaturate" class="font-mono text-blue-400 font-bold">110%</span>
          </div>
          <input id="sliderSaturate" type="range" min="30" max="180" value="110" class="hub-slider w-full cursor-pointer" oninput="updatePreview()" />
        </div>

        <!-- 暗化遮罩 -->
        <div>
          <div class="flex justify-between text-xs mb-1.5">
            <span class="text-slate-300">边缘暗角遮罩 (Darken Mask)</span>
            <span id="valDarken" class="font-mono text-blue-400 font-bold">18%</span>
          </div>
          <input id="sliderDarken" type="range" min="0" max="50" value="18" class="hub-slider w-full cursor-pointer" oninput="updatePreview()" />
        </div>

        <!-- 重置参数 -->
        <div class="pt-1 flex justify-end">
          <button onclick="resetSliders()" class="text-[11px] text-slate-400 hover:text-blue-400 transition">恢复默认参数</button>
        </div>
      </div>

      <!-- 操作与选项 -->
      <div class="space-y-3 pt-2">
        <label class="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer p-2.5 rounded-lg bg-[#141a29] border border-cardBorder">
          <input id="chkAutoRestart" type="checkbox" checked class="w-4 h-4 rounded text-blue-600 accent-blue-500" />
          <span>应用后自动重启 Antigravity 客户端（立即生效）</span>
        </label>

        <button id="btnApply" onclick="applyWallpaper()" class="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          <span>一键应用换肤到零重力</span>
        </button>

        <div class="flex items-center justify-between text-xs text-slate-400 px-1 pt-1">
          <button onclick="openCurrentDir()" class="hover:text-slate-200 transition underline">打开壁纸本地目录</button>
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

  <script>
    let allWallpapers = [];
    let currentFilter = 'all';
    let selectedWp = null;
    let activeWorkshopId = '';

    // 初始化加载
    window.addEventListener('DOMContentLoaded', () => {
      fetchWallpapers();
      initSearch();
      initSliders();
    });

    async function fetchWallpapers(force = false) {
      document.getElementById('statBadge').textContent = '正在极速扫描壁纸库...';
      try {
        const res = await fetch('/api/wallpapers' + (force ? '?refresh=1' : ''));
        const data = await res.json();
        allWallpapers = data.wallpapers || [];
        activeWorkshopId = data.activeId || '';

        // 更新统计计数
        document.getElementById('countAll').textContent = allWallpapers.length;
        document.getElementById('countScene').textContent = allWallpapers.filter(w => w.type === 'scene').length;
        document.getElementById('countVideo').textContent = allWallpapers.filter(w => w.type === 'video').length;
        document.getElementById('countWeb').textContent = allWallpapers.filter(w => w.type === 'web').length;
        document.getElementById('statBadge').textContent = allWallpapers.length + ' 款已订阅壁纸已就绪';

        renderGrid();
      } catch(e) {
        document.getElementById('statBadge').textContent = '扫描失败: ' + e.message;
      }
    }

    function initSearch() {
      const input = document.getElementById('searchInput');
      input.addEventListener('input', () => {
        renderGrid();
      });
    }

    function setFilter(type) {
      currentFilter = type;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.type === type) {
          btn.classList.add('bg-blue-600', 'text-white');
          btn.classList.remove('bg-[#161c2a]', 'text-slate-300');
        } else {
          btn.classList.remove('bg-blue-600', 'text-white');
          btn.classList.add('bg-[#161c2a]', 'text-slate-300');
        }
      });
      renderGrid();
    }

    function renderGrid() {
      const query = document.getElementById('searchInput').value.trim().toLowerCase();
      const grid = document.getElementById('grid');
      const emptyTip = document.getElementById('emptyTip');

      let list = allWallpapers.filter(item => {
        // 类型过滤
        if (currentFilter === 'scene' && item.type !== 'scene') return false;
        if (currentFilter === 'video' && item.type !== 'video') return false;
        if (currentFilter === 'web' && item.type !== 'web') return false;
        if (currentFilter === 'active' && item.id !== activeWorkshopId) return false;

        // 搜索关键词
        if (query) {
          return item.title.toLowerCase().includes(query) || item.id.includes(query);
        }
        return true;
      });

      if (list.length === 0) {
        grid.innerHTML = '';
        emptyTip.classList.remove('hidden');
        return;
      }

      emptyTip.classList.add('hidden');
      grid.innerHTML = list.map(item => {
        const isActive = item.id === activeWorkshopId;
        const typeColor = item.type === 'video' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' : 
                         item.type === 'web' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                         'bg-blue-500/20 text-blue-300 border-blue-500/30';
        const typeLabel = item.type === 'video' ? '视频' : item.type === 'web' ? '网页' : '场景';

        return \`
          <div onclick="openInspector('\${item.id}')" class="group relative rounded-2xl bg-card border \${isActive ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-cardBorder hover:border-blue-500/60'} overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 flex flex-col">
            <!-- 缩略图容器 -->
            <div class="relative aspect-video w-full overflow-hidden bg-black/30 card-zoom">
              <img src="/api/preview/\${item.id}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 60\\'><rect width=\\'100\\' height=\\'60\\' fill=\\'%23121722\\'/><text x=\\'50\\' y=\\'32\\' fill=\\'%23666\\' font-size=\\'8\\' text-anchor=\\'middle\\'>无封面</text></svg>'" />
              
              <!-- 标签徽章 -->
              <div class="absolute top-2 right-2 flex items-center gap-1">
                \${item.hasAnimated ? '<span class="px-1.5 py-0.5 rounded-md bg-cyan-500/80 text-white font-mono text-[9px] shadow-sm font-bold">60帧超清</span>' : ''}
                <span class="px-1.5 py-0.5 rounded-md text-[10px] font-medium border backdrop-blur-md \${typeColor}">\${typeLabel}</span>
              </div>

              \${isActive ? '<div class="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-emerald-500 text-black font-bold text-[10px] shadow-lg flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-black animate-pulse"></span>已生效</div>' : ''}
            </div>

            <!-- 卡片文本 -->
            <div class="p-3 flex-1 flex flex-col justify-between">
              <h3 class="text-xs font-semibold text-slate-200 line-clamp-1 group-hover:text-blue-400 transition" title="\${escapeHtml(item.title)}">\${escapeHtml(item.title)}</h3>
              <div class="mt-2 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>ID: \${item.id}</span>
                <span class="text-blue-400/80 opacity-0 group-hover:opacity-100 transition">配置 →</span>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 打开参数调参抽屉
    async function openInspector(id) {
      selectedWp = allWallpapers.find(w => w.id === id);
      if (!selectedWp) return;

      document.getElementById('drawerTitle').textContent = selectedWp.title;
      document.getElementById('drawerTypeBadge').textContent = selectedWp.type.toUpperCase();
      document.getElementById('drawerPreviewImg').src = '/api/preview/' + selectedWp.id;
      document.getElementById('steamLink').href = 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + selectedWp.id;

      // 读取并还原当前配置
      try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        if (selectedWp.id === cfg.workshopId) {
          document.getElementById('sliderOpacity').value = Math.round((cfg.opacity ?? 0.68) * 100);
          document.getElementById('sliderBlur').value = cfg.blur ?? 0;
          document.getElementById('sliderBrightness').value = cfg.brightness ?? 105;
          document.getElementById('sliderContrast').value = cfg.contrast ?? 110;
          document.getElementById('sliderSaturate').value = cfg.saturate ?? 110;
          document.getElementById('sliderDarken').value = cfg.darken ?? 18;
        } else {
          resetSliders();
        }
      } catch(e) {
        resetSliders();
      }

      updatePreview();
      document.getElementById('drawer').classList.remove('translate-x-full');
    }

    function closeDrawer() {
      document.getElementById('drawer').classList.add('translate-x-full');
    }

    function resetSliders() {
      document.getElementById('sliderOpacity').value = 68;
      document.getElementById('sliderBlur').value = 0;
      document.getElementById('sliderBrightness').value = 105;
      document.getElementById('sliderContrast').value = 110;
      document.getElementById('sliderSaturate').value = 110;
      document.getElementById('sliderDarken').value = 18;
      updatePreview();
    }

    function updatePreview() {
      const op = document.getElementById('sliderOpacity').value;
      const blur = document.getElementById('sliderBlur').value;
      const br = document.getElementById('sliderBrightness').value;
      const ct = document.getElementById('sliderContrast').value;
      const sat = document.getElementById('sliderSaturate').value;
      const dark = document.getElementById('sliderDarken').value;

      document.getElementById('valOpacity').textContent = op + '%';
      document.getElementById('valBlur').textContent = blur + ' px';
      document.getElementById('valBrightness').textContent = br + '%';
      document.getElementById('valContrast').textContent = ct + '%';
      document.getElementById('valSaturate').textContent = sat + '%';
      document.getElementById('valDarken').textContent = dark + '%';

      // 实时更新每一个滑块的轨道着色进度百分比
      [document.getElementById('sliderOpacity'),
       document.getElementById('sliderBlur'),
       document.getElementById('sliderBrightness'),
       document.getElementById('sliderContrast'),
       document.getElementById('sliderSaturate'),
       document.getElementById('sliderDarken')].forEach(s => {
         if (!s) return;
         const min = parseFloat(s.min) || 0;
         const max = parseFloat(s.max) || 100;
         const pct = ((s.value - min) / (max - min)) * 100;
         s.style.setProperty('--progress', pct + '%');
       });

      const img = document.getElementById('drawerPreviewImg');
      const mask = document.getElementById('drawerMask');

      img.style.opacity = op / 100;
      img.style.filter = \`blur(\${blur}px) brightness(\${br}%) contrast(\${ct}%) saturate(\${sat}%)\`;
      mask.style.background = \`radial-gradient(circle at center, rgba(10,13,20,\${(dark/100)*0.4}) 0%, rgba(10,13,20,\${Math.min(1, (dark/100)+0.35)}) 100%)\`;
    }

    // 初始化滑块拖拽捕获与流畅度增强
    function initSliders() {
      const sliders = document.querySelectorAll('input[type="range"].hub-slider');
      sliders.forEach(slider => {
        slider.draggable = false;
        slider.addEventListener('dragstart', (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        });

        // 增强指针拖拽支持：利用 PointerCapture 确保无论鼠标移得多快或移出元素，都能 100% 丝滑连续捕获拖拽
        const updateFromPointer = (e) => {
          const rect = slider.getBoundingClientRect();
          if (rect.width <= 0) return;
          const min = parseFloat(slider.min) || 0;
          const max = parseFloat(slider.max) || 100;
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const step = parseFloat(slider.step) || 1;
          const rawVal = min + ratio * (max - min);
          const steppedVal = Math.round(rawVal / step) * step;
          if (String(slider.value) !== String(steppedVal)) {
            slider.value = steppedVal;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };

        slider.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return; // 仅左键响应
          try { slider.setPointerCapture(e.pointerId); } catch(_) {}
          updateFromPointer(e);

          const onPointerMove = (ev) => {
            if (ev.buttons === 1) {
              updateFromPointer(ev);
            }
          };

          const onPointerUp = (ev) => {
            try { slider.releasePointerCapture(ev.pointerId); } catch(_) {}
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
          };

          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);
        });
      });

      updatePreview();
    }

    // 一键应用壁纸
    async function applyWallpaper() {
      if (!selectedWp) return;
      const btn = document.getElementById('btnApply');
      const oldHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span> 正在打包注入 app.asar...';

      const payload = {
        workshopId: selectedWp.id,
        opacity: parseInt(document.getElementById('sliderOpacity').value) / 100,
        blur: parseInt(document.getElementById('sliderBlur').value),
        brightness: parseInt(document.getElementById('sliderBrightness').value),
        contrast: parseInt(document.getElementById('sliderContrast').value),
        saturate: parseInt(document.getElementById('sliderSaturate').value),
        darken: parseInt(document.getElementById('sliderDarken').value),
        autoRestart: document.getElementById('chkAutoRestart').checked
      };

      try {
        const res = await fetch('/api/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          activeWorkshopId = selectedWp.id;
          renderGrid();
          showToast(data.message, 'success');
        } else {
          showToast('应用失败: ' + (data.error || '未知错误'), 'error');
        }
      } catch(e) {
        showToast('请求异常: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    }

    function openCurrentDir() {
      if (selectedWp && selectedWp.dir) {
        fetch('/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: selectedWp.dir })
        });
      }
    }

    function showToast(text, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = text;
      toast.className = 'fixed bottom-6 right-6 z-50 transition-all duration-300 px-4 py-3 rounded-xl text-sm font-semibold shadow-2xl flex items-center gap-2 ' +
        (type === 'success' ? 'bg-emerald-600 text-white shadow-emerald-500/20' : 'bg-red-600 text-white shadow-red-500/20');
      toast.classList.remove('translate-y-20', 'opacity-0');
      setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
      }, 4000);
    }
  </script>
</body>
</html>`;
}

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  Antigravity 壁纸控制中心已启动！`);
    console.log(`  访问地址: http://localhost:${PORT}`);
    console.log(`====================================================`);
});
