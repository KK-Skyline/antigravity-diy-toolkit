import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'localization_engine.js');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ag234-ci-'));
const srcDir = path.join(tmpBase, 'src');
const appDir = path.join(tmpBase, 'app');
const resDir = path.join(appDir, 'resources');
const storeDir = path.join(tmpBase, 'baseline-store');

function createSynthetic234Asar(targetAsar) {
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'package.json'), JSON.stringify({ name: 'antigravity', version: '2.34.0' }));
    fs.writeFileSync(path.join(srcDir, 'dist', 'preload.js'), [
        '"use strict";',
        'const electron_1 = require("electron");',
        'exports.WCV_THREE_LAYER_STACK_ARG = "--agy-wcv-three-layer-stack=1";',
        'function installHubSurfaceThemeAutoSync() {}',
        'installHubSurfaceThemeAutoSync();',
    ].join('\n'));
    fs.writeFileSync(path.join(srcDir, 'dist', 'main.js'), [
        '"use strict";',
        'const electron_1 = require("electron");',
        'console.log("synthetic 2.34.0 main");',
    ].join('\n'));
    fs.writeFileSync(path.join(srcDir, 'dist', 'debugConsole.js'), [
        '"use strict";',
        'const electron_1 = require("electron");',
        'function isDebugConsoleEnabled() {',
        '    return !electron_1.app.isPackaged;',
        '}',
        'exports.isDebugConsoleEnabled = isDebugConsoleEnabled;',
    ].join('\n'));
    fs.writeFileSync(path.join(srcDir, 'dist', 'utils.js'), [
        '"use strict";',
        'const debugConsole_1 = require("./debugConsole");',
        'exports.getHubWebContents = (win) => win?.hubContents;',
        'exports.webPrefs = { devTools: (0, debugConsole_1.isDebugConsoleEnabled)() };',
    ].join('\n'));
    fs.writeFileSync(path.join(srcDir, 'dist', 'keybindings.js'), [
        '"use strict";',
        'const utils_1 = require("./utils");',
        'function registerKeybindings(win, actions) {',
        '    const hubContents = (0, utils_1.getHubWebContents)(win) ?? win.webContents;',
        '    const handleBeforeInput = (event, input) => {',
        '        const isCmdOrCtrl = input.control;',
        '        if (input.type === "keyDown") {',
        "            if (isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'n') {",
        '                actions.createNewWindow();',
        '                event.preventDefault();',
        '            }',
        '        }',
        '    };',
        '    hubContents?.on("before-input-event", handleBeforeInput);',
        '}',
        'exports.registerKeybindings = registerKeybindings;',
    ].join('\n'));
    fs.writeFileSync(path.join(srcDir, 'dist', 'menu.js'), [
        '"use strict";',
        'const electron_1 = require("electron");',
        'function buildMenu(menu) {',
        '    electron_1.Menu.setApplicationMenu(menu);',
        '}',
        'async function wslConnectMenuTemplate() {',
        '    const submenu = [];',
        "    return { label: 'Connect to WSL', submenu };",
        '}',
        'function wslReopenLocallyTemplate() {',
        "    return { label: 'Reopen Locally', click: () => relaunchWithWslDistro('') };",
        '}',
        'function addItemToSubmenu(appMenu, submenuLabel, position, item) {',
        '    const submenuItem = appMenu.items.find((item) => item.label === submenuLabel);',
        '    if (!submenuItem?.submenu) return;',
        '    submenuItem.submenu.insert(position, item);',
        '}',
        'exports.buildMenu = buildMenu;',
        'exports.wslConnectMenuTemplate = wslConnectMenuTemplate;',
        'exports.wslReopenLocallyTemplate = wslReopenLocallyTemplate;',
        'exports.addItemToSubmenu = addItemToSubmenu;',
    ].join('\n'));
    fs.writeFileSync(path.join(srcDir, 'dist', 'tray.js'), [
        '"use strict";',
        'const electron_1 = require("electron");',
        'let tray = null;',
        'let contextMenu = null;',
        'function createTray(actions, onClick) {',
        '    contextMenu = electron_1.Menu.buildFromTemplate(actions);',
        '    tray.setContextMenu(contextMenu);',
        '    if (onClick) tray.on("click", onClick);',
        '}',
        'function insertTrayMenuItem(position, options) {',
        '    if (!tray || !contextMenu) return;',
        '    contextMenu.insert(position, new electron_1.MenuItem(options));',
        '    tray.setContextMenu(contextMenu);',
        '}',
        'function updateTrayAgentCount(count) {',
        '    const countItem = contextMenu?.items?.find((item) => item.id === "running-agents");',
        '    if (countItem) {',
        "        countItem.label = (count > 0 ? count + ' agent' + (count === 1 ? '' : 's') : 'No agents') + ' running';",
        '    }',
        '}',
        'exports.createTray = createTray;',
        'exports.insertTrayMenuItem = insertTrayMenuItem;',
        'exports.updateTrayAgentCount = updateTrayAgentCount;',
    ].join('\n'));
    fs.writeFileSync(path.join(srcDir, 'dist', 'loadingOverlay.js'), [
        '"use strict";',
        'function getLoadingHtml() { return "<html><body><svg class=\\"logo\\"></svg></body></html>"; }',
        'exports.getLoadingHtml = getLoadingHtml;',
    ].join('\n'));
    fs.writeFileSync(path.join(srcDir, 'dist', 'updater.js'), [
        '"use strict";',
        'const opts = {',
        "                title: 'Check for Updates',",
        "                message: 'No updates available',",
        "                buttons: ['OK'],",
        '};',
        'exports.opts = opts;',
    ].join('\n'));
    return asar.createPackage(srcDir, targetAsar);
}

