import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as asar from '@electron/asar';
import { escape as escapeGlob } from 'minimatch';
const literalGlob = name => escapeGlob(name).replaceAll(',', '\\,');

const SIGNATURE = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const SHA = /^[a-f0-9]{64}$/;
const livePath = dir => path.join(dir, 'app.asar');
const pointerPath = dir => path.join(dir, 'app.asar.baseline.json');
const restoreMarkerPath = dir => path.join(dir, 'app.asar.restore.pending');
const configMarkerPath = dir => path.join(dir, 'app.asar.config.pending');
const backupPath = (dir, sha) => path.join(dir, `app.asar.baseline-${sha}.bak`);
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const unique = () => `${process.pid}-${crypto.randomUUID()}`;
const busyError = message => Object.assign(new Error(message), { code: 'ASAR_BUSY' });

function processAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) {
        if (error.code === 'ESRCH') return false;
        if (error.code === 'EPERM') return true;
        throw error;
    }
}

function syncFile(file) {
    const fd = fs.openSync(file, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function syncDir(dir) {
    if (process.platform === 'win32') return;
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function syncSidecar(dir, files) {
    for (const name of files) syncFile(path.join(dir, name));
    const folders = [...new Set(files.map(name => path.dirname(path.join(dir, name))))]
        .sort((a, b) => b.length - a.length);
    for (const folder of folders) syncDir(folder);
    syncDir(dir);
}

function writeJson(file, value) {
    const temp = `${file}.new-${unique()}`;
    try {
        fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
        syncFile(temp);
        fs.renameSync(temp, file);
        syncDir(path.dirname(file));
    } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}

function sidecarHash(sidecar, files) {
    const digest = crypto.createHash('sha256');
    const root = files.length ? fs.realpathSync(sidecar) : null;
    for (const name of files) {
        if (name.split(/[\\/]/).includes('..') || path.isAbsolute(name) || name.includes(':')) {
            throw new Error(`Unsafe unpacked path: ${name}`);
        }
        const file = path.join(sidecar, name);
        if (!fs.lstatSync(file).isFile() || !fs.realpathSync(file).startsWith(root + path.sep)) {
            throw new Error(`Unsafe unpacked file: ${file}`);
        }
        digest.update(name).update('\0').update(hashFile(file)).update('\0');
    }
    return digest.digest('hex');
}

export function inspectArchive(file, sidecar = `${file}.unpacked`) {
    if (!fs.statSync(file).isFile() || fs.statSync(file).size < 1024) throw new Error(`Invalid ASAR size: ${file}`);
    asar.uncache(file);
    const entries = asar.listPackage(file, { isPack: true }).map(entry => entry.replaceAll('\\', '/'));
    if (!entries.some(entry => entry.endsWith(' : /dist/preload.js'))) throw new Error(`ASAR missing preload: ${file}`);
    const unpackedDirs = entries.filter(entry => entry.startsWith('unpack : '))
        .map(entry => entry.slice('unpack : /'.length))
        .filter(name => 'files' in asar.statFile(file, name.split('/').join(path.sep))).sort();
    const unpacked = entries.filter(entry => entry.startsWith('unpack : '))
        .map(entry => entry.slice('unpack : /'.length))
        .filter(name => !('files' in asar.statFile(file, name.split('/').join(path.sep)))).sort();
    const unpackedSha256 = sidecarHash(sidecar, unpacked);
    for (const entry of entries) {
        const name = entry.slice(entry.indexOf(' : /') + 4);
        const archiveName = name.split('/').join(path.sep);
        const info = asar.statFile(file, archiveName);
        if ('files' in info || 'link' in info) continue;
        if (!info.unpacked) {
            const bytes = asar.extractFile(file, archiveName);
            if (bytes.length !== info.size ||
                (info.integrity?.hash && crypto.createHash('sha256').update(bytes).digest('hex') !== info.integrity.hash)) {
                throw new Error(`Packed ASAR entry mismatch: ${name}`);
            }
            continue;
        }
        const integrity = info.integrity;
        if (integrity?.hash && hashFile(path.join(sidecar, name)) !== integrity.hash) {
            throw new Error(`Unpacked ASAR entry hash mismatch: ${name}`);
        }
    }
    const preload = asar.extractFile(file, 'dist/preload.js');
    if (!preload.length) throw new Error(`Empty ASAR preload: ${file}`);
    const pkg = JSON.parse(asar.extractFile(file, 'package.json').toString());
    if (typeof pkg.version !== 'string' || !pkg.version) throw new Error(`Missing ASAR version: ${file}`);
    return {
        size: fs.statSync(file).size,
        version: pkg.version,
        localized: preload.includes(SIGNATURE),
        unpacked,
        unpackedDirs,
        unpackedSha256
    };
}

export function acquireLock(dir) {
    const lock = path.join(dir, 'app.asar.install.lock');
    const token = crypto.randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
            syncFile(lock);
            return () => {
                if (JSON.parse(fs.readFileSync(lock, 'utf8')).token !== token) throw new Error('ASAR lock ownership changed');
                fs.unlinkSync(lock);
            };
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const raw = fs.readFileSync(lock, 'utf8');
            let owner;
            try { owner = JSON.parse(raw); } catch (readError) {}
            if (Number.isInteger(owner?.pid) && owner.pid > 0) {
                if (processAlive(owner.pid)) throw busyError(`ASAR install already running: ${owner.pid}`);
            } else if (Date.now() - fs.statSync(lock).mtimeMs < 30000) {
                throw busyError('ASAR lock is incomplete; retry after 30 seconds');
            }
            const recoveryGuard = `${lock}.recovery`;
            const releaseGuard = acquireRecoveryGuard(recoveryGuard);
            try {
                if (fs.readFileSync(lock, 'utf8') !== raw) throw new Error('ASAR lock changed during stale recovery');
                fs.unlinkSync(lock);
            } finally {
                releaseGuard();
            }
        }
    }
    throw new Error('Could not acquire ASAR install lock');
}

function acquireRecoveryGuard(guard) {
    const ownerFile = path.join(guard, 'owner.json');
    const token = crypto.randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            fs.mkdirSync(guard);
            try {
                fs.writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
                syncFile(ownerFile);
            } catch (error) {
                if (fs.existsSync(ownerFile)) fs.unlinkSync(ownerFile);
                fs.rmdirSync(guard);
                throw error;
            }
            return () => {
                if (JSON.parse(fs.readFileSync(ownerFile, 'utf8')).token !== token) throw new Error('ASAR recovery guard ownership changed');
                fs.unlinkSync(ownerFile);
                fs.rmdirSync(guard);
            };
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            let rawOwner = null;
            try { rawOwner = fs.readFileSync(ownerFile, 'utf8'); }
            catch (readError) { if (readError.code !== 'ENOENT') throw readError; }
            let owner;
            try { owner = JSON.parse(rawOwner); } catch (readError) {}
            let observedMtime;
            try { observedMtime = fs.statSync(guard).mtimeMs; }
            catch (statError) { if (statError.code === 'ENOENT') continue; throw statError; }
            if (Number.isInteger(owner?.pid) && owner.pid > 0) {
                if (processAlive(owner.pid)) throw busyError('ASAR stale lock recovery is in progress');
            } else if (Date.now() - observedMtime < 30000) {
                throw busyError('ASAR stale lock recovery is in progress');
            }
            const abandoned = `${guard}.stale-${unique()}`;
            try { fs.renameSync(guard, abandoned); }
            catch (renameError) { if (renameError.code === 'ENOENT') continue; throw renameError; }
            let movedOwner = null;
            try { movedOwner = fs.readFileSync(path.join(abandoned, 'owner.json'), 'utf8'); }
            catch (readError) { if (readError.code !== 'ENOENT') throw readError; }
            if (movedOwner !== rawOwner || fs.statSync(abandoned).mtimeMs !== observedMtime) {
                if (!fs.existsSync(guard)) fs.renameSync(abandoned, guard);
                throw busyError('ASAR recovery guard changed during stale recovery');
            }
            fs.rmSync(abandoned, { recursive: true });
        }
    }
    throw busyError('ASAR stale lock recovery is in progress');
}

