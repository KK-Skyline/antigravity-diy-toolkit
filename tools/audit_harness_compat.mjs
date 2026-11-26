import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import { readAsarArchive, extractSubtree, buildPatchedAsar } from '../core/asar_fast_patch.mjs';
import { peekBaselineStoreDir } from '../asar_transaction.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const { probeInstallationDir, resolveResourcesDir } = require(path.join(repoRoot, 'core', 'host_env.js'));
const pluginLoader = require(path.join(repoRoot, 'core', 'plugin_loader.js'));
const injector = require(path.join(repoRoot, 'core', 'injector.js'));

const SIGNATURE_START = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const SIGNATURE_END = '/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */';
const ALL_PLUGINS = ['devtools', 'theme-obsidian-blue', 'wallpaper-engine', 'theme-acrylic', 'fx-rain', 'i18n-zh'];

const SYNTHETIC_DATA_URL = 'data:image/png;base64,' + 'A'.repeat(256);
const SYNTHETIC_BAKED_WALLPAPER = {
    title: 'Synthetic Audit Wallpaper',
    type: 'image',
    mediaType: 'image/png',
    dataUrl: SYNTHETIC_DATA_URL,
    videoPath: '',
    videoMime: '',
    effects: {},
    config: { blur: 0, contrast: 105, saturate: 110 }
};

function withCapturedConsole(fn) {
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
        return fn();
    } finally {
        console.log = origLog;
        console.warn = origWarn;
    }
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanPreloadSignature(content) {
    const re = new RegExp(escapeRegExp(SIGNATURE_START) + '[\\s\\S]*?' + escapeRegExp(SIGNATURE_END), 'g');
    return content.replace(re, '');
}

function findEntrySlice(raw, header, dataStart, relPosix) {
    const parts = relPosix.split('/');
    let cur = header;
    for (const seg of parts) {
        if (!cur || !cur.files || !Object.prototype.hasOwnProperty.call(cur.files, seg)) return null;
        cur = cur.files[seg];
    }
    if (!cur) return null;
    if ('files' in cur || 'link' in cur || cur.unpacked) return { exists: true, slice: null };
    const offset = Number(cur.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(cur.size) || cur.size < 0 ||
        dataStart + offset + cur.size > raw.length) {
        return { exists: false, slice: null };
    }
    return { exists: true, slice: raw.subarray(dataStart + offset, dataStart + offset + cur.size) };
}

function countDistFiles(header) {
    const distNode = header?.files?.dist;
    if (!distNode || !('files' in distNode)) return 0;
    let count = 0;
    const walk = (filesObj) => {
        for (const info of Object.values(filesObj)) {
            if ('files' in info) walk(info.files);
            else if (!('link' in info)) count++;
        }
    };
    walk(distNode.files);
    return count;
}

function collectDistPatchMap(distDir) {
    const patchMap = new Map();
    if (!fs.existsSync(distDir)) return patchMap;
    const walk = (absDir, relPosix) => {
        for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
            const abs = path.join(absDir, entry.name);
            const rel = `${relPosix}/${entry.name}`;
            if (entry.isDirectory()) {
                walk(abs, rel);
            } else if (entry.isFile()) {
                patchMap.set(rel, fs.readFileSync(abs));
            }
        }
    };
    walk(distDir, 'dist');
    return patchMap;
}

