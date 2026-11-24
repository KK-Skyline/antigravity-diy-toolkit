import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as asar from '@electron/asar';
import { escape as escapeGlob } from 'minimatch';
import { extractSubtree as fastExtractSubtree, buildPatchedAsar } from './core/asar_fast_patch.mjs';
const literalGlob = name => escapeGlob(name).replaceAll(',', '\\,');

const SIGNATURE = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const SHA = /^[a-f0-9]{64}$/;
const livePath = dir => path.join(dir, 'app.asar');
const pointerPath = dir => path.join(baselineStoreDir(dir), 'app.asar.baseline.json');
const restoreMarkerPath = dir => path.join(dir, 'app.asar.restore.pending');
const configMarkerPath = dir => path.join(dir, 'app.asar.config.pending');
const backupPath = (dir, sha) => path.join(baselineStoreDir(dir), `app.asar.baseline-${sha}.bak`);
export const baselinePointerPath = dir => pointerPath(dir);
export const baselineBackupPath = (dir, sha) => backupPath(dir, sha);
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

// ---------- 官方原版备份（baseline）放在安装目录之外 ----------
// Antigravity 官方更新时，旧版卸载程序会先把 resources\ 下的所有文件挪进 %TEMP%\nsiXXXX.tmp\old-install。
// 备份的 app.asar.baseline-<64位哈希>.bak.unpacked 目录名很长，挪过去后大量路径超过 260 字符，
// 卸载失败，并误报"Antigravity 无法关闭，请手动关闭它"，导致永远无法更新。
// 所以备份放进用户数据目录下的独立仓库，每个安装目录一个子目录（安装路径的哈希前 16 位）。
// 测试或特殊环境可用 AG_BASELINE_STORE 指定仓库根目录。
function baselineRoot() {
    if (process.env.AG_BASELINE_STORE) return path.resolve(process.env.AG_BASELINE_STORE);
    const home = os.homedir();
    if (process.platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'antigravity2-cn', 'baselines');
    }
    if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'antigravity2-cn', 'baselines');
    return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'antigravity2-cn', 'baselines');
}

const LEGACY_BASELINE_ENTRY = /^app\.asar\.baseline(\.json|-[a-f0-9]{64}\.bak(\.json|\.unpacked)?)$/;
const migratedStores = new Set();

export function baselineStoreDir(dir) {
    const resolved = fs.existsSync(dir) ? fs.realpathSync.native(dir) : path.resolve(dir);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const store = path.join(baselineRoot(), crypto.createHash('sha256').update(key).digest('hex').slice(0, 16));
    if (!migratedStores.has(store)) {
        migrateLegacyBaseline(resolved, store);
        migratedStores.add(store);
    }
    return store;
}

function moveEntry(from, to) {
    try {
        fs.renameSync(from, to);
    } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        const temp = `${to}.new-${unique()}`;
        try {
            fs.cpSync(from, temp, { recursive: true, errorOnExist: true, force: false });
            fs.renameSync(temp, to);
        } finally {
            if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true });
        }
        fs.rmSync(from, { recursive: true });
    }
}