const BASELINE_SOURCES = new Set(['user-confirmed-unverified-live', 'user-confirmed-unverified-legacy-pair']);
const LEGACY_SOURCES = new Set(['unlocalized-live', 'matching-legacy-pair']);

function readPointer(dir) {
    const pointer = JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8'));
    const keys = pointer && typeof pointer === 'object' && !Array.isArray(pointer) ? Object.keys(pointer).sort() : [];
    if (!SHA.test(pointer?.sha256) ||
        (keys.join(',') !== 'sha256' && keys.join(',') !== 'sha256,userConfirmedUnverified') ||
        ('userConfirmedUnverified' in pointer && typeof pointer.userConfirmedUnverified !== 'boolean')) {
        throw new Error('Invalid ASAR baseline pointer');
    }
    return pointer;
}

function verifyBaseline(dir, sha, { allowLegacySource = false } = {}) {
    if (!SHA.test(sha)) throw new Error('Invalid ASAR baseline pointer');
    const file = backupPath(dir, sha);
    const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
    const keys = meta && typeof meta === 'object' && !Array.isArray(meta) ? Object.keys(meta).sort().join(',') : '';
    const legacySource = LEGACY_SOURCES.has(meta?.source);
    if (keys !== 'sha256,size,source,unpackedSha256,version' ||
        !Number.isSafeInteger(meta.size) || meta.size <= 0 ||
        typeof meta.version !== 'string' || !meta.version || !SHA.test(meta.unpackedSha256) ||
        (!BASELINE_SOURCES.has(meta.source) && !(allowLegacySource && legacySource))) {
        throw new Error('Invalid ASAR baseline metadata');
    }
    const info = inspectArchive(file);
    if (info.localized || meta.sha256 !== sha || hashFile(file) !== sha ||
        meta.version !== info.version || meta.size !== info.size ||
        meta.unpackedSha256 !== info.unpackedSha256) {
        throw new Error(`ASAR baseline verification failed: ${file}`);
    }
    return { file, info, meta, legacySource };
}

