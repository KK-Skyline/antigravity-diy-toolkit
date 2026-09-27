import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as asar from '@electron/asar';

const SIGNATURE = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const SHA = /^[a-f0-9]{64}$/;
const livePath = dir => path.join(dir, 'app.asar');
const pointerPath = dir => path.join(dir, 'app.asar.baseline.json');
const backupPath = (dir, sha) => path.join(dir, `app.asar.baseline-${sha}.bak`);
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const unique = () => `${process.pid}-${crypto.randomUUID()}`;

function syncFile(file) {
    const fd = fs.openSync(file, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function syncDir(dir) {
    if (process.platform === 'win32') return;
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
    const entries = asar.listPackage(file, { isPack: true });
    if (!entries.some(entry => entry.endsWith(' : /dist/preload.js'))) throw new Error(`ASAR missing preload: ${file}`);
    const unpacked = entries.filter(entry => entry.startsWith('unpack : '))
        .map(entry => entry.slice('unpack : /'.length))
        .filter(name => !('files' in asar.statFile(file, name))).sort();
    const unpackedSha256 = sidecarHash(sidecar, unpacked);
    for (const entry of entries) {
        const name = entry.slice(entry.indexOf(' : /') + 4);
        const info = asar.statFile(file, name);
        if ('files' in info || 'link' in info) continue;
        if (!info.unpacked) {
            const bytes = asar.extractFile(file, name);
            if (bytes.length !== info.size ||
                (info.integrity?.hash && crypto.createHash('sha256').update(bytes).digest('hex') !== info.integrity.hash)) {
                throw new Error(`Packed ASAR entry mismatch: ${name}`);
            }
            continue;
        }
        const integrity = asar.statFile(file, name).integrity;
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
                try { process.kill(owner.pid, 0); throw new Error(`ASAR install already running: ${owner.pid}`); }
                catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
            } else if (Date.now() - fs.statSync(lock).mtimeMs < 30000) {
                throw new Error('ASAR lock is incomplete; retry after 30 seconds');
            }
            const recoveryGuard = `${lock}.recovery`;
            try { fs.mkdirSync(recoveryGuard); }
            catch (guardError) {
                if (guardError.code === 'EEXIST') throw new Error('ASAR stale lock recovery is in progress');
                throw guardError;
            }
            try {
                if (fs.readFileSync(lock, 'utf8') !== raw) throw new Error('ASAR lock changed during stale recovery');
                fs.unlinkSync(lock);
            } finally {
                fs.rmdirSync(recoveryGuard);
            }
        }
    }
    throw new Error('Could not acquire ASAR install lock');
}

function verifyBaseline(dir, sha) {
    if (!SHA.test(sha)) throw new Error('Invalid ASAR baseline pointer');
    const file = backupPath(dir, sha);
    const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
    const info = inspectArchive(file);
    if (info.localized || meta.sha256 !== sha || hashFile(file) !== sha ||
        meta.version !== info.version || meta.size !== info.size ||
        meta.unpackedSha256 !== info.unpackedSha256) {
        throw new Error(`ASAR baseline verification failed: ${file}`);
    }
    return { file, info };
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
            fs.renameSync(temp, target);
            if (info.unpacked.length) fs.renameSync(`${temp}.unpacked`, `${target}.unpacked`);
            syncDir(dir);
        } finally {
            if (fs.existsSync(temp)) fs.unlinkSync(temp);
            if (fs.existsSync(`${temp}.unpacked`)) fs.rmSync(`${temp}.unpacked`, { recursive: true });
        }
    }
    if (info.unpacked.length && !fs.existsSync(`${target}.unpacked`)) {
        fs.cpSync(sidecar, `${target}.unpacked`, { recursive: true, errorOnExist: true, force: false });
    }
    if (!fs.existsSync(`${target}.json`)) writeJson(`${target}.json`, {
        sha256: sha, size: info.size, version: info.version,
        unpackedSha256: info.unpackedSha256, source: label
    });
    verifyBaseline(dir, sha);
    writeJson(pointerPath(dir), { sha256: sha });
    return target;
}

