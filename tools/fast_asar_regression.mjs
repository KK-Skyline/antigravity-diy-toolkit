import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tx = await import(new URL('../asar_transaction.mjs', import.meta.url));
const { computeIntegrity, buildPatchedAsar } = await import(new URL('../core/asar_fast_patch.mjs', import.meta.url));
const pluginLoader = require(path.join(rootDir, 'core', 'plugin_loader.js'));
const injector = require(path.join(rootDir, 'core', 'injector.js'));

const SIGNATURE_START = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const SIGNATURE_END = '/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */';

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

async function createSyntheticAsar(fixtureDir, { extraFiles = 0 } = {}) {
    const srcDir = path.join(fixtureDir, 'src');
    const resourcesDir = path.join(fixtureDir, 'resources');
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, 'node_modules', 'demo-pkg'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, 'native'), { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'package.json'), JSON.stringify({ name: 'antigravity', version: '2.35.0' }));
    fs.writeFileSync(path.join(srcDir, 'dist', 'preload.js'), 'console.log("preload");\n');
    fs.writeFileSync(path.join(srcDir, 'dist', 'main.js'), 'console.log("main");\n');
    fs.writeFileSync(path.join(srcDir, 'dist', 'empty.bin'), Buffer.alloc(0));
    // > 4MB file to test multi-block integrity.blocks
    const bigBuf = crypto.randomBytes(4 * 1024 * 1024 + 12345);
    fs.writeFileSync(path.join(srcDir, 'node_modules', 'demo-pkg', 'big.bin'), bigBuf);
    fs.writeFileSync(path.join(srcDir, 'node_modules', 'demo-pkg', 'index.js'), 'module.exports = 42;\n');
    if (process.platform !== 'win32') {
        fs.writeFileSync(path.join(srcDir, 'dist', 'run.sh'), '#!/bin/sh\necho ok\n', { mode: 0o755 });
    }
    for (let i = 0; i < extraFiles; i++) {
        fs.writeFileSync(path.join(srcDir, 'node_modules', 'demo-pkg', `mod_${i}.js`), `exports.n = ${i};\n`);
    }
    fs.writeFileSync(path.join(srcDir, 'native', 'addon.node'), crypto.randomBytes(4096));
    fs.writeFileSync(path.join(srcDir, 'leaf.node'), crypto.randomBytes(1024));

    const asarFile = path.join(resourcesDir, 'app.asar');
    await asar.createPackageWithOptions(srcDir, asarFile, {
        unpackDir: 'native',
        unpack: path.join(srcDir, 'leaf.node').replaceAll('\\', '/')
    });
    return { srcDir, resourcesDir, asarFile, bigBuf };
}