function verifiedConfirmedBaseline(dir, { sha256, userConfirmedUnverified }, confirmUnverified) {
    const baseline = verifyBaseline(dir, sha256, { allowLegacySource: confirmUnverified });
    if (baseline.legacySource) {
        writeJson(`${baseline.file}.json`, { ...baseline.meta,
            source: baseline.meta.source === 'unlocalized-live' ?
                'user-confirmed-unverified-live' : 'user-confirmed-unverified-legacy-pair' });
    }
    if (userConfirmedUnverified !== true) {
        if (!confirmUnverified) throw new Error('Existing ASAR baseline requires explicit confirmation of unverified provenance');
        writeJson(pointerPath(dir), { sha256, userConfirmedUnverified: true });
    }
    return baseline;
}

export function preflightBaselineConsent(dir, { confirmUnverified = false } = {}) {
    if (!fs.existsSync(pointerPath(dir))) {
        if (!confirmUnverified) throw new Error('New ASAR baseline requires explicit confirmation of unverified provenance');
        return;
    }
    const pointer = readPointer(dir);
    if (pointer.userConfirmedUnverified !== true && !confirmUnverified) {
        throw new Error('Existing ASAR baseline requires explicit confirmation of unverified provenance');
    }
    verifyBaseline(dir, pointer.sha256, { allowLegacySource: confirmUnverified });
}

