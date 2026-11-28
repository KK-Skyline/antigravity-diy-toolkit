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
    assert.match(rendererSrc, /observer\.observe\(body,\s*\{\s*childList:\s*true,\s*subtree:\s*false\s*\}\)/);
    assert.doesNotMatch(rendererSrc, /observer\.observe\(body,\s*\{[^}]*subtree:\s*true/);
    assert.match(rendererSrc, /catch\s*\(\s*error\s*\)\s*\{[\s\S]*?console\.error\(/);

    const cssSrc = fs.readFileSync(path.join(rootDir, 'plugins', launcher, 'launcher.css'), 'utf8');
    assert.doesNotMatch(cssSrc, /^\s*(?:top|height):[^;]*!important/m);

    for (const file of ['index.js', 'main.js', 'renderer.js', 'start-hub.js']) {
        const src = fs.readFileSync(path.join(rootDir, 'plugins', launcher, file), 'utf8');
        assert.doesNotMatch(src, /(?:[A-Z]:\\|\/Users\/|\/home\/|shell:\s*true)/i);
    }
}

function testRendererPositioning() {
    const source = fs.readFileSync(path.join(rootDir, 'plugins', launcher, 'renderer.js'), 'utf8');
    function createDomEnv() {
        const makeEl = (tag, props = {}) => {
            const el = {
                tagName: tag.toUpperCase(),
                id: '',
                type: '',
                className: '',
                _textContent: undefined,
                title: '',
                disabled: false,
                isConnected: false,
                offsetWidth: 58,
                parentElement: null,
                children: [],
                attrs: {},
                dataset: {},
                style: { setProperty(k, v) { this[k] = v; } },
                listeners: {},
                get textContent() {
                    if (this._textContent !== undefined) return this._textContent;
                    return this.children.map(c => c.textContent).join('');
                },
                set textContent(v) { this._textContent = v; },
                setAttribute(k, v) { this.attrs[k] = String(v); },
                removeAttribute(k) { delete this.attrs[k]; },
                appendChild(child) {
                    child.parentElement = this;
                    this.children.push(child);
                    child.isConnected = true;
                    return child;
                },
                contains(target) {
                    let cur = target;
                    while (cur) {
                        if (cur === this) return true;
                        cur = cur.parentElement;
                    }
                    return false;
                },
                addEventListener(type, fn) { this.listeners[type] = fn; },
                getBoundingClientRect() { return this._rect || { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; },
                getRootNode() { return this._root || null; },
                closest() { return null; },
                ...props
            };
            return el;
        };
        return { makeEl };
    }

    function runInDom(menuItems, labels, buildCustomBody) {
        const { makeEl } = createDomEnv();
        const items = menuItems.map(item => makeEl('div', {
            textContent: item.text,
            _rect: item.rect,
            _color: item.color || 'rgb(220, 226, 238)',
            _fontSize: item.fontSize || '12px',
            closest: sel => (sel.includes('title-menu-bar') ? menuBar : null)
        }));
        const menuBar = makeEl('div', { id: 'title-menu-bar', isConnected: true });
        const body = makeEl('body', { isConnected: true });
        if (buildCustomBody) buildCustomBody(makeEl, body);
        const document = {
            documentElement: makeEl('html'),
            body,
            createElement: tag => makeEl(tag),
            createElementNS: (_ns, tag) => makeEl(tag),
            getElementById: id => body.children.find(c => c.id === id) || null,
            addEventListener() {},
            querySelector: sel => (!buildCustomBody && sel.includes('title-menu-bar') ? menuBar : null),
            querySelectorAll: sel => (!buildCustomBody && sel.includes('title-menu-bar-item') ? items : [])
        };
        class MutationObserver { observe() {} disconnect() {} }
        class ResizeObserver { observe() {} disconnect() {} }
        const intervals = new Map();
        let nextIntervalId = 1;
        const window = {
            innerWidth: 1280,
            addEventListener() {},
            getComputedStyle: el => ({ color: el._color, fontSize: el._fontSize })
        };
        window.top = window;
        const sandbox = {
            module: {},
            process,
            window,
            document,
            MutationObserver,
            ResizeObserver,
            requestAnimationFrame: fn => { fn(); return 1; },
            setTimeout: () => 0,
            clearTimeout() {},
            setInterval(fn, ms) {
                const id = nextIntervalId++;
                intervals.set(id, { fn, ms });
                return { id, unref() {} };
            },
            clearInterval(handle) {
                if (handle && typeof handle === 'object') intervals.delete(handle.id);
                else intervals.delete(handle);
            },
            require: id => {
                assert.equal(id, 'electron');
                return { ipcRenderer: { invoke: async () => ({ ok: true }) } };
            }
        };
        vm.runInNewContext(source, sandbox);
        sandbox.module.exports(labels, true);
        if (buildCustomBody) {
            return { button: document.getElementById('ag-hub-launcher-btn'), body, makeEl, intervals };
        }
        return document.getElementById('ag-hub-launcher-btn');
    }

    const cnBtn = runInDom([
        { text: '文件', rect: { left: 90, right: 126, top: 4, bottom: 28, width: 36, height: 24 } },
        { text: '视图', rect: { left: 130, right: 166, top: 4, bottom: 28, width: 36, height: 24 } },
        { text: '窗口', rect: { left: 170, right: 206, top: 4, bottom: 28, width: 36, height: 24 } }
    ], { short: '壁纸', open: '打开壁纸选择库', failure: '无法打开壁纸选择库。' });
    assert.ok(cnBtn, 'launcher button must be mounted');
    assert.ok(cnBtn.children.some(c => c.tagName === 'SVG'), 'button must contain svg');
    const cnLabel = cnBtn.children.find(c => c.className === 'ag-hub-launcher-label');
    assert.equal(cnLabel?.textContent, '壁纸');
    assert.equal(cnBtn.style.left, '214px');
    assert.equal(cnBtn.style.top, '4px');
    assert.equal(cnBtn.style.height, '24px');

    const fallbackBtn = runInDom([
        { text: 'File', rect: { left: 84, right: 120, top: 5, bottom: 27, width: 36, height: 22 } },
        { text: 'View', rect: { left: 124, right: 160, top: 5, bottom: 27, width: 36, height: 22 } }
    ], { short: 'Wallpaper', open: 'Open Wallpaper Hub', failure: 'Could not open Wallpaper Hub.' });
    const fallbackLabel = fallbackBtn.children.find(c => c.className === 'ag-hub-launcher-label');
    assert.equal(fallbackLabel?.textContent, 'Wallpaper');
    assert.equal(fallbackBtn.style.left, '168px');
    assert.equal(fallbackBtn.style.top, '5px');
    assert.equal(fallbackBtn.style.height, '22px');

    // Antigravity 2.36.0 nested div/span topbar without data-testid or .agy-titlebar
    const { button: v236Btn } = runInDom([], { short: '壁纸', open: '打开壁纸选择库', failure: '无法打开壁纸选择库。' }, (makeEl, body) => {
        const topbar = makeEl('div', { _rect: { left: 0, right: 1280, top: 0, bottom: 34, width: 1280, height: 34 } });
        const addItem = (text, boxRect, spanRect) => {
            const box = makeEl('div', { _rect: boxRect, _color: 'rgb(204, 210, 224)', _fontSize: '12px' });
            const span = makeEl('span', { textContent: text, _rect: spanRect, _color: 'rgb(204, 210, 224)', _fontSize: '12px' });
            box.appendChild(span);
            topbar.appendChild(box);
        };
        addItem('Antigravity', { left: 10, right: 98, top: 5, bottom: 29, width: 88, height: 24 }, { left: 18, right: 90, top: 8, bottom: 26, width: 72, height: 18 });
        addItem('工作区', { left: 102, right: 154, top: 5, bottom: 29, width: 52, height: 24 }, { left: 110, right: 146, top: 8, bottom: 26, width: 36, height: 18 });
        addItem('视图', { left: 158, right: 196, top: 5, bottom: 29, width: 38, height: 24 }, { left: 166, right: 188, top: 8, bottom: 26, width: 22, height: 18 });
        addItem('窗口', { left: 200, right: 244, top: 5, bottom: 29, width: 44, height: 24 }, { left: 208, right: 236, top: 8, bottom: 26, width: 28, height: 18 });
        body.appendChild(topbar);

        // Decoy chat container below top > 56 containing "窗口" must be pruned
        const chatArea = makeEl('div', { _rect: { left: 0, right: 1280, top: 60, bottom: 800, width: 1280, height: 740 } });
        const chatDecoy = makeEl('span', { textContent: '窗口', _rect: { left: 400, right: 440, top: 100, bottom: 120, width: 40, height: 20 } });
        chatArea.appendChild(chatDecoy);
        body.appendChild(chatArea);
    });
    assert.equal(v236Btn.style.left, '252px');
    assert.equal(v236Btn.style.top, '5px');
    assert.equal(v236Btn.style.height, '24px');

    // Delayed mount recovery (> 6.2s): #root starts empty, then React hydrates topbar inside #root
    let delayedRoot;
    const delayed = runInDom([], { short: '壁纸', open: '打开壁纸选择库', failure: '无法打开壁纸选择库。' }, (makeEl, body) => {
        delayedRoot = makeEl('div', { id: 'root', _rect: { left: 0, right: 1280, top: 0, bottom: 800, width: 1280, height: 800 } });
        body.appendChild(delayedRoot);
    });
    assert.equal(delayed.button.style.left, '10px');
    assert.equal(Array.from(delayed.intervals.values())[0]?.ms, 500);
    {
        const topbar = delayed.makeEl('div', { _rect: { left: 0, right: 1280, top: 0, bottom: 34, width: 1280, height: 34 } });
        const winBox = delayed.makeEl('div', { _rect: { left: 200, right: 244, top: 5, bottom: 29, width: 44, height: 24 } });
        const winSpan = delayed.makeEl('span', { textContent: '窗口', _rect: { left: 208, right: 236, top: 8, bottom: 26, width: 28, height: 18 } });
        winBox.appendChild(winSpan);
        topbar.appendChild(winBox);
        delayedRoot.appendChild(topbar);
        Array.from(delayed.intervals.values())[0].fn();
    }
    assert.equal(delayed.button.style.left, '252px');
    assert.equal(delayed.button.style.top, '5px');
    assert.equal(delayed.button.style.height, '24px');
    assert.equal(Array.from(delayed.intervals.values())[0]?.ms, 2500);

    // 350-node sidebar before topbar + -0.5px DPI subpixel negative top + Open Shadow DOM
    const { button: shadowBtn } = runInDom([], { short: '壁纸', open: '打开壁纸选择库', failure: '无法打开壁纸选择库。' }, (makeEl, body) => {
        const sidebar = makeEl('div', { _rect: { left: 0, right: 260, top: 32, bottom: 800, width: 260, height: 768 } });
        for (let i = 0; i < 350; i++) {
            sidebar.appendChild(makeEl('div', { textContent: '会话 ' + i, _rect: { left: 10, right: 240, top: 40 + (i % 10) * 30, bottom: 64 + (i % 10) * 30, width: 230, height: 24 } }));
        }
        body.appendChild(sidebar);

        const shadowHost = makeEl('div', { _rect: { left: 0, right: 1280, top: 0, bottom: 34, width: 1280, height: 34 } });
        const shadowRoot = { host: shadowHost, children: [] };
        const topbar = makeEl('div', { _rect: { left: 0, right: 1280, top: 0, bottom: 34, width: 1280, height: 34 }, _root: shadowRoot });
        const winBox = makeEl('div', { _rect: { left: 200, right: 244, top: -0.5, bottom: 23.5, width: 44, height: 24 }, _root: shadowRoot });
        const winSpan = makeEl('span', { textContent: '窗口', _rect: { left: 208, right: 236, top: 2.5, bottom: 20.5, width: 28, height: 18 }, _root: shadowRoot });
        winBox.appendChild(winSpan);
        topbar.appendChild(winBox);
        shadowRoot.children.push(topbar);
        shadowHost.shadowRoot = shadowRoot;
        body.appendChild(shadowHost);
    });
    assert.equal(shadowBtn.style.left, '252px');
    assert.equal(shadowBtn.style.top, '2px');
    assert.equal(shadowBtn.style.height, '24px');
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
            spawnExitCode = 1;
            spawnStderr = 'SPAWN_FAILED';
            assert.equal((await handler(event)).error, 'hub_start_failed');
            assert.ok(loggedErrors.some(line => line.includes('STARTER_EXIT_1:SPAWN_FAILED')));
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

    const parseInjectedConfig = launcherMain => {
        const match = launcherMain.match(/\)\(([\s\S]*)\);\s*$/);
        assert.ok(match, 'agWallpaperHubLauncher.js must end with )(config);');
        return JSON.parse(match[1]);
    };

    for (const [args, configMode, button, menuItem, expectedMenuLabel, localeMode] of [
        [['--wallpaper'], undefined, true, true, '壁纸选择库...', 'zh-CN'],
        [['--wallpaper', '--only-skin'], undefined, true, true, 'Wallpaper Hub...', 'en'],
        [['--tw', '--wallpaper'], undefined, true, true, '桌布選擇庫...', 'zh-TW'],
        [['--wallpaper', '--only-skin', '--disable', launcher], undefined, false, false, null, null],
        [['--wallpaper'], 'example', true, true, '壁纸选择库...', 'zh-CN'],
        [['--wallpaper', '--disable', launcher], 'example', false, false, null, null],
        [['--wallpaper', '--enable', launcher], false, true, true, '壁纸选择库...', 'zh-CN'],
        [['--wallpaper', '--disable', launcher], true, false, false, null, null],
        [[], true, true, true, '壁纸选择库...', 'zh-CN']
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
        if (localeMode) {
            const launcherMain = asar.extractFile(appAsar, 'dist/' + moduleName).toString();
            const injectedConfig = parseInjectedConfig(launcherMain);
            const serialized = JSON.stringify(injectedConfig);
            if (localeMode === 'en') {
                assert.ok(preload.includes('"short":"Wallpaper"'), 'en preload must include short Wallpaper label');
                assert.ok(preload.includes('Open Wallpaper Hub'), 'en preload must include Open Wallpaper Hub');
                assert.ok(preload.includes('Could not open Wallpaper Hub.'), 'en preload must include English failure');
                assert.ok(!preload.includes('壁纸选择库'), 'en preload must not include zh-CN label');
                assert.ok(!preload.includes('桌布選擇庫'), 'en preload must not include zh-TW label');
                assert.equal(injectedConfig.title, 'Antigravity Wallpaper Hub');
                assert.equal(injectedConfig.messages, undefined);
                assert.doesNotMatch(serialized, /[\u4e00-\u9fff]/);
            } else if (localeMode === 'zh-CN') {
                assert.ok(preload.includes('"short":"壁纸"'), 'zh-CN preload must include short 壁纸 label');
                assert.equal(injectedConfig.title, 'Antigravity 壁纸选择库');
                assert.ok(injectedConfig.messages.hubScriptMissing.includes('壁纸选择库'));
            } else if (localeMode === 'zh-TW') {
                assert.ok(preload.includes('"short":"桌布"'), 'zh-TW preload must include short 桌布 label');
                assert.ok(preload.includes('開啟桌布選擇庫'), 'zh-TW preload must include 開啟桌布選擇庫');
                assert.ok(preload.includes('無法開啟桌布選擇庫。'), 'zh-TW preload must include 無法開啟桌布選擇庫。');
                assert.ok(!preload.includes('"short":"壁纸"'), 'zh-TW preload must not include simplified 壁纸');
                assert.equal(injectedConfig.title, 'Antigravity 桌布選擇庫');
                assert.ok(!serialized.includes('壁纸'), 'zh-TW config must not contain simplified 壁纸');
                assert.ok(!serialized.includes('文件'), 'zh-TW config must not contain simplified 文件');
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
    testRendererPositioning();
    await testMainProcess();
    await testCli();
    console.log('Wallpaper Hub launcher regression: PASS');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
