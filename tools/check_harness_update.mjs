import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readAsarArchive } from '../core/asar_fast_patch.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const { probeInstallationDir, resolveResourcesDir } = require(path.join(repoRoot, 'core', 'host_env.js'));

const SIGNATURE_START = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const MAX_MANIFEST_BYTES = 65536; // 64 KiB
const ALLOWED_YML_KEYS = new Set(['provider', 'url', 'updaterCacheDirName', 'version', 'releaseDate']);
const SEMVER_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemver(ver) {
    if (typeof ver !== 'string') return null;
    const m = SEMVER_RE.exec(ver.trim());
    if (!m) return null;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    const patch = Number(m[3]);
    if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null;
    let prerelease = [];
    if (m[4]) {
        prerelease = m[4].split('.');
        for (const seg of prerelease) {
            if (/^\d+$/.test(seg) && seg.length > 1 && seg.startsWith('0')) return null;
        }
    }
    return { major, minor, patch, prerelease };
}

export function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb) return null;
    if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
    if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
    if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

    const la = pa.prerelease.length;
    const lb = pb.prerelease.length;
    if (la === 0 && lb === 0) return 0;
    if (la === 0) return 1;
    if (lb === 0) return -1;

    const len = Math.max(la, lb);
    for (let i = 0; i < len; i++) {
        if (i >= la) return -1;
        if (i >= lb) return 1;
        const sa = pa.prerelease[i];
        const sb = pb.prerelease[i];
        const na = /^\d+$/.test(sa);
        const nb = /^\d+$/.test(sb);
        if (na && nb) {
            const va = Number(sa);
            const vb = Number(sb);
            if (va !== vb) return va > vb ? 1 : -1;
        } else if (na !== nb) {
            return na ? -1 : 1;
        } else if (sa !== sb) {
            return sa > sb ? 1 : -1;
        }
    }
    return 0;
}

function isForbiddenIpv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
}

function isForbiddenHost(hostname) {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
    const ipType = net.isIP(host);
    if (ipType === 4) return isForbiddenIpv4(host);
    if (ipType === 6) {
        if (host === '::' || host === '::1') return true;
        if (host.startsWith('::ffff:')) {
            const v4 = host.slice(7);
            if (net.isIP(v4) === 4) return isForbiddenIpv4(v4);
            const hexPair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v4);
            if (hexPair) {
                const hi = parseInt(hexPair[1], 16);
                const lo = parseInt(hexPair[2], 16);
                return isForbiddenIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
            }
            return true;
        }
        const firstHex = parseInt(host.split(':')[0] || '0', 16);
        if ((firstHex & 0xfe00) === 0xfc00) return true; // fc00::/7
        if ((firstHex & 0xffc0) === 0xfe80) return true; // fe80::/10
    }
    return false;
}

export function validateUpdateUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
        throw new Error('Update URL must be a non-empty string');
    }
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') {
        throw new Error(`Unsafe update URL protocol: ${parsed.protocol}`);
    }
    if (parsed.username || parsed.password) {
        throw new Error('Update URL must not contain credentials');
    }
    if (isForbiddenHost(parsed.hostname)) {
        throw new Error(`Forbidden update URL host: ${parsed.hostname}`);
    }
    if (!parsed.pathname.endsWith('/')) {
        parsed.pathname += '/';
    }
    return parsed.toString();
}

export function parseUpdateYml(text) {
    if (typeof text !== 'string') throw new Error('YAML content must be a string');
    const out = Object.create(null);
    const lines = text.replace(/\r/g, '').split('\n');
    for (const line of lines) {
        if (!line || line.trim().startsWith('#')) continue;
        if (/^[ \t]/.test(line)) continue; // Ignore indented lines (e.g. files:\n  - url:)
        const m = /^([A-Za-z0-9_]+):(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1];
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            throw new Error(`Forbidden YAML key: ${key}`);
        }
        if (!ALLOWED_YML_KEYS.has(key)) continue;
        let val = m[2].trim();
        if (/^(?:[&*]|!!)/.test(val)) {
            throw new Error(`Unsafe YAML construct in key "${key}"`);
        }
        if ((val.startsWith("'") && val.endsWith("'") && val.length >= 2) ||
            (val.startsWith('"') && val.endsWith('"') && val.length >= 2)) {
            val = val.slice(1, -1);
        }
        if (key === 'url') {
            val = validateUpdateUrl(val);
        }
        out[key] = val;
    }
    return out;
}

function findEntryByPath(header, relPosix) {
    const parts = relPosix.split('/');
    let cur = header;
    for (let i = 0; i < parts.length; i++) {
        if (!cur || !cur.files || !Object.prototype.hasOwnProperty.call(cur.files, parts[i])) {
            return null;
        }
        cur = cur.files[parts[i]];
    }
    return cur;
}