function saveBaseline(dir, source, sidecar, label) {
    const info = inspectArchive(source, sidecar);
    if (info.localized) throw new Error('Refusing localized ASAR as clean baseline');
    const sha = hashFile(source);
    const target = backupPath(dir, sha);
    if (!fs.existsSync(target)) {
        const temp = `${target}.new-${unique()}`;
        try {
            fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
            if (info.unpacked.length) fs.cpSync(sidecar, `${temp}.unpacked`, { recursive: true, errorOnExist: true, force: false });
            if (hashFile(temp) !== sha) throw new Error('ASAR baseline copy hash mismatch');
            inspectArchive(temp);
            syncFile(temp);
            if (info.unpacked.length) syncSidecar(`${temp}.unpacked`, info.unpacked);
            fs.renameSync(temp, target);
            if (info.unpacked.length) fs.renameSync(`${temp}.unpacked`, `${target}.unpacked`);
            syncDir(dir);
        } finally {
            if (fs.existsSync(temp)) fs.unlinkSync(temp);
            if (fs.existsSync(`${temp}.unpacked`)) fs.rmSync(`${temp}.unpacked`, { recursive: true });
        }
    }
    if (info.unpacked.length && !fs.existsSync(`${target}.unpacked`)) {
        const stagedSidecar = `${target}.unpacked.new-${unique()}`;
        try {
            fs.cpSync(sidecar, stagedSidecar, { recursive: true, errorOnExist: true, force: false });
            if (sidecarHash(stagedSidecar, info.unpacked) !== info.unpackedSha256) {
                throw new Error('ASAR baseline sidecar copy hash mismatch');
            }
            syncSidecar(stagedSidecar, info.unpacked);
            fs.renameSync(stagedSidecar, `${target}.unpacked`);
            syncDir(dir);
        } finally {
            if (fs.existsSync(stagedSidecar)) fs.rmSync(stagedSidecar, { recursive: true });
        }
    }
    if (!fs.existsSync(`${target}.json`)) writeJson(`${target}.json`, {
        sha256: sha, size: info.size, version: info.version,
        unpackedSha256: info.unpackedSha256, source: label
    });
    const saved = verifyBaseline(dir, sha, { allowLegacySource: true });
    if (saved.legacySource) writeJson(`${target}.json`, { ...saved.meta, source: label });
    verifyBaseline(dir, sha);
    writeJson(pointerPath(dir), { sha256: sha, userConfirmedUnverified: true });
    return target;
}

function importLegacy(dir, version, confirmUnverified) {
    if (!confirmUnverified) throw new Error('Legacy ASAR backups require explicit confirmation of unverified provenance');
    const first = path.join(dir, 'app.asar.bak');
    const second = path.join(dir, 'app.asar.official_backup');
    if (!fs.existsSync(first) || !fs.existsSync(second) || hashFile(first) !== hashFile(second)) {
        throw new Error('No verified baseline; matching legacy backups are required');
    }
    const info = inspectArchive(first, `${livePath(dir)}.unpacked`);
    if (info.localized || (version && info.version !== version)) throw new Error('Legacy baseline does not match installed app');
    console.warn('[备份] 用户已确认导入两份一致的旧备份；工具未验证其官方来源。');
    return saveBaseline(dir, first, `${livePath(dir)}.unpacked`, 'user-confirmed-unverified-legacy-pair');
}

export function prepareBaseline(dir, { confirmUnverified = false } = {}) {
    preflightBaselineConsent(dir, { confirmUnverified });
    if (fs.existsSync(configMarkerPath(dir))) throw new Error('Unresolved ASAR config transaction exists');
    const live = livePath(dir);
    const info = inspectArchive(live);
    const pointer = pointerPath(dir);
    if (!fs.existsSync(pointer)) {
        if (!confirmUnverified) throw new Error('New ASAR baseline requires explicit confirmation of unverified provenance');
        return info.localized ? importLegacy(dir, info.version, true) :
            saveBaseline(dir, live, `${live}.unpacked`, 'user-confirmed-unverified-live');
    }
    const pointerInfo = readPointer(dir);
    const baseline = verifiedConfirmedBaseline(dir, pointerInfo, confirmUnverified);
    const { sha256 } = pointerInfo;
    if (!info.localized) {
        if (hashFile(live) === sha256 && info.unpackedSha256 === baseline.info.unpackedSha256) return baseline.file;
        if (!confirmUnverified) throw new Error('Unlocalized ASAR does not match confirmed baseline; explicit confirmation required');
        return saveBaseline(dir, live, `${live}.unpacked`, 'user-confirmed-unverified-live');
    }
    if (baseline.info.version !== info.version || baseline.info.unpackedSha256 !== info.unpackedSha256) {
        throw new Error('Installed ASAR differs from verified baseline version/sidecar');
    }
    return baseline.file;
}

