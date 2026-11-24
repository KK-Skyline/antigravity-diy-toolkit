'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
    getStyles(ctx) {
        const acrylicCssPath = path.join(ctx.rootDir, 'theme-acrylic.css');
        const css = fs.existsSync(acrylicCssPath) ? fs.readFileSync(acrylicCssPath, 'utf8') : '';
        return {
            id: 'antigravity-acrylic-theme',
            layerOrder: 20,
            css
        };
    },

    getPreloadRuntime() {
        return `
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
    function tuneAccent(c) {
        const hsl = rgb2hsl(c[0], c[1], c[2]);
        return hsl2rgb(hsl[0], Math.min(0.85, Math.max(0.5, hsl[1])), 0.66);
    }
    function mergeBins(a, b) {
        return a.map((x, i) => ({ w: x.w + b[i].w, r: x.r + b[i].r, g: x.g + b[i].g, b: x.b + b[i].b }));
    }
    function accentFromBins(bins) {
        const top = bins.filter(b => b.w > 0).sort((a, b) => b.w - a.w)[0];
        if (!top) return null;
        return tuneAccent([Math.round(top.r / top.w), Math.round(top.g / top.w), Math.round(top.b / top.w)]);
    }
    function parseHexAccent(hex) {
        if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) {
            return tuneAccent([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
        }
        return null;
    }
    function setAccent(c) {
        const root = document.documentElement;
        if (!root || !c) return;
        root.style.setProperty('--ag-accent', c.join(' '));
        root.style.setProperty('--ag-tint-h', String(Math.round(rgb2hsl(c[0], c[1], c[2])[0])));
        root.style.setProperty('--ag-accent-ink', luminance(c) > 0.35 ? '6 14 16' : '255 255 255');
    }

    let adaptBase = null, lumEma = null, accentBins = null, accentSamples = 0;
    function setAdaptive(lum) {
        const root = document.documentElement;
        if (!root || typeof lum !== 'number') return;
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

    bus.on('wallpaper:frame', (frame) => {
        if (!frame) return;
        if (frame.reset) {
            accentBins = null; accentSamples = 0; lumEma = null;
        }
        const manual = parseHexAccent(frame.manualAccent);
        if (manual) setAccent(manual);
        if (typeof frame.lum === 'number') setAdaptive(frame.lum);
        if (frame.bins && !manual) {
            if (frame.isVideoSample) {
                if (accentSamples < 6) {
                    accentBins = accentBins ? mergeBins(accentBins, frame.bins) : frame.bins;
                    accentSamples++;
                    const c = accentFromBins(accentBins);
                    if (c) setAccent(c);
                }
            } else {
                const c = accentFromBins(frame.bins);
                if (c) setAccent(c);
            }
        }
    });

    try {
        const electron = require('electron');
        const ipc = electron && electron.ipcRenderer;
        if (ipc && process.platform === 'win32' && !ipc.__agTitleBarPatched) {
            ipc.__agTitleBarPatched = true;
            const TITLE_BAR_OVERLAY = { color: '#00000000', symbolColor: '#dde7e9' };
            const origInvoke = ipc.invoke.bind(ipc);
            ipc.invoke = (channel, ...args) => channel === 'window:set-title-bar-overlay'
                ? origInvoke(channel, TITLE_BAR_OVERLAY)
                : origInvoke(channel, ...args);
            origInvoke('window:set-title-bar-overlay', TITLE_BAR_OVERLAY).catch(() => {});
        }
    } catch (e) {}
`;
    }
};
