'use strict';

module.exports = {
    getPreloadRuntime(ctx) {
        const cfg = ctx.pluginConfig || {};
        const mode = cfg.mode || 'auto';
        const defaultIntensity = typeof cfg.intensity === 'number' ? cfg.intensity : 0.6;
        if (mode === 'off') return '';

        return `
    const RAIN_MODE = ${JSON.stringify(mode)};
    const RAIN_DEFAULT_INTENSITY = ${JSON.stringify(defaultIntensity)};
    const RAIN_LAYERS = [
        { len: [10, 16], speed: [700, 900], alpha: [0.10, 0.18], width: 0.8, share: 0.5 },
        { len: [16, 26], speed: [1000, 1300], alpha: [0.16, 0.28], width: 1.0, share: 0.35 },
        { len: [28, 44], speed: [1500, 1900], alpha: [0.24, 0.38], width: 1.4, share: 0.15 }
    ];
    const RAIN_SLANT = 0.12;
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
        const count = Math.round(innerWidth * innerHeight / 3200 * (rainOpts ? rainOpts.intensity : RAIN_DEFAULT_INTENSITY));
        rainDrops = [];
        for (let i = 0; i < count; i++) rainDrops.push(newDrop(true));
    }
    function drawRain(t) {
        rainRaf = requestAnimationFrame(drawRain);
        if (!rainCanvas || document.hidden) { rainLast = t; return; }
        const dt = Math.min(0.05, (t - (rainLast || t)) / 1000);
        rainLast = t;
        const ctx2d = rainCanvas.getContext('2d');
        const dpr = rainCanvas.width / innerWidth;
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.clearRect(0, 0, innerWidth, innerHeight);
        ctx2d.lineCap = 'round';
        const H = innerHeight;
        for (let i = 0; i < rainDrops.length; i++) {
            const d = rainDrops[i];
            const dy = d.speed * dt;
            d.y += dy; d.x += dy * RAIN_SLANT;
            if (d.y - d.len > H) { rainDrops[i] = newDrop(false); continue; }
            ctx2d.strokeStyle = 'rgba(214, 232, 240, ' + d.alpha + ')';
            ctx2d.lineWidth = d.width;
            ctx2d.beginPath();
            ctx2d.moveTo(d.x, d.y);
            ctx2d.lineTo(d.x - d.len * RAIN_SLANT, d.y - d.len);
            ctx2d.stroke();
        }
    }
    function unmountRain() {
        if (rainRaf) cancelAnimationFrame(rainRaf);
        rainRaf = 0;
        window.removeEventListener('resize', resizeRain);
        if (rainCanvas) { rainCanvas.remove(); rainCanvas = null; }
    }
    function mountRain(opts) {
        rainOpts = opts || { intensity: RAIN_DEFAULT_INTENSITY };
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', () => mountRain(opts), { once: true });
            return;
        }
        if (rainCanvas && !rainCanvas.isConnected) unmountRain();
        if (rainCanvas) return;
        rainCanvas = document.createElement('canvas');
        rainCanvas.id = 'ag-rain-canvas';
        rainCanvas.setAttribute('aria-hidden', 'true');
        rainCanvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none;';
        const video = document.getElementById('ag-wallpaper-video');
        document.body.insertBefore(rainCanvas, video ? video.nextSibling : document.body.firstChild);
        window.addEventListener('resize', resizeRain);
        resizeRain();
        rainRaf = requestAnimationFrame(drawRain);
    }

    if (RAIN_MODE === 'always') {
        mountRain({ intensity: RAIN_DEFAULT_INTENSITY });
    } else if (RAIN_MODE === 'auto') {
        bus.on('wallpaper:effects', (effects) => {
            if (effects && effects.rain) mountRain(effects.rain);
            else unmountRain();
        });
    }
`;
    }
};