export function readInstalledHarnessInfo({ installDir = null, asarPath = null } = {}) {
    let resolvedAsar = asarPath ? path.resolve(asarPath) : null;
    let updateYmlPath = null;
    if (!resolvedAsar) {
        const probed = probeInstallationDir(installDir);
        const resourcesDir = probed ? resolveResourcesDir(probed) : null;
        if (resourcesDir) {
            const candidateAsar = path.join(resourcesDir, 'app.asar');
            if (fs.existsSync(candidateAsar)) resolvedAsar = candidateAsar;
            const candidateYml = path.join(resourcesDir, 'app-update.yml');
            if (fs.existsSync(candidateYml)) updateYmlPath = candidateYml;
        }
    } else if (fs.existsSync(resolvedAsar)) {
        const candidateYml = path.join(path.dirname(resolvedAsar), 'app-update.yml');
        if (fs.existsSync(candidateYml)) updateYmlPath = candidateYml;
    }

    if (!resolvedAsar || !fs.existsSync(resolvedAsar)) {
        return { found: false, version: null, sha256: null, localized: false, asarPath: null, updateYmlPath: null };
    }

    const { raw, header, dataStart } = readAsarArchive(resolvedAsar);
    const sha256 = crypto.createHash('sha256').update(raw).digest('hex');

    const readEntrySlice = (relPosix) => {
        const info = findEntryByPath(header, relPosix);
        if (!info || 'files' in info || 'link' in info || info.unpacked) return null;
        const offset = Number(info.offset);
        if (!Number.isSafeInteger(offset) || offset < 0 ||
            !Number.isSafeInteger(info.size) || info.size < 0 ||
            dataStart + offset + info.size > raw.length) {
            throw new Error(`Invalid ASAR bounds for ${relPosix}`);
        }
        const slice = raw.subarray(dataStart + offset, dataStart + offset + info.size);
        if (info.integrity?.hash) {
            const actual = crypto.createHash('sha256').update(slice).digest('hex');
            if (actual !== info.integrity.hash) {
                throw new Error(`Packed ASAR entry mismatch: ${relPosix}`);
            }
        }
        return slice;
    };

    const pkgSlice = readEntrySlice('package.json');
    const preloadSlice = readEntrySlice('dist/preload.js');
    const pkg = pkgSlice ? JSON.parse(pkgSlice.toString('utf8')) : null;
    const version = pkg && typeof pkg.version === 'string' && pkg.version ? pkg.version : null;
    const localized = Boolean(preloadSlice && preloadSlice.includes(SIGNATURE_START));

    return {
        found: true,
        version,
        sha256,
        localized,
        asarPath: resolvedAsar,
        updateYmlPath
    };
}

async function readResponseWithLimit(res, maxBytes) {
    if (!res.body || typeof res.body.getReader !== 'function') {
        const text = await res.text();
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
            throw new Error(`Remote manifest exceeds ${maxBytes} bytes limit`);
        }
        return text;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
                try { await reader.cancel(); } catch (e) {}
                throw new Error(`Remote manifest exceeds ${maxBytes} bytes limit`);
            }
            chunks.push(Buffer.from(value));
        }
    }
    return Buffer.concat(chunks).toString('utf8');
}