function importLegacy(dir, version) {
    const first = path.join(dir, 'app.asar.bak');
    const second = path.join(dir, 'app.asar.official_backup');
    if (!fs.existsSync(first) || !fs.existsSync(second) || hashFile(first) !== hashFile(second)) {
        throw new Error('No verified baseline; matching legacy backups are required');
    }
    const info = inspectArchive(first, `${livePath(dir)}.unpacked`);
    if (info.localized || (version && info.version !== version)) throw new Error('Legacy baseline does not match installed app');
    console.warn('[备份] 导入两份一致的旧备份；其官方来源仍需由用户确认。');
    return saveBaseline(dir, first, `${livePath(dir)}.unpacked`, 'matching-legacy-pair');
}

export function prepareBaseline(dir) {
    const live = livePath(dir);
    const info = inspectArchive(live);
    if (!info.localized) return saveBaseline(dir, live, `${live}.unpacked`, 'unlocalized-live');
    const pointer = pointerPath(dir);
    if (!fs.existsSync(pointer)) return importLegacy(dir, info.version);
    const { sha256 } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    const baseline = verifyBaseline(dir, sha256);
    if (baseline.info.version !== info.version || baseline.info.unpackedSha256 !== info.unpackedSha256) {
        throw new Error('Installed ASAR differs from verified baseline version/sidecar');
    }
    return baseline.file;
}

export function recover(dir) {
    const live = livePath(dir);
    const rollback = `${live}.rollback`;
    if (!fs.existsSync(rollback)) return;
    const previous = inspectArchive(rollback, `${live}.unpacked`);
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

function replace(dir, next) {
    const live = livePath(dir);
    const rollback = `${live}.rollback`;
    inspectArchive(next, `${live}.unpacked`);
    if (fs.existsSync(rollback)) throw new Error('Unresolved ASAR rollback exists');
    if (!fs.existsSync(live)) {
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
    try { fs.unlinkSync(rollback); syncDir(dir); }
    catch (error) { console.warn(`[ASAR] 新包已验证，但旧包清理失败: ${error.message}`); }
}

export function extractBaseline(file, dest) { asar.extractAll(file, dest); }

export async function packAndReplace(dir, extracted, baseline) {
    const original = inspectArchive(baseline);
    const next = path.join(dir, `app.asar.new-${unique()}`);
    const dirs = [...new Set(original.unpacked.map(name => name.startsWith('node_modules/')
        ? name.split('/').slice(0, 2).join(path.sep) : path.dirname(name)))];
    if (dirs.some(name => name === '.' || /[{}*?\[\],]/.test(name))) throw new Error('Unsupported unpacked layout');
    try {
        await asar.createPackageWithOptions(extracted, next,
            dirs.length ? { unpackDir: dirs.length === 1 ? dirs[0] : `{${dirs.join(',')}}` } : {});
        const packed = inspectArchive(next);
        if (packed.version !== original.version || !packed.localized ||
            packed.unpacked.join('\0') !== original.unpacked.join('\0') ||
            packed.unpackedSha256 !== original.unpackedSha256) {
            throw new Error('Repacked ASAR layout/version differs from baseline');
        }
        if (packed.unpackedSha256 !== inspectArchive(livePath(dir)).unpackedSha256) {
            throw new Error('Installed unpacked sidecar changed');
        }
        if (fs.existsSync(`${next}.unpacked`)) fs.rmSync(`${next}.unpacked`, { recursive: true });
        syncFile(next);
        replace(dir, next);
    } finally {
        if (fs.existsSync(next)) fs.unlinkSync(next);
        if (fs.existsSync(`${next}.unpacked`)) fs.rmSync(`${next}.unpacked`, { recursive: true });
    }
}

export function restore(dir) {
    const pointer = pointerPath(dir);
    if (!fs.existsSync(pointer)) importLegacy(dir, null);
    const { sha256 } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    const baseline = verifyBaseline(dir, sha256);
    const live = livePath(dir);
    if (sidecarHash(`${live}.unpacked`, baseline.info.unpacked) !== baseline.info.unpackedSha256) {
        throw new Error('Installed unpacked sidecar differs from baseline');
    }
    const next = path.join(dir, `app.asar.restore-${unique()}`);
    try {
        fs.copyFileSync(baseline.file, next, fs.constants.COPYFILE_EXCL);
        if (hashFile(next) !== sha256) throw new Error('ASAR restore copy hash mismatch');
        syncFile(next);
        replace(dir, next);
    } finally {
        if (fs.existsSync(next)) fs.unlinkSync(next);
    }
}
