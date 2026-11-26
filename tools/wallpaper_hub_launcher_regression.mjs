import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as asar from '@electron/asar';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(import.meta.dirname, '..');
const pluginLoader = require('../core/plugin_loader');
const injector = require('../core/injector');
const launcher = 'wallpaper-hub-launcher';
const moduleName = 'agWallpaperHubLauncher.js';
const channel = 'antigravity:open-wallpaper-hub';
const hubUrl = 'http://127.0.0.1:3210';
const menuSource = 'const electron_1 = require("electron");\n' +
    'module.exports = function(menu) {\n    electron_1.Menu.setApplicationMenu(menu);\n};\n';
const styleId = 'antigravity-hub-launcher-style';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-hub-launcher-'));
const distDir = path.join(tmp, 'dist');

function syntaxCheck(file) {
    execFileSync(process.execPath, ['--check', file]);
}

function setup(dist, enable, settings = {}, cliFlags = {}, isV2 = true) {
    const manifests = pluginLoader.discoverPlugins(rootDir);
    const resolved = pluginLoader.resolvePlugins(rootDir, {
        enable, settings, disable: manifests.map(m => m.id).filter(id => !enable.includes(id))
    });
    const ctx = injector.buildContextBase({
        rootDir, distDir: dist, isV2, allConfigs: resolved.allConfigs, cliFlags,
        shared: { bakedWallpaper: { type: 'image', dataUrl: 'data:image/png;base64,AAAA', config: {} } }
    });
    return { active: resolved.active, ctx };
}

