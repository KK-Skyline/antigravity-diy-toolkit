'use strict';

const fs = require('node:fs');
const path = require('node:path');
const registerWallpaperHub = require('./main');
const mountLauncher = require('./renderer');

function labels(ctx) {
    const locale = ctx.allConfigs?.['i18n-zh']?.locale;
    if (locale === 'zh-TW') return { menu: '桌布選擇庫...', open: '開啟桌布選擇庫', failure: '無法開啟桌布選擇庫。' };
    if (locale === 'zh-CN') return { menu: '壁纸选择库...', open: '打开壁纸选择库', failure: '无法打开壁纸选择库。' };
    return { menu: 'Wallpaper Hub...', open: 'Open Wallpaper Hub', failure: 'Could not open Wallpaper Hub.' };
}

function addMenuItem(menu, MenuItem, label) {
    const file = menu.items.find(item => {
        const name = (item.label || '').replace(/\(&[a-z]\)|&/gi, '').trim();
        return item.role === 'filemenu' || /^(File|文件|檔案)$/i.test(name);
    }) || menu.items[0];
    if (!file?.submenu || file.submenu.items.some(item => item.id === 'ag-open-wallpaper-hub')) return;
    file.submenu.append(new MenuItem({ type: 'separator' }));
    file.submenu.append(new MenuItem({
        id: 'ag-open-wallpaper-hub', label, accelerator: 'CmdOrCtrl+Alt+W',
        click: () => require('./agWallpaperHubLauncher').openWallpaperHub()
    }));
}

function patchMenu(ctx) {
    const menuPath = path.join(ctx.distDir, 'menu.js');
    const showMenu = ctx.pluginConfig.showMenuItem && !ctx.cliFlags?.NO_I18N;
    if (!fs.existsSync(menuPath)) {
        if (showMenu) console.warn('[Wallpaper Hub] Missing dist/menu.js');
        return;
    }
    const original = fs.readFileSync(menuPath, 'utf8');
    let menu = original.replace(/\/\* --- AG WALLPAPER HUB MENU START --- \*\/[\s\S]*?\/\* --- AG WALLPAPER HUB MENU END --- \*\/\r?\n/g, '');
    if (showMenu) {
        const anchor = 'electron_1.Menu.setApplicationMenu(menu);';
        if (menu.includes(anchor)) {
            const block = '/* --- AG WALLPAPER HUB MENU START --- */\n(' + addMenuItem.toString() +
                ')(menu, electron_1.MenuItem, ' + JSON.stringify(labels(ctx).menu) + ');\n/* --- AG WALLPAPER HUB MENU END --- */\n';
            menu = menu.replace(anchor, () => block + anchor);
        } else {
            console.warn('[Wallpaper Hub] Missing application menu anchor in dist/menu.js');
        }
    }
    if (menu !== original) fs.writeFileSync(menuPath, menu, 'utf8');
}

module.exports = {
    patchMain(ctx) {
        if (!ctx.isV2) return;
        const mainPath = path.join(ctx.distDir, 'main.js');
        const original = fs.readFileSync(mainPath, 'utf8');
        const config = { hubDir: ctx.rootDir, nodeExec: process.execPath, openMode: ctx.pluginConfig.openMode };
        const moduleCode = "'use strict';\nmodule.exports = (" + registerWallpaperHub.toString() + ')(' + JSON.stringify(config) + ');\n';
        fs.writeFileSync(path.join(ctx.distDir, 'agWallpaperHubLauncher.js'), moduleCode, 'utf8');
        const load = "require('./agWallpaperHubLauncher')";
        if (!original.includes(load)) {
            fs.writeFileSync(mainPath, original + '\n/* --- AG WALLPAPER HUB MAIN --- */\ntry { ' + load +
                "; } catch (error) { console.error('[Wallpaper Hub] Launcher registration failed', error); }\n", 'utf8');
        }
        patchMenu(ctx);
    },

    getStyles(ctx) {
        if (!ctx.isV2 || !ctx.pluginConfig.showTopLeftButton) return null;
        return {
            id: 'antigravity-hub-launcher-style', layerOrder: 28,
            css: fs.readFileSync(path.join(__dirname, 'launcher.css'), 'utf8')
        };
    },

    getPreloadRuntime(ctx) {
        if (!ctx.isV2 || !ctx.pluginConfig.showTopLeftButton) return '';
        const showShortcut = ctx.pluginConfig.showMenuItem && !ctx.cliFlags?.NO_I18N;
        return '(' + mountLauncher.toString() + ')(' + JSON.stringify(labels(ctx)) + ', ' + showShortcut + ');';
    }
};
