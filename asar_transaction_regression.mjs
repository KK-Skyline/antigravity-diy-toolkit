import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import { escape as escapeGlob } from 'minimatch';
import { wrappedFs as asarFs } from './node_modules/@electron/asar/lib/wrapped-fs.js';
import * as tx from './asar_transaction.mjs';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-asar-test-'));
// 官方原版备份仓库放进测试目录，不碰真实的用户数据目录；子进程通过 env 继承
process.env.AG_BASELINE_STORE = path.join(fixture, 'baseline-store');
const source = path.join(fixture, 'source');
const resources = path.join(fixture, 'resources');
const live = path.join(resources, 'app.asar');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const enospc = () => Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' });
const snapshot = root => {
    const entries = [];
    const visit = (dir, prefix = '') => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const name = path.posix.join(prefix, item.name);
            entries.push(item.isDirectory() ? [name, 'dir'] : [name, hash(path.join(dir, item.name))]);
            if (item.isDirectory()) visit(path.join(dir, item.name), name);
        }
    };
    visit(root);
    return entries.sort((a, b) => a[0].localeCompare(b[0]));
};
const signature = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';

try {
    fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(source, 'native'), { recursive: true });
    fs.mkdirSync(path.join(source, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(resources);
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: '2.17.0' }));
    fs.writeFileSync(path.join(source, 'dist', 'preload.js'), '/* preload */\n' + 'x'.repeat(2048));
    fs.writeFileSync(path.join(source, 'dist', 'main.js'), '/* main */');
    fs.writeFileSync(path.join(source, 'native', 'addon.node'), 'native test bytes');
    fs.writeFileSync(path.join(source, 'node_modules', 'pkg', 'addon.node'), 'package native test bytes');
    await asar.createPackageWithOptions(source, live, { unpackDir: '{native,node_modules/pkg}' });
    const originalHash = hash(live);
    assert.equal(tx.inspectArchive(live).unpacked.length, 2);
    assert.equal(tx.asarUnpackGlob(tx.inspectArchive(live).unpackedDirs), '{native,node_modules/pkg}');

    const release = tx.acquireLock(resources);
    assert.throws(() => tx.acquireLock(resources), /already running/);
    const contender = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import { acquireLock } from ${JSON.stringify(new URL('./asar_transaction.mjs', import.meta.url).href)}; acquireLock(${JSON.stringify(resources)});`],
        { encoding: 'utf8' });
    assert.notEqual(contender.status, 0);
    assert.match(contender.stderr, /already running/);
    release();
    const lockFile = path.join(resources, 'app.asar.install.lock');
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 4242, token: 'inaccessible' }));
    const kill = process.kill;
    process.kill = (pid, signal) => {
        if (pid === 4242) throw Object.assign(new Error('access denied'), { code: 'EPERM' });
        return kill(pid, signal);
    };
    try { assert.throws(() => tx.acquireLock(resources), /already running/); }
    finally { process.kill = kill; }
    fs.unlinkSync(lockFile);
    fs.writeFileSync(path.join(resources, 'app.asar.install.lock'), JSON.stringify({ pid: 999999999, token: 'stale' }));
    const recoveryGuard = path.join(resources, 'app.asar.install.lock.recovery');
    fs.mkdirSync(recoveryGuard);
    assert.throws(() => tx.acquireLock(resources), /recovery is in progress/);
    fs.writeFileSync(path.join(recoveryGuard, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'active' }));
    assert.throws(() => tx.acquireLock(resources), /recovery is in progress/);
    fs.rmSync(recoveryGuard, { recursive: true });
    const guardCrash = spawnSync(process.execPath, ['-e',
        `const fs=require('fs'); fs.mkdirSync(${JSON.stringify(recoveryGuard)}); fs.writeFileSync(${JSON.stringify(path.join(recoveryGuard, 'owner.json'))}, JSON.stringify({pid:process.pid,token:'crashed'})); process.kill(process.pid, 'SIGKILL');`],
        { encoding: 'utf8' });
    assert.notEqual(guardCrash.status, 0);
    tx.acquireLock(resources)();
    assert.equal(fs.existsSync(recoveryGuard), false);
    fs.writeFileSync(path.join(resources, 'app.asar.install.lock'), JSON.stringify({ pid: 999999999, token: 'stale' }));
    fs.mkdirSync(recoveryGuard);
    const oldGuard = new Date(Date.now() - 31000);
    fs.utimesSync(recoveryGuard, oldGuard, oldGuard);
    tx.acquireLock(resources)();
    const incompleteLock = path.join(resources, 'app.asar.install.lock');
    fs.writeFileSync(incompleteLock, '{');
    const old = new Date(Date.now() - 31000);
    fs.utimesSync(incompleteLock, old, old);
    tx.acquireLock(resources)();

    assert.throws(() => tx.prepareBaseline(resources), /explicit confirmation/);
    assert.equal(fs.existsSync(tx.baselinePointerPath(resources)), false);
    const backup = tx.prepareBaseline(resources, { confirmUnverified: true });
    const backupHash = hash(backup);
    const baselineSidecarDigest = tx.inspectArchive(backup).unpackedSha256;
    assert.equal(backupHash, originalHash);
    assert.ok(fs.existsSync(`${backup}.json`));
    assert.ok(fs.existsSync(`${backup}.unpacked`));
    assert.equal(JSON.parse(fs.readFileSync(`${backup}.json`, 'utf8')).source,
        'user-confirmed-unverified-live');
    assert.equal(JSON.parse(fs.readFileSync(tx.baselinePointerPath(resources))).userConfirmedUnverified, true);
    fs.writeFileSync(tx.baselinePointerPath(resources), JSON.stringify({ sha256: backupHash }));
    const unconfirmedPointer = fs.readFileSync(tx.baselinePointerPath(resources));
    assert.throws(() => tx.prepareBaseline(resources), /explicit confirmation/);
    assert.throws(() => tx.restore(resources), /explicit confirmation/);
    assert.deepEqual(fs.readFileSync(tx.baselinePointerPath(resources)), unconfirmedPointer);
    assert.equal(hash(live), originalHash);
    assert.equal(hash(backup), backupHash);
    fs.copyFileSync(live, `${live}.rollback`);
    assert.throws(() => tx.restore(resources), /explicit confirmation/);
    assert.equal(hash(live), originalHash);
    assert.equal(hash(`${live}.rollback`), originalHash);
    fs.writeFileSync(live, 'corrupt live');
    const corruptLive = fs.readFileSync(live);
    const namesBeforeReject = fs.readdirSync(resources).sort();
    assert.throws(() => tx.restore(resources), /explicit confirmation/);
    assert.deepEqual(fs.readdirSync(resources).sort(), namesBeforeReject);
    assert.deepEqual(fs.readFileSync(live), corruptLive);
    assert.equal(hash(`${live}.rollback`), originalHash);
    fs.copyFileSync(`${live}.rollback`, live);
    fs.unlinkSync(`${live}.rollback`);
    const legacyMetadata = { ...JSON.parse(fs.readFileSync(`${backup}.json`, 'utf8')),
        source: 'unlocalized-live' };
    fs.writeFileSync(`${backup}.json`, JSON.stringify(legacyMetadata));
    assert.throws(() => tx.restore(resources), /explicit confirmation/);
    tx.restore(resources, { confirmUnverified: true });
    const pointerFile = tx.baselinePointerPath(resources);
    assert.equal(JSON.parse(fs.readFileSync(pointerFile)).userConfirmedUnverified, true);
    assert.match(JSON.parse(fs.readFileSync(pointerFile)).metadataSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.parse(fs.readFileSync(`${backup}.json`)).source, 'user-confirmed-unverified-live');
    tx.restore(resources);
    const confirmedMetadata = fs.readFileSync(`${backup}.json`);
    const metaObject = JSON.parse(confirmedMetadata);
    const malformedMetadata = [
        { ...metaObject, sha256: '0'.repeat(64) }, { ...metaObject, size: 1 },
        { ...metaObject, version: 'forged' }, { ...metaObject, unpackedSha256: '0'.repeat(64) },
        { ...metaObject, source: 'forged-official-source' },
        { ...metaObject, source: 'user-confirmed-unverified-legacy-pair' },
        { ...metaObject, extra: true },
        ...Object.keys(metaObject).map(key => {
            const copy = { ...metaObject };
            delete copy[key];
            return copy;
        })
    ];
    for (const candidate of malformedMetadata) {
        fs.writeFileSync(`${backup}.json`, JSON.stringify(candidate));
        const beforeRejected = snapshot(resources);
        assert.throws(() => tx.prepareBaseline(resources));
        assert.throws(() => tx.restore(resources));
        assert.deepEqual(snapshot(resources), beforeRejected);
    }
    fs.writeFileSync(`${backup}.json`, confirmedMetadata);
    const confirmedPointer = JSON.parse(fs.readFileSync(pointerFile));
    for (const candidate of [
        { ...confirmedPointer, metadataSha256: '0'.repeat(64) },
        { ...confirmedPointer, extra: true },
        { userConfirmedUnverified: true },
        { sha256: backupHash, userConfirmedUnverified: 'true' },
        { sha256: backupHash, userConfirmedUnverified: false }
    ]) {
        fs.writeFileSync(tx.baselinePointerPath(resources), JSON.stringify(candidate));
        const beforeRejected = snapshot(resources);
        assert.throws(() => tx.prepareBaseline(resources));
        assert.throws(() => tx.restore(resources));
        assert.deepEqual(snapshot(resources), beforeRejected);
    }
    fs.writeFileSync(pointerFile, JSON.stringify({ sha256: backupHash, userConfirmedUnverified: true }));
    const beforeLegacyPointerReject = snapshot(resources);
    assert.throws(() => tx.restore(resources), /explicit confirmation/);
    assert.deepEqual(snapshot(resources), beforeLegacyPointerReject);
    tx.restore(resources, { confirmUnverified: true });
    assert.match(JSON.parse(fs.readFileSync(pointerFile)).metadataSha256, /^[a-f0-9]{64}$/);
    fs.writeFileSync(tx.baselinePointerPath(resources),
        JSON.stringify({ sha256: '0'.repeat(64), userConfirmedUnverified: true }));
    assert.throws(() => tx.restore(resources));
    assert.equal(hash(live), originalHash);
    assert.equal(hash(backup), backupHash);
    fs.writeFileSync(tx.baselinePointerPath(resources), unconfirmedPointer);
    assert.equal(tx.prepareBaseline(resources, { confirmUnverified: true }), backup);
    const pointerBeforeTamper = fs.readFileSync(tx.baselinePointerPath(resources));
    fs.writeFileSync(path.join(source, 'dist', 'main.js'), 'third-party edit');
    const unsignedEdit = path.join(fixture, 'unsigned-edit.asar');
    await asar.createPackageWithOptions(source, unsignedEdit, { unpackDir: '{native,node_modules/pkg}' });
    fs.copyFileSync(unsignedEdit, live);
    assert.throws(() => tx.prepareBaseline(resources), /does not match confirmed baseline/);
    assert.deepEqual(fs.readFileSync(tx.baselinePointerPath(resources)), pointerBeforeTamper);
    tx.restore(resources);
    assert.equal(hash(live), originalHash);
    fs.writeFileSync(path.join(source, 'dist', 'main.js'), '/* main */');

    const extracted = path.join(fixture, 'extracted');
    fs.mkdirSync(extracted);
    tx.extractBaseline(backup, extracted);
    fs.appendFileSync(path.join(extracted, 'dist', 'preload.js'), `\n${signature}\n`);
    await tx.packAndReplace(resources, extracted, backup);
    assert.equal(tx.inspectArchive(live).localized, true);
    assert.equal(hash(backup), backupHash);
    const legacy = path.join(fixture, 'legacy');
    fs.mkdirSync(legacy);
    fs.copyFileSync(live, path.join(legacy, 'app.asar'));
    fs.cpSync(`${live}.unpacked`, path.join(legacy, 'app.asar.unpacked'), { recursive: true });
    fs.copyFileSync(backup, path.join(legacy, 'app.asar.bak'));
    fs.copyFileSync(backup, path.join(legacy, 'app.asar.official_backup'));
    assert.throws(() => tx.prepareBaseline(legacy), /explicit confirmation/);
    assert.equal(fs.existsSync(tx.baselinePointerPath(legacy)), false);
    const importedLegacy = tx.prepareBaseline(legacy, { confirmUnverified: true });
    assert.equal(hash(importedLegacy), backupHash);
    assert.equal(JSON.parse(fs.readFileSync(`${importedLegacy}.json`, 'utf8')).source,
        'user-confirmed-unverified-legacy-pair');
    const legacyMeta = fs.readFileSync(`${importedLegacy}.json`);
    fs.writeFileSync(`${importedLegacy}.json`, JSON.stringify({ ...JSON.parse(legacyMeta),
        source: 'user-confirmed-unverified-live' }));
    const beforeLegacySourceReject = snapshot(legacy);
    assert.throws(() => tx.restore(legacy), /metadata digest mismatch/);
    assert.deepEqual(snapshot(legacy), beforeLegacySourceReject);
    fs.writeFileSync(`${importedLegacy}.json`, legacyMeta);

    const badExtract = path.join(fixture, 'bad-extracted');
    fs.cpSync(extracted, badExtract, { recursive: true });
    fs.unlinkSync(path.join(badExtract, 'dist', 'preload.js'));
    const beforeFailure = hash(live);
    await assert.rejects(tx.packAndReplace(resources, badExtract, backup));
    assert.equal(hash(live), beforeFailure);
    assert.equal(hash(backup), backupHash);

    if (process.platform === 'win32') {
        fs.renameSync(live, `${live}.rollback`);
    } else {
        const crash = spawnSync(process.execPath, ['--input-type=module', '-e',
            `import fs from 'node:fs'; import { acquireLock } from ${JSON.stringify(new URL('./asar_transaction.mjs', import.meta.url).href)}; acquireLock(${JSON.stringify(resources)}); fs.renameSync(${JSON.stringify(live)}, ${JSON.stringify(`${live}.rollback`)}); process.kill(process.pid, 'SIGKILL');`],
            { encoding: 'utf8' });
        assert.equal(crash.signal, 'SIGKILL', crash.stderr);
    }
    const releaseAfterCrash = tx.acquireLock(resources);
    tx.recover(resources);
    releaseAfterCrash();
    assert.equal(hash(live), beforeFailure);
    assert.equal(fs.existsSync(`${live}.rollback`), false);
    fs.copyFileSync(live, `${live}.rollback`);
    const unlink = fs.unlinkSync;
    fs.unlinkSync = (file, ...args) => {
        if (file === `${live}.rollback`) throw new Error('simulated rollback cleanup failure');
        return unlink(file, ...args);
    };
    try { tx.recover(resources); }
    finally { fs.unlinkSync = unlink; }
    assert.equal(hash(live), beforeFailure);
    assert.equal(fs.existsSync(`${live}.rollback`), true);
    tx.recover(resources);
    assert.equal(hash(live), beforeFailure);
    assert.equal(fs.existsSync(`${live}.rollback`), false);
    fs.copyFileSync(live, `${live}.rollback`);
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: '2.18.0' }));
    const updated = path.join(fixture, 'updated.asar');
    await asar.createPackageWithOptions(source, updated, { unpackDir: '{native,node_modules/pkg}' });
    fs.copyFileSync(updated, live);
    const updatedHash = hash(live);
    assert.throws(() => tx.recover(resources), /manual review required/);
    assert.equal(hash(live), updatedHash);
    assert.equal(hash(`${live}.rollback`), beforeFailure);
    fs.copyFileSync(`${live}.rollback`, live);
    fs.unlinkSync(`${live}.rollback`);
    fs.copyFileSync(live, `${live}.rollback`);
    fs.writeFileSync(live, 'corrupt candidate');
    tx.recover(resources);
    assert.equal(hash(live), beforeFailure);

    fs.writeFileSync(live, 'corrupt live archive');
    assert.throws(() => tx.prepareBaseline(resources));
    assert.equal(hash(backup), backupHash);
    tx.restore(resources);
    assert.equal(hash(live), originalHash);
    assert.equal(hash(backup), backupHash);
    fs.unlinkSync(live);
    tx.restore(resources);
    assert.equal(hash(live), originalHash);

    const windowsAppRunning = process.platform === 'win32' &&
        spawnSync('tasklist', ['/fi', 'imagename eq Antigravity.exe', '/nh'], { encoding: 'utf8' })
            .stdout.split(/\r?\n/).some(line => /^Antigravity\.exe\s/i.test(line.trim()));
    if (windowsAppRunning) {
        console.log('SKIP synthetic engine CLI integration: real Antigravity is running');
    } else {
    const integration = path.join(fixture, 'integration');
    const integrationResources = path.join(integration, 'resources');
    const integrationLive = path.join(integrationResources, 'app.asar');
    const safeHome = path.join(integration, 'home');
    fs.mkdirSync(integrationResources, { recursive: true });
    fs.mkdirSync(safeHome);
    fs.copyFileSync(live, integrationLive);
    fs.cpSync(`${live}.unpacked`, `${integrationLive}.unpacked`, { recursive: true });
    const enginePath = fileURLToPath(new URL('./localization_engine.js', import.meta.url));
    const env = { ...process.env, HOME: safeHome, USERPROFILE: safeHome,
        APPDATA: path.join(safeHome, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(safeHome, '.config') };
    const homedir = spawnSync(process.execPath, ['-e', "process.stdout.write(require('os').homedir())"], { env, encoding: 'utf8' });
    assert.equal(homedir.stdout, safeHome);
    const installRun = spawnSync(process.execPath, [enginePath, '--confirm-unverified-baseline', '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(installRun.status, 0, installRun.stderr);
    assert.equal(tx.inspectArchive(integrationLive).localized, true);
    const localizedHash = hash(integrationLive);
    const releaseIntegration = tx.acquireLock(integrationResources);
    const engineConfig = path.join(path.dirname(enginePath), 'wallpaper_config.json');
    const configBeforeBusy = fs.existsSync(engineConfig) ? fs.readFileSync(engineConfig) : null;
    const busyApply = spawnSync(process.execPath, [enginePath, '--wallpaper', '--hub-config',
        JSON.stringify({ workshopId: '123', opacity: 0.2 }), '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(busyApply.status, 75, busyApply.stderr);
    assert.match(busyApply.stderr, /ASAR_BUSY/);
    assert.deepEqual(fs.existsSync(engineConfig) ? fs.readFileSync(engineConfig) : null, configBeforeBusy);
    const busyRun = spawnSync(process.execPath, [enginePath, '--huifu', '--install-dir', integration], { env, encoding: 'utf8' });
    releaseIntegration();
    assert.equal(busyRun.status, 75, busyRun.stderr);
    assert.match(busyRun.stderr, /ASAR_BUSY/);
    assert.equal(hash(integrationLive), localizedHash);
    const integrationPointer = tx.baselinePointerPath(integrationResources);
    fs.writeFileSync(integrationPointer,
        JSON.stringify({ sha256: JSON.parse(fs.readFileSync(integrationPointer)).sha256 }));
    fs.copyFileSync(integrationLive, `${integrationLive}.rollback`);
    const beforeUnconfirmedCli = snapshot(integrationResources);
    for (const operation of [[], ['--huifu']]) {
        const rejected = spawnSync(process.execPath, [enginePath, ...operation, '--install-dir', integration],
            { env, encoding: 'utf8' });
        assert.equal(rejected.status, 1, rejected.stderr);
        assert.match(rejected.stderr, /explicit confirmation/);
        assert.deepEqual(snapshot(integrationResources), beforeUnconfirmedCli);
    }
    const confirmedRestore = spawnSync(process.execPath,
        [enginePath, '--huifu', '--confirm-unverified-baseline', '--install-dir', integration],
        { env, encoding: 'utf8' });
    assert.equal(confirmedRestore.status, 0, confirmedRestore.stderr);
    assert.equal(JSON.parse(fs.readFileSync(integrationPointer)).userConfirmedUnverified, true);
    assert.equal(hash(integrationLive), originalHash);
    assert.equal(fs.existsSync(`${integrationLive}.rollback`), false);
    const engineOrphan = path.join(integrationResources, `app.asar.new-999999999-${crypto.randomUUID()}`);
    fs.writeFileSync(engineOrphan, 'partial ASAR');
    const restoreRun = spawnSync(process.execPath, [enginePath, '--huifu', '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(restoreRun.status, 0, restoreRun.stderr);
    assert.equal(fs.existsSync(engineOrphan), false);
    assert.equal(hash(integrationLive), originalHash);
    assert.ok(fs.existsSync(tx.baselinePointerPath(integrationResources)));
    const runningShim = path.join(fixture, 'running-client.cjs');
    const taskkillMarker = path.join(fixture, 'unexpected-taskkill');
    fs.writeFileSync(runningShim, `Object.defineProperty(process, 'platform', { value: 'win32' });