function testInjection() {
    const manifests = pluginLoader.discoverPlugins(rootDir);
    assert.equal(manifests.length, 7);
    const manifest = manifests.find(item => item.id === launcher);
    assert.equal(manifest.layerOrder, 28);
    assert.equal(manifest.defaultEnabled, false);
    assert.equal(manifest.settingsSchema.port, undefined);
    assert.throws(() => pluginLoader.validatePluginConfig(manifest, { openMode: 'invalid' }), /must be one of/);

    for (const [locale, fileLabel, label] of [
        [null, '&File', 'Wallpaper Hub...'],
        ['zh-CN', '文件(&F)', '壁纸选择库...'],
        ['zh-TW', '檔案(&F)', '桌布選擇庫...']
    ]) {
        const { active, ctx } = setup(distDir, [launcher, ...(locale ? ['i18n-zh'] : [])],
            { 'i18n-zh': { locale } });
        const mainPath = path.join(distDir, 'main.js');
        const menuPath = path.join(distDir, 'menu.js');
        fs.writeFileSync(mainPath, '"use strict";\n');
        fs.writeFileSync(menuPath, menuSource);
        for (let i = 0; i < 2; i++) injector.runPatchMain(active, ctx);
        const main = fs.readFileSync(mainPath, 'utf8');
        const menu = fs.readFileSync(menuPath, 'utf8');
        assert.equal(main.split("require('./agWallpaperHubLauncher')").length, 2);
        assert.equal(menu.split('AG WALLPAPER HUB MENU START').length, 2);
        assert.equal(menu.includes('translateMenu(menu.items)'), Boolean(locale));
        for (const file of [mainPath, menuPath, path.join(distDir, moduleName)]) syntaxCheck(file);

        let calls = 0;
        let shouldThrow = false;
        let installed;
        const loggedErrors = [];
        const sandbox = {
            module: {},
            console: { error: (...args) => loggedErrors.push(args.join(' ')) },
            require(id) {
                if (id === 'electron') return {
                    Menu: { setApplicationMenu: menu => { installed = menu; } },
                    MenuItem: class { constructor(options) { Object.assign(this, options); } }
                };
                assert.equal(id, './agWallpaperHubLauncher');
                return {
                    openWallpaperHub: () => {
                        if (shouldThrow) throw new Error('simulated click failure');
                        return ++calls;
                    }
                };
            }
        };
        vm.runInNewContext(menu, sandbox);
        const unrelated = { label: 'View', submenu: { items: [] } };
        const submenu = { items: [], append(item) { this.items.push(item); } };
        const applicationMenu = { items: [unrelated, { label: fileLabel, submenu }] };
        sandbox.module.exports(applicationMenu);
        sandbox.module.exports(applicationMenu);
        assert.equal(installed, applicationMenu);
        assert.equal(unrelated.submenu.items.length, 0);
        assert.equal(submenu.items.length, 2);
        const [separator, entry] = submenu.items;
        assert.equal(separator.type, 'separator');
        assert.equal(entry.id, 'ag-open-wallpaper-hub');
        assert.equal(entry.label, label);
        assert.equal(entry.accelerator, 'CmdOrCtrl+Alt+W');
        assert.equal(entry.click(), 1);
        shouldThrow = true;
        assert.doesNotThrow(() => entry.click());
        assert.ok(loggedErrors.some(msg => msg.includes('Failed to open')));
    }

    const { active, ctx } = setup(distDir, ['theme-obsidian-blue', 'wallpaper-engine', 'theme-acrylic', launcher]);
    const styles = injector.collectStyles(active, ctx);
    assert.deepEqual(styles.map(({ id, layerOrder }) => [id, layerOrder]), [
        ['antigravity-dark-blue-theme', 10], ['antigravity-we-style', 15],
        ['antigravity-acrylic-theme', 20], [styleId, 28]
    ]);
    const payload = injector.buildPreloadPayload(active, ctx);
    for (const token of ['-webkit-app-region: no-drag', 'translate', 'notranslate', channel, 'DOMContentLoaded']) {
        assert.ok(payload.includes(token), token);
    }
    const preload = path.join(distDir, 'preload.js');
    fs.writeFileSync(preload, payload);
    syntaxCheck(preload);

    for (const options of [
        { settings: { showMenuItem: false }, button: true, menu: false },
        { settings: { showTopLeftButton: false }, button: false, menu: true },
        { flags: { NO_I18N: true }, button: true, menu: true }
    ]) {
        const { active, ctx } = setup(distDir, [launcher], { [launcher]: options.settings }, options.flags);
        const menuPath = path.join(distDir, 'menu.js');
        fs.writeFileSync(menuPath, Buffer.from(menuSource.replaceAll('\n', '\r\n')));
        const original = fs.readFileSync(menuPath);
        injector.runPatchMain(active, ctx);
        const menu = fs.readFileSync(menuPath);
        if (options.menu) assert.match(menu.toString(), /AG WALLPAPER HUB MENU START/);
        else assert.deepEqual(menu, original);
        const payload = injector.buildPreloadPayload(active, ctx);
        assert.equal(payload.includes(styleId), options.button);
        assert.equal(payload.includes(channel), options.button);
    }

    const rendererSrc = fs.readFileSync(path.join(rootDir, 'plugins', launcher, 'renderer.js'), 'utf8');
    assert.doesNotMatch(rendererSrc, /subtree:\s*true/);
    assert.match(rendererSrc, /catch\s*\(\s*error\s*\)\s*\{[\s\S]*?console\.error\(/);

    for (const file of ['index.js', 'main.js', 'renderer.js', 'start-hub.js']) {
        const src = fs.readFileSync(path.join(rootDir, 'plugins', launcher, file), 'utf8');
        assert.doesNotMatch(src, /(?:[A-Z]:\\|\/Users\/|\/home\/|shell:\s*true)/i);
    }
}

async function testMainProcess() {
    const hubDir = path.join(tmp, 'hub');
    const validConfig = JSON.stringify({ enabled: true, workshopId: '123', opacity: 0.68, blur: 0 });
    fs.mkdirSync(hubDir);
    fs.writeFileSync(path.join(hubDir, 'hub.js'), 'original hub asset');
    const script = path.join(hubDir, 'wallpaper_hub_server.js');
    const starter = path.join(hubDir, 'plugins', launcher, 'start-hub.js');
    fs.mkdirSync(path.dirname(starter), { recursive: true });
    fs.writeFileSync(starter, '');
    let stalledProbes = 0;
    let state = 'offline';
    const server = http.createServer((req, res) => {
        if (state === 'starting') {
            stalledProbes++;
            req.once('close', () => { state = 'ready'; });
            return;
        }
        if (req.url === '/api/config') {
            res.end(state === 'ready' ? validConfig : '{}');
            return;
        }
        res.end('unrelated');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let handler;
    let spawnCount = 0;
    let spawnError = false;
    let spawnExitCode = 0;
    let spawnStderr = '';
    let spawnStartsHub = true;
    const opened = [];
    const dialogs = [];
    const windows = [];
    const loggedErrors = [];
    class BrowserWindow extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.webContents = new EventEmitter();
            this.webContents.setWindowOpenHandler = fn => { this.openHandler = fn; };
            windows.push(this);
        }
        isDestroyed() { return false; }
        isMinimized() { return true; }
        restore() { this.restored = true; }
        focus() { this.focused = true; }
        async loadURL(url) { this.url = url; }
    }
    const electron = {
        BrowserWindow,
        ipcMain: { handle(name, fn) { assert.equal(name, channel); handler = fn; } },
        shell: { async openExternal(url) { opened.push(url); } },
        dialog: { async showMessageBox(options) { dialogs.push(options); } }
    };
    function register(openMode) {
        const source = fs.readFileSync(path.join(rootDir, 'plugins', launcher, 'main.js'), 'utf8');
        const sandbox = {
            module: {}, process, Buffer, AbortSignal, URL,
            console: { error: (...args) => loggedErrors.push(args.join(' ')), log() {}, warn() {} },
            require(id) {
                if (id === 'electron') return electron;
                if (id === 'node:http') return {
                    get(url, options, callback) {
                        assert.ok(url.startsWith(hubUrl + '/'));
                        if (state !== 'offline') {
                            return http.get(url.replace(hubUrl, 'http://127.0.0.1:' + server.address().port), options, callback);
                        }
                        const request = new EventEmitter();
                        queueMicrotask(() => request.emit('error', Object.assign(new Error('offline'), { code: 'ECONNREFUSED' })));
                        return request;
                    }
                };
                if (id === 'node:child_process') return {
                    spawn(command, [entry], options) {
                        spawnCount++;
                        assert.equal(command, process.execPath);
                        assert.equal(entry, process.platform === 'win32' ? starter : script);
                        assert.equal(options.cwd, hubDir);
                        assert.equal(options.shell, false);
                        assert.equal(options.windowsHide, true);
                        if (process.platform === 'win32') {
                            assert.deepEqual(Array.from(options.stdio), ['ignore', 'ignore', 'pipe']);
                        } else assert.equal(options.stdio, 'ignore');
                        assert.equal(options.detached, process.platform !== 'win32');
                        const child = new EventEmitter();
                        child.stderr = new EventEmitter();
                        child.unref = () => {};
                        queueMicrotask(() => {
                            if (spawnError) child.emit('error', new Error('test spawn failure'));
                            else if (spawnExitCode !== 0 && process.platform === 'win32') {
                                if (spawnStderr) child.stderr.emit('data', Buffer.from(spawnStderr));
                                child.emit('close', spawnExitCode);
                            } else {
                                if (spawnStartsHub) state = 'starting';
                                child.emit(process.platform === 'win32' ? 'close' : 'spawn', 0);
                            }
                        });
                        return child;
                    }
                };
                return require(id);
            }
        };
        vm.runInNewContext(source, sandbox);
        return sandbox.module.exports({ hubDir, nodeExec: process.execPath, openMode });
    }

    try {
        const { openWallpaperHub } = register('browser');
        const senderFrame = {};
        const event = { senderFrame, sender: { mainFrame: senderFrame } };
        assert.equal(handler(event, hubUrl).error, 'invalid_invocation');
        assert.equal(handler({ ...event, senderFrame: {} }).error, 'invalid_invocation');
        const missing = await handler(event);
        assert.equal(missing.error, 'hub_script_missing');
        assert.equal(missing.message, dialogs.at(-1).message);
        fs.writeFileSync(script, '');
        const first = handler(event);
        assert.equal(openWallpaperHub(), first);
        assert.equal((await first).ok, true);
        assert.equal(stalledProbes, 1, 'startup must recover from a probe deadline');
        assert.equal((await handler(event)).ok, true);
        assert.equal(spawnCount, 1);
        assert.deepEqual(opened, [hubUrl, hubUrl]);

        // Initial probe returning pending must retry and recover to ready
        state = 'starting';
        assert.equal((await handler(event)).ok, true);
        assert.equal(stalledProbes, 2, 'initial pending probe must retry and recover');

        // Running Hub opens even if local hub.js differs and wallpaper_hub_server.js is absent
        fs.writeFileSync(path.join(hubDir, 'hub.js'), 'modified local asset');
        fs.rmSync(script, { force: true });
        state = 'ready';
        assert.equal((await handler(event)).ok, true);
        fs.writeFileSync(script, '');

        state = 'foreign';
        assert.equal((await handler(event)).error, 'hub_port_in_use');
        assert.equal(spawnCount, 1);
        state = 'offline';
        spawnError = true;
        assert.equal((await handler(event)).error, 'hub_start_failed');
        spawnError = false;
        if (process.platform === 'win32') {
            spawnExitCode = 42;
            spawnStderr = 'C:\\secret\\path\\leak.js failed';
            assert.equal((await handler(event)).error, 'hub_start_failed');
            assert.ok(loggedErrors.some(line => line.includes('STARTER_EXIT_42')));
            assert.ok(!loggedErrors.some(line => line.includes('C:\\secret\\path')));
            spawnExitCode = 0;
            spawnStderr = '';
        }
        spawnStartsHub = false;
        assert.equal((await handler(event)).error, 'hub_start_timeout');
        assert.deepEqual(opened, [hubUrl, hubUrl, hubUrl, hubUrl]);

        state = 'ready';
        register('window');
        assert.equal((await handler(event)).mode, 'window');
        assert.equal((await handler(event)).url, hubUrl);
        assert.equal(windows.length, 1);
        const [win] = windows;
        assert.equal(win.url, hubUrl);
        assert.equal(win.restored && win.focused, true);
        assert.equal(win.options.webPreferences.sandbox, true);
        assert.equal(win.options.webPreferences.contextIsolation, true);
        assert.equal(win.options.webPreferences.nodeIntegration, false);
        for (const type of ['will-navigate', 'will-redirect']) {
            for (const [url, allowed] of [
                [hubUrl + '/?view=hub', true], ['http://localhost:3210/', true],
                ['http://localhost:3211/', false], ['https://example.invalid/', false]
            ]) {
                let denied = false;
                win.webContents.emit(type, { url, preventDefault() { denied = true; } });
                assert.equal(denied, !allowed);
            }
        }
        for (const allowedUrl of ['http://127.0.0.1:3210/', 'http://localhost:3210/']) {
            const res = win.openHandler({ url: allowedUrl });
            assert.equal(res.action, 'allow');
            assert.equal(res.overrideBrowserWindowOptions.webPreferences.sandbox, true);
            assert.equal(res.overrideBrowserWindowOptions.webPreferences.contextIsolation, true);
            assert.equal(res.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false);
        }
        assert.equal(win.openHandler({ url: 'https://example.invalid/' }).action, 'deny');
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

async function testCli() {
    const toolkit = path.join(tmp, 'toolkit');
    fs.mkdirSync(toolkit);
    for (const rel of ['core', 'plugins', 'dicts', 'dicts_tw', 'theme-acrylic.css', 'localization_engine.js',
        'asar_transaction.mjs', 'plugins.config.example.json']) {
        fs.cpSync(path.join(rootDir, rel), path.join(toolkit, rel), { recursive: true });
    }
    fs.symlinkSync(path.join(rootDir, 'node_modules'),
        path.join(toolkit, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const shim = path.join(tmp, 'host.cjs');
    fs.writeFileSync(shim, [
        'const host = require(' + JSON.stringify(path.join(toolkit, 'core', 'host_env.js')) + ');',
        'host.checkIfAppIsRunning = () => false;',
        'host.closeAntigravityProcesses = () => { throw new Error("Unexpected process close"); };',
        'host.cleanElectronCache = () => {};',
        'host.resignAppOnMac = () => {};'
    ].join('\n'));
    fs.writeFileSync(path.join(toolkit, 'wallpaper_engine_reader.js'), 'exports.getActiveWallpaper = () => null;\n');
    const original = path.join(tmp, 'original');
    const sourceDist = path.join(original, 'dist');
    fs.mkdirSync(sourceDist, { recursive: true });
    fs.writeFileSync(path.join(original, 'package.json'), '{"name":"antigravity","version":"2.34.0"}');
    for (const rel of ['main.js', 'preload.js']) fs.writeFileSync(path.join(sourceDist, rel), '"use strict";\n');
    fs.writeFileSync(path.join(sourceDist, 'menu.js'), menuSource);
    const baseline = path.join(tmp, 'baseline.asar');
    await asar.createPackage(original, baseline);
    const userConfig = path.join(toolkit, 'plugins.config.json');
    const runCli = (installDir, args) => execFileSync(process.execPath,
        ['--require', shim, path.join(toolkit, 'localization_engine.js'),
            '--install-dir', installDir, '--confirm-unverified-baseline', ...args],
        { cwd: toolkit, env: { ...process.env, AG_BASELINE_STORE: path.join(tmp, 'store') } }
    );

    for (const [args, configMode, button, menuItem, expectedMenuLabel, expectedMainToken] of [
        [['--wallpaper'], undefined, true, true, '壁纸选择库...', '壁纸选择库'],
        [['--wallpaper', '--only-skin'], undefined, true, true, 'Wallpaper Hub...', 'Wallpaper Hub'],
        [['--tw', '--wallpaper'], undefined, true, true, '桌布選擇庫...', '桌布選擇庫'],
        [['--wallpaper', '--only-skin', '--disable', launcher], undefined, false, false, null, null],
        [['--wallpaper'], 'example', true, true, '壁纸选择库...', '壁纸选择库'],
        [['--wallpaper', '--disable', launcher], 'example', false, false, null, null],
        [['--wallpaper', '--enable', launcher], false, true, true, '壁纸选择库...', '壁纸选择库'],
        [['--wallpaper', '--disable', launcher], true, false, false, null, null],
        [[], true, true, true, '壁纸选择库...', '壁纸选择库']
    ]) {
        if (configMode === undefined) fs.rmSync(userConfig, { force: true });
        else if (configMode === 'example') fs.copyFileSync(path.join(toolkit, 'plugins.config.example.json'), userConfig);
        else fs.writeFileSync(userConfig, JSON.stringify({ enabled: { [launcher]: configMode } }));
        const app = fs.mkdtempSync(path.join(tmp, 'install-'));
        const resources = path.join(app, 'resources');
        fs.mkdirSync(resources);
        const appAsar = path.join(resources, 'app.asar');
        fs.copyFileSync(baseline, appAsar);
        runCli(app, args);
        const hasModule = asar.listPackage(appAsar).some(entry => entry.endsWith('/' + moduleName) ||
            entry.endsWith('\\' + moduleName));
        assert.equal(hasModule, button);
        const preload = asar.extractFile(appAsar, 'dist/preload.js').toString();
        const menu = asar.extractFile(appAsar, 'dist/menu.js').toString();
        assert.equal(preload.includes(styleId), button);
        assert.equal(menu.includes('AG WALLPAPER HUB MENU START'), menuItem);
        if (expectedMenuLabel) assert.ok(menu.includes(expectedMenuLabel), expectedMenuLabel);
        if (expectedMainToken) {
            const launcherMain = asar.extractFile(appAsar, 'dist/' + moduleName).toString();
            assert.ok(launcherMain.includes(expectedMainToken), expectedMainToken);
            if (args.includes('--tw')) {
                assert.ok(!launcherMain.includes('壁纸'), 'zh-TW main.js must not contain simplified 壁纸');
                assert.ok(!launcherMain.includes('文件'), 'zh-TW main.js must not contain simplified 文件');
                assert.ok(preload.includes('開啟桌布選擇庫'), 'zh-TW preload must include 開啟桌布選擇庫');
                assert.ok(preload.includes('無法開啟桌布選擇庫。'), 'zh-TW preload must include 無法開啟桌布選擇庫。');
            }
        }
        if (args.includes('--only-skin') && !menuItem) assert.equal(menu, menuSource);
    }

    // Broken plugins.config.json must throw explicitly instead of falling back silently
    fs.writeFileSync(userConfig, '{ broken json');
    assert.throws(() => pluginLoader.resolvePlugins(toolkit, {}), /Invalid plugins\.config\.json/);
    fs.rmSync(userConfig, { force: true });

    const legacy = path.join(tmp, 'legacy');
    const out = path.join(legacy, 'resources', 'app', 'out');
    const workbench = path.join(out, 'vs', 'code', 'electron-browser', 'workbench');
    fs.mkdirSync(workbench, { recursive: true });
    const html = path.join(workbench, 'workbench.html');
    fs.writeFileSync(html, '<body></body>');
    runCli(legacy, ['--wallpaper', '--enable', launcher]);
    assert.match(fs.readFileSync(html, 'utf8'), /ag_agent_hanhua\.js/);
    const generated = path.join(out, 'ag_agent_hanhua.js');
    assert.ok(!fs.readFileSync(generated, 'utf8').includes(channel));
    syntaxCheck(generated);
}

try {
    fs.mkdirSync(distDir);
    testInjection();
    await testMainProcess();
    await testCli();
    console.log('Wallpaper Hub launcher regression: PASS');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
