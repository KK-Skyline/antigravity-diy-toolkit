'use strict';

const SIGNATURE_START = "/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */";
const SIGNATURE_END = "/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */";

function buildContextBase({ rootDir, tempDir, distDir, isV2, cliFlags, allConfigs, shared, hostHelpers }) {
    return {
        rootDir,
        tempDir: tempDir || '',
        distDir: distDir || '',
        isV2: Boolean(isV2),
        cliFlags: cliFlags || {},
        pluginConfig: {},
        allConfigs: allConfigs || {},
        shared: shared || {},
        hostHelpers: hostHelpers || {}
    };
}

function runPrepare(activePlugins, baseCtx) {
    for (const plugin of activePlugins) {
        if (typeof plugin.module.prepare === 'function') {
            const ctx = { ...baseCtx, pluginConfig: plugin.config };
            plugin.module.prepare(ctx);
        }
    }
}

function runPatchMain(activePlugins, baseCtx) {
    if (!baseCtx.isV2) return;
    for (const plugin of activePlugins) {
        if (typeof plugin.module.patchMain === 'function') {
            const ctx = { ...baseCtx, pluginConfig: plugin.config };
            plugin.module.patchMain(ctx);
        }
    }
}

function collectStyles(activePlugins, baseCtx) {
    const styles = [];
    for (const plugin of activePlugins) {
        if (typeof plugin.module.getStyles === 'function') {
            const ctx = { ...baseCtx, pluginConfig: plugin.config };
            const res = plugin.module.getStyles(ctx);
            if (res && typeof res.css === 'string' && res.css.length > 0 && typeof res.id === 'string') {
                styles.push({
                    id: res.id,
                    layerOrder: typeof res.layerOrder === 'number' ? res.layerOrder : plugin.manifest.layerOrder,
                    css: res.css
                });
            }
        }
    }
    styles.sort((a, b) => a.layerOrder - b.layerOrder);
    return styles;
}

function collectRuntimes(activePlugins, baseCtx) {
    const runtimes = [];
    for (const plugin of activePlugins) {
        if (typeof plugin.module.getPreloadRuntime === 'function') {
            const ctx = { ...baseCtx, pluginConfig: plugin.config };
            const code = plugin.module.getPreloadRuntime(ctx);
            if (typeof code === 'string' && code.trim().length > 0) {
                runtimes.push({ id: plugin.manifest.id, code });
            }
        }
    }
    return runtimes;
}

function buildPreloadPayload(activePlugins, baseCtx, extraLegacyInnerJs = '') {
    const styles = collectStyles(activePlugins, baseCtx);
    const runtimes = collectRuntimes(activePlugins, baseCtx);

    const styleBlocks = styles.map(s => {
        const idJson = JSON.stringify(s.id);
        const cssJson = JSON.stringify(s.css);
        return `
    (function() {
        const injectStyle = () => {
            if (document.getElementById(${idJson})) return;
            const style = document.createElement('style');
            style.id = ${idJson};
            style.textContent = ${cssJson};
            const head = document.head || document.documentElement;
            if (head) head.appendChild(style);
        };
        injectStyle();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectStyle);
        }
        window.addEventListener('load', injectStyle);
    })();`;
    }).join('\n');

    const runtimeBlocks = runtimes.map(r => {
        const idStr = JSON.stringify(r.id);
        return `
    try {
        (function(bus) {
${r.code}
        })(__agBus);
    } catch (e) {
        console.error('[AG-Plugin:' + ${idStr} + ']', e);
    }`;
    }).join('\n');

    return `${SIGNATURE_START}
(() => {
    const __agBus = (() => {
        const listeners = Object.create(null);
        const state = Object.create(null);
        return {
            on(evt, fn, opts) {
                (listeners[evt] = listeners[evt] || []).push(fn);
                if ((!opts || opts.replay !== false) && Object.prototype.hasOwnProperty.call(state, evt)) {
                    try { fn(state[evt]); } catch (e) {}
                }
            },
            emit(evt, data) {
                state[evt] = data;
                for (const fn of (listeners[evt] || [])) {
                    try { fn(data); } catch (e) {}
                }
            },
            getState(evt) { return state[evt]; }
        };
    })();
${styleBlocks}
${runtimeBlocks}
${extraLegacyInnerJs ? `\n${extraLegacyInnerJs}` : ''}
})();
${SIGNATURE_END}`;
}

module.exports = {
    SIGNATURE_START,
    SIGNATURE_END,
    buildContextBase,
    runPrepare,
    runPatchMain,
    collectStyles,
    collectRuntimes,
    buildPreloadPayload
};