async function runTests() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-fast-asar-'));
    const prevStore = process.env.AG_BASELINE_STORE;
    process.env.AG_BASELINE_STORE = path.join(tmp, 'baseline-store');

    try {
        // 1. Binary compatibility & integrity.blocks parity test
        {
            const f1 = path.join(tmp, 'compat');
            const { resourcesDir, asarFile, bigBuf } = await createSyntheticAsar(f1);
            const txCtx = tx.createTransactionContext();
            const baseline = tx.prepareBaseline(resourcesDir, { confirmUnverified: true, txCtx });
            const origInfo = tx.inspectArchive(baseline);

            const patchRoot = path.join(f1, 'patch');
            tx.extractSubtree(baseline, patchRoot, ['dist']);
            assert.ok(fs.existsSync(path.join(patchRoot, 'dist', 'preload.js')));
            assert.ok(!fs.existsSync(path.join(patchRoot, 'node_modules')), 'node_modules must not be extracted');
            assert.ok(!fs.existsSync(path.join(patchRoot, 'native')), 'unpacked native dir must not be extracted');

            const newPreload = Buffer.from(`console.log("preload");\n${SIGNATURE_START}\nconsole.log("ok");\n${SIGNATURE_END}\n`);
            const newVideoMod = Buffer.from("'use strict';\nmodule.exports = 'video';\n");
            fs.writeFileSync(path.join(patchRoot, 'dist', 'preload.js'), newPreload);
            fs.writeFileSync(path.join(patchRoot, 'dist', 'agWallpaperVideo.js'), newVideoMod);

            await tx.patchAndReplace(resourcesDir, patchRoot, baseline, null, txCtx);

            // Verify with official @electron/asar APIs
            asar.uncache(asarFile);
            const rawHeader = asar.getRawHeader(asarFile);
            assert.ok(rawHeader.header.files.dist.files['agWallpaperVideo.js']);
            const listed = asar.listPackage(asarFile, { isPack: true }).map(e => e.replaceAll('\\', '/'));
            assert.ok(listed.some(e => e.endsWith('/dist/agWallpaperVideo.js')));
            assert.deepEqual(asar.extractFile(asarFile, path.join('dist', 'preload.js')), newPreload);
            assert.deepEqual(asar.extractFile(asarFile, path.join('dist', 'agWallpaperVideo.js')), newVideoMod);
            assert.deepEqual(asar.extractFile(asarFile, path.join('dist', 'empty.bin')), Buffer.alloc(0));
            assert.deepEqual(asar.extractFile(asarFile, path.join('node_modules', 'demo-pkg', 'big.bin')), bigBuf);

            const statEmpty = asar.statFile(asarFile, path.join('dist', 'empty.bin'));
            assert.deepEqual(statEmpty.integrity, computeIntegrity(Buffer.alloc(0)));
            const statBig = asar.statFile(asarFile, path.join('node_modules', 'demo-pkg', 'big.bin'));
            assert.deepEqual(statBig.integrity, computeIntegrity(bigBuf));
            if (process.platform !== 'win32') {
                assert.equal(asar.statFile(asarFile, path.join('dist', 'run.sh')).executable, true);
            }

            const extractCheck = path.join(f1, 'extract-all');
            asar.extractAll(asarFile, extractCheck);
            assert.deepEqual(fs.readFileSync(path.join(extractCheck, 'dist', 'preload.js')), newPreload);
            assert.deepEqual(fs.readFileSync(path.join(extractCheck, 'node_modules', 'demo-pkg', 'big.bin')), bigBuf);

            const newInfo = tx.inspectArchive(asarFile);
            assert.equal(newInfo.localized, true);
            assert.deepEqual(newInfo.unpacked, origInfo.unpacked);
            assert.deepEqual(newInfo.unpackedDirs, origInfo.unpackedDirs);
            assert.equal(newInfo.unpackedSha256, origInfo.unpackedSha256);
        }

        // 2. Fail-Closed security tests
        {
            const f2 = path.join(tmp, 'fail-closed');
            const { resourcesDir, asarFile } = await createSyntheticAsar(f2);
            const baseline = tx.prepareBaseline(resourcesDir, { confirmUnverified: true });

            // Attempt to overwrite unpacked file via buildPatchedAsar
            assert.throws(
                () => buildPatchedAsar(baseline, new Map([['leaf.node', Buffer.from('bad')]]), path.join(f2, 'out1.asar')),
                /unpacked/i
            );
            // Attempt path traversal in patchMap
            assert.throws(
                () => buildPatchedAsar(baseline, new Map([['../evil.js', Buffer.from('bad')]]), path.join(f2, 'out2.asar')),
                /Unsafe ASAR patch path/
            );
            // Attempt symlink inside patchRoot/dist (best-effort on OS allowing symlinks)
            const badPatchRoot = path.join(f2, 'bad-patch');
            fs.mkdirSync(path.join(badPatchRoot, 'dist'), { recursive: true });
            const outsideFile = path.join(f2, 'secret.txt');
            fs.writeFileSync(outsideFile, 'secret');
            try {
                fs.symlinkSync(outsideFile, path.join(badPatchRoot, 'dist', 'leak.txt'));
                await assert.rejects(
                    () => tx.patchAndReplace(resourcesDir, badPatchRoot, baseline),
                    /Symlink not allowed/
                );
            } catch (e) {
                if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
            }

            // 1-byte tamper in packed file
            const tamperedAsar = path.join(f2, 'tampered.asar');
            const rawBuf = Buffer.from(fs.readFileSync(asarFile));
            rawBuf[rawBuf.length - 10] ^= 0xff;
            fs.writeFileSync(tamperedAsar, rawBuf);
            assert.throws(() => tx.inspectArchive(tamperedAsar, `${asarFile}.unpacked`), /Packed ASAR entry mismatch/);

            // 1-byte tamper in unpacked sidecar
            const sidecarLeaf = path.join(`${asarFile}.unpacked`, 'leaf.node');
            const leafOrig = fs.readFileSync(sidecarLeaf);
            const leafBad = Buffer.from(leafOrig);
            leafBad[0] ^= 0xff;
            fs.writeFileSync(sidecarLeaf, leafBad);
            assert.throws(() => tx.inspectArchive(asarFile), /Unpacked ASAR entry hash mismatch/);
            fs.writeFileSync(sidecarLeaf, leafOrig);
        }

        // 3. Dual-write config transaction & rollback
        {
            const f3 = path.join(tmp, 'config-tx');
            const { resourcesDir, asarFile } = await createSyntheticAsar(f3);
            const cfgFile = path.join(f3, 'wallpaper_config.json');
            fs.writeFileSync(cfgFile, JSON.stringify({ workshopId: '111', opacity: 0.5 }));
            const baseline = tx.prepareBaseline(resourcesDir, { confirmUnverified: true });
            const patchRoot = path.join(f3, 'patch');
            tx.extractSubtree(baseline, patchRoot, ['dist']);
            fs.writeFileSync(path.join(patchRoot, 'dist', 'preload.js'),
                Buffer.from(`${SIGNATURE_START}\nconsole.log("cfg");\n${SIGNATURE_END}\n`));

            await tx.patchAndReplace(resourcesDir, patchRoot, baseline, {
                file: cfgFile,
                value: { workshopId: '222', opacity: 0.8 }
            });
            assert.equal(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).workshopId, '222');
            assert.equal(fs.existsSync(path.join(resourcesDir, 'app.asar.config.pending')), false);
            assert.equal(fs.existsSync(`${asarFile}.rollback`), false);

            // Rollback test: missing localized signature triggers validation failure after build, before commit
            const beforeAsar = fs.readFileSync(asarFile);
            const beforeCfg = fs.readFileSync(cfgFile);
            fs.writeFileSync(path.join(patchRoot, 'dist', 'preload.js'), Buffer.from('no-signature'));
            await assert.rejects(() => tx.patchAndReplace(resourcesDir, patchRoot, baseline, {
                file: cfgFile,
                value: { workshopId: '333' }
            }));
            assert.deepEqual(fs.readFileSync(asarFile), beforeAsar);
            assert.deepEqual(fs.readFileSync(cfgFile), beforeCfg);
        }

        // 4. AG_DISABLE_FAST_ASAR=1 fallback check & single dataUrl inlining check
        {
            const engineSrc = fs.readFileSync(path.join(rootDir, 'localization_engine.js'), 'utf8');
            assert.ok(engineSrc.includes('AG_DISABLE_FAST_ASAR'), 'localization_engine.js must support AG_DISABLE_FAST_ASAR fallback');

            const resolved = pluginLoader.resolvePlugins(rootDir, {
                enable: ['theme-obsidian-blue', 'wallpaper-engine', 'theme-acrylic'],
                disable: ['i18n-zh', 'devtools', 'fx-rain']
            });
            const bigDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(2048);
            const ctx = injector.buildContextBase({
                rootDir,
                isV2: false,
                allConfigs: resolved.allConfigs,
                shared: {
                    bakedWallpaper: {
                        title: 'DedupTest',
                        type: 'image',
                        dataUrl: bigDataUrl,
                        videoPath: '',
                        effects: {},
                        config: { blur: 0, contrast: 105, saturate: 110 }
                    }
                },
                hostHelpers: {}
            });
            const payload = injector.buildPreloadPayload(resolved.active, ctx);
            const occurrences = payload.split(bigDataUrl).length - 1;
            assert.equal(occurrences, 1, `dataUrl must appear exactly once in preload payload, got ${occurrences}`);
            const idxBlue = payload.indexOf('antigravity-dark-blue-theme');
            const idxWe = payload.indexOf('antigravity-we-style');
            const idxAcrylic = payload.indexOf('antigravity-acrylic-theme');
            assert.ok(idxBlue < idxWe && idxWe < idxAcrylic, 'layerOrder must remain 10 < 15 < 20');
        }

        // 5. Performance benchmark (synthetic 400-file ASAR)
        {
            const f5 = path.join(tmp, 'bench');
            const { resourcesDir, asarFile } = await createSyntheticAsar(f5, { extraFiles: 400 });
            const baseline = tx.prepareBaseline(resourcesDir, { confirmUnverified: true });

            const t0 = performance.now();
            tx.inspectArchive(asarFile);
            const inspectMs = performance.now() - t0;

            const patchDir = path.join(f5, 'fast-patch');
            const t1 = performance.now();
            tx.extractSubtree(baseline, patchDir, ['dist']);
            fs.writeFileSync(path.join(patchDir, 'dist', 'preload.js'),
                Buffer.from(`${SIGNATURE_START}\nconsole.log("fast");\n${SIGNATURE_END}\n`));
            await tx.patchAndReplace(resourcesDir, patchDir, baseline);
            const fastMs = performance.now() - t1;

            const legacyDir = path.join(f5, 'legacy-extract');
            const t2 = performance.now();
            tx.extractBaseline(baseline, legacyDir);
            fs.writeFileSync(path.join(legacyDir, 'dist', 'preload.js'),
                Buffer.from(`${SIGNATURE_START}\nconsole.log("legacy");\n${SIGNATURE_END}\n`));
            await tx.packAndReplace(resourcesDir, legacyDir, baseline);
            const legacyMs = performance.now() - t2;

            console.log(`fast asar benchmark (400+ files): inspectArchive=${inspectMs.toFixed(1)}ms, fast=${fastMs.toFixed(1)}ms, legacy=${legacyMs.toFixed(1)}ms, speedup=${(legacyMs / Math.max(fastMs, 0.1)).toFixed(2)}x`);
        }

        console.log('fast asar regression: PASS');
    } finally {
        if (prevStore === undefined) delete process.env.AG_BASELINE_STORE;
        else process.env.AG_BASELINE_STORE = prevStore;
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

runTests();
