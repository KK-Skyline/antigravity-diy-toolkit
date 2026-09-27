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
    fs.mkdirSync(resources);
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: '2.17.0' }));
    fs.writeFileSync(path.join(source, 'dist', 'preload.js'), '/* preload */\n' + 'x'.repeat(2048));
    fs.writeFileSync(path.join(source, 'dist', 'main.js'), '/* main */');
    fs.writeFileSync(path.join(source, 'native', 'addon.node'), 'native test bytes');
    await asar.createPackageWithOptions(source, live, { unpackDir: 'native' });
    const originalHash = hash(live);
    assert.equal(tx.inspectArchive(live).unpacked.length, 1);

    const release = tx.acquireLock(resources);
    assert.throws(() => tx.acquireLock(resources), /already running/);
    const contender = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import { acquireLock } from ${JSON.stringify(new URL('./asar_transaction.mjs', import.meta.url).href)}; acquireLock(${JSON.stringify(resources)});`],
        { encoding: 'utf8' });
    assert.notEqual(contender.status, 0);
    assert.match(contender.stderr, /already running/);
    release();
    fs.writeFileSync(path.join(resources, 'app.asar.install.lock'), JSON.stringify({ pid: 999999999, token: 'stale' }));
    const recoveryGuard = path.join(resources, 'app.asar.install.lock.recovery');
    fs.mkdirSync(recoveryGuard);
    assert.throws(() => tx.acquireLock(resources), /recovery is in progress/);
    fs.rmdirSync(recoveryGuard);
    tx.acquireLock(resources)();
    const incompleteLock = path.join(resources, 'app.asar.install.lock');
    fs.writeFileSync(incompleteLock, '{');
    const old = new Date(Date.now() - 31000);
    fs.utimesSync(incompleteLock, old, old);
    tx.acquireLock(resources)();

    const backup = tx.prepareBaseline(resources);
    const backupHash = hash(backup);
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
    await asar.createPackageWithOptions(source, updated, { unpackDir: 'native' });
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

    const integration = path.join(fixture, 'integration');
    const integrationResources = path.join(integration, 'resources');
    const integrationLive = path.join(integrationResources, 'app.asar');
    const safeHome = path.join(integration, 'home');
    fs.mkdirSync(integrationResources, { recursive: true });
    fs.mkdirSync(safeHome);
    fs.copyFileSync(live, integrationLive);
    fs.cpSync(`${live}.unpacked`, `${integrationLive}.unpacked`, { recursive: true });
    const enginePath = fileURLToPath(new URL('./localization_engine.js', import.meta.url));
    const env = { ...process.env, HOME: safeHome, XDG_CONFIG_HOME: path.join(safeHome, '.config') };
    const homedir = spawnSync(process.execPath, ['-e', "process.stdout.write(require('os').homedir())"], { env, encoding: 'utf8' });
    assert.equal(homedir.stdout, safeHome);
    const installRun = spawnSync(process.execPath, [enginePath, '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(installRun.status, 0, installRun.stderr);
    assert.equal(tx.inspectArchive(integrationLive).localized, true);
    const restoreRun = spawnSync(process.execPath, [enginePath, '--huifu', '--install-dir', integration], { env, encoding: 'utf8' });
    assert.equal(restoreRun.status, 0, restoreRun.stderr);
    assert.equal(hash(integrationLive), originalHash);
    assert.ok(fs.existsSync(path.join(integrationResources, 'app.asar.baseline.json')));

    const liveSidecarFile = path.join(`${live}.unpacked`, 'native', 'addon.node');
    fs.appendFileSync(liveSidecarFile, 'changed');
    assert.throws(() => tx.restore(resources), /sidecar/);
    assert.equal(hash(live), originalHash);
    fs.copyFileSync(path.join(`${backup}.unpacked`, 'native', 'addon.node'), liveSidecarFile);

    fs.appendFileSync(backup, 'corruption');
    assert.throws(() => tx.restore(resources), /verification failed/);
    assert.equal(hash(live), originalHash);
    for (const script of ['一键彻底还原官方英文(保底防炸).bat', '一键彻底还原官方英文(保底防炸).ps1']) {
        const content = fs.readFileSync(new URL(script, import.meta.url), 'utf8');
        assert.match(content, /localization_engine\.js/);
        assert.match(content, /--huifu/);
        assert.doesNotMatch(content, /copy \/y|Copy-Item|taskkill|Stop-Process/i);
    }
    const engine = fs.readFileSync(new URL('./localization_engine.js', import.meta.url), 'utf8');
    assert.doesNotMatch(engine, /proxy_config|injectProxyIfNeeded|restoreProxyIfNeeded/);
    console.log('asar transaction regression: PASS (cross-process lock, pack failure, rollback, installer/restore integration, retained backup, tamper)');
} finally {
    fs.rmSync(fixture, { recursive: true, force: true });
}