const cp = require('node:child_process');
const real = cp.execFileSync;
cp.execFileSync = (command, args, options) => {
    if (command === 'tasklist') return 'Antigravity.exe 123 Console 1 1000 K';
    if (command === 'taskkill') { require('node:fs').writeFileSync(${JSON.stringify(taskkillMarker)}, 'called'); throw Error('unexpected taskkill'); }
    return real(command, args, options);
};`);
    if (process.platform !== 'win32') {
        // runningShim spoofs process.platform='win32', which lowercases the baseline store key;
        // mirror the already-created baseline dir under the win32-cased key so preflight finds it.
        const realStore = tx.baselineStoreDir(integrationResources);
        const winKey = crypto.createHash('sha256').update(fs.realpathSync.native(integrationResources).toLowerCase()).digest('hex').slice(0, 16);
        const winStore = path.join(path.dirname(realStore), winKey);
        if (winStore !== realStore && fs.existsSync(realStore) && !fs.existsSync(winStore)) {
            fs.cpSync(realStore, winStore, { recursive: true });
        }
    }
    const beforeRunningReject = snapshot(integrationResources);
    const configBeforeRunningReject = fs.existsSync(engineConfig) ? fs.readFileSync(engineConfig) : null;
    for (const operation of [[], ['--huifu']]) {
        const rejected = spawnSync(process.execPath,
            ['--require', runningShim, enginePath, ...operation, '--no-kill', '--install-dir', integration],
            { env, encoding: 'utf8' });
        assert.equal(rejected.status, 1, rejected.stderr);
        assert.match(rejected.stderr, /正在运行/);
        assert.deepEqual(snapshot(integrationResources), beforeRunningReject);
        assert.deepEqual(fs.existsSync(engineConfig) ? fs.readFileSync(engineConfig) : null,
            configBeforeRunningReject);
        assert.equal(fs.existsSync(taskkillMarker), false);
    }
    if (process.platform !== 'win32') {
    const macApp = path.join(fixture, 'Antigravity.app');
    fs.cpSync(integration, macApp, { recursive: true });
    fs.mkdirSync(path.join(macApp, 'Contents'), { recursive: true });
    const macResources = path.join(macApp, 'Contents', 'Resources');
    fs.renameSync(path.join(macApp, 'resources'), macResources);
    const macLive = path.join(macResources, 'app.asar');
    const macTargetExe = path.join(macApp, 'Contents', 'MacOS', 'Antigravity');
    const macDummyExe = path.join(fixture, 'unrelated', 'Antigravity');
    fs.mkdirSync(path.dirname(macTargetExe), { recursive: true });
    fs.mkdirSync(path.dirname(macDummyExe), { recursive: true });
    fs.writeFileSync(macTargetExe, 'fixture executable');
    fs.writeFileSync(macDummyExe, 'unrelated executable');
    const macState = path.join(fixture, 'mac-client-state.json');
    const macLog = path.join(fixture, 'mac-process-calls.jsonl');
    const macSelfKill = path.join(fixture, 'mac-self-kill');
    const macShim = path.join(fixture, 'mac-process-shim.cjs');
    fs.writeFileSync(macState, JSON.stringify({ running: false }));
    fs.writeFileSync(macShim, `Object.defineProperty(process, 'platform', { value: 'darwin' });