// 旧版本把备份放在安装目录里：搬进仓库。指针文件最后搬，中途中断时下次运行会继续。
// 备份文件名带内容哈希，仓库里已有同名文件说明内容相同，安装目录里的副本直接删掉；
// 仓库里已有指针时以仓库为准（它是更新后写的）。
function migrateLegacyBaseline(dir, store) {
    if (!fs.existsSync(dir) || path.resolve(dir) === path.resolve(store)) return;
    const legacy = fs.readdirSync(dir).filter(name => LEGACY_BASELINE_ENTRY.test(name))
        .sort((a, b) => (a === 'app.asar.baseline.json') - (b === 'app.asar.baseline.json'));
    if (!legacy.length) return;
    fs.mkdirSync(store, { recursive: true });
    for (const name of legacy) {
        const from = path.join(dir, name);
        const to = path.join(store, name);
        if (fs.existsSync(to)) fs.rmSync(from, { recursive: true });
        else moveEntry(from, to);
    }
    syncDir(store);
    syncDir(dir);
    console.warn(`[备份] 已把官方原版备份从安装目录迁移到: ${store}`);
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

export function createTransactionContext() {
    return {
        consentChecked: new Set(),
        baselines: new Map(),
        liveUnpackedSha256: null
    };
}

function inspectBaselineWithCtx(file, txCtx) {
    if (!txCtx) {
        return { info: inspectArchive(file), sha256: hashFile(file) };
    }
    const st = fs.statSync(file);
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    let entry = txCtx.baselines.get(key);
    if (!entry) {
        entry = { info: inspectArchive(file), sha256: hashFile(file) };
        txCtx.baselines.set(key, entry);
    }
    return entry;
}

export function inspectArchive(file, sidecar = `${file}.unpacked`) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1024) throw new Error(`Invalid ASAR size: ${file}`);
    asar.uncache(file);
    const { header, headerSize } = asar.getRawHeader(file);
    const raw = fs.readFileSync(file);
    const dataStart = 8 + headerSize;
    if (dataStart > raw.length || !header || typeof header.files !== 'object' || header.files === null) {
        throw new Error(`Invalid ASAR header: ${file}`);
    }

    const unpackedDirs = [];
    const unpackedEntries = [];
    let preloadBuf = null;
    let pkgBuf = null;

    const walk = (filesObj, prefix) => {
        for (const [entryName, info] of Object.entries(filesObj)) {
            const relPath = prefix ? `${prefix}/${entryName}` : entryName;
            if ('files' in info) {
                if (info.unpacked) unpackedDirs.push(relPath);
                walk(info.files, relPath);
                continue;
            }
            if ('link' in info) continue;
            if (info.unpacked) {
                unpackedEntries.push({ name: relPath, info });
                continue;
            }
            const offset = Number(info.offset);
            if (!Number.isSafeInteger(offset) || offset < 0 ||
                !Number.isSafeInteger(info.size) || info.size < 0 ||
                dataStart + offset + info.size > raw.length) {
                throw new Error(`Packed ASAR entry mismatch: ${relPath}`);
            }
            const slice = raw.subarray(dataStart + offset, dataStart + offset + info.size);
            if (info.integrity?.hash &&
                crypto.createHash('sha256').update(slice).digest('hex') !== info.integrity.hash) {
                throw new Error(`Packed ASAR entry mismatch: ${relPath}`);
            }
            if (relPath === 'dist/preload.js') preloadBuf = slice;
            else if (relPath === 'package.json') pkgBuf = slice;
        }
    };
    walk(header.files, '');

    if (!preloadBuf) throw new Error(`ASAR missing preload: ${file}`);
    if (!preloadBuf.length) throw new Error(`Empty ASAR preload: ${file}`);
    if (!pkgBuf) throw new Error(`Missing ASAR version: ${file}`);
    const pkg = JSON.parse(pkgBuf.toString());
    if (typeof pkg.version !== 'string' || !pkg.version) throw new Error(`Missing ASAR version: ${file}`);

    unpackedDirs.sort();
    unpackedEntries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const digest = crypto.createHash('sha256');
    const root = unpackedEntries.length ? fs.realpathSync(sidecar) : null;
    const unpacked = [];
    for (const { name, info } of unpackedEntries) {
        if (name.split(/[\\/]/).includes('..') || path.isAbsolute(name) || name.includes(':')) {
            throw new Error(`Unsafe unpacked path: ${name}`);
        }
        const absFile = path.join(sidecar, name);
        if (!fs.lstatSync(absFile).isFile() || !fs.realpathSync(absFile).startsWith(root + path.sep)) {
            throw new Error(`Unsafe unpacked file: ${absFile}`);
        }
        const fileSha = hashFile(absFile);
        if (info.integrity?.hash && fileSha !== info.integrity.hash) {
            throw new Error(`Unpacked ASAR entry hash mismatch: ${name}`);
        }
        digest.update(name).update('\0').update(fileSha).update('\0');
        unpacked.push(name);
    }

    return {
        size: raw.length,
        version: pkg.version,
        localized: preloadBuf.includes(SIGNATURE),
        unpacked,
        unpackedDirs,
        unpackedSha256: digest.digest('hex')
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
const metadataDigest = meta => crypto.createHash('sha256').update(JSON.stringify({
    sha256: meta.sha256, size: meta.size, source: meta.source,
    unpackedSha256: meta.unpackedSha256, version: meta.version
})).digest('hex');

function readPointer(dir) {
    const pointer = JSON.parse(fs.readFileSync(pointerPath(dir), 'utf8'));
    const keys = pointer && typeof pointer === 'object' && !Array.isArray(pointer) ? Object.keys(pointer).sort() : [];
    if (!SHA.test(pointer?.sha256) ||
        !['sha256', 'sha256,userConfirmedUnverified', 'metadataSha256,sha256,userConfirmedUnverified'].includes(keys.join(',')) ||
        ('userConfirmedUnverified' in pointer && typeof pointer.userConfirmedUnverified !== 'boolean') ||
        ('metadataSha256' in pointer && (!SHA.test(pointer.metadataSha256) || pointer.userConfirmedUnverified !== true))) {
        throw new Error('Invalid ASAR baseline pointer');
    }
    return pointer;
}

function verifyBaseline(dir, sha, { allowLegacySource = false, txCtx = null } = {}) {
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
    const { info, sha256: fileSha } = inspectBaselineWithCtx(file, txCtx);
    if (info.localized || meta.sha256 !== sha || fileSha !== sha ||
        meta.version !== info.version || meta.size !== info.size ||
        meta.unpackedSha256 !== info.unpackedSha256) {
        throw new Error(`ASAR baseline verification failed: ${file}`);
    }
    return { file, info, meta, legacySource };
}

function verifiedConfirmedBaseline(dir, { sha256, metadataSha256, userConfirmedUnverified }, confirmUnverified, txCtx = null) {
    const baseline = verifyBaseline(dir, sha256, { allowLegacySource: confirmUnverified && !metadataSha256, txCtx });
    if (metadataSha256 && metadataSha256 !== metadataDigest(baseline.meta)) {
        throw new Error('ASAR baseline metadata digest mismatch');
    }
    if (!metadataSha256 && !confirmUnverified) {
        throw new Error('Existing ASAR baseline requires explicit confirmation of unverified provenance');
    }
    let meta = baseline.meta;
    if (baseline.legacySource) {
        meta = { ...baseline.meta,
            source: baseline.meta.source === 'unlocalized-live' ?
                'user-confirmed-unverified-live' : 'user-confirmed-unverified-legacy-pair' };
        writeJson(`${baseline.file}.json`, meta);
    }
    if (userConfirmedUnverified !== true || !metadataSha256) {
        if (!confirmUnverified) throw new Error('Existing ASAR baseline requires explicit confirmation of unverified provenance');
        writeJson(pointerPath(dir), { sha256, userConfirmedUnverified: true, metadataSha256: metadataDigest(meta) });
    }
    return baseline;
}

export function preflightBaselineConsent(dir, { confirmUnverified = false, txCtx = null } = {}) {
    if (txCtx && txCtx.consentChecked.has(dir)) return;
    if (!fs.existsSync(pointerPath(dir))) {
        if (!confirmUnverified) throw new Error('New ASAR baseline requires explicit confirmation of unverified provenance');
        return;
    }
    const pointer = readPointer(dir);
    if ((pointer.userConfirmedUnverified !== true || !pointer.metadataSha256) && !confirmUnverified) {
        throw new Error('Existing ASAR baseline requires explicit confirmation of unverified provenance');
    }
    const baseline = verifyBaseline(dir, pointer.sha256,
        { allowLegacySource: confirmUnverified && !pointer.metadataSha256, txCtx });
    if (pointer.metadataSha256 && pointer.metadataSha256 !== metadataDigest(baseline.meta)) {
        throw new Error('ASAR baseline metadata digest mismatch');
    }
    if (txCtx) txCtx.consentChecked.add(dir);
}

function saveBaseline(dir, source, sidecar, label) {
    const info = inspectArchive(source, sidecar);
    if (info.localized) throw new Error('Refusing localized ASAR as clean baseline');
    const sha = hashFile(source);
    const target = backupPath(dir, sha);
    const store = path.dirname(target);
    fs.mkdirSync(store, { recursive: true });
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
            syncDir(store);
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
            syncDir(store);
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
    writeJson(pointerPath(dir), { sha256: sha, userConfirmedUnverified: true,
        metadataSha256: metadataDigest(JSON.parse(fs.readFileSync(`${target}.json`, 'utf8'))) });
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

export function prepareBaseline(dir, { confirmUnverified = false, txCtx = null } = {}) {
    preflightBaselineConsent(dir, { confirmUnverified, txCtx });
    if (fs.existsSync(configMarkerPath(dir))) throw new Error('Unresolved ASAR config transaction exists');
    const live = livePath(dir);
    const info = inspectArchive(live);
    if (txCtx) txCtx.liveUnpackedSha256 = info.unpackedSha256;
    const pointer = pointerPath(dir);
    if (!fs.existsSync(pointer)) {
        if (!confirmUnverified) throw new Error('New ASAR baseline requires explicit confirmation of unverified provenance');
        return info.localized ? importLegacy(dir, info.version, true) :
            saveBaseline(dir, live, `${live}.unpacked`, 'user-confirmed-unverified-live');
    }
    const pointerInfo = readPointer(dir);
    const baseline = verifiedConfirmedBaseline(dir, pointerInfo, confirmUnverified, txCtx);
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

export function recover(dir, { rescueSidecar = false, configFile = null, confirmUnverified = false, txCtx = null } = {}) {
    preflightBaselineConsent(dir, { confirmUnverified, txCtx });
    if (confirmUnverified && fs.existsSync(pointerPath(dir))) {
        verifiedConfirmedBaseline(dir, readPointer(dir), true, txCtx);
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

export function cleanupOrphanStages(dir, configFile) {
    const owner = JSON.parse(fs.readFileSync(path.join(dir, 'app.asar.install.lock'), 'utf8'));
    if (owner.pid !== process.pid) throw new Error('ASAR install lock is required for stage cleanup');
    if (fs.existsSync(configMarkerPath(dir)) || fs.existsSync(restoreMarkerPath(dir))) return;
    if (path.basename(configFile) !== 'wallpaper_config.json') throw new Error('Invalid config stage target');
    const suffix = '([1-9]\\d*)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
    const sweep = (root, pattern, sidecar = false) => {
        let changed = false;
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            const match = pattern.exec(entry.name);
            const pid = match && Number(match[1]);
            if (!Number.isSafeInteger(pid) || processAlive(pid)) continue;
            const file = path.join(root, entry.name);
            if (entry.isFile()) fs.unlinkSync(file);
            else if (sidecar && match[2] && entry.isDirectory()) fs.rmSync(file, { recursive: true });
            else continue;
            changed = true;
        }
        if (changed) syncDir(root);
    };
    sweep(dir, new RegExp(`^app\\.asar\\.new-${suffix}(\\.unpacked)?$`), true);
    sweep(path.dirname(configFile), new RegExp(`^wallpaper_config\\.json\\.new-${suffix}$`));
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

function replace(dir, next, keepRollback = false, { alreadyInspectedNext = false, verifiedNextSha256 = null } = {}) {
    const live = livePath(dir);
    const rollback = `${live}.rollback`;
    if (!alreadyInspectedNext) inspectArchive(next, `${live}.unpacked`);
    if (fs.existsSync(rollback)) throw new Error('Unresolved ASAR rollback exists');
    const verifyLive = () => {
        if (verifiedNextSha256) {
            if (hashFile(live) !== verifiedNextSha256) throw new Error('ASAR live post-rename hash mismatch');
        } else {
            inspectArchive(live);
        }
    };
    if (!fs.existsSync(live)) {
        if (keepRollback) throw new Error('Cannot commit ASAR/config pair without a live rollback source');
        fs.renameSync(next, live);
        syncDir(dir);
        verifyLive();
        return;
    }
    fs.renameSync(live, rollback);
    try {
        syncDir(dir);
        fs.renameSync(next, live);
        syncDir(dir);
        verifyLive();
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

export function extractSubtree(file, dest, subdirs = ['dist']) {
    return fastExtractSubtree(file, dest, subdirs);
}

function collectPatchMap(patchRootDir, subdirs = ['dist']) {
    const rootReal = fs.realpathSync(patchRootDir);
    const patchMap = new Map();
    for (const sub of subdirs) {
        const subDir = path.join(patchRootDir, sub);
        if (!fs.existsSync(subDir)) continue;
        const st = fs.lstatSync(subDir);
        if (st.isSymbolicLink() || !st.isDirectory()) {
            throw new Error(`Unsafe patch directory: ${subDir}`);
        }
        const subReal = fs.realpathSync(subDir);
        if (!subReal.startsWith(rootReal + path.sep)) {
            throw new Error(`Patch directory escapes root: ${subDir}`);
        }
        const walk = (absDir, relPosix) => {
            for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
                const absEntry = path.join(absDir, entry.name);
                const nextRel = `${relPosix}/${entry.name}`;
                if (entry.isSymbolicLink()) {
                    throw new Error(`Symlink not allowed in patch directory: ${nextRel}`);
                }
                const entryReal = fs.realpathSync(absEntry);
                if (!entryReal.startsWith(subReal + path.sep)) {
                    throw new Error(`Patch entry escapes directory: ${nextRel}`);
                }
                if (entry.isDirectory()) {
                    walk(absEntry, nextRel);
                } else if (entry.isFile()) {
                    patchMap.set(nextRel, fs.readFileSync(absEntry));
                }
            }
        };
        walk(subDir, sub);
    }
    return patchMap;
}

function commitStagedAsar(dir, next, config, original, inspectSidecar, txCtx) {
    let configStage = null;
    const configFile = config ? path.resolve(config.file) : null;
    try {
        const packed = inspectSidecar ? inspectArchive(next, inspectSidecar) : inspectArchive(next);
        if (packed.version !== original.version || !packed.localized ||
            packed.unpacked.join('\0') !== original.unpacked.join('\0') ||
            packed.unpackedDirs.join('\0') !== original.unpackedDirs.join('\0') ||
            packed.unpackedSha256 !== original.unpackedSha256) {
            throw new Error('Repacked ASAR layout/version differs from baseline');
        }
        const liveUnpackedSha = txCtx?.liveUnpackedSha256 || inspectArchive(livePath(dir)).unpackedSha256;
        if (packed.unpackedSha256 !== liveUnpackedSha) {
            throw new Error('Installed unpacked sidecar changed');
        }
        if (fs.existsSync(`${next}.unpacked`)) fs.rmSync(`${next}.unpacked`, { recursive: true });
        syncFile(next);
        const nextSha256 = hashFile(next);
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
            replace(dir, next, !!config, { alreadyInspectedNext: true, verifiedNextSha256: nextSha256 });
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

export function asarUnpackGlob(dirs) {
    const patterns = [...new Set(dirs)].map(literalGlob);
    return patterns.length === 1 ? patterns[0] : patterns.length ? `{${patterns.join(',')}}` : undefined;
}

function asarUnpackFilesGlob(files, extracted) {
    const patterns = files.map(name => literalGlob(path.join(extracted, name).replaceAll('\\', '/')));
    return patterns.length === 1 ? patterns[0] : patterns.length ? `{${patterns.join(',')}}` : undefined;
}

export async function packAndReplace(dir, extracted, baseline, config = null, txCtx = null) {
    preflightBaselineConsent(dir, { txCtx });
    const { info: original } = inspectBaselineWithCtx(baseline, txCtx);
    const next = path.join(dir, `app.asar.new-${unique()}`);
    const leafFiles = original.unpacked.filter(name =>
        !original.unpackedDirs.some(dirName => name.startsWith(`${dirName}/`)));
    try {
        await asar.createPackageWithOptions(extracted, next, {
            unpackDir: asarUnpackGlob(original.unpackedDirs),
            unpack: asarUnpackFilesGlob(leafFiles, extracted)
        });
    } catch (error) {
        if (fs.existsSync(next)) fs.unlinkSync(next);
        if (fs.existsSync(`${next}.unpacked`)) fs.rmSync(`${next}.unpacked`, { recursive: true });
        throw error;
    }
    commitStagedAsar(dir, next, config, original, null, txCtx);
}

export async function patchAndReplace(dir, patchRootDir, baseline, config = null, txCtx = null) {
    preflightBaselineConsent(dir, { txCtx });
    const { info: original } = inspectBaselineWithCtx(baseline, txCtx);
    const next = path.join(dir, `app.asar.new-${unique()}`);
    try {
        const patchMap = collectPatchMap(patchRootDir, ['dist']);
        buildPatchedAsar(baseline, patchMap, next);
    } catch (error) {
        if (fs.existsSync(next)) fs.unlinkSync(next);
        throw error;
    }
    commitStagedAsar(dir, next, config, original, `${livePath(dir)}.unpacked`, txCtx);
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
