import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const {
    compareSemver,
    validateUpdateUrl,
    parseUpdateYml,
    fetchRemoteManifest
} = await import(new URL('./check_harness_update.mjs', import.meta.url));

const { auditHarnessCompat } = await import(new URL('./audit_harness_compat.mjs', import.meta.url));

const SIGNATURE_START = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const SIGNATURE_END = '/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */';

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function createAuditFixtureAsar(dir, version, {
    localized = false,
    breakDebugConsole = false,
    breakTrayCount = false,
    breakUpdater = false
} = {}) {
    const src = path.join(dir, 'src');
    fs.mkdirSync(path.join(src, 'dist', 'remote'), { recursive: true });
    fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'antigravity', version }));

    const preloadBase = 'console.log("preload");\n';
    fs.writeFileSync(
        path.join(src, 'dist', 'preload.js'),
        localized ? `${preloadBase}\n${SIGNATURE_START}\nconsole.log("old");\n${SIGNATURE_END}\n` : preloadBase
    );
    fs.writeFileSync(path.join(src, 'dist', 'main.js'), 'console.log("main");\n');
    fs.writeFileSync(path.join(src, 'dist', 'remote', 'sample.js'), 'module.exports = 1;\n');
    fs.writeFileSync(
        path.join(src, 'dist', 'debugConsole.js'),
        breakDebugConsole
            ? 'function isDebugConsoleEnabled() { return false; }\n'
            : 'function isDebugConsoleEnabled() {\n    return !electron_1.app.isPackaged;\n}\n'
    );
    fs.writeFileSync(
        path.join(src, 'dist', 'keybindings.js'),
        "function handle(isCmdOrCtrl, input) { if (isCmdOrCtrl && input.shift && input.key.toLowerCase() === 'n') { return 1; } }\n"
    );
    fs.writeFileSync(
        path.join(src, 'dist', 'menu.js'),
        [
            'function build(menu, appMenu, submenuLabel) {',
            "  const submenuItem = appMenu.items.find((item) => item.label === submenuLabel);",
            "  const a = () => { return { label: 'Connect to WSL', submenu }; };",
            "  const b = () => { return { label: 'Reopen Locally', click: () => relaunchWithWslDistro('') }; };",
            '  electron_1.Menu.setApplicationMenu(menu);',
            '}'
        ].join('\n')
    );
    fs.writeFileSync(
        path.join(src, 'dist', 'tray.js'),
        [
            'function createTray(actions, onClick) {',
            '  tray.setContextMenu(contextMenu);',
            '}',
            'function insertTrayMenuItem(options) {}',
            'function updateTrayAgentCount(countItem, count) {',
            breakTrayCount
                ? "  countItem.text = count + ' active';"
                : "  countItem.label = (count > 0 ? `${count} agents` : 'No agents') + ' running';",
            '}'
        ].join('\n')
    );
    fs.writeFileSync(
        path.join(src, 'dist', 'updater.js'),
        [
            'const opts = {',
            "                title: 'Check for Updates',",
            breakUpdater ? "                detail: 'No updates'," : "                message: 'No updates available',",
            "                buttons: ['OK'],",
            '};'
        ].join('\n')
    );
    fs.writeFileSync(path.join(src, 'dist', 'loadingOverlay.js'), '<div><svg></svg></div>\n');

    const outAsar = path.join(dir, 'resources', 'app.asar');
    fs.mkdirSync(path.dirname(outAsar), { recursive: true });
    await asar.createPackage(src, outAsar);
    return outAsar;
}