const fs = require('node:fs');
const cp = require('node:child_process');
const realExecFileSync = cp.execFileSync;
const realKill = process.kill;
process.kill = (pid, signal) => {
    if (pid === 434343) { fs.writeFileSync(${JSON.stringify(macSelfKill)}, 'unrelated process killed'); throw Error('unrelated process killed'); }
    if (pid === 424242 && signal === 'SIGTERM') {
        fs.appendFileSync(process.env.MAC_TEST_LOG, JSON.stringify({ command: 'kill', pid }) + '\\n');
        const state = JSON.parse(fs.readFileSync(process.env.MAC_TEST_STATE));
        fs.writeFileSync(process.env.MAC_TEST_STATE, JSON.stringify({ ...state, target: false }));
        return true;
    }
    return realKill(pid, signal);
};
cp.execFileSync = (command, args, options) => {
    fs.appendFileSync(process.env.MAC_TEST_LOG, JSON.stringify({ command, args }) + '\\n');
    if (command === 'pgrep' && process.env.FAKE_PGREP_MARKER) return realExecFileSync(command, args, options);
    if (command === '/usr/bin/pgrep') {
        if (args.includes('-f')) return String(process.pid) + '\\n';
        const state = JSON.parse(fs.readFileSync(process.env.MAC_TEST_STATE));
        const found = [state.self && process.pid, state.dummy && 434343, state.target && 424242].filter(Boolean);
        if (args.includes('-x') && found.length) return found.join('\\n') + '\\n';
        throw Object.assign(Error('no process'), { status: 1 });
    }
    if (command === 'ps') {
        const pid = Number(args[args.indexOf('-p') + 1]);
        const state = JSON.parse(fs.readFileSync(process.env.MAC_TEST_STATE));
        if (state.brokenPath) return 'Antigravity\\n';
        return pid === 424242 || state.spoof ? process.env.MAC_TEST_TARGET_EXE + '\\n' : process.env.MAC_TEST_DUMMY_EXE + '\\n';
    }
    if (command === '/usr/bin/osascript') {
        const pid = Number(args.at(-1));
        const state = JSON.parse(fs.readFileSync(process.env.MAC_TEST_STATE));
        if (state.nativeError) throw Error('native identity unavailable');
        if (state.nativeNil) return 'null\\n';
        if (state.nativeMulti) return '{}\\n{}\\n';
        const actual = pid === 424242 ? process.env.MAC_TEST_TARGET_EXE : process.env.MAC_TEST_DUMMY_EXE;
        return JSON.stringify({ pid: state.nativeBadPid ? pid + 1 : pid,
            path: state.nativeBadPath ? 'Antigravity' : actual }) + '\\n';
    }
    if (command === '/usr/sbin/lsof') {
        const pid = Number(args[args.indexOf('-p') + 1]);
        const state = JSON.parse(fs.readFileSync(process.env.MAC_TEST_STATE));
        const executable = pid === 424242 ? process.env.MAC_TEST_TARGET_EXE : process.env.MAC_TEST_DUMMY_EXE;
        if (state.mappedTarget && pid === 434343) return 'p' + pid + '\\nftxt\\nn' + executable + '\\nftxt\\nn' + process.env.MAC_TEST_TARGET_EXE + '\\n';
        if (state.multiText) return 'p' + pid + '\\nftxt\\nn' + executable + '\\nftxt\\nn/usr/lib/dyld\\n';
        if (state.ambiguous) return 'p' + pid + '\\nftxt\\nn' + executable + '\\nftxt\\nn' + executable + '\\n';
        return state.brokenPath ? 'p' + pid + '\\nftxt\\nnAntigravity\\n' :
            'p' + pid + '\\nftxt\\nn' + executable + '\\n';
    }
    if (command === 'pkill') {
        fs.writeFileSync(${JSON.stringify(macSelfKill)}, 'name-only kill');
        process.exit(98);
    }
    if (['xattr', 'codesign', 'open'].includes(command)) return '';
    throw Error('unexpected external command: ' + command);
};`);
    const macEnv = { ...env, MAC_TEST_STATE: macState, MAC_TEST_LOG: macLog,
        MAC_TEST_TARGET_EXE: macTargetExe, MAC_TEST_DUMMY_EXE: macDummyExe };
    const runMac = (args, installPath = macApp, extraEnv = {}) => spawnSync(process.execPath,
        ['--require', macShim, enginePath, ...args, '--install-dir', installPath],
        { env: { ...macEnv, ...extraEnv }, encoding: 'utf8' });
    const macCalls = () => fs.readFileSync(macLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    for (const operation of [[], ['--tw'], ['--huifu']]) {
        const run = runMac(operation);
        assert.equal(run.status, 0, run.stderr);
    }
    assert.equal(hash(macLive), originalHash);
    assert.equal(macCalls().some(call => call.command === 'pkill'), false);
    fs.writeFileSync(macState, JSON.stringify({ self: true }));
    const selfOnly = runMac(['--huifu']);
    assert.equal(selfOnly.status, 0, selfOnly.stderr);
    assert.equal(macCalls().some(call => call.command === 'pkill'), false);
    fs.writeFileSync(macState, JSON.stringify({ dummy: true }));
    const dummyOnly = runMac(['--huifu']);
    assert.equal(dummyOnly.status, 0, dummyOnly.stderr);
    assert.equal(fs.existsSync(macSelfKill), false);
    fs.writeFileSync(macState, JSON.stringify({ dummy: true, spoof: true, mappedTarget: true }));
    const forgedArgv = runMac(['--huifu', '--close-app']);
    assert.equal(forgedArgv.status, 0, forgedArgv.stderr);
    assert.equal(fs.existsSync(macSelfKill), false);
    assert.equal(macCalls().some(call => call.command === 'kill'), false);
    assert.equal(macCalls().some(call => call.command === 'ps'), false);
    assert.equal(macCalls().some(call => call.command === '/usr/sbin/lsof'), false);
    const fakePgrepBin = path.join(fixture, 'fake-pgrep-bin');
    const fakePgrepMarker = path.join(fixture, 'fake-pgrep-ran');
    fs.mkdirSync(fakePgrepBin);
    fs.writeFileSync(path.join(fakePgrepBin, 'pgrep'), '#!/bin/sh\nprintf ran > "$FAKE_PGREP_MARKER"\nexit 1\n',
        { mode: 0o755 });
    fs.writeFileSync(macState, JSON.stringify({ target: true }));
    const beforePathHijack = snapshot(macResources);
    const pathHijack = runMac(['--huifu'], macApp, {
        PATH: fakePgrepBin + path.delimiter + process.env.PATH, FAKE_PGREP_MARKER: fakePgrepMarker });
    assert.equal(pathHijack.status, 1, pathHijack.stderr);
    assert.match(pathHijack.stderr, /正在运行/);
    assert.equal(fs.existsSync(fakePgrepMarker), false);
    assert.deepEqual(snapshot(macResources), beforePathHijack);
    const beforeUnknownPath = snapshot(macResources);
    for (const failure of ['nativeNil', 'nativeMulti', 'nativeBadPid', 'nativeBadPath', 'nativeError']) {
        fs.writeFileSync(macState, JSON.stringify({ target: true, [failure]: true }));
        const rejected = runMac(['--huifu', '--close-app']);
        assert.equal(rejected.status, 1, `${failure}: ${rejected.stderr}`);
        assert.deepEqual(snapshot(macResources), beforeUnknownPath);
        assert.equal(macCalls().some(call => call.command === 'kill'), false);
    }
    fs.writeFileSync(macState, JSON.stringify({ target: true, multiText: true }));
    const multiTextTarget = runMac(['--huifu', '--close-app']);
    assert.equal(multiTextTarget.status, 0, multiTextTarget.stderr);
    assert.equal(JSON.parse(fs.readFileSync(macState)).target, false);
    assert.equal(macCalls().some(call => call.command === '/usr/sbin/lsof'), false);
    fs.writeFileSync(macState, JSON.stringify({ target: true, dummy: true }));
    const beforeMacNoKill = snapshot(macResources);
    const configBeforeMacNoKill = fs.existsSync(engineConfig) ? fs.readFileSync(engineConfig) : null;
    for (const operation of [[], ['--huifu']]) {
        const rejected = runMac([...operation, '--no-kill']);
        assert.equal(rejected.status, 1, rejected.stderr);
        assert.match(rejected.stderr, /正在运行/);
        assert.deepEqual(snapshot(macResources), beforeMacNoKill);
        assert.deepEqual(fs.existsSync(engineConfig) ? fs.readFileSync(engineConfig) : null,
            configBeforeMacNoKill);
    }
    const linkedResources = path.join(fixture, 'linked-resources');
    const linkedAsarDir = path.join(fixture, 'linked-asar');
    fs.symlinkSync(macResources, linkedResources, 'dir');
    fs.mkdirSync(linkedAsarDir);
    fs.symlinkSync(macLive, path.join(linkedAsarDir, 'app.asar'), 'file');
    for (const linkedPath of [linkedResources, path.join(linkedAsarDir, 'app.asar')]) {
        const rejected = runMac(['--huifu', '--confirm-unverified-baseline'], linkedPath);
        assert.equal(rejected.status, 1, rejected.stderr);
        assert.match(rejected.stderr, /正在运行/);
        assert.deepEqual(snapshot(macResources), beforeMacNoKill);
    }
    assert.equal(macCalls().some(call => call.command === 'pkill'), false);
    const closed = runMac(['--close-app']);
    assert.equal(closed.status, 0, closed.stderr);
    assert.equal(tx.inspectArchive(macLive).localized, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(macState)), { target: false, dummy: true });
    assert.equal(fs.existsSync(macSelfKill), false);
    assert.deepEqual(macCalls().filter(call => call.command === 'kill').map(call => call.pid), [424242, 424242]);
    fs.writeFileSync(macState, JSON.stringify({ target: true, dummy: true }));
    const resourcePathClose = runMac(['--huifu', '--close-app'], macResources);
    assert.equal(resourcePathClose.status, 0, resourcePathClose.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(macState)), { target: false, dummy: true });
    assert.deepEqual(macCalls().filter(call => call.command === 'kill').map(call => call.pid), [424242, 424242, 424242]);
    fs.writeFileSync(macState, JSON.stringify({ target: true, dummy: true }));
    const asarPathClose = runMac(['--huifu', '--close-app'], macLive);
    assert.equal(asarPathClose.status, 0, asarPathClose.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(macState)), { target: false, dummy: true });
    assert.deepEqual(macCalls().filter(call => call.command === 'kill').map(call => call.pid), [424242, 424242, 424242, 424242]);
    const unrelatedOnly = runMac(['--huifu', '--close-app']);
    assert.equal(unrelatedOnly.status, 0, unrelatedOnly.stderr);
    assert.deepEqual(macCalls().filter(call => call.command === 'kill').map(call => call.pid), [424242, 424242, 424242, 424242]);
    assert.ok(macCalls().filter(call => call.command.endsWith('/pgrep'))
        .every(call => JSON.stringify(call.args) === JSON.stringify(['-x', 'Antigravity'])));
    assert.ok(macCalls().some(call => call.command === '/usr/bin/pgrep'));
    assert.equal(macCalls().some(call => call.command === 'pgrep'), false);
    assert.equal(macCalls().some(call => call.command === 'pkill'), false);
    const commandCopy = path.join(fixture, 'command-copy');
    const fakeNodeBin = path.join(fixture, 'command-bin');
    fs.mkdirSync(commandCopy);
    fs.mkdirSync(fakeNodeBin);
    fs.writeFileSync(path.join(fakeNodeBin, 'node'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_FILE"\n',
        { mode: 0o755 });
    const forwarded = ['--close-app', '--confirm-unverified-baseline', 'argument with spaces'];
    for (const [script, expected] of [
        ['双击安装中文汉化.command', ['localization_engine.js', '--brand-title', 'english']],
        ['双击安装繁体中文.command', ['localization_engine.js', '--tw', '--brand-title', 'english']],
        ['双击卸载还原官方英文.command', ['localization_engine.js', '--huifu']]
    ]) {
        const source = fs.readFileSync(new URL(script, import.meta.url), 'utf8');
        assert.match(source, /exec sudo bash "\$0" "\$@"/);
        assert.ok(source.includes('if [ "$EUID" -ne 0 ]; then'));
        const copied = path.join(commandCopy, script);
        fs.writeFileSync(copied, source.replace('if [ "$EUID" -ne 0 ]; then', 'if false; then'));
        const capture = path.join(fixture, `${script}.argv`);
        const run = spawnSync('bash', [copied, ...forwarded], {
            env: { ...env, PATH: `${fakeNodeBin}${path.delimiter}${process.env.PATH}`, CAPTURE_FILE: capture },
            input: '\n\n', encoding: 'utf8', timeout: 5000
        });
        assert.equal(run.status, 0, run.stderr);
        assert.deepEqual(fs.readFileSync(capture, 'utf8').trimEnd().split('\n'),
            [...expected, '--install-dir', '/Applications/Antigravity.app', ...forwarded]);
    }
    }
    fs.rmSync(`${integrationLive}.unpacked`, { recursive: true });
    const rescueRun = spawnSync(process.execPath, [enginePath, '--huifu', '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(rescueRun.status, 0, rescueRun.stderr);
    assert.equal(hash(integrationLive), originalHash);
    assert.equal(hash(path.join(`${integrationLive}.unpacked`, 'native', 'addon.node')),
        hash(path.join(`${live}.unpacked`, 'native', 'addon.node')));
    fs.renameSync(integrationLive, `${integrationLive}.rollback`);
    fs.rmSync(`${integrationLive}.unpacked`, { recursive: true });
    const interruptedRescue = spawnSync(process.execPath, [enginePath, '--huifu', '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(interruptedRescue.status, 0, interruptedRescue.stderr);
    assert.equal(hash(integrationLive), originalHash);
    assert.equal(fs.existsSync(`${integrationLive}.rollback`), false);
    fs.copyFileSync(integrationLive, `${integrationLive}.rollback`);
    fs.rmSync(`${integrationLive}.unpacked`, { recursive: true });
    const promotedRescue = spawnSync(process.execPath, [enginePath, '--huifu', '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(promotedRescue.status, 0, promotedRescue.stderr);
    assert.equal(hash(integrationLive), originalHash);
    assert.equal(fs.existsSync(`${integrationLive}.rollback`), false);
    const preservedRollbacks = fs.readdirSync(integrationResources).filter(name => name.startsWith('app.asar.rollback.rescue-'));
    assert.equal(preservedRollbacks.length, 1);
    assert.equal(hash(path.join(integrationResources, preservedRollbacks[0])), originalHash);
    if (process.platform !== 'win32') {
        const twInstall = path.join(fixture, 'tw-install');
        const twResources = path.join(twInstall, 'resources');
        fs.mkdirSync(twResources, { recursive: true });
        fs.copyFileSync(live, path.join(twResources, 'app.asar'));
        fs.cpSync(`${live}.unpacked`, path.join(twResources, 'app.asar.unpacked'), { recursive: true });
        const twRun = spawnSync(process.execPath,
            [enginePath, '--tw', '--confirm-unverified-baseline', '--install-dir', twInstall],
            { env, encoding: 'utf8' });
        assert.equal(twRun.status, 0, twRun.stderr);
        assert.equal(tx.inspectArchive(path.join(twResources, 'app.asar')).localized, true);
        const isolatedEngine = path.join(fixture, 'isolated-engine');
        const isolatedInstall = path.join(fixture, 'isolated-install');
        const isolatedResources = path.join(isolatedInstall, 'resources');
        fs.mkdirSync(isolatedEngine);
        fs.mkdirSync(isolatedResources, { recursive: true });
        for (const name of ['localization_engine.js', 'asar_transaction.mjs', 'theme-acrylic.css']) {
            fs.copyFileSync(new URL(name, import.meta.url), path.join(isolatedEngine, name));
        }
        fs.cpSync(new URL('./dicts/', import.meta.url), path.join(isolatedEngine, 'dicts'), { recursive: true });
        fs.symlinkSync(path.join(path.dirname(enginePath), 'node_modules'), path.join(isolatedEngine, 'node_modules'), 'dir');
        fs.writeFileSync(path.join(isolatedEngine, 'wallpaper_engine_reader.js'),
            'module.exports = { getActiveWallpaper: () => null };\n');
        const isolatedConfig = path.join(isolatedEngine, 'wallpaper_config.json');
        fs.writeFileSync(isolatedConfig, JSON.stringify({ workshopId: '123', opacity: 0.4 }));
        fs.copyFileSync(live, path.join(isolatedResources, 'app.asar'));
        fs.cpSync(`${live}.unpacked`, path.join(isolatedResources, 'app.asar.unpacked'), { recursive: true });
        const hubRun = spawnSync(process.execPath, [path.join(isolatedEngine, 'localization_engine.js'),
            '--wallpaper', '--hub-config', JSON.stringify({ workshopId: '123', opacity: 0.2 }),
            '--confirm-unverified-baseline', '--install-dir', isolatedInstall], { env, encoding: 'utf8' });
        assert.equal(hubRun.status, 0, hubRun.stderr);
        assert.equal(JSON.parse(fs.readFileSync(isolatedConfig)).opacity, 0.2);
        assert.equal(tx.inspectArchive(path.join(isolatedResources, 'app.asar')).localized, true);
    }
    }

    const liveSidecar = `${live}.unpacked`;
    const liveSidecarFile = path.join(`${live}.unpacked`, 'native', 'addon.node');
    const backupSidecarHash = hash(path.join(`${backup}.unpacked`, 'native', 'addon.node'));
    const cp = fs.cpSync;
    fs.cpSync = (from, to, options) => {
        if (from === `${backup}.unpacked` && to.startsWith(`${live}.restore-`)) {
            throw new Error('simulated sidecar stage failure');
        }
        return cp(from, to, options);
    };
    try { assert.throws(() => tx.restore(resources), /simulated sidecar stage failure/); }
    finally { fs.cpSync = cp; }
    assert.equal(hash(live), originalHash);
    assert.equal(tx.inspectArchive(live).unpackedSha256, baselineSidecarDigest);
    assert.equal(fs.existsSync(`${live}.restore.pending`), false);
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (from.startsWith(`${live}.restore-`) && to === live) throw new Error('simulated ASAR swap failure');
        return rename(from, to);
    };
    try { assert.throws(() => tx.restore(resources), /simulated ASAR swap failure/); }
    finally { fs.renameSync = rename; }
    assert.equal(hash(live), originalHash);
    assert.equal(hash(liveSidecarFile), backupSidecarHash);
    assert.equal(tx.inspectArchive(live).unpackedSha256, baselineSidecarDigest);
    assert.equal(fs.existsSync(`${live}.restore.pending`), false);
    assert.equal(fs.existsSync(`${live}.unpacked.rollback`), false);

    const crashRestore = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs'; import { restore } from ${JSON.stringify(new URL('./asar_transaction.mjs', import.meta.url).href)}; const rename=fs.renameSync; fs.renameSync=(from,to)=>{ const result=rename(from,to); if (from.includes('.restore-') && to===${JSON.stringify(liveSidecar)}) process.kill(process.pid,'SIGKILL'); return result; }; restore(${JSON.stringify(resources)});`],
        { encoding: 'utf8' });
    assert.notEqual(crashRestore.status, 0);
    assert.equal(fs.existsSync(`${live}.restore.pending`), true);
    const pendingPointer = tx.baselinePointerPath(resources);
    fs.writeFileSync(pendingPointer, JSON.stringify({ sha256: backupHash }));
    fs.writeFileSync(`${backup}.json`, JSON.stringify({ ...JSON.parse(fs.readFileSync(`${backup}.json`)), source: 'unlocalized-live' }));
    const beforePendingReject = snapshot(resources);
    assert.throws(() => tx.restore(resources), /explicit confirmation/);
    assert.throws(() => tx.recover(resources), /explicit confirmation/);
    assert.deepEqual(snapshot(resources), beforePendingReject);
    tx.recover(resources, { confirmUnverified: true });
    assert.equal(JSON.parse(fs.readFileSync(pendingPointer)).userConfirmedUnverified, true);
    assert.equal(JSON.parse(fs.readFileSync(`${backup}.json`)).source, 'user-confirmed-unverified-live');
    assert.equal(hash(live), originalHash);
    assert.equal(hash(liveSidecarFile), backupSidecarHash);
    assert.equal(tx.inspectArchive(live).unpackedSha256, baselineSidecarDigest);
    assert.equal(fs.existsSync(`${live}.restore.pending`), false);

    fs.appendFileSync(liveSidecarFile, 'changed');
    tx.restore(resources);
    assert.equal(hash(live), originalHash);
    assert.equal(hash(liveSidecarFile), backupSidecarHash);
    assert.equal(tx.inspectArchive(live).unpackedSha256, baselineSidecarDigest);
    fs.rmSync(liveSidecar, { recursive: true });
    const renameMissing = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (from.startsWith(`${live}.restore-`) && to === live) throw new Error('simulated ASAR swap failure');
        return renameMissing(from, to);
    };
    try { assert.throws(() => tx.restore(resources), /simulated ASAR swap failure/); }
    finally { fs.renameSync = renameMissing; }
    assert.equal(hash(live), originalHash);
    assert.equal(fs.existsSync(liveSidecar), false);
    tx.restore(resources);
    assert.equal(hash(live), originalHash);
    assert.equal(hash(liveSidecarFile), backupSidecarHash);
    assert.equal(tx.inspectArchive(live).unpackedSha256, baselineSidecarDigest);

    const backupSidecarFile = path.join(`${backup}.unpacked`, 'native', 'addon.node');
    fs.appendFileSync(backupSidecarFile, 'corruption');
    assert.throws(() => tx.restore(resources), /verification failed|hash mismatch/);
    assert.equal(hash(live), originalHash);
    assert.equal(tx.inspectArchive(live).unpackedSha256, baselineSidecarDigest);
    fs.copyFileSync(liveSidecarFile, backupSidecarFile);
    fs.appendFileSync(backup, 'corruption');
    assert.throws(() => tx.restore(resources), /verification failed/);
    assert.equal(hash(live), originalHash);
    const packedOnly = path.join(fixture, 'packed-only');
    const packedOnlySource = path.join(packedOnly, 'source');
    const packedOnlyResources = path.join(packedOnly, 'resources');
    fs.mkdirSync(path.join(packedOnlySource, 'dist'), { recursive: true });
    fs.mkdirSync(packedOnlyResources);
    fs.writeFileSync(path.join(packedOnlySource, 'package.json'), JSON.stringify({ version: '2.17.0' }));
    fs.writeFileSync(path.join(packedOnlySource, 'dist', 'preload.js'), 'x'.repeat(2048));
    await asar.createPackage(packedOnlySource, path.join(packedOnlyResources, 'app.asar'));
    const packedOnlyHash = hash(path.join(packedOnlyResources, 'app.asar'));
    tx.prepareBaseline(packedOnlyResources, { confirmUnverified: true });
    tx.restore(packedOnlyResources);
    assert.equal(hash(path.join(packedOnlyResources, 'app.asar')), packedOnlyHash);
    const mixed = path.join(fixture, 'mixed-unpack');
    const mixedSource = path.join(mixed, 'source');
    const mixedResources = path.join(mixed, 'resources');
    const mixedLive = path.join(mixedResources, 'app.asar');
    fs.mkdirSync(path.join(mixedSource, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(mixedSource, 'node_modules', 'native-pkg'), { recursive: true });
    fs.mkdirSync(path.join(mixedSource, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(mixedSource, 'native2'), { recursive: true });
    fs.mkdirSync(path.join(mixedSource, 'weird[dir],x'), { recursive: true });
    fs.mkdirSync(mixedResources);
    fs.writeFileSync(path.join(mixedSource, 'package.json'), JSON.stringify({ version: '2.17.0' }));
    fs.writeFileSync(path.join(mixedSource, 'dist', 'preload.js'), 'x'.repeat(2048));
    fs.writeFileSync(path.join(mixedSource, 'node_modules', 'native-pkg', 'addon.node'), 'native bytes');
    fs.writeFileSync(path.join(mixedSource, 'node_modules', 'native-pkg', 'index.js'), 'packed sibling');
    fs.writeFileSync(path.join(mixedSource, 'assets', '[literal],file.node'), 'special name');
    fs.writeFileSync(path.join(mixedSource, 'assets', 'packed.js'), 'packed asset');
    fs.writeFileSync(path.join(mixedSource, 'native2', 'addon.bin'), 'whole directory');
    fs.writeFileSync(path.join(mixedSource, 'weird[dir],x', 'addon.bin'), 'special directory');
    const mixedUnpackPattern = ['node_modules/native-pkg/addon.node', 'assets/[literal],file.node']
        .map(name => escapeGlob(path.join(mixedSource, name).replaceAll('\\', '/')).replaceAll(',', '\\,'));
    await asar.createPackageWithOptions(mixedSource, mixedLive,
        { unpackDir: `{native2,${escapeGlob('weird[dir],x').replaceAll(',', '\\,')}}`,
            unpack: `{${mixedUnpackPattern.join(',')}}` });
    const mixedOriginal = tx.inspectArchive(mixedLive);
    assert.deepEqual(mixedOriginal.unpacked,
        ['assets/[literal],file.node', 'native2/addon.bin', 'node_modules/native-pkg/addon.node',
            'weird[dir],x/addon.bin']);
    assert.deepEqual(mixedOriginal.unpackedDirs, ['native2', 'weird[dir],x']);
    const mixedBackup = tx.prepareBaseline(mixedResources, { confirmUnverified: true });
    const mixedExtracted = path.join(mixed, 'extracted');
    fs.mkdirSync(mixedExtracted);
    tx.extractBaseline(mixedBackup, mixedExtracted);
    fs.appendFileSync(path.join(mixedExtracted, 'dist', 'preload.js'), `\n${signature}\n`);
    const mixedConfig = path.join(mixed, 'wallpaper_config.json');
    fs.writeFileSync(mixedConfig, JSON.stringify({ workshopId: '123', opacity: 0.4 }));
    const mixedConfigPlan = opacity => ({ file: mixedConfig, value: { workshopId: '123', opacity } });
    await tx.packAndReplace(mixedResources, mixedExtracted, mixedBackup, mixedConfigPlan(0.2));
    assert.deepEqual(tx.inspectArchive(mixedLive).unpacked, mixedOriginal.unpacked);
    assert.deepEqual(tx.inspectArchive(mixedLive).unpackedDirs, mixedOriginal.unpackedDirs);
    assert.equal(tx.inspectArchive(mixedLive).unpackedSha256, mixedOriginal.unpackedSha256);
    assert.equal(JSON.parse(fs.readFileSync(mixedConfig)).opacity, 0.2);
    const committedMixedHash = hash(mixedLive);
    const committedConfig = fs.readFileSync(mixedConfig);
    const similarAsar = path.join(mixedResources, 'app.asar.new-user-data');
    const similarConfig = `${mixedConfig}.new-user-data`;
    fs.writeFileSync(similarAsar, 'user data');
    fs.writeFileSync(similarConfig, 'user data');
    const beforeOrphan = snapshot(mixedResources);
    const orphanSidecar = path.join(mixedResources, `app.asar.new-999999999-${crypto.randomUUID()}.unpacked`);
    fs.mkdirSync(orphanSidecar);
    fs.writeFileSync(path.join(orphanSidecar, 'partial.node'), 'partial sidecar');
    if (process.platform === 'win32') {
        fs.writeFileSync(path.join(mixedResources, `app.asar.new-999999999-${crypto.randomUUID()}`), 'partial ASAR');
        fs.writeFileSync(`${mixedConfig}.new-999999999-${crypto.randomUUID()}`, 'partial config');
    } else {
        const orphanCrash = spawnSync(process.execPath, ['--input-type=module', '-e',
            `import fs from 'node:fs'; import { acquireLock, packAndReplace } from ${JSON.stringify(new URL('./asar_transaction.mjs', import.meta.url).href)}; acquireLock(${JSON.stringify(mixedResources)}); const write=fs.writeFileSync; fs.writeFileSync=(file,...args)=>{ const result=write(file,...args); if(String(file).startsWith(${JSON.stringify(`${mixedConfig}.new-`)})) process.kill(process.pid,'SIGKILL'); return result; }; await packAndReplace(${JSON.stringify(mixedResources)},${JSON.stringify(mixedExtracted)},${JSON.stringify(mixedBackup)},${JSON.stringify(mixedConfigPlan(0.3))});`],
            { encoding: 'utf8' });
        assert.equal(orphanCrash.signal, 'SIGKILL', orphanCrash.stderr);
    }
    assert.equal(fs.existsSync(path.join(mixedResources, 'app.asar.config.pending')), false);
    assert.ok(fs.readdirSync(mixedResources).some(name => /^app\.asar\.new-\d+-/.test(name)));
    assert.ok(fs.readdirSync(path.dirname(mixedConfig)).some(name => /^wallpaper_config\.json\.new-\d+-/.test(name)));
    const releaseOrphan = tx.acquireLock(mixedResources);
    try {
        tx.recover(mixedResources, { configFile: mixedConfig });
        tx.cleanupOrphanStages(mixedResources, mixedConfig);
    } finally { releaseOrphan(); }
    assert.throws(() => tx.cleanupOrphanStages(mixedResources, mixedConfig), /lock/);
    assert.deepEqual(snapshot(mixedResources), beforeOrphan);
    assert.deepEqual(fs.readFileSync(mixedConfig), committedConfig);
    assert.equal(fs.readFileSync(similarAsar, 'utf8'), 'user data');
    assert.equal(fs.readFileSync(similarConfig, 'utf8'), 'user data');
    const liveStage = path.join(mixedResources, `app.asar.new-${process.pid}-${crypto.randomUUID()}`);
    fs.writeFileSync(liveStage, 'active owner');
    const releaseLiveStage = tx.acquireLock(mixedResources);
    try { tx.cleanupOrphanStages(mixedResources, mixedConfig); }
    finally { releaseLiveStage(); }
    assert.equal(fs.readFileSync(liveStage, 'utf8'), 'active owner');
    fs.unlinkSync(liveStage);
    const beforeDiskFull = snapshot(mixedResources);
    const writeMixed = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
        if (String(file).startsWith(`${mixedConfig}.new-`)) throw enospc();
        return writeMixed(file, ...args);
    };
    try {
        await assert.rejects(tx.packAndReplace(mixedResources, mixedExtracted, mixedBackup, mixedConfigPlan(0.3)),
            { code: 'ENOSPC' });
    } finally { fs.writeFileSync = writeMixed; }
    assert.deepEqual(snapshot(mixedResources), beforeDiskFull);
    assert.deepEqual(fs.readFileSync(mixedConfig), committedConfig);
    const createAsarStream = asarFs.createWriteStream;
    asarFs.createWriteStream = (file, ...args) => {
        if (String(file).startsWith(path.join(mixedResources, 'app.asar.new-'))) {
            fs.writeFileSync(file, 'partial ASAR');
            throw enospc();
        }
        return createAsarStream(file, ...args);
    };
    try {
        await assert.rejects(tx.packAndReplace(mixedResources, mixedExtracted, mixedBackup, mixedConfigPlan(0.3)),
            { code: 'ENOSPC' });
    } finally { asarFs.createWriteStream = createAsarStream; }
    assert.deepEqual(snapshot(mixedResources), beforeDiskFull);
    assert.deepEqual(fs.readFileSync(mixedConfig), committedConfig);
    const brokenMixed = path.join(mixed, 'broken');
    fs.cpSync(mixedExtracted, brokenMixed, { recursive: true });
    fs.unlinkSync(path.join(brokenMixed, 'dist', 'preload.js'));
    await assert.rejects(tx.packAndReplace(mixedResources, brokenMixed, mixedBackup, mixedConfigPlan(0.3)));
    assert.equal(hash(mixedLive), committedMixedHash);
    assert.deepEqual(fs.readFileSync(mixedConfig), committedConfig);
    const renameMixed = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (from.startsWith(path.join(mixedResources, 'app.asar.new-')) && to === mixedLive) {
            throw enospc();
        }
        return renameMixed(from, to);
    };
    try {
        await assert.rejects(tx.packAndReplace(mixedResources, mixedExtracted, mixedBackup, mixedConfigPlan(0.3)),
            { code: 'ENOSPC' });
    } finally { fs.renameSync = renameMixed; }
    assert.deepEqual(snapshot(mixedResources), beforeDiskFull);
    assert.deepEqual(fs.readFileSync(mixedConfig), committedConfig);
    fs.renameSync = (from, to) => {
        if (to === mixedConfig && from.includes('.new-')) throw enospc();
        return renameMixed(from, to);
    };
    try {
        await assert.rejects(tx.packAndReplace(mixedResources, mixedExtracted, mixedBackup, mixedConfigPlan(0.3)),
            { code: 'ENOSPC' });
    } finally { fs.renameSync = renameMixed; }
    assert.deepEqual(snapshot(mixedResources), beforeDiskFull);
    assert.deepEqual(fs.readFileSync(mixedConfig), committedConfig);
    fs.renameSync = (from, to) => {
        const result = renameMixed(from, to);
        if (to === mixedConfig && from.includes('.new-')) throw new Error('simulated crash after config rename');
        return result;
    };
    try {
        await assert.rejects(tx.packAndReplace(mixedResources, mixedExtracted, mixedBackup, mixedConfigPlan(0.3)),
            /simulated crash after config rename/);
    } finally { fs.renameSync = renameMixed; }
    assert.equal(hash(mixedLive), committedMixedHash);
    assert.deepEqual(fs.readFileSync(mixedConfig), committedConfig);
    if (process.platform !== 'win32') {
        const configCrash = spawnSync(process.execPath, ['--input-type=module', '-e',
            `import fs from 'node:fs'; import { packAndReplace } from ${JSON.stringify(new URL('./asar_transaction.mjs', import.meta.url).href)}; const rename=fs.renameSync; fs.renameSync=(from,to)=>{ const result=rename(from,to); if(to===${JSON.stringify(mixedConfig)} && from.includes('.new-')) process.kill(process.pid,'SIGKILL'); return result; }; await packAndReplace(${JSON.stringify(mixedResources)},${JSON.stringify(mixedExtracted)},${JSON.stringify(mixedBackup)},${JSON.stringify(mixedConfigPlan(0.3))});`],
            { encoding: 'utf8' });
        assert.equal(configCrash.signal, 'SIGKILL', configCrash.stderr);
        assert.ok(fs.existsSync(path.join(mixedResources, 'app.asar.config.pending')));
        const pendingStageName = JSON.parse(fs.readFileSync(path.join(mixedResources, 'app.asar.config.pending'))).stage;
        const pendingConfigStage = path.join(path.dirname(mixedConfig), pendingStageName);
        const pendingAsarStage = path.join(mixedResources, `app.asar.new-999999999-${crypto.randomUUID()}`);
        fs.writeFileSync(pendingConfigStage, 'recoverable stage');
        fs.writeFileSync(pendingAsarStage, 'unrelated orphan');
        const beforePendingSweep = snapshot(mixedResources);
        const releasePendingSweep = tx.acquireLock(mixedResources);
        try { tx.cleanupOrphanStages(mixedResources, mixedConfig); }
        finally { releasePendingSweep(); }
        assert.deepEqual(snapshot(mixedResources), beforePendingSweep);
        assert.equal(fs.readFileSync(pendingConfigStage, 'utf8'), 'recoverable stage');
        assert.equal(fs.readFileSync(pendingAsarStage, 'utf8'), 'unrelated orphan');
        const mixedPointer = tx.baselinePointerPath(mixedResources);
        const confirmedMixedPointer = fs.readFileSync(mixedPointer);
        fs.writeFileSync(mixedPointer, JSON.stringify({ sha256: JSON.parse(confirmedMixedPointer).sha256 }));
        const beforeConfigReject = snapshot(mixedResources);
        const configBeforeReject = fs.readFileSync(mixedConfig);
        assert.throws(() => tx.recover(mixedResources, { configFile: mixedConfig }), /explicit confirmation/);
        assert.deepEqual(snapshot(mixedResources), beforeConfigReject);
        assert.deepEqual(fs.readFileSync(mixedConfig), configBeforeReject);
        fs.writeFileSync(mixedPointer, confirmedMixedPointer);
        assert.throws(() => tx.restore(mixedResources), /Unresolved ASAR config transaction/);
        tx.recover(mixedResources, { configFile: mixedConfig });
        assert.equal(hash(mixedLive), committedMixedHash);
        assert.deepEqual(fs.readFileSync(mixedConfig), committedConfig);
        const releaseAfterPending = tx.acquireLock(mixedResources);
        try { tx.cleanupOrphanStages(mixedResources, mixedConfig); }
        finally { releaseAfterPending(); }
        assert.equal(fs.existsSync(pendingAsarStage), false);
    }
    fs.unlinkSync(mixedConfig);
    fs.renameSync = (from, to) => {
        const result = renameMixed(from, to);
        if (to === mixedConfig && from.includes('.new-')) throw new Error('simulated missing-config commit crash');
        return result;
    };
    try {
        await assert.rejects(tx.packAndReplace(mixedResources, mixedExtracted, mixedBackup, mixedConfigPlan(0.5)),
            /simulated missing-config commit crash/);
    } finally { fs.renameSync = renameMixed; }
    assert.equal(fs.existsSync(mixedConfig), false);
    assert.equal(hash(mixedLive), committedMixedHash);
    for (const script of ['一键彻底还原官方英文(保底防炸).bat', '一键彻底还原官方英文(保底防炸).ps1']) {
        const content = fs.readFileSync(new URL(script, import.meta.url), 'utf8');
        assert.match(content, /localization_engine\.js/);
        assert.match(content, /--huifu/);
        assert.doesNotMatch(content, /copy \/y|Copy-Item|taskkill|Stop-Process/i);
    }
    const engine = fs.readFileSync(new URL('./localization_engine.js', import.meta.url), 'utf8');
    assert.doesNotMatch(engine, /proxy_config|injectProxyIfNeeded|restoreProxyIfNeeded/);
    assert.match(engine, /execFileSync\('open', \[installDir\], \{ stdio: 'ignore', shell: false \}\)/);
    assert.doesNotMatch(engine, /child_process\.exec\(`open/);
    if (process.platform !== 'win32') {
        const fakeBin = path.join(fixture, 'fake-bin');
        const captured = path.join(fixture, 'open-argv');
        const marker = path.join(fixture, 'injected-marker');
        fs.mkdirSync(fakeBin);
        fs.writeFileSync(path.join(fakeBin, 'open'), '#!/bin/sh\nprintf "%s" "$1" > "$CAPTURE_FILE"\n', { mode: 0o755 });
        const specialDir = path.join(fixture, 'app$(touch injected-marker)');
        fs.mkdirSync(specialDir);
        const openRun = spawnSync('open', [specialDir], { cwd: fixture, env: { ...process.env, PATH: fakeBin,
            CAPTURE_FILE: captured }, shell: false });
        assert.equal(openRun.status, 0, openRun.error?.message);
        assert.equal(fs.readFileSync(captured, 'utf8'), specialDir);
        assert.equal(fs.existsSync(marker), false);
    }
    // 旧版本把官方原版备份放在安装目录（resources）里。官方更新时旧卸载程序会把 resources 下的文件
    // 挪进 %TEMP%\nsiXXXX.tmp\old-install，备份目录名太长导致路径超过 260 字符，卸载失败并误报
    // "Antigravity 无法关闭"，永远无法更新。所以：旧布局必须整体迁移到仓库，安装目录里一个都不能留。
    {
        const legacyRes = path.join(fixture, 'legacy-layout', 'resources');
        const legacySrc = path.join(fixture, 'legacy-layout', 'source');
        fs.mkdirSync(path.join(legacySrc, 'native'), { recursive: true });
        fs.mkdirSync(path.join(legacySrc, 'dist'), { recursive: true });
        fs.mkdirSync(legacyRes, { recursive: true });
        fs.writeFileSync(path.join(legacySrc, 'package.json'), JSON.stringify({ version: '2.18.1' }));
        fs.writeFileSync(path.join(legacySrc, 'dist', 'preload.js'), '/* legacy preload */\n' + 'y'.repeat(2048));
        fs.writeFileSync(path.join(legacySrc, 'native', 'addon.node'), 'legacy native bytes');
        const legacyLive = path.join(legacyRes, 'app.asar');
        await asar.createPackageWithOptions(legacySrc, legacyLive, { unpackDir: 'native' });
        const isBaselineEntry = name => /^app\.asar\.baseline/.test(name);
        const savedStore = process.env.AG_BASELINE_STORE;
        try {
            // 1) 先在一个临时仓库里生成合法备份，再原样挪回安装目录，模拟旧版本的布局
            process.env.AG_BASELINE_STORE = path.join(fixture, 'legacy-old-store');
            const oldStore = path.dirname(tx.prepareBaseline(legacyRes, { confirmUnverified: true }));
            for (const name of fs.readdirSync(oldStore)) fs.renameSync(path.join(oldStore, name), path.join(legacyRes, name));
            assert.deepEqual(fs.readdirSync(legacyRes).filter(isBaselineEntry).map(name => name.replace(/[a-f0-9]{64}/, '<sha>')).sort(),
                ['app.asar.baseline-<sha>.bak', 'app.asar.baseline-<sha>.bak.json',
                    'app.asar.baseline-<sha>.bak.unpacked', 'app.asar.baseline.json']);
            // 2) 换成新的仓库根目录（相当于升级后第一次运行）：自动迁移，且不需要重新确认来源
            const newRoot = path.join(fixture, 'legacy-new-store');
            process.env.AG_BASELINE_STORE = newRoot;
            tx.preflightBaselineConsent(legacyRes);
            assert.deepEqual(fs.readdirSync(legacyRes).filter(isBaselineEntry), []);
            const migrated = tx.prepareBaseline(legacyRes);
            assert.ok(migrated.startsWith(newRoot + path.sep), migrated);
            assert.equal(hash(migrated), hash(legacyLive));
            assert.ok(fs.existsSync(`${migrated}.unpacked`));
            assert.equal(tx.baselineStoreDir(legacyRes), path.dirname(migrated));
        } finally {
            process.env.AG_BASELINE_STORE = savedStore;
        }
    }
    // 主流程（备份、注入、回滚、恢复）全部跑完后，安装目录里不能有任何 baseline 备份
    assert.deepEqual(fs.readdirSync(resources).filter(name => /^app\.asar\.baseline/.test(name)), []);
    const macCheck = process.platform === 'win32' ? 'Darwin shim skipped on Windows' : 'Darwin process matching and .command argv';
    console.log(`asar transaction regression: PASS (metadata digest, no-kill, ${macCheck}, ENOSPC, selective unpack, config/recovery, dead guard, busy 75, sidecar rescue, baseline outside install dir + legacy migration)`);
} finally {
    fs.rmSync(fixture, { recursive: true, force: true });
}
