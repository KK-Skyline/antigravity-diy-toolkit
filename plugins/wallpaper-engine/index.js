'use strict';

const fs = require('fs');
const path = require('path');

const SIGNATURE_START = "/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */";
const SIGNATURE_END = "/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */";

const WALLPAPER_VIDEO_MAIN_MODULE = [
    "'use strict';",
    "// Antigravity 视频壁纸服务（由 antigravity2-cn/plugins/wallpaper-engine 注入）",
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

function detectSceneEffects(dir) {
    const effects = {};
    try {
        const pkg = path.join(dir, 'scene.pkg');
        if (!fs.existsSync(pkg)) return effects;
        const fd = fs.openSync(pkg, 'r');
        const buf = Buffer.alloc(Math.min(fs.statSync(pkg).size, 256 * 1024));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        const names = buf.toString('latin1').toLowerCase();
        let rainOn = /particles\/[^\x00]*rain/.test(names);
        try {
            const proj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
            const prop = proj.general && proj.general.properties && proj.general.properties.rain;
            if (prop && Array.isArray(prop.options)) {
                const opt = prop.options.find(o => String(o.value) === String(prop.value));
                if (opt && /off|关/i.test(String(opt.label))) rainOn = false;
            } else if (prop && prop.type === 'bool' && prop.value === false) {
                rainOn = false;
            }
        } catch (e) {}
        if (rainOn) effects.rain = { intensity: /down_?pour|heavy|storm/.test(names) ? 1 : 0.6 };
    } catch (e) {}
    return effects;
}

module.exports = {
    prepare(ctx) {
        if (ctx.shared && ctx.shared.bakedWallpaper !== undefined) return;
        let bakedWallpaper = null;
        try {
            const userCfg = {
                enabled: true,
                workshopId: '3284620554',
                monitor: 'Monitor0',
                opacity: 0.68,
                blur: 0,
                brightness: 105,
                contrast: 110,
                saturate: 110,
                darken: 18,
                flipHorizontal: false,
                caretColor: '#4f8cff'
            };
            const cfgFile = path.join(ctx.rootDir, 'wallpaper_config.json');
            if (fs.existsSync(cfgFile)) {
                try { Object.assign(userCfg, JSON.parse(fs.readFileSync(cfgFile, 'utf8'))); } catch (e) {}
            }
            const configOverride = ctx.shared && ctx.shared.configOverride;
            if (configOverride) Object.assign(userCfg, configOverride);
            if (!/^\d{1,20}$/.test(String(userCfg.workshopId))) throw new Error('Invalid workshopId');
            const weReader = require(path.join(ctx.rootDir, 'wallpaper_engine_reader'));
            let wp = weReader.getActiveWallpaper(userCfg.monitor, userCfg.workshopId);
            try {
                const prepScript = path.join(ctx.rootDir, 'prepare_hd_wallpaper.py');
                if (fs.existsSync(prepScript) && userCfg.workshopId && ctx.hostHelpers && typeof ctx.hostHelpers.runPrepareHdWallpaper === 'function') {
                    ctx.hostHelpers.runPrepareHdWallpaper(prepScript, userCfg);
                    wp = weReader.getActiveWallpaper(userCfg.monitor, userCfg.workshopId);
                }
            } catch (e) {}
            const lastGoodFile = path.join(ctx.rootDir, 'last_good_wallpaper.json');
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
        if (ctx.shared) ctx.shared.bakedWallpaper = bakedWallpaper;
    },

    patchMain(ctx) {
        if (!ctx.isV2 || !ctx.distDir) return;
        const mainPath = path.join(ctx.distDir, 'main.js');
        const videoModulePath = path.join(ctx.distDir, 'agWallpaperVideo.js');
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
    },

    getPreloadRuntime(ctx) {
        const bakedWallpaper = ctx.shared && ctx.shared.bakedWallpaper;
        if (!bakedWallpaper || !(bakedWallpaper.dataUrl || bakedWallpaper.videoPath)) {
            return '';
        }
        return `
    const BAKED_WE_DATA = ${JSON.stringify(bakedWallpaper)};
    let currentWp = BAKED_WE_DATA;

    function rgb2hsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
        if (mx === mn) return [0, 0, l];
        const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [h * 60, s, l];
    }

    function analyzeFrame(src, sw, sh) {
        const w = 120, h = Math.max(1, Math.round(120 * sh / sw));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const ctx2d = cv.getContext('2d', { willReadFrequently: true });
        ctx2d.drawImage(src, 0, 0, w, h);
        const d = ctx2d.getImageData(0, 0, w, h).data;
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

    function getManualAccent(wp) {
        const m = wp && wp.config && wp.config.accent;
        return (typeof m === 'string' && /^#[0-9a-f]{6}$/i.test(m)) ? m : null;
    }

    function analyzeImage(wp) {
        try {
            const manual = getManualAccent(wp);
            if (manual) {
                bus.emit('wallpaper:frame', { bins: null, lum: null, manualAccent: manual, config: wp.config || {}, isVideoSample: false });
            }
            if (!wp.dataUrl) return;
            const img = new Image();
            img.onload = () => {
                try {
                    const r = analyzeFrame(img, img.naturalWidth, img.naturalHeight);
                    bus.emit('wallpaper:frame', { bins: r.bins, lum: r.lum, manualAccent: manual, config: wp.config || {}, isVideoSample: false });
                } catch (e) { console.warn('[Antigravity] 壁纸分析失败，使用默认参数:', e); }
            };
            img.src = wp.dataUrl;
        } catch (e) {}
    }

    const videoSource = { path: '', mime: 'video/mp4' };
    function startVideoServer() {
        const electron = require('electron');
        return electron.ipcRenderer.invoke('antigravity:wallpaper-video-url', videoSource.path, videoSource.mime);
    }

    let videoEl = null, sampleTimer = null;
    function sampleVideo() {
        try {
            if (!videoEl || videoEl.readyState < 2 || document.hidden || !videoEl.videoWidth) return;
            const r = analyzeFrame(videoEl, videoEl.videoWidth, videoEl.videoHeight);
            bus.emit('wallpaper:frame', {
                bins: r.bins,
                lum: r.lum,
                manualAccent: getManualAccent(currentWp),
                config: currentWp.config || {},
                isVideoSample: true
            });
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
        if (videoEl && !videoEl.isConnected) unmountVideo();
        if (!videoEl) {
            videoEl = document.createElement('video');
            videoEl.id = 'ag-wallpaper-video';
            videoEl.muted = true; videoEl.loop = true; videoEl.autoplay = true; videoEl.playsInline = true;
            videoEl.crossOrigin = 'anonymous';
            videoEl.setAttribute('aria-hidden', 'true');
            document.body.insertBefore(videoEl, document.body.firstChild);
            const resume = () => { if (videoEl && !document.hidden && videoEl.paused) videoEl.play().catch(() => {}); };
            document.addEventListener('visibilitychange', resume);
            window.addEventListener('focus', resume);
            sampleTimer = setInterval(sampleVideo, 2500);
        }
        videoEl.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover;z-index:0;pointer-events:none;filter:' + filter + ';';
        if (videoSource.path !== wp.videoPath) {
            videoSource.path = wp.videoPath;
            videoSource.mime = wp.videoMime || 'video/mp4';
            const manual = getManualAccent(wp);
            if (manual) {
                bus.emit('wallpaper:frame', { bins: null, lum: null, manualAccent: manual, config: wp.config || {}, isVideoSample: true, reset: true });
            }
            startVideoServer().then(url => {
                if (!videoEl) return;
                videoEl.src = url + '?v=' + Date.now();
                videoEl.play().catch(() => {});
            }).catch(e => console.warn('[Antigravity] 视频壁纸服务启动失败，保留静态封面:', e));
        }
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
                'body::before {',
                '  content: "" !important;',
                '  position: fixed !important;',
                '  inset: -10px !important;',
                '  z-index: 0 !important;',
                '  pointer-events: none !important;',
                wp.dataUrl ? '  background: url("' + wp.dataUrl + '") center / cover no-repeat !important;' : '  background: none !important;',
                '  filter: ' + artFilter + ' !important;',
                '}',
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
                '}'
            ].join('\\n');

            if (wp.type === 'video' && wp.videoPath) {
                mountVideo(wp, artFilter);
            } else {
                unmountVideo();
                if (wp !== analyzeImage.last || !document.documentElement.style.getPropertyValue('--ag-glass-a')) {
                    analyzeImage.last = wp;
                    analyzeImage(wp);
                }
            }

            bus.emit('wallpaper:effects', { rain: (wp.effects && wp.effects.rain) ? wp.effects.rain : null });
            console.log('[Antigravity] 联动 Wallpaper Engine 渲染成功: ' + (wp.title || '壁纸已应用') + (wp.videoPath ? '（原视频播放）' : ''));
        } catch (e) {
            console.error('[Antigravity] Wallpaper Engine 渲染异常:', e);
        }
    }

    applyWallpaper(currentWp);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => applyWallpaper(currentWp));
    }
    window.addEventListener('load', () => applyWallpaper(currentWp));
    setTimeout(() => applyWallpaper(currentWp), 100);
    setTimeout(() => applyWallpaper(currentWp), 500);

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
    } catch (e) {}
`;
    }
};