function recoverPendingConfig(dir, configFile) {
    const markerFile = configMarkerPath(dir);
    if (!fs.existsSync(markerFile)) return;
    const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    if (marker.mode !== 'config' || !configFile || marker.file !== path.resolve(configFile) ||
        typeof marker.hadConfig !== 'boolean' || typeof marker.original !== 'string' ||
        typeof marker.originalSha256 !== 'string' ||
        !/^wallpaper_config\.json\.new-[0-9a-f-]+$/.test(marker.stage)) {
        throw new Error('Invalid ASAR config marker; manual review required');
    }
    const original = Buffer.from(marker.original, 'base64');
    if (crypto.createHash('sha256').update(original).digest('hex') !== marker.originalSha256) {
        throw new Error('ASAR config rollback hash mismatch');
    }
    const live = livePath(dir);
    const rollback = `${live}.rollback`;
    let discarded = null;
    if (fs.existsSync(rollback)) {
        if (fs.existsSync(live)) {
            discarded = `${live}.failed-${unique()}`;
            fs.renameSync(live, discarded);
        }
        fs.renameSync(rollback, live);
        syncDir(dir);
        inspectArchive(live);
    } else {
        inspectArchive(live);
    }
    const target = path.resolve(configFile);
    if (marker.hadConfig) {
        const stagedRestore = `${target}.restore-${unique()}`;
        try {
            fs.writeFileSync(stagedRestore, original, { flag: 'wx' });
            syncFile(stagedRestore);
            fs.renameSync(stagedRestore, target);
            syncDir(path.dirname(target));
        } finally {
            if (fs.existsSync(stagedRestore)) fs.unlinkSync(stagedRestore);
        }
    } else if (fs.existsSync(target)) {
        fs.unlinkSync(target);
        syncDir(path.dirname(target));
    }
    const stage = path.join(path.dirname(target), marker.stage);
    if (fs.existsSync(stage)) fs.unlinkSync(stage);
    fs.unlinkSync(markerFile);
    syncDir(dir);
    if (discarded) fs.unlinkSync(discarded);
}

export function recover(dir, { rescueSidecar = false, configFile = null, confirmUnverified = false } = {}) {
    preflightBaselineConsent(dir, { confirmUnverified });
    if (confirmUnverified && fs.existsSync(pointerPath(dir))) {
        verifiedConfirmedBaseline(dir, readPointer(dir), true);
    }
    recoverPendingConfig(dir, configFile);
    if (fs.existsSync(restoreMarkerPath(dir))) recoverPendingRestore(dir);
    const live = livePath(dir);
    const rollback = `${live}.rollback`;
    if (!fs.existsSync(rollback)) return;
    let previous;
    try { previous = inspectArchive(rollback, `${live}.unpacked`); }
    catch (error) {
        if (!fs.existsSync(pointerPath(dir))) throw error;
        const { sha256 } = JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8'));
        verifyBaseline(dir, sha256);
        if (fs.existsSync(live)) {
            if (!rescueSidecar) throw error;
            const preserved = `${rollback}.rescue-${unique()}`;
            fs.renameSync(rollback, preserved);
            console.warn(`[ASAR] 保留无法与当前 sidecar 校验的回滚包: ${preserved}`);
        } else {
            fs.renameSync(rollback, live);
        }
        syncDir(dir);
        return;
    }
    if (fs.existsSync(live)) {
        let current;
        try {
            current = inspectArchive(live);
        } catch (error) {}
        if (current && (current.version !== previous.version ||
            current.unpackedSha256 !== previous.unpackedSha256)) {
            throw new Error('Valid live ASAR differs from pending rollback; manual review required');
        }
        if (current) {
            try { fs.unlinkSync(rollback); syncDir(dir); }
            catch (error) { console.warn(`[ASAR] 回滚文件清理失败: ${error.message}`); }
            return;
        }
        fs.renameSync(live, `${live}.corrupt-${unique()}`);
    }
    fs.renameSync(rollback, live);
    syncDir(dir);
    inspectArchive(live);
}

