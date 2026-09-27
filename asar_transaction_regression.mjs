import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import * as tx from './asar_transaction.mjs';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-asar-test-'));
const source = path.join(fixture, 'source');
const resources = path.join(fixture, 'resources');
const live = path.join(resources, 'app.asar');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
    assert.equal(tx.asarUnpackGlob(tx.inspectArchive(live).unpacked), '{native,node_modules/pkg}');

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

    const backup = tx.prepareBaseline(resources);
    const backupHash = hash(backup);
    const baselineSidecarDigest = tx.inspectArchive(backup).unpackedSha256;
    assert.equal(backupHash, originalHash);
    assert.ok(fs.existsSync(`${backup}.json`));
    assert.ok(fs.existsSync(`${backup}.unpacked`));

    const extracted = path.join(fixture, 'extracted');
    fs.mkdirSync(extracted);
    tx.extractBaseline(backup, extracted);
    fs.appendFileSync(path.join(extracted, 'dist', 'preload.js'), `\n${signature}\n`);
    await tx.packAndReplace(resources, extracted, backup);
    assert.equal(tx.inspectArchive(live).localized, true);
    assert.equal(hash(backup), backupHash);

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
    const installRun = spawnSync(process.execPath, [enginePath, '--install-dir', integration], { env, encoding: 'utf8' });
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
    const restoreRun = spawnSync(process.execPath, [enginePath, '--huifu', '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(restoreRun.status, 0, restoreRun.stderr);
    assert.equal(hash(integrationLive), originalHash);
    assert.ok(fs.existsSync(path.join(integrationResources, 'app.asar.baseline.json')));
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
    tx.recover(resources);
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
    tx.prepareBaseline(packedOnlyResources);
    tx.restore(packedOnlyResources);
    assert.equal(hash(path.join(packedOnlyResources, 'app.asar')), packedOnlyHash);
    for (const script of ['一键彻底还原官方英文(保底防炸).bat', '一键彻底还原官方英文(保底防炸).ps1']) {
        const content = fs.readFileSync(new URL(script, import.meta.url), 'utf8');
        assert.match(content, /localization_engine\.js/);
        assert.match(content, /--huifu/);
        assert.doesNotMatch(content, /copy \/y|Copy-Item|taskkill|Stop-Process/i);
    }
    const engine = fs.readFileSync(new URL('./localization_engine.js', import.meta.url), 'utf8');
    assert.doesNotMatch(engine, /proxy_config|injectProxyIfNeeded|restoreProxyIfNeeded/);
    console.log('asar transaction regression: PASS (dead guard, busy exit 75, portable unpack glob, sidecar rescue, crash rollback, tamper)');
} finally {
    fs.rmSync(fixture, { recursive: true, force: true });
}