async function runTests() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-maint-test-'));
    const prevStore = process.env.AG_BASELINE_STORE;
    process.env.AG_BASELINE_STORE = path.join(tmp, 'baseline-store');

    try {
        // 1. compareSemver, validateUpdateUrl, parseUpdateYml, fetchRemoteManifest
        {
            assert.equal(compareSemver('2.35.10', '2.35.2'), 1);
            assert.equal(compareSemver('2.35.0', '2.35.0'), 0);
            assert.equal(compareSemver('2.35.0', '2.35.0-beta.1'), 1);
            assert.equal(compareSemver('2.35.0-beta.10', '2.35.0-beta.2'), 1);
            assert.equal(compareSemver('2.35.0+build1', '2.35.0+build2'), 0);
            assert.equal(compareSemver('02.35.0', '2.35.0'), null);

            assert.equal(validateUpdateUrl('https://example.com/manifest'), 'https://example.com/manifest/');
            for (const bad of [
                'http://example.com/',
                'file:///etc/passwd',
                'https://127.0.0.1/',
                'https://localhost/',
                'https://169.254.169.254/',
                'https://[::1]/',
                'https://user:pass@example.com/'
            ]) {
                assert.throws(() => validateUpdateUrl(bad), `Should reject URL: ${bad}`);
            }

            const yml = parseUpdateYml([
                'version: "2.36.0"',
                "releaseDate: '2026-11-26'",
                'url: https://cdn.example.com/updates',
                'files:',
                '  - url: setup.exe'
            ].join('\n'));
            assert.equal(yml.version, '2.36.0');
            assert.equal(yml.releaseDate, '2026-11-26');
            assert.equal(yml.url, 'https://cdn.example.com/updates/');
            assert.throws(() => parseUpdateYml('__proto__: bad\n'), /Forbidden YAML key/);

            const ymlPath = path.join(tmp, 'app-update.yml');
            fs.writeFileSync(ymlPath, 'provider: generic\nurl: https://updates.example.com/win\n');
            const seenCalls = [];
            const mockFetch = async (url, init) => {
                seenCalls.push({ url, redirect: init.redirect });
                if (url.endsWith('latest-x64-win.yml')) return new Response('not found', { status: 404 });
                return new Response('version: 2.36.1\nreleaseDate: 2026-11-26\n', { status: 200 });
            };
            const resOk = await fetchRemoteManifest(ymlPath, {
                fetchImpl: mockFetch,
                platform: 'win32',
                arch: 'x64'
            });
            assert.equal(resOk.status, 'ok');
            assert.equal(resOk.latestVersion, '2.36.1');
            assert.equal(seenCalls[0].redirect, 'error');
            assert.ok(seenCalls[0].url.endsWith('/latest-x64-win.yml'));
            assert.ok(seenCalls[1].url.endsWith('/latest.yml'));

            const oversizedFetch = async () => new Response('x'.repeat(70000), { status: 200 });
            const resBig = await fetchRemoteManifest(ymlPath, {
                fetchImpl: oversizedFetch,
                platform: 'win32',
                arch: 'x64'
            });
            assert.equal(resBig.status, 'error');
            assert.match(resBig.error, /65536 bytes/);
        }

        // 2. harness_compat.json schema & privacy
        {
            const rawCompat = fs.readFileSync(path.join(repoRoot, 'harness_compat.json'), 'utf8');
            assert.ok(!rawCompat.includes('C:\\Users\\') && !rawCompat.includes('/Users/') && !rawCompat.includes('workshopId'));
            const compat = JSON.parse(rawCompat);
            assert.equal(compat.schemaVersion, 1);
            assert.ok(compareSemver(compat.lastVerifiedVersion, '0.0.0') !== null);
            assert.equal(compat.hookAnchors.length, 14);
            assert.ok(Array.isArray(compat.verifiedHistory) && compat.verifiedHistory.length > 0);
        }

        // 3. check_harness_update.mjs CLI (--json purity & exit codes)
        {
            const tmpCompat = path.join(tmp, 'compat-2.35.0.json');
            const realCompat = JSON.parse(fs.readFileSync(path.join(repoRoot, 'harness_compat.json'), 'utf8'));
            realCompat.lastVerifiedVersion = '2.35.0';
            fs.writeFileSync(tmpCompat, JSON.stringify(realCompat, null, 2));

            const asar235 = await createAuditFixtureAsar(path.join(tmp, 'chk-235'), '2.35.0');
            const shaBefore = sha256File(asar235);
            const r235 = spawnSync(process.execPath, [
                path.join(repoRoot, 'tools', 'check_harness_update.mjs'),
                '--asar', asar235, '--compat-file', tmpCompat, '--json', '--fail-on-update'
            ], { encoding: 'utf8' });
            assert.equal(r235.status, 0, r235.stderr);
            const j235 = JSON.parse(r235.stdout);
            assert.equal(j235.needsMaintenance, false);
            assert.equal(sha256File(asar235), shaBefore);

            const asar236 = await createAuditFixtureAsar(path.join(tmp, 'chk-236'), '2.36.0');
            const r236 = spawnSync(process.execPath, [
                path.join(repoRoot, 'tools', 'check_harness_update.mjs'),
                '--asar', asar236, '--compat-file', tmpCompat, '--json', '--fail-on-update'
            ], { encoding: 'utf8' });
            assert.equal(r236.status, 10, r236.stderr);
            const j236 = JSON.parse(r236.stdout);
            assert.equal(j236.needsMaintenance, true);
            assert.equal(j236.semverDiff, 'newer');
            assert.equal(j236.canAuditLocally, true);

            const rMissing = spawnSync(process.execPath, [
                path.join(repoRoot, 'tools', 'check_harness_update.mjs'),
                '--install-dir', path.join(tmp, 'no-such-dir'), '--compat-file', tmpCompat, '--json'
            ], { encoding: 'utf8' });
            assert.equal(rMissing.status, 0, rMissing.stderr);
            assert.equal(JSON.parse(rMissing.stdout).installed.found, false);
        }

        // 4. audit_harness_compat.mjs 3-mode sandbox (clean & pre-localized, with nested dist/remote/sample.js)
        {
            const tmpCompat = path.join(tmp, 'compat-audit.json');
            fs.copyFileSync(path.join(repoRoot, 'harness_compat.json'), tmpCompat);

            for (const localized of [false, true]) {
                const fDir = path.join(tmp, `audit-${localized ? 'loc' : 'clean'}`);
                const asarFile = await createAuditFixtureAsar(fDir, '2.36.0', { localized });
                const beforeSha = sha256File(asarFile);
                const run = spawnSync(process.execPath, [
                    path.join(repoRoot, 'tools', 'audit_harness_compat.mjs'),
                    '--asar', asarFile, '--compat-file', tmpCompat, '--json'
                ], { encoding: 'utf8' });
                assert.equal(run.status, 0, run.stderr || run.stdout);
                const parsed = JSON.parse(run.stdout);
                assert.equal(parsed.verdict, 'COMPATIBLE');
                assert.equal(parsed.sandboxModes.length, 3);
                assert.ok(parsed.sandboxModes.every(m => m.ok === true));
                assert.equal(sha256File(asarFile), beforeSha);
            }
        }

        // 5. audit_harness_compat.mjs broken anchors & missing ASAR
        {
            const tmpCompat = path.join(tmp, 'compat-broken.json');
            fs.copyFileSync(path.join(repoRoot, 'harness_compat.json'), tmpCompat);
            const brokenAsar = await createAuditFixtureAsar(path.join(tmp, 'audit-broken'), '2.36.0', {
                breakDebugConsole: true,
                breakTrayCount: true,
                breakUpdater: true
            });
            const run = spawnSync(process.execPath, [
                path.join(repoRoot, 'tools', 'audit_harness_compat.mjs'),
                '--asar', brokenAsar, '--compat-file', tmpCompat, '--json'
            ], { encoding: 'utf8' });
            assert.equal(run.status, 2);
            const parsed = JSON.parse(run.stdout);
            assert.equal(parsed.verdict, 'NEEDS_ADAPTATION');
            for (const id of ['devtools-debug-console', 'i18n-tray-count', 'i18n-updater-dialog']) {
                assert.ok(parsed.anchors.failed.includes(id), `Expected failed anchor: ${id}`);
            }

            const missingRun = spawnSync(process.execPath, [
                path.join(repoRoot, 'tools', 'audit_harness_compat.mjs'),
                '--asar', path.join(tmp, 'nonexistent.asar'), '--json'
            ], { encoding: 'utf8' });
            assert.equal(missingRun.status, 1);
        }

        // 6. CDP graceful degradation, shell transparency check & privacy probe
        {
            const tmpCompat = path.join(tmp, 'compat-cdp.json');
            fs.copyFileSync(path.join(repoRoot, 'harness_compat.json'), tmpCompat);
            const okAsar = await createAuditFixtureAsar(path.join(tmp, 'audit-cdp'), '2.36.0');

            const unavail = await auditHarnessCompat({
                asarPath: okAsar,
                compatFile: tmpCompat,
                enableCdp: true,
                cdpPort: 59999
            });
            assert.equal(unavail.cdp.status, 'unavailable');
            assert.equal(unavail.verdict, 'COMPATIBLE');

            const opaqueCdp = await auditHarnessCompat({
                asarPath: okAsar,
                compatFile: tmpCompat,
                enableCdp: true,
                cdpRunner: (scriptPath) => {
                    if (scriptPath.endsWith('check-wallpaper.js')) {
                        return JSON.stringify({
                            themeLoaded: true,
                            browserHole: 'false',
                            shellBg: { agyShell: 'rgb(18, 20, 24)', insetShell: 'missing' }
                        });
                    }
                    return JSON.stringify({ appVersion: '2.36.0', selectors: {}, labels: ['Settings', 'New Brand Button'] });
                }
            });
            assert.equal(opaqueCdp.cdp.status, 'ok');
            assert.equal(opaqueCdp.cdp.shellTransparencyOk, false);
            assert.equal(opaqueCdp.verdict, 'NEEDS_ADAPTATION');
            assert.ok(opaqueCdp.cdp.untranslatedCandidates.includes('New Brand Button'));

            const holeCdp = await auditHarnessCompat({
                asarPath: okAsar,
                compatFile: tmpCompat,
                enableCdp: true,
                cdpRunner: (scriptPath) => {
                    if (scriptPath.endsWith('check-wallpaper.js')) {
                        return JSON.stringify({
                            themeLoaded: true,
                            browserHole: 'true',
                            shellBg: { agyShell: 'rgb(18, 20, 24)', insetShell: 'missing' }
                        });
                    }
                    return JSON.stringify({ appVersion: '2.36.0', selectors: {}, labels: [] });
                }
            });
            assert.equal(holeCdp.verdict, 'COMPATIBLE');

            const probePath = path.join(repoRoot, 'tools', 'probe_untranslated_ui.js');
            const probeSrc = fs.readFileSync(probePath, 'utf8');
            assert.ok(probeSrc.includes('[data-testid="conversation-view"]'));
            assert.ok(probeSrc.includes('[data-testid="conversation-row-sidebar"]'));
            assert.ok(probeSrc.includes('@') && probeSrc.includes('\\.[a-z0-9]{1,8}$'));
            execFileSync(process.execPath, ['--check', probePath], { stdio: 'pipe' });
        }

        // 7. Runbook, package.json, and CI workflow checks
        {
            const ciYml = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
            assert.ok(ciYml.includes('permissions:') && ciYml.includes('contents: read'));
            assert.ok(ciYml.includes("'auto/**'") && ciYml.includes('tools/harness_maintenance_regression.mjs'));

            const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
            assert.ok(pkg.scripts['check:update'] && pkg.scripts['audit:harness'] && pkg.scripts['test:maintenance']);
            assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@electron/asar', 'minimatch']);

            const runbook = fs.readFileSync(path.join(repoRoot, 'docs', 'SELF_ITERATION_RUNBOOK.md'), 'utf8');
            for (const marker of ['-R', 'git worktree', 'Model: "pro"', 'Reviewed Commit SHA', '--draft', '--match-head-commit', 'gh pr merge']) {
                assert.ok(runbook.includes(marker), `Runbook missing marker: ${marker}`);
            }
        }

        console.log('harness maintenance regression: PASS');
    } finally {
        if (prevStore === undefined) delete process.env.AG_BASELINE_STORE;
        else process.env.AG_BASELINE_STORE = prevStore;
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

runTests();