function readRestoreMarker(dir) {
    const marker = JSON.parse(fs.readFileSync(restoreMarkerPath(dir), 'utf8'));
    if (marker.mode !== 'restore' || !SHA.test(marker.sha256) ||
        !/^app\.asar\.restore-[0-9a-f-]+$/.test(marker.next) ||
        typeof marker.hadLive !== 'boolean' || typeof marker.hadSidecar !== 'boolean') {
        throw new Error('Invalid ASAR restore marker; manual review required');
    }
    return { ...marker, next: path.join(dir, marker.next) };
}

function cleanupRestore(dir, marker) {
    const live = livePath(dir);
    if (fs.existsSync(`${live}.rollback`)) fs.unlinkSync(`${live}.rollback`);
    if (fs.existsSync(`${live}.unpacked.rollback`)) fs.rmSync(`${live}.unpacked.rollback`, { recursive: true });
    if (fs.existsSync(marker.next)) fs.unlinkSync(marker.next);
    if (fs.existsSync(`${marker.next}.unpacked`)) fs.rmSync(`${marker.next}.unpacked`, { recursive: true });
    fs.unlinkSync(restoreMarkerPath(dir));
    syncDir(dir);
}

function recoverPendingRestore(dir) {
    const marker = readRestoreMarker(dir);
    const baseline = verifyBaseline(dir, marker.sha256);
    const live = livePath(dir);
    const sidecar = `${live}.unpacked`;
    let restored = false;
    try {
        const info = inspectArchive(live);
        restored = fs.existsSync(sidecar) && hashFile(live) === marker.sha256 &&
            info.unpackedSha256 === baseline.info.unpackedSha256;
    } catch (error) {}
    if (restored) {
        cleanupRestore(dir, marker);
        return;
    }
    const discarded = [];
    if (fs.existsSync(`${live}.rollback`)) {
        if (fs.existsSync(live)) {
            const failed = `${live}.failed-${unique()}`;
            fs.renameSync(live, failed);
            discarded.push(failed);
        }
        fs.renameSync(`${live}.rollback`, live);
    } else if (!marker.hadLive && fs.existsSync(live)) {
        const failed = `${live}.failed-${unique()}`;
        fs.renameSync(live, failed);
        discarded.push(failed);
    } else if (marker.hadLive && !fs.existsSync(live)) {
        throw new Error('Original ASAR is missing during restore rollback');
    }
    if (fs.existsSync(`${sidecar}.rollback`)) {
        if (fs.existsSync(sidecar)) {
            const failed = `${sidecar}.failed-${unique()}`;
            fs.renameSync(sidecar, failed);
            discarded.push(failed);
        }
        fs.renameSync(`${sidecar}.rollback`, sidecar);
    } else if (!marker.hadSidecar && fs.existsSync(sidecar)) {
        const failed = `${sidecar}.failed-${unique()}`;
        fs.renameSync(sidecar, failed);
        discarded.push(failed);
    } else if (marker.hadSidecar && !fs.existsSync(sidecar)) {
        throw new Error('Original ASAR sidecar is missing during restore rollback');
    }
    syncDir(dir);
    cleanupRestore(dir, marker);
    for (const failed of discarded) fs.rmSync(failed, { recursive: true });
}

