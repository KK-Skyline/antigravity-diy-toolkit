'use strict';

const fs = require('node:fs');
const path = require('node:path');
const registerWallpaperHub = require('./main');
const mountLauncher = require('./renderer');

function labels(ctx) {
    const locale = ctx.allConfigs?.['i18n-zh']?.locale;
    if (locale === 'zh-TW') {
        return {
            title: 'Antigravity 桌布選擇庫',
            menu: '桌布選擇庫...',
            open: '開啟桌布選擇庫',
            failure: '無法開啟桌布選擇庫。',
            messages: {
                hubScriptMissing: '未找到桌布選擇庫腳本，請重新執行安裝程式。',
                hubReadFailed: '無法讀取桌布選擇庫檔案，請檢查工具包的存取權限。',
                hubStartTimeout: '桌布選擇庫啟動逾時，請檢查連接埠 3210 後重試。',
                hubStartFailed: '無法啟動桌布選擇庫，請檢查 Node.js 與工具包後重試。',
                hubPortInUse: '連接埠 3210 的服務未能確認為本工具的桌布選擇庫。',
                hubOpenFailed: '無法開啟桌布選擇庫，請重試。'
            }
        };
    }
    if (locale === 'zh-CN') {
        return {
            title: 'Antigravity 壁纸选择库',
            menu: '壁纸选择库...',
            open: '打开壁纸选择库',
            failure: '无法打开壁纸选择库。',
            messages: {
                hubScriptMissing: '未找到壁纸选择库脚本，请重新运行安装器。',
                hubReadFailed: '无法读取壁纸选择库文件，请检查工具包的访问权限。',
                hubStartTimeout: '壁纸选择库启动超时，请检查端口 3210 后重试。',
                hubStartFailed: '无法启动壁纸选择库，请检查 Node.js 和工具包后重试。',
                hubPortInUse: '端口 3210 的服务未能确认为本工具的壁纸选择库。',
                hubOpenFailed: '无法打开壁纸选择库，请重试。'
            }
        };
    }
    return {
        title: 'Antigravity Wallpaper Hub',
        menu: 'Wallpaper Hub...',
        open: 'Open Wallpaper Hub',
        failure: 'Could not open Wallpaper Hub.'
    };
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
        click: () => {
            try {
                return require('./agWallpaperHubLauncher').openWallpaperHub();
            } catch (error) {
                console.error('[Wallpaper Hub] Failed to open:', error);
            }
        }
    }));
}

function patchMenu(ctx) {
    const menuPath = path.join(ctx.distDir, 'menu.js');
    const showMenu = Boolean(ctx.pluginConfig.showMenuItem);
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
        const loc = labels(ctx);
        const config = {
            hubDir: ctx.rootDir,
            nodeExec: process.execPath,
            openMode: ctx.pluginConfig.openMode,
            title: loc.title,
            ...(loc.messages ? { messages: loc.messages } : {})
        };
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
        const showShortcut = Boolean(ctx.pluginConfig.showMenuItem);
        const loc = labels(ctx);
        return '(' + mountLauncher.toString() + ')(' + JSON.stringify({ open: loc.open, failure: loc.failure }) + ', ' + showShortcut + ');';
    }
};
