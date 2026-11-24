'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
    patchMain(ctx) {
        if (!ctx.isV2 || !ctx.distDir) return;

        // 1. debugConsole.js (2.34+)
        const debugConsolePath = path.join(ctx.distDir, 'debugConsole.js');
        if (fs.existsSync(debugConsolePath)) {
            const dcContent = fs.readFileSync(debugConsolePath, 'utf8');
            const patchedDc = dcContent.replace(
                /function isDebugConsoleEnabled\(\)\s*\{\s*return\s+!electron_1\.app\.isPackaged;\s*\}/,
                'function isDebugConsoleEnabled() {\n    return true;\n}'
            );
            if (patchedDc !== dcContent) {
                fs.writeFileSync(debugConsolePath, patchedDc, 'utf8');
                console.log('[修改] 已通过 debugConsole.js 开启开发者工具权限。');
            }
        }

        // 2. utils.js (legacy fallback)
        const utilsPath = path.join(ctx.distDir, 'utils.js');
        if (fs.existsSync(utilsPath)) {
            const utilsContent = fs.readFileSync(utilsPath, 'utf8');
            const patchedUtils = utilsContent.replace('devTools: !electron_1.app.isPackaged', 'devTools: true');
            if (patchedUtils !== utilsContent) {
                fs.writeFileSync(utilsPath, patchedUtils, 'utf8');
            }
        }

        // 3. keybindings.js (F12 / Ctrl+Shift+I, BaseWindow + WebContentsView compatible)
        const kbPath = path.join(ctx.distDir, 'keybindings.js');
        if (fs.existsSync(kbPath)) {
            let kbContent = fs.readFileSync(kbPath, 'utf8');
            if (!kbContent.includes('toggleDevTools')) {
                const kbTarget = "if (isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'n') {";
                const kbReplacement = `if ((isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
                const targetContents = (typeof utils_1.getHubWebContents === 'function' ? (0, utils_1.getHubWebContents)(win) : null) ?? win.webContents;
                targetContents?.toggleDevTools();
                event.preventDefault();
            }
            if (isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'n') {`;
                kbContent = kbContent.replace(kbTarget, kbReplacement);
                fs.writeFileSync(kbPath, kbContent, 'utf8');
            }
        }
    }
};