function replace(dir, next, keepRollback = false) {
    const live = livePath(dir);
    const rollback = `${live}.rollback`;
    inspectArchive(next, `${live}.unpacked`);
    if (fs.existsSync(rollback)) throw new Error('Unresolved ASAR rollback exists');
    if (!fs.existsSync(live)) {
        if (keepRollback) throw new Error('Cannot commit ASAR/config pair without a live rollback source');
        fs.renameSync(next, live);
        syncDir(dir);
        inspectArchive(live);
        return;
    }
    fs.renameSync(live, rollback);
    try {
        syncDir(dir);
        fs.renameSync(next, live);
        syncDir(dir);
        inspectArchive(live);
    } catch (error) {
        if (fs.existsSync(live)) fs.renameSync(live, `${next}.failed`);
        if (fs.existsSync(rollback)) fs.renameSync(rollback, live);
        syncDir(dir);
        throw error;
    }
    if (!keepRollback) {
        try { fs.unlinkSync(rollback); syncDir(dir); }
        catch (error) { console.warn(`[ASAR] 新包已验证，但旧包清理失败: ${error.message}`); }
    }
}

export function extractBaseline(file, dest) { asar.extractAll(file, dest); }

export function asarUnpackGlob(dirs) {
    const patterns = [...new Set(dirs)].map(literalGlob);
    return patterns.length === 1 ? patterns[0] : patterns.length ? `{${patterns.join(',')}}` : undefined;
}

function asarUnpackFilesGlob(files, extracted) {
    const patterns = files.map(name => literalGlob(path.join(extracted, name).replaceAll('\\', '/')));
    return patterns.length === 1 ? patterns[0] : patterns.length ? `{${patterns.join(',')}}` : undefined;
}

export async function packAndReplace(dir, extracted, baseline, config = null) {
    preflightBaselineConsent(dir);
    const original = inspectArchive(baseline);
    const next = path.join(dir, `app.asar.new-${unique()}`);
    let configStage = null;
    const configFile = config ? path.resolve(config.file) : null;
    try {
        const leafFiles = original.unpacked.filter(name =>
            !original.unpackedDirs.some(dirName => name.startsWith(`${dirName}/`)));
        await asar.createPackageWithOptions(extracted, next, {
            unpackDir: asarUnpackGlob(original.unpackedDirs),
            unpack: asarUnpackFilesGlob(leafFiles, extracted)
        });
        const packed = inspectArchive(next);
        if (packed.version !== original.version || !packed.localized ||
            packed.unpacked.join('\0') !== original.unpacked.join('\0') ||
            packed.unpackedDirs.join('\0') !== original.unpackedDirs.join('\0') ||
            packed.unpackedSha256 !== original.unpackedSha256) {
            throw new Error('Repacked ASAR layout/version differs from baseline');
        }
        if (packed.unpackedSha256 !== inspectArchive(livePath(dir)).unpackedSha256) {
            throw new Error('Installed unpacked sidecar changed');
        }
        if (fs.existsSync(`${next}.unpacked`)) fs.rmSync(`${next}.unpacked`, { recursive: true });
        syncFile(next);
        let markerWritten = false;
        if (config) {
            if (fs.existsSync(configMarkerPath(dir))) throw new Error('Unresolved ASAR config transaction exists');
            const originalConfig = fs.existsSync(configFile) ? fs.readFileSync(configFile) : null;
            configStage = `${configFile}.new-${unique()}`;
            fs.writeFileSync(configStage, JSON.stringify(config.value, null, 2), { flag: 'wx' });
            syncFile(configStage);
            syncDir(path.dirname(configFile));
            writeJson(configMarkerPath(dir), { mode: 'config', file: configFile,
                hadConfig: originalConfig !== null, original: originalConfig?.toString('base64') || '',
                originalSha256: crypto.createHash('sha256').update(originalConfig || Buffer.alloc(0)).digest('hex'),
                stage: path.basename(configStage) });
            markerWritten = true;
        }
        try {
            replace(dir, next, !!config);
            if (config) {
                fs.renameSync(configStage, configFile);
                syncDir(path.dirname(configFile));
                fs.unlinkSync(configMarkerPath(dir));
                syncDir(dir);
                try { fs.unlinkSync(`${livePath(dir)}.rollback`); syncDir(dir); }
                catch (error) { console.warn(`[ASAR] 已提交配置与新包，旧包清理失败: ${error.message}`); }
            }
        } catch (error) {
            if (markerWritten) {
                try { recoverPendingConfig(dir, configFile); }
                catch (rollbackError) { throw new AggregateError([error, rollbackError], 'ASAR/config rollback failed'); }
            }
            throw error;
        }
    } finally {
        if (fs.existsSync(next)) fs.unlinkSync(next);
        if (fs.existsSync(`${next}.unpacked`)) fs.rmSync(`${next}.unpacked`, { recursive: true });
        if (configStage && fs.existsSync(configStage)) fs.unlinkSync(configStage);
    }
}