function checkSyntax(file) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

function runEngine(args) {
    const res = spawnSync(process.execPath, [ENGINE, '--install-dir', appDir, ...args], {
        cwd: ROOT,
        env: { ...process.env, AG_BASELINE_STORE: storeDir },
        encoding: 'utf8',
    });
    if (res.status !== 0) {
        throw new Error(`Engine failed (${res.status}) for [${args.join(' ')}]:\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`);
    }
    return res.stdout;
}

try {
    // 1. Static syntax checks for all core JS/MJS scripts
    for (const rel of [
        'localization_engine.js',
        'asar_transaction.mjs',
        'wallpaper_engine_reader.js',
        'wallpaper_hub_server.js',
        'hub.js',
        'tools/agcdp.js',
        'tools/check-wallpaper.js',
        'tools/compare_dicts.js',
    ]) {
        checkSyntax(path.join(ROOT, rel));
    }

    // 2. Verify theme-acrylic.css contains required 2.34.0 Shell/Sheet & Browser-Hole rules
    const acrylicCss = fs.readFileSync(path.join(ROOT, 'theme-acrylic.css'), 'utf8');
    for (const token of [
        'body[data-agy-theme]',
        '--shell: transparent !important',
        '--shell-canvas: transparent !important',
        '.agy-inset-shell',
        '.surface-composer-card',
        'body[data-has-browser-hole="true"]',
        'sidebar-navigation-items',
        '.agy-sidebar-row',
        '.agy-dialog',
    ]) {
        assert.ok(acrylicCss.includes(token), `theme-acrylic.css missing 2.34.0 rule/token: ${token}`);
    }

    // 3. Synthetic 2.34.0 ASAR injection, idempotency, zh-TW, and restore tests
    // Note: skip CLI install run only if a real local Antigravity process is running on the same Windows host
    const antigravityRunning = process.platform === 'win32' &&
        spawnSync('tasklist', ['/fi', 'imagename eq Antigravity.exe', '/nh'], { encoding: 'utf8' })
            .stdout?.toLowerCase().includes('antigravity.exe');

    fs.mkdirSync(resDir, { recursive: true });
    fs.mkdirSync(storeDir, { recursive: true });
    const liveAsar = path.join(resDir, 'app.asar');
    await createSynthetic234Asar(liveAsar);
    const originalSha = hash(liveAsar);

    if (antigravityRunning) {
        console.log('SKIP live CLI synthetic 2.34.0 ASAR install: real Antigravity.exe is running locally (CI runs this unconditionally).');
    } else {
        // First install (zh-CN + dark-blue + confirm baseline)
        const out1 = runEngine(['--dark-blue', '--confirm-unverified-baseline']);
        assert.match(out1, /通过 debugConsole\.js 开启开发者工具权限/);
        assert.match(out1, /loadingOverlay\.js 为纯图标加载页/);

        const inspect1 = path.join(tmpBase, 'inspect1');
        asar.uncache(liveAsar);
        asar.extractAll(liveAsar, inspect1);
        for (const rel of ['dist/preload.js', 'dist/main.js', 'dist/debugConsole.js', 'dist/utils.js', 'dist/keybindings.js', 'dist/menu.js', 'dist/tray.js', 'dist/loadingOverlay.js', 'dist/updater.js']) {
            checkSyntax(path.join(inspect1, rel));
        }

        const preload1 = fs.readFileSync(path.join(inspect1, 'dist/preload.js'), 'utf8');
        assert.ok(preload1.includes('ANTIGRAVITY CHINESE LOCALIZATION START'));
        assert.ok(preload1.includes('--shell-canvas: #090d13 !important'));
        assert.ok(preload1.includes('[data-browser-hole], webview'));
        assert.ok(!preload1.includes('[data-testid="builtin-browser-pane"]'), 'builtin-browser-pane must not be isolated');
        assert.ok(preload1.includes('Automations'));
        assert.ok(preload1.includes("valNorm.endsWith('...')"), 'prefix fallback must require ellipsis truncation');

        const dc1 = fs.readFileSync(path.join(inspect1, 'dist/debugConsole.js'), 'utf8');
        assert.match(dc1, /function isDebugConsoleEnabled\(\)\s*\{\s*return true;\s*\}/);

        const kb1 = fs.readFileSync(path.join(inspect1, 'dist/keybindings.js'), 'utf8');
        assert.ok(kb1.includes('getHubWebContents') && kb1.includes('toggleDevTools'));
        assert.ok(!kb1.includes('win.webContents.toggleDevTools()'));

        const menu1 = fs.readFileSync(path.join(inspect1, 'dist/menu.js'), 'utf8');
        assert.ok(menu1.includes('translateMenu') && menu1.includes('连接到 WSL') && menu1.includes('submenuAliases'));

        const tray1 = fs.readFileSync(path.join(inspect1, 'dist/tray.js'), 'utf8');
        assert.ok(tray1.includes('TRAY TRANSLATION START'));
        assert.ok(tray1.includes('TRAY INSERT TRANSLATION START'));
        assert.ok(tray1.includes('TRAY DOUBLE CLICK START'));
        assert.ok(tray1.includes('getLocalHubWindows') && tray1.includes('BaseWindow'));
        assert.ok(tray1.includes('个智能体运行中'));

        const updater1 = fs.readFileSync(path.join(inspect1, 'dist/updater.js'), 'utf8');
        assert.ok(updater1.includes('检查更新') && updater1.includes('暂无可用更新'));

        // Second install (idempotency + zh-TW mode)
        runEngine(['--tw']);
        const inspect2 = path.join(tmpBase, 'inspect2');
        asar.uncache(liveAsar);
        asar.extractAll(liveAsar, inspect2);
        for (const rel of ['dist/preload.js', 'dist/menu.js', 'dist/tray.js', 'dist/debugConsole.js', 'dist/keybindings.js', 'dist/updater.js']) {
            checkSyntax(path.join(inspect2, rel));
        }
        const tray2 = fs.readFileSync(path.join(inspect2, 'dist/tray.js'), 'utf8');
        assert.equal((tray2.match(/TRAY TRANSLATION START/g) || []).length, 1, 'tray translation block duplicated');
        assert.ok(tray2.includes('連線到 WSL'));
        assert.ok(tray2.includes('個代理執行中'));
        const menu2 = fs.readFileSync(path.join(inspect2, 'dist/menu.js'), 'utf8');
        assert.ok(menu2.includes('連線到 WSL'));

        // Direct CN -> TW re-patch idempotency on an already-CN-patched menu.js & tray.js
        const cnRepatchSrc = path.join(tmpBase, 'cn-repatch-src');
        fs.cpSync(inspect1, cnRepatchSrc, { recursive: true });
        // Keep preload.js clean so asar_transaction accepts the archive as a baseline while menu.js & tray.js remain CN-patched
        fs.copyFileSync(path.join(srcDir, 'dist', 'preload.js'), path.join(cnRepatchSrc, 'dist', 'preload.js'));
        const cnRepatchDir = path.join(tmpBase, 'cn-repatch');
        const cnRepatchRes = path.join(cnRepatchDir, 'resources');
        const cnRepatchStore = path.join(tmpBase, 'cn-repatch-store');
        fs.mkdirSync(cnRepatchRes, { recursive: true });
        fs.mkdirSync(cnRepatchStore, { recursive: true });
        const cnRepatchAsar = path.join(cnRepatchRes, 'app.asar');
        await asar.createPackage(cnRepatchSrc, cnRepatchAsar);
        const repatchOut = spawnSync(process.execPath, [ENGINE, '--install-dir', cnRepatchDir, '--tw', '--confirm-unverified-baseline'], {
            cwd: ROOT,
            env: { ...process.env, AG_BASELINE_STORE: cnRepatchStore },
            encoding: 'utf8',
        });
        assert.equal(repatchOut.status, 0, repatchOut.stderr);
        const inspect3 = path.join(tmpBase, 'inspect3');
        asar.uncache(cnRepatchAsar);
        asar.extractAll(cnRepatchAsar, inspect3);
        const menu3 = fs.readFileSync(path.join(inspect3, 'dist/menu.js'), 'utf8');
        const tray3 = fs.readFileSync(path.join(inspect3, 'dist/tray.js'), 'utf8');
        checkSyntax(path.join(inspect3, 'dist/menu.js'));
        checkSyntax(path.join(inspect3, 'dist/tray.js'));
        assert.ok(menu3.includes('連線到 WSL') && !menu3.includes("'连接到 WSL'"), 'menu.js CN->TW re-patch failed');
        assert.ok(tray3.includes('個代理執行中') && !tray3.includes('个智能体运行中'), 'tray.js CN->TW re-patch failed');
        assert.equal((tray3.match(/TRAY TRANSLATION START/g) || []).length, 1, 'tray.js re-patch duplicated marker');

        // Restore must match original SHA-256 bit-for-bit
        runEngine(['--huifu']);
        assert.equal(hash(liveAsar), originalSha, 'Restored ASAR SHA-256 mismatch');
        console.log('adapt 2.34.0 synthetic ASAR install + zh-TW + CN->TW re-patch + restore: PASS');
    }

    console.log('adapt 2.34.0 regression: PASS');
} finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
}
