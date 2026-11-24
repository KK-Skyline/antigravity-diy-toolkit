import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BLOCK_SIZE = 4 * 1024 * 1024;
const align4 = n => (n + 3) & ~3;

export function computeIntegrity(buf) {
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const blocks = [];
    for (let off = 0; off < buf.length; off += BLOCK_SIZE) {
        const end = Math.min(off + BLOCK_SIZE, buf.length);
        blocks.push(crypto.createHash('sha256').update(buf.subarray(off, end)).digest('hex'));
    }
    if (buf.length === 0) {
        blocks.push(hash);
    }
    return { algorithm: 'SHA256', hash, blockSize: BLOCK_SIZE, blocks };
}

export function readAsarArchive(asarPath) {
    const raw = fs.readFileSync(asarPath);
    if (raw.length < 16) {
        throw new Error(`Invalid ASAR file (too small): ${asarPath}`);
    }
    const sizePayload = raw.readUInt32LE(0);
    if (sizePayload !== 4) {
        throw new Error(`Invalid ASAR size pickle: ${asarPath}`);
    }
    const headerSize = raw.readUInt32LE(4);
    const dataStart = 8 + headerSize;
    if (headerSize < 8 || dataStart > raw.length) {
        throw new Error(`Invalid ASAR header size: ${asarPath}`);
    }
    const alignedPayloadSize = raw.readUInt32LE(8);
    const utf8Len = raw.readUInt32LE(12);
    if (4 + align4(utf8Len) !== alignedPayloadSize || 8 + utf8Len > headerSize) {
        throw new Error(`Invalid ASAR header pickle: ${asarPath}`);
    }
    const header = JSON.parse(raw.subarray(16, 16 + utf8Len).toString('utf8'));
    if (!header || typeof header !== 'object' || Array.isArray(header) ||
        !header.files || typeof header.files !== 'object' || Array.isArray(header.files)) {
        throw new Error(`Invalid ASAR header structure: ${asarPath}`);
    }
    return { raw, header, headerSize, dataStart };
}

export function extractSubtree(asarPath, destDir, subdirs = ['dist']) {
    const { raw, header, dataStart } = readAsarArchive(asarPath);
    const normalizedSubdirs = subdirs
        .map(s => String(s).replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''))
        .filter(Boolean);

    const shouldVisitDir = relDir => normalizedSubdirs.some(sub =>
        relDir === sub || relDir.startsWith(`${sub}/`) || sub.startsWith(`${relDir}/`)
    );
    const isIncludedFile = relFile => normalizedSubdirs.some(sub =>
        relFile === sub || relFile.startsWith(`${sub}/`)
    );

    const walk = (filesObj, prefix) => {
        for (const [name, info] of Object.entries(filesObj)) {
            const relPosix = prefix ? `${prefix}/${name}` : name;
            if ('files' in info) {
                if (shouldVisitDir(relPosix)) {
                    walk(info.files, relPosix);
                }
                continue;
            }
            if ('link' in info || info.unpacked || !isIncludedFile(relPosix)) continue;
            const offset = Number(info.offset);
            if (!Number.isSafeInteger(offset) || offset < 0 ||
                !Number.isSafeInteger(info.size) || info.size < 0 ||
                dataStart + offset + info.size > raw.length) {
                throw new Error(`Invalid packed ASAR entry bounds: ${relPosix}`);
            }
            const outPath = path.join(destDir, ...relPosix.split('/'));
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, raw.subarray(dataStart + offset, dataStart + offset + info.size));
        }
    };
    walk(header.files, '');
}

function validatePatchKey(key) {
    if (typeof key !== 'string' || !key || key.includes('\\') || key.startsWith('/') ||
        key.endsWith('/') || key.includes(':') || key.includes('\0') || key.includes('//')) {
        throw new Error(`Unsafe ASAR patch path: ${key}`);
    }
    const parts = key.split('/');
    if (parts.some(p => !p || p === '.' || p === '..')) {
        throw new Error(`Unsafe ASAR patch path: ${key}`);
    }
    return parts;
}

function encodeAsarHeader(headerObj) {
    const headerStrBuf = Buffer.from(JSON.stringify(headerObj), 'utf8');
    const headerPayloadSize = 4 + align4(headerStrBuf.length);
    const headerPickle = Buffer.alloc(4 + headerPayloadSize);
    headerPickle.writeUInt32LE(headerPayloadSize, 0);
    headerPickle.writeUInt32LE(headerStrBuf.length, 4);
    headerStrBuf.copy(headerPickle, 8);

    const sizePickle = Buffer.alloc(8);
    sizePickle.writeUInt32LE(4, 0);
    sizePickle.writeUInt32LE(headerPickle.length, 4);
    return [sizePickle, headerPickle];
}

