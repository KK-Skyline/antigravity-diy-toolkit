import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const pluginLoader = require(path.join(rootDir, 'core', 'plugin_loader.js'));
const injector = require(path.join(rootDir, 'core', 'injector.js'));

function runTests() {
    // 1. Default plugins & --dark-blue + --wallpaper coexistence + layerOrder
    {
        const resolved = pluginLoader.resolvePlugins(rootDir, {
            enable: ['devtools', 'i18n-zh', 'theme-obsidian-blue', 'wallpaper-engine', 'theme-acrylic', 'fx-rain'],
            disable: []
        });
        const ids = resolved.active.map(p => p.manifest.id);
        assert.deepEqual(ids, ['devtools', 'theme-obsidian-blue', 'wallpaper-engine', 'theme-acrylic', 'fx-rain', 'i18n-zh']);
        const baseCtx = injector.buildContextBase({
            rootDir,
            isV2: false,
            cliFlags: {},
            allConfigs: resolved.allConfigs,
            shared: {},
            hostHelpers: {}
        });
        const styles = injector.collectStyles(resolved.active, baseCtx);
        assert.equal(styles.length, 2);
        assert.equal(styles[0].id, 'antigravity-dark-blue-theme');
        assert.equal(styles[0].layerOrder, 10);
        assert.equal(styles[1].id, 'antigravity-acrylic-theme');
        assert.equal(styles[1].layerOrder, 20);
    }

    // 2. --no-i18n pure skin mode: SIGNATURE_START/END preserved, no i18n runtime
    {
        const resolved = pluginLoader.resolvePlugins(rootDir, {
            enable: ['devtools', 'theme-obsidian-blue'],
            disable: ['i18n-zh', 'wallpaper-engine', 'theme-acrylic', 'fx-rain']
        });
        const baseCtx = injector.buildContextBase({
            rootDir,
            isV2: false,
            cliFlags: { NO_I18N: true },
            allConfigs: resolved.allConfigs,
            shared: {},
            hostHelpers: {}
        });
        injector.runPrepare(resolved.active, baseCtx);
        const payload = injector.buildPreloadPayload(resolved.active, baseCtx);
        assert.ok(payload.includes(injector.SIGNATURE_START), 'SIGNATURE_START must always be present');
        assert.ok(payload.includes(injector.SIGNATURE_END), 'SIGNATURE_END must always be present');
        assert.ok(!payload.includes('CODE_ISOLATION_SELECTOR'), 'i18n runtime must not be injected when i18n-zh is disabled');
        assert.ok(payload.includes('antigravity-dark-blue-theme'), 'dark blue theme style must be present');
    }

    // 3. Disabling devtools & fx-rain mode off/always
    {
        const resolvedOff = pluginLoader.resolvePlugins(rootDir, {
            enable: ['fx-rain'],
            disable: ['devtools', 'i18n-zh', 'theme-obsidian-blue', 'wallpaper-engine', 'theme-acrylic'],
            settings: { 'fx-rain': { mode: 'off', intensity: 1.2 } }
        });
        const ctxOff = injector.buildContextBase({ rootDir, isV2: false, allConfigs: resolvedOff.allConfigs });
        assert.equal(injector.collectRuntimes(resolvedOff.active, ctxOff).length, 0);

        const resolvedAlways = pluginLoader.resolvePlugins(rootDir, {
            enable: ['fx-rain'],
            disable: ['devtools', 'i18n-zh', 'theme-obsidian-blue', 'wallpaper-engine', 'theme-acrylic'],
            settings: { 'fx-rain': { mode: 'always', intensity: 1.5 } }
        });
        const ctxAlways = injector.buildContextBase({ rootDir, isV2: false, allConfigs: resolvedAlways.allConfigs });
        const runtimesAlways = injector.collectRuntimes(resolvedAlways.active, ctxAlways);
        assert.equal(runtimesAlways.length, 1);
        assert.ok(runtimesAlways[0].code.includes('"always"'));
        assert.ok(runtimesAlways[0].code.includes('1.5'));
    }

    // 4. Error isolation: throwing plugin does not break subsequent plugins, and __agBus works without window
    {
        const mockPlugins = [
            {
                manifest: { id: 'broken-plugin', layerOrder: 1 },
                config: {},
                module: {
                    getPreloadRuntime() {
                        return 'throw new Error("boom");';
                    }
                }
            },
            {
                manifest: { id: 'healthy-plugin', layerOrder: 2 },
                config: {},
                module: {
                    getPreloadRuntime() {
                        return 'bus.emit("test:ping", { ok: true }); bus.on("test:ping", (v) => { globalThis.__pong = v.ok; });';
                    }
                }
            }
        ];
        const payload = injector.buildPreloadPayload(mockPlugins, injector.buildContextBase({ rootDir }));
        const errors = [];
        const sandbox = {
            document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
            window: { addEventListener() {} },
            console: { error: (...a) => errors.push(a.join(' ')), log() {}, warn() {} },
            globalThis: {}
        };
        sandbox.globalThis = sandbox;
        vm.runInNewContext(payload, sandbox);
        assert.equal(sandbox.__pong, true, 'healthy plugin must still run after broken plugin throws');
        assert.equal(sandbox.window.__agBus, undefined, '__agBus must not leak to window');
        assert.ok(errors.some(e => e.includes('[AG-Plugin:broken-plugin]')), 'error must be tagged with plugin id');
    }

    // 5. plugin_loader.js security validation: illegal ID, settingsSchema bounds, symlink escape
    {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-plugin-sec-'));
        try {
            // Illegal directory name
            const badDir = path.join(tmp, 'plugins', 'Bad_Plugin');
            fs.mkdirSync(badDir, { recursive: true });
            fs.writeFileSync(path.join(badDir, 'plugin.json'), JSON.stringify({ id: 'Bad_Plugin' }));
            fs.writeFileSync(path.join(badDir, 'index.js'), 'module.exports = {};');
            assert.throws(() => pluginLoader.discoverPlugins(tmp), /Illegal plugin directory name/);

            // settingsSchema validation
            const goodManifest = {
                id: 'good-plugin',
                settingsSchema: {
                    flag: { type: 'boolean', default: true },
                    level: { type: 'number', min: 0, max: 10, default: 5 },
                    mode: { type: 'enum', values: ['a', 'b'], default: 'a' },
                    tint: { type: 'color', default: '#112233' }
                }
            };
            assert.throws(() => pluginLoader.validatePluginConfig(goodManifest, { level: 99 }), /exceeds max/);
            assert.throws(() => pluginLoader.validatePluginConfig(goodManifest, { level: NaN }), /finite number/);
            assert.throws(() => pluginLoader.validatePluginConfig(goodManifest, { mode: 'c' }), /must be one of/);
            assert.throws(() => pluginLoader.validatePluginConfig(goodManifest, { tint: 'red' }), /hex color/);
            assert.throws(() => pluginLoader.validatePluginConfig(goodManifest, { flag: 'true' }), /boolean/);

            const valid = pluginLoader.validatePluginConfig(goodManifest, { level: 7, mode: 'b', tint: '#AABBCC' });
            assert.deepEqual(valid, { flag: true, level: 7, mode: 'b', tint: '#AABBCC' });

            // Symlink traversal check (best-effort if OS allows symlinks)
            const symRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-plugin-sym-'));
            const outsideDir = path.join(symRoot, 'outside');
            fs.mkdirSync(outsideDir, { recursive: true });
            fs.writeFileSync(path.join(outsideDir, 'plugin.json'), JSON.stringify({ id: 'sym-escape' }));
            fs.writeFileSync(path.join(outsideDir, 'index.js'), 'module.exports = {};');
            const symPluginsDir = path.join(symRoot, 'plugins');
            fs.mkdirSync(symPluginsDir, { recursive: true });
            try {
                fs.symlinkSync(outsideDir, path.join(symPluginsDir, 'sym-escape'), 'dir');
                assert.throws(() => pluginLoader.discoverPlugins(symRoot), /escapes plugins/);
            } catch (e) {
                if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
            } finally {
                fs.rmSync(symRoot, { recursive: true, force: true });
            }
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }

    console.log('plugin architecture regression: PASS');
}

runTests();