function resolveAuditInput({ asarPath = null, installDir = null } = {}) {
    if (asarPath) {
        const resolved = path.resolve(asarPath);
        if (!fs.existsSync(resolved)) throw new Error(`ASAR file not found: ${resolved}`);
        const { raw, header, dataStart } = readAsarArchive(resolved);
        const pkgEntry = findEntrySlice(raw, header, dataStart, 'package.json');
        const preloadEntry = findEntrySlice(raw, header, dataStart, 'dist/preload.js');
        const version = pkgEntry?.slice ? JSON.parse(pkgEntry.slice.toString('utf8')).version : null;
        const localized = Boolean(preloadEntry?.slice && preloadEntry.slice.includes(SIGNATURE_START));
        return {
            inputAsar: resolved,
            source: 'explicit-asar',
            liveAlreadyLocalized: localized,
            auditedVersion: version,
            asarSha256: crypto.createHash('sha256').update(raw).digest('hex'),
            archive: { raw, header, dataStart }
        };
    }

    const probed = probeInstallationDir(installDir);
    const resourcesDir = probed ? resolveResourcesDir(probed) : null;
    const liveAsar = resourcesDir ? path.join(resourcesDir, 'app.asar') : null;
    if (!liveAsar || !fs.existsSync(liveAsar)) {
        throw new Error('Could not locate installed Antigravity resources/app.asar');
    }

    const liveArchive = readAsarArchive(liveAsar);
    const livePkgEntry = findEntrySlice(liveArchive.raw, liveArchive.header, liveArchive.dataStart, 'package.json');
    const livePreloadEntry = findEntrySlice(liveArchive.raw, liveArchive.header, liveArchive.dataStart, 'dist/preload.js');
    const liveVersion = livePkgEntry?.slice ? JSON.parse(livePkgEntry.slice.toString('utf8')).version : null;
    const liveAlreadyLocalized = Boolean(livePreloadEntry?.slice && livePreloadEntry.slice.includes(SIGNATURE_START));

    if (liveAlreadyLocalized) {
        const storeDir = peekBaselineStoreDir(resourcesDir);
        const pointerFile = path.join(storeDir, 'app.asar.baseline.json');
        if (fs.existsSync(pointerFile)) {
            try {
                const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
                const sha = pointer?.sha256;
                if (typeof sha === 'string' && /^[a-f0-9]{64}$/.test(sha)) {
                    const bakFile = path.join(storeDir, `app.asar.baseline-${sha}.bak`);
                    const metaFile = `${bakFile}.json`;
                    if (fs.existsSync(bakFile) && fs.existsSync(metaFile)) {
                        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
                        if (meta.version === liveVersion) {
                            const bakArchive = readAsarArchive(bakFile);
                            const bakPreload = findEntrySlice(bakArchive.raw, bakArchive.header, bakArchive.dataStart, 'dist/preload.js');
                            const bakLocalized = Boolean(bakPreload?.slice && bakPreload.slice.includes(SIGNATURE_START));
                            if (!bakLocalized) {
                                return {
                                    inputAsar: bakFile,
                                    source: 'saved-baseline',
                                    liveAlreadyLocalized: true,
                                    auditedVersion: liveVersion,
                                    asarSha256: crypto.createHash('sha256').update(bakArchive.raw).digest('hex'),
                                    archive: bakArchive
                                };
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    }

    return {
        inputAsar: liveAsar,
        source: 'live-asar',
        liveAlreadyLocalized,
        auditedVersion: liveVersion,
        asarSha256: crypto.createHash('sha256').update(liveArchive.raw).digest('hex'),
        archive: liveArchive
    };
}

function runStageA(archive, compat) {
    const { raw, header, dataStart } = archive;
    const passed = [];
    const failed = [];
    const optionalSkipped = [];

    for (const anchor of (compat.hookAnchors || [])) {
        const entry = findEntrySlice(raw, header, dataStart, anchor.file);
        let ok = false;
        if (anchor.type === 'exists') {
            ok = Boolean(entry && entry.exists);
        } else if (entry && entry.slice) {
            const text = entry.slice.toString('utf8');
            if (anchor.type === 'substring') {
                ok = text.includes(anchor.pattern);
            } else if (anchor.type === 'regex') {
                ok = new RegExp(anchor.pattern).test(text);
            }
        }
        if (ok) {
            passed.push(anchor.id);
        } else if (anchor.required === false) {
            optionalSkipped.push(anchor.id);
        } else {
            failed.push(anchor.id);
        }
    }

    return {
        distFileCount: countDistFiles(header),
        anchors: { passed, failed, optionalSkipped }
    };
}

function runSandboxMode(inputAsar, sandboxRoot, modeConfig) {
    const { mode, enable, useWallpaper, useDarkBlue, noI18n } = modeConfig;
    const disable = ALL_PLUGINS.filter(id => !enable.includes(id));
    const modeDir = path.join(sandboxRoot, mode);
    const extractDir = path.join(modeDir, 'extracted');
    const outAsar = path.join(modeDir, 'out.asar');
    fs.mkdirSync(extractDir, { recursive: true });

    const result = { mode, ok: false, checkedFiles: [], assertions: {}, error: null };
    try {
        extractSubtree(inputAsar, extractDir, ['dist']);
        const distDir = path.join(extractDir, 'dist');

        const snap = (rel) => {
            const p = path.join(distDir, rel);
            return fs.existsSync(p) ? fs.readFileSync(p) : null;
        };
        const menuBefore = snap('menu.js');
        const trayBefore = snap('tray.js');
        const updaterBefore = snap('updater.js');

        const { active, allConfigs } = pluginLoader.resolvePlugins(repoRoot, {
            enable,
            disable,
            settings: {
                'i18n-zh': { locale: 'zh-CN', brandTitle: 'english' },
                'fx-rain': { mode: 'auto', intensity: 0.6 }
            }
        });

        const shared = {};
        if (useWallpaper) {
            shared.bakedWallpaper = structuredClone(SYNTHETIC_BAKED_WALLPAPER);
        }

        const ctx = injector.buildContextBase({
            rootDir: repoRoot,
            tempDir: extractDir,
            distDir,
            isV2: true,
            cliFlags: { USE_TW: false, USE_DARK_BLUE: useDarkBlue, USE_WALLPAPER: useWallpaper, BRAND_TITLE_MODE: 'english', NO_I18N: noI18n },
            allConfigs,
            shared,
            hostHelpers: {}
        });

        withCapturedConsole(() => {
            injector.runPrepare(active, ctx);
        });

        const preloadPath = path.join(distDir, 'preload.js');
        if (!fs.existsSync(preloadPath)) throw new Error('Missing dist/preload.js in extracted subtree');
        const rawPreload = fs.readFileSync(preloadPath, 'utf8');
        const cleanedPreload = cleanPreloadSignature(rawPreload);
        const payload = injector.buildPreloadPayload(active, ctx);
        fs.writeFileSync(preloadPath, cleanedPreload + '\n' + payload, 'utf8');

        withCapturedConsole(() => {
            injector.runPatchMain(active, ctx);
        });

        const patchMap = collectDistPatchMap(distDir);
        buildPatchedAsar(inputAsar, patchMap, outAsar);

        const syntaxTargets = ['preload.js', 'main.js', 'menu.js', 'tray.js', 'debugConsole.js', 'keybindings.js', 'updater.js', 'utils.js'];
        if (useWallpaper) syntaxTargets.push('agWallpaperVideo.js');
        for (const rel of syntaxTargets) {
            const p = path.join(distDir, rel);
            if (fs.existsSync(p)) {
                execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
                result.checkedFiles.push(`dist/${rel}`);
            } else if (rel === 'agWallpaperVideo.js' && useWallpaper) {
                throw new Error('Missing dist/agWallpaperVideo.js after wallpaper patchMain');
            }
        }

        asar.uncache(outAsar);
        const headerCheck = asar.getRawHeader(outAsar);
        if (!headerCheck?.header?.files?.dist) throw new Error('Invalid out.asar header');
        const outPreloadBuf = asar.extractFile(outAsar, path.join('dist', 'preload.js'));
        const outPreloadText = outPreloadBuf.toString('utf8');
        const outPkg = JSON.parse(asar.extractFile(outAsar, 'package.json').toString('utf8'));
        if (!outPreloadText.includes(SIGNATURE_START) || !outPreloadText.includes(SIGNATURE_END)) {
            throw new Error('out.asar dist/preload.js missing SIGNATURE markers');
        }
        if (typeof outPkg.version !== 'string' || !outPkg.version) {
            throw new Error('out.asar package.json missing version');
        }
        result.assertions.asarReadable = true;

        const readPatched = (rel) => {
            const p = path.join(distDir, rel);
            return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
        };

        if (mode === 'default-i18n') {
            const dc = readPatched('debugConsole.js');
            const kb = readPatched('keybindings.js');
            const menu = readPatched('menu.js');
            const tray = readPatched('tray.js');
            const updater = readPatched('updater.js');
            result.assertions.debugConsoleUnlocked = dc.includes('return true;');
            result.assertions.keybindingsPatched = kb.includes('toggleDevTools');
            result.assertions.menuPatched = menu.includes('translateMenu') && menu.includes('submenuAliases');
            result.assertions.trayPatched = tray.includes('TRAY TRANSLATION START') && tray.includes('个智能体运行中');
            result.assertions.updaterPatched = updater.includes('检查更新');
        } else if (mode === 'wallpaper-full') {
            const idxBlue = outPreloadText.indexOf('antigravity-dark-blue-theme');
            const idxWe = outPreloadText.indexOf('antigravity-we-style');
            const idxAcrylic = outPreloadText.indexOf('antigravity-acrylic-theme');
            const dataUrlCount = outPreloadText.split(SYNTHETIC_DATA_URL).length - 1;
            result.assertions.layerOrder = idxBlue !== -1 && idxWe !== -1 && idxAcrylic !== -1 && idxBlue < idxWe && idxWe < idxAcrylic;
            result.assertions.singleDataUrl = dataUrlCount === 1;
            result.assertions.videoServerInjected = result.checkedFiles.includes('dist/agWallpaperVideo.js');
        } else if (mode === 'skin-only') {
            const menuAfter = snap('menu.js');
            const trayAfter = snap('tray.js');
            const updaterAfter = snap('updater.js');
            result.assertions.menuUntouched = (menuBefore === null && menuAfter === null) || (menuBefore && menuAfter && menuBefore.equals(menuAfter));
            result.assertions.trayUntouched = (trayBefore === null && trayAfter === null) || (trayBefore && trayAfter && trayBefore.equals(trayAfter));
            result.assertions.updaterUntouched = (updaterBefore === null && updaterAfter === null) || (updaterBefore && updaterAfter && updaterBefore.equals(updaterAfter));
            result.assertions.noI18nInPreload = !outPreloadText.includes('CODE_ISOLATION_SELECTOR');
        }

        if (Object.values(result.assertions).some(v => v !== true)) {
            throw new Error(`Mode ${mode} semantic assertion failed: ${JSON.stringify(result.assertions)}`);
        }
        result.ok = true;
    } catch (err) {
        result.error = err?.message || String(err);
    } finally {
        asar.uncache(outAsar);
    }
    return result;
}

function parseColorAlpha(colorStr) {
    if (typeof colorStr !== 'string') return null;
    const s = colorStr.trim().toLowerCase();
    if (!s || s === 'missing') return null;
    if (s === 'transparent') return 0;
    const rgbaComma = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(s);
    if (rgbaComma) {
        if (!rgbaComma[1]) return 1;
        return rgbaComma[1].endsWith('%') ? parseFloat(rgbaComma[1]) / 100 : parseFloat(rgbaComma[1]);
    }
    const css4 = /^rgba?\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(s);
    if (css4) {
        if (!css4[1]) return 1;
        return css4[1].endsWith('%') ? parseFloat(css4[1]) / 100 : parseFloat(css4[1]);
    }
    return null;
}

function normalizeDictKey(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim()
        .replace(/’/g, "'").replace(/‘/g, "'")
        .replace(/“/g, '"').replace(/”/g, '"')
        .replace(/…/g, '...');
}

function loadCnDictSet() {
    const set = new Set();
    const dictsDir = path.join(repoRoot, 'dicts');
    if (!fs.existsSync(dictsDir)) return set;
    for (const file of fs.readdirSync(dictsDir)) {
        if (!file.endsWith('.json')) continue;
        try {
            const raw = fs.readFileSync(path.join(dictsDir, file), 'utf8').replace(/^\uFEFF/, '');
            const obj = JSON.parse(raw);
            for (const k of Object.keys(obj)) {
                const normK = normalizeDictKey(k);
                if (normK) set.add(normK.toLowerCase());
            }
        } catch (e) {}
    }
    return set;
}

function stripShortcutSuffix(text) {
    const m = /^(.+?)\s*\((Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\+?([^)]*)\)$/i.exec(text);
    return m ? m[1].trim() : text;
}

function runStageC({ cdpPort = null, cdpRunner = null } = {}) {
    const defaultRunner = (absScriptPath) => {
        const args = [path.join(repoRoot, 'tools', 'agcdp.js'), 'eval', absScriptPath];
        if (cdpPort) args.push('--port', String(cdpPort));
        return execFileSync(process.execPath, args, {
            timeout: 8000,
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8'
        });
    };
    const execCdp = cdpRunner || defaultRunner;

    try {
        const checkPath = path.join(repoRoot, 'tools', 'check-wallpaper.js');
        const probePath = path.join(repoRoot, 'tools', 'probe_untranslated_ui.js');
        const wallpaperState = JSON.parse(String(execCdp(checkPath)).trim());
        const probeData = JSON.parse(String(execCdp(probePath)).trim());

        let shellTransparencyOk = null;
        if (wallpaperState && wallpaperState.themeLoaded === true && String(wallpaperState.browserHole) !== 'true') {
            shellTransparencyOk = true;
            const shellBg = wallpaperState.shellBg || {};
            for (const key of ['agyShell', 'insetShell']) {
                const alpha = parseColorAlpha(shellBg[key]);
                if (alpha !== null && alpha >= 0.99) {
                    shellTransparencyOk = false;
                }
            }
        }

        const dictSet = loadCnDictSet();
        const untranslatedCandidates = [];
        for (const rawLabel of (probeData?.labels || [])) {
            const norm = normalizeDictKey(rawLabel);
            if (!norm) continue;
            const stripped = normalizeDictKey(stripShortcutSuffix(norm));
            if (!dictSet.has(norm.toLowerCase()) && !dictSet.has(stripped.toLowerCase())) {
                untranslatedCandidates.push(rawLabel);
            }
        }

        return {
            status: 'ok',
            reason: null,
            wallpaperState,
            shellTransparencyOk,
            shellSelectors: probeData?.selectors || null,
            untranslatedCandidates
        };
    } catch (error) {
        return {
            status: 'unavailable',
            reason: error?.message || String(error),
            wallpaperState: null,
            shellTransparencyOk: null,
            shellSelectors: null,
            untranslatedCandidates: []
        };
    }
}

export async function auditHarnessCompat({
    asarPath = null,
    installDir = null,
    compatFile = path.join(repoRoot, 'harness_compat.json'),
    enableCdp = false,
    cdpPort = null,
    cdpRunner = null
} = {}) {
    const compat = JSON.parse(fs.readFileSync(path.resolve(compatFile), 'utf8'));
    const input = resolveAuditInput({ asarPath, installDir });
    const stageA = runStageA(input.archive, compat);

    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-harness-audit-'));
    let sandboxModes = [];
    try {
        const modes = [
            { mode: 'default-i18n', enable: ['devtools', 'i18n-zh'], useWallpaper: false, useDarkBlue: false, noI18n: false },
            { mode: 'wallpaper-full', enable: ['devtools', 'theme-obsidian-blue', 'wallpaper-engine', 'theme-acrylic', 'fx-rain', 'i18n-zh'], useWallpaper: true, useDarkBlue: true, noI18n: false },
            { mode: 'skin-only', enable: ['devtools', 'wallpaper-engine', 'theme-acrylic', 'fx-rain'], useWallpaper: true, useDarkBlue: false, noI18n: true }
        ];
        sandboxModes = modes.map(m => runSandboxMode(input.inputAsar, sandboxRoot, m));
    } finally {
        fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }

    const cdp = enableCdp
        ? runStageC({ cdpPort, cdpRunner })
        : {
            status: 'skipped',
            reason: null,
            wallpaperState: null,
            shellTransparencyOk: null,
            shellSelectors: null,
            untranslatedCandidates: []
        };

    const reasons = [];
    if (stageA.anchors.failed.length > 0) {
        reasons.push(`Missing/changed required hook anchors: ${stageA.anchors.failed.join(', ')}`);
    }
    for (const m of sandboxModes) {
        if (!m.ok) reasons.push(`Sandbox mode ${m.mode} failed: ${m.error}`);
    }
    if (cdp.status === 'ok' && cdp.shellTransparencyOk === false) {
        reasons.push('CDP detected opaque .agy-shell or .agy-inset-shell while acrylic theme is active');
    }

    const verdict = reasons.length === 0 ? 'COMPATIBLE' : 'NEEDS_ADAPTATION';

    return {
        verdict,
        auditedVersion: input.auditedVersion,
        repoVerifiedVersion: compat.lastVerifiedVersion,
        source: input.source,
        liveAlreadyLocalized: input.liveAlreadyLocalized,
        asarSha256: input.asarSha256,
        distFileCount: stageA.distFileCount,
        anchors: stageA.anchors,
        sandboxModes,
        cdp,
        reasons
    };
}

function parseCliArgs(argv) {
    const opts = {
        asarPath: null,
        installDir: null,
        compatFile: path.join(repoRoot, 'harness_compat.json'),
        enableCdp: false,
        cdpPort: null,
        json: false,
        out: null
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--asar') opts.asarPath = argv[++i] || null;
        else if (a.startsWith('--asar=')) opts.asarPath = a.slice('--asar='.length);
        else if (a === '--install-dir') opts.installDir = argv[++i] || null;
        else if (a.startsWith('--install-dir=')) opts.installDir = a.slice('--install-dir='.length);
        else if (a === '--compat-file') opts.compatFile = argv[++i] || opts.compatFile;
        else if (a.startsWith('--compat-file=')) opts.compatFile = a.slice('--compat-file='.length);
        else if (a === '--cdp') opts.enableCdp = true;
        else if (a === '--cdp-port') opts.cdpPort = argv[++i] || null;
        else if (a.startsWith('--cdp-port=')) opts.cdpPort = a.slice('--cdp-port='.length);
        else if (a === '--json') opts.json = true;
        else if (a === '--out') opts.out = argv[++i] || null;
        else if (a.startsWith('--out=')) opts.out = a.slice('--out='.length);
    }
    return opts;
}

const isMain = process.argv[1] && (
    process.platform === 'win32'
        ? path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase()
        : path.resolve(process.argv[1]) === __filename
);

if (isMain) {
    const opts = parseCliArgs(process.argv.slice(2));
    auditHarnessCompat(opts).then(report => {
        const serialized = JSON.stringify(report, null, 2);
        if (opts.out) {
            fs.writeFileSync(path.resolve(opts.out), serialized + '\n', 'utf8');
        }
        if (opts.json) {
            process.stdout.write(serialized + '\n');
        } else {
            console.log(`审计结论: ${report.verdict} (版本 ${report.auditedVersion}, 来源 ${report.source})`);
            console.log(`静态锚点: ${report.anchors.passed.length} 通过, ${report.anchors.failed.length} 失败, ${report.anchors.optionalSkipped.length} 可选跳过`);
            for (const m of report.sandboxModes) {
                console.log(`沙箱模式 [${m.mode}]: ${m.ok ? 'PASS' : `FAIL (${m.error})`}`);
            }
            console.log(`CDP 状态: ${report.cdp.status}${report.cdp.reason ? ` (${report.cdp.reason})` : ''}`);
        }
        process.exitCode = report.verdict === 'COMPATIBLE' ? 0 : 2;
    }).catch(err => {
        if (opts.json) {
            process.stdout.write(JSON.stringify({ error: err?.message || String(err) }) + '\n');
        } else {
            console.error(`[错误] ${err?.message || err}`);
        }
        process.exitCode = 1;
    });
}