function writeBuffersAtomic(outputPath, buffers) {
    const nonEmpty = buffers.filter(b => b.length > 0);
    const fd = fs.openSync(outputPath, 'wx');
    try {
        const BATCH = 512;
        for (let i = 0; i < nonEmpty.length; i += BATCH) {
            const slice = nonEmpty.slice(i, i + BATCH);
            let total = 0;
            for (const b of slice) total += b.length;
            let written = 0;
            let idx = 0;
            let off = 0;
            while (written < total) {
                const iov = off > 0
                    ? [slice[idx].subarray(off), ...slice.slice(idx + 1)]
                    : slice.slice(idx);
                const n = fs.writevSync(fd, iov);
                if (n <= 0) {
                    throw new Error(`Short write (0 bytes) while writing ${outputPath}`);
                }
                written += n;
                let rem = n;
                while (rem > 0 && idx < slice.length) {
                    const avail = slice[idx].length - off;
                    if (rem >= avail) {
                        rem -= avail;
                        idx++;
                        off = 0;
                    } else {
                        off += rem;
                        rem = 0;
                    }
                }
            }
        }
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

export function buildPatchedAsar(baselinePath, patchMap, outputPath) {
    const { raw, header, dataStart } = readAsarArchive(baselinePath);
    const clonedHeader = structuredClone(header);

    const normalizedPatches = new Map();
    for (const [rawKey, val] of patchMap.entries()) {
        const parts = validatePatchKey(rawKey);
        if (!Buffer.isBuffer(val) && !(val instanceof Uint8Array)) {
            throw new Error(`Patch payload for ${rawKey} must be a Buffer`);
        }
        const buf = Buffer.isBuffer(val) ? val : Buffer.from(val);
        normalizedPatches.set(rawKey, buf);

        let dirNode = clonedHeader;
        for (let i = 0; i < parts.length - 1; i++) {
            const seg = parts[i];
            if (!dirNode.files[seg]) {
                dirNode.files[seg] = { files: {} };
            }
            const nextNode = dirNode.files[seg];
            if (!('files' in nextNode) || 'link' in nextNode || nextNode.unpacked === true) {
                throw new Error(`Cannot patch inside non-directory or unpacked entry: ${parts.slice(0, i + 1).join('/')}`);
            }
            dirNode = nextNode;
        }
        const leafName = parts[parts.length - 1];
        const existing = dirNode.files[leafName];
        if (existing) {
            if ('files' in existing || 'link' in existing || existing.unpacked === true) {
                throw new Error(`Refusing to overwrite directory, symlink, or unpacked entry: ${rawKey}`);
            }
        } else {
            dirNode.files[leafName] = { size: 0, offset: '0' };
        }
    }

    const chunks = [];
    let cursor = 0;

    const rebuild = (filesObj, prefix) => {
        for (const [name, node] of Object.entries(filesObj)) {
            const relPosix = prefix ? `${prefix}/${name}` : name;
            if ('files' in node) {
                rebuild(node.files, relPosix);
                continue;
            }
            if ('link' in node || node.unpacked === true) {
                continue;
            }
            if (normalizedPatches.has(relPosix)) {
                const newBuf = normalizedPatches.get(relPosix);
                node.size = newBuf.length;
                node.offset = String(cursor);
                node.integrity = computeIntegrity(newBuf);
                cursor += newBuf.length;
                chunks.push(newBuf);
            } else {
                const oldOffset = Number(node.offset);
                if (!Number.isSafeInteger(oldOffset) || oldOffset < 0 ||
                    !Number.isSafeInteger(node.size) || node.size < 0 ||
                    dataStart + oldOffset + node.size > raw.length) {
                    throw new Error(`Invalid baseline packed entry bounds: ${relPosix}`);
                }
                node.offset = String(cursor);
                cursor += node.size;
                chunks.push(raw.subarray(dataStart + oldOffset, dataStart + oldOffset + node.size));
            }
        }
    };
    rebuild(clonedHeader.files, '');

    const [sizePickle, headerPickle] = encodeAsarHeader(clonedHeader);
    writeBuffersAtomic(outputPath, [sizePickle, headerPickle, ...chunks]);
}