export async function fetchRemoteManifest(appUpdateYmlPath, {
    fetchImpl = globalThis.fetch,
    timeoutMs = 5000,
    platform = process.platform,
    arch = process.arch
} = {}) {
    if (!appUpdateYmlPath || !fs.existsSync(appUpdateYmlPath)) {
        return { status: 'skipped', latestVersion: null, releaseDate: null, error: 'app-update.yml not found' };
    }
    try {
        const cfg = parseUpdateYml(fs.readFileSync(appUpdateYmlPath, 'utf8'));
        if (!cfg.url) {
            return { status: 'error', latestVersion: null, releaseDate: null, error: 'app-update.yml missing url' };
        }
        const baseUrl = validateUpdateUrl(cfg.url);

        const candidates = [];
        if (platform === 'win32') {
            candidates.push(`latest-${arch}-win.yml`, 'latest.yml');
        } else if (platform === 'darwin') {
            candidates.push(`latest-${arch}-mac.yml`, 'latest-mac.yml');
        } else {
            candidates.push(`latest-${arch}-linux.yml`, 'latest-linux.yml');
        }

        let lastErr = null;
        for (const fileName of candidates) {
            const manifestUrl = new URL(fileName, baseUrl).toString();
            const res = await fetchImpl(manifestUrl, {
                redirect: 'error',
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (res.status === 404) continue;
            if (!res.ok) {
                lastErr = `HTTP ${res.status} from ${manifestUrl}`;
                continue;
            }
            const body = await readResponseWithLimit(res, MAX_MANIFEST_BYTES);
            if (/^\s*<!doctype\s+html|^\s*<html/i.test(body)) {
                throw new Error(`Unexpected HTML response from ${manifestUrl}`);
            }
            const parsed = parseUpdateYml(body);
            if (!parsed.version || parseSemver(parsed.version) === null) {
                throw new Error(`Invalid version in remote manifest: ${parsed.version}`);
            }
            return {
                status: 'ok',
                latestVersion: parsed.version,
                releaseDate: parsed.releaseDate || null,
                manifestUrl
            };
        }
        return {
            status: 'error',
            latestVersion: null,
            releaseDate: null,
            error: lastErr || 'Remote manifest not found (404)'
        };
    } catch (error) {
        const isOffline = error && (error.name === 'TimeoutError' || error.name === 'AbortError' ||
            /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(error.message || ''));
        return {
            status: isOffline ? 'offline' : 'error',
            latestVersion: null,
            releaseDate: null,
            error: error?.message || String(error)
        };
    }
}

export async function checkHarnessUpdate({
    installDir = null,
    asarPath = null,
    compatFile = path.join(repoRoot, 'harness_compat.json'),
    remote = false,
    fetchImpl = globalThis.fetch,
    timeoutMs = 5000,
    platform = process.platform,
    arch = process.arch
} = {}) {
    const compat = JSON.parse(fs.readFileSync(path.resolve(compatFile), 'utf8'));
    const repoVerifiedVersion = compat.lastVerifiedVersion;
    const installed = readInstalledHarnessInfo({ installDir, asarPath });

    let remoteResult = { status: 'skipped', latestVersion: null, releaseDate: null };
    if (remote) {
        remoteResult = await fetchRemoteManifest(installed.updateYmlPath, { fetchImpl, timeoutMs, platform, arch });
    }

    let targetVersion = null;
    if (installed.version && remoteResult.latestVersion) {
        targetVersion = compareSemver(installed.version, remoteResult.latestVersion) >= 0
            ? installed.version
            : remoteResult.latestVersion;
    } else {
        targetVersion = installed.version || remoteResult.latestVersion || null;
    }

    let semverDiff = 'unknown';
    if (targetVersion && repoVerifiedVersion) {
        const cmp = compareSemver(targetVersion, repoVerifiedVersion);
        if (cmp === 1) semverDiff = 'newer';
        else if (cmp === 0) semverDiff = 'same';
        else if (cmp === -1) semverDiff = 'older';
    }

    const localInstallOutdated = Boolean(
        remoteResult.latestVersion &&
        installed.version &&
        compareSemver(remoteResult.latestVersion, installed.version) === 1
    );
    const needsMaintenance = semverDiff === 'newer';
    const canAuditLocally = Boolean(
        installed.found &&
        installed.version &&
        repoVerifiedVersion &&
        compareSemver(installed.version, repoVerifiedVersion) === 1
    );

    return {
        repoVerifiedVersion,
        installed,
        remote: remoteResult,
        targetVersion,
        semverDiff,
        localInstallOutdated,
        needsMaintenance,
        canAuditLocally
    };
}

function parseCliArgs(argv) {
    const opts = {
        installDir: null,
        asarPath: null,
        compatFile: path.join(repoRoot, 'harness_compat.json'),
        remote: false,
        json: false,
        failOnUpdate: false
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--install-dir') opts.installDir = argv[++i] || null;
        else if (a.startsWith('--install-dir=')) opts.installDir = a.slice('--install-dir='.length);
        else if (a === '--asar') opts.asarPath = argv[++i] || null;
        else if (a.startsWith('--asar=')) opts.asarPath = a.slice('--asar='.length);
        else if (a === '--compat-file') opts.compatFile = argv[++i] || opts.compatFile;
        else if (a.startsWith('--compat-file=')) opts.compatFile = a.slice('--compat-file='.length);
        else if (a === '--remote') opts.remote = true;
        else if (a === '--json') opts.json = true;
        else if (a === '--fail-on-update') opts.failOnUpdate = true;
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
    checkHarnessUpdate(opts).then(result => {
        if (opts.json) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
            console.log(`仓库已核验版本: ${result.repoVerifiedVersion}`);
            console.log(`本机安装版本:   ${result.installed.found ? `${result.installed.version} (${result.installed.localized ? '已注入' : '原版'})` : '未检测到'}`);
            if (opts.remote) {
                console.log(`远端最新版本:   ${result.remote.status === 'ok' ? result.remote.latestVersion : `${result.remote.status} (${result.remote.error || ''})`}`);
            }
            console.log(`需要维护适配:   ${result.needsMaintenance ? '是 (needsMaintenance=true)' : '否'}`);
        }
        if (opts.failOnUpdate && result.needsMaintenance) {
            process.exitCode = 10;
        }
    }).catch(err => {
        if (opts.json) {
            process.stdout.write(JSON.stringify({ error: err?.message || String(err) }) + '\n');
        } else {
            console.error(`[错误] ${err?.message || err}`);
        }
        process.exitCode = 1;
    });
}