export function restore(dir, { confirmUnverified = false } = {}) {
    preflightBaselineConsent(dir, { confirmUnverified });
    if (confirmUnverified && fs.existsSync(pointerPath(dir))) {
        verifiedConfirmedBaseline(dir, readPointer(dir), true);
    }
    if (fs.existsSync(configMarkerPath(dir))) throw new Error('Unresolved ASAR config transaction exists');
    if (fs.existsSync(restoreMarkerPath(dir))) recoverPendingRestore(dir);
    if (fs.existsSync(`${livePath(dir)}.rollback`)) recover(dir, { rescueSidecar: true, confirmUnverified });
    const pointer = pointerPath(dir);
    if (!fs.existsSync(pointer)) importLegacy(dir, null, confirmUnverified);
    const pointerInfo = readPointer(dir);
    const baseline = verifiedConfirmedBaseline(dir, pointerInfo, confirmUnverified);
    const { sha256 } = pointerInfo;
    const live = livePath(dir);
    const next = path.join(dir, `app.asar.restore-${unique()}`);
    const nextSidecar = `${next}.unpacked`;
    const sidecar = `${live}.unpacked`;
    try {
        fs.copyFileSync(baseline.file, next, fs.constants.COPYFILE_EXCL);
        if (baseline.info.unpacked.length) {
            fs.cpSync(`${baseline.file}.unpacked`, nextSidecar, { recursive: true, errorOnExist: true, force: false });
        } else {
            fs.mkdirSync(nextSidecar);
        }
        if (hashFile(next) !== sha256) throw new Error('ASAR restore copy hash mismatch');
        const staged = inspectArchive(next);
        if (staged.unpackedSha256 !== baseline.info.unpackedSha256) throw new Error('ASAR restore sidecar copy hash mismatch');
        syncFile(next);
        syncSidecar(nextSidecar, staged.unpacked);
        const marker = { mode: 'restore', sha256, next: path.basename(next),
            hadLive: fs.existsSync(live), hadSidecar: fs.existsSync(sidecar) };
        if (fs.existsSync(restoreMarkerPath(dir)) || fs.existsSync(`${live}.rollback`) ||
            fs.existsSync(`${sidecar}.rollback`)) throw new Error('Unresolved ASAR transaction exists');
        writeJson(restoreMarkerPath(dir), marker);
        try {
            if (marker.hadLive) fs.renameSync(live, `${live}.rollback`);
            if (marker.hadSidecar) fs.renameSync(sidecar, `${sidecar}.rollback`);
            fs.renameSync(nextSidecar, sidecar);
            fs.renameSync(next, live);
            syncDir(dir);
            if (hashFile(live) !== sha256 ||
                inspectArchive(live).unpackedSha256 !== baseline.info.unpackedSha256) {
                throw new Error('ASAR restore pair verification failed');
            }
            recoverPendingRestore(dir);
        } catch (error) {
            try { recoverPendingRestore(dir); }
            catch (rollbackError) { throw new AggregateError([error, rollbackError], 'ASAR restore and rollback failed'); }
            throw error;
        }
    } finally {
        if (fs.existsSync(next)) fs.unlinkSync(next);
        if (fs.existsSync(nextSidecar)) fs.rmSync(nextSidecar, { recursive: true });
    }
}
