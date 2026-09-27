const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const realConfig = path.join(__dirname, 'wallpaper_config.json');
const hash = file => fs.existsSync(file)
    ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const realConfigBefore = hash(realConfig);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-hub-test-'));
const fixtureConfig = path.join(fixture, 'wallpaper_config.json');
const calls = path.join(fixture, 'localizer.calls');
const failFlag = path.join(fixture, 'localizer.fail');
let server;
let competingServer;

function prepareFixture() {
    const wallpaperRoot = path.join(fixture, 'workshop');
    fs.mkdirSync(path.join(wallpaperRoot, '123'), { recursive: true });
    const source = fs.readFileSync(path.join(__dirname, 'wallpaper_hub_server.js'), 'utf8');
    const roots = source.match(/const candidateDirs = \[[\s\S]*?\n    \];/g);
    assert.strictEqual(roots?.length, 1, 'Wallpaper root insertion point changed');
    fs.writeFileSync(path.join(fixture, 'wallpaper_hub_server.js'),
        source.replace(roots[0], 'const candidateDirs = [' + JSON.stringify(wallpaperRoot) + '];'));
    for (const file of ['hub.css', 'hub.js']) fs.copyFileSync(path.join(__dirname, file), path.join(fixture, file));
    fs.writeFileSync(path.join(fixture, 'wallpaper_engine_reader.js'), 'module.exports = {};\n');
    fs.writeFileSync(path.join(fixture, 'localization_engine.js'), [
        "const fs = require('fs');",
        "fs.appendFileSync(process.env.HUB_STUB_CALLS, 'called\\n');",
        "if (fs.existsSync(process.env.HUB_STUB_FAIL)) {",
        "    process.stderr.write('PRIVATE_LOCALIZER_DETAILS\\n');",
        "    process.exit(17);",
        "}"
    ].join('\n'));
    fs.writeFileSync(fixtureConfig, '{}');
}

function spawnHub() {
    const child = spawn(process.execPath, [path.join(fixture, 'wallpaper_hub_server.js')], {
        cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HUB_STUB_CALLS: calls, HUB_STUB_FAIL: failFlag }
    });
    child.output = { stdout: '', stderr: '' };
    child.stdout.on('data', chunk => { child.output.stdout += chunk; });
    child.stderr.on('data', chunk => { child.output.stderr += chunk; });
    return child;
}

function waitForStart(child) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Hub did not start: ' + child.output.stderr)), 5000);
        child.stdout.on('data', () => {
            if (child.output.stdout.includes('访问地址')) { clearTimeout(timer); resolve(); }
        });
        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error('Hub exited ' + code + ': ' + child.output.stderr));
        });
    });
}

function waitForExit(child) {
    if (child.exitCode !== null) return Promise.resolve(child.exitCode);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Hub did not exit')), 5000);
        child.once('close', code => { clearTimeout(timer); resolve(code); });
    });
}

function request(pathname, { method = 'GET', headers = {}, body = '' } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: 3210, path: pathname, method,
            headers: { Host: '127.0.0.1:3210', ...headers } }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        });
        req.on('error', reject);
        req.end(body);
    });
}

async function main() {
    prepareFixture();
    server = spawnHub();
    await waitForStart(server);

    const page = await request('/');
    assert.strictEqual(page.status, 200);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.strictEqual(page.headers['x-frame-options'], 'DENY');
    assert.match(page.text, /src="\/hub\.js"/);
    assert.match(page.text, /href="\/hub\.css"/);
    assert.doesNotMatch(page.text, /cdn\.tailwindcss|<script>|\sonclick=|\soninput=|\sonerror=/);
    assert.strictEqual((await request('/hub.css')).status, 200);
    assert.strictEqual((await request('/hub.js')).status, 200);

    const list = await request('/api/wallpapers');
    assert.strictEqual(list.status, 200);
    assert.ok(JSON.parse(list.text).wallpapers.some(item => item.id === '123'));
    for (const item of JSON.parse(list.text).wallpapers) {
        assert.ok(!Object.prototype.hasOwnProperty.call(item, 'dir') &&
            !Object.prototype.hasOwnProperty.call(item, 'baseDir'));
    }
    const badHost = await request('/', { headers: { Host: 'evil.example' } });
    assert.strictEqual(badHost.status, 403);
    assert.match(badHost.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.strictEqual(badHost.headers['x-frame-options'], 'DENY');
    assert.strictEqual((await request('/', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.strictEqual((await request('/', { headers: { Origin: 'null' } })).status, 403);
    assert.strictEqual((await request('/', { headers: { Origin: 'http://localhost:3210' } })).status, 200);
    assert.strictEqual((await request('/api/apply', { method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: '{"workshopId":"123"}' })).status, 403);
    assert.strictEqual((await request('/api/apply', { method: 'OPTIONS' })).status, 404);

    const post = (pathname, data, headers = {}) => request(pathname, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data)
    });
    const fixtureConfigBefore = hash(fixtureConfig);
    assert.strictEqual((await post('/api/apply', { workshopId: '1 & whoami' })).status, 400);
    assert.strictEqual((await post('/api/apply', { workshopId: '../x' })).status, 400);
    assert.strictEqual((await post('/api/apply', { workshopId: '1'.repeat(21) })).status, 400);
    assert.deepStrictEqual(JSON.parse((await post('/api/apply', { workshopId: '123', opacity: -1 })).text),
        { success: false, code: 'INVALID_REQUEST', error: '请求参数无效。' });
    assert.strictEqual((await request('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: '{"workshopId":"123","opacity":1e999}' })).status, 400);
    assert.strictEqual((await post('/api/apply', { workshopId: '123', padding: 'x'.repeat(65536) })).status, 413);
    assert.strictEqual((await request('/api/apply', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.strictEqual((await post('/api/open-folder', { dir: '\\\\attacker\\share' })).status, 400);
    assert.strictEqual((await post('/api/open-folder', { id: '../x' })).status, 400);
    assert.strictEqual(hash(fixtureConfig), fixtureConfigBefore);
    assert.strictEqual(fs.existsSync(calls), false, 'Invalid requests must not invoke the localizer');

    assert.strictEqual((await post('/api/apply', { workshopId: '123', autoRestart: false })).status, 200);
    assert.strictEqual(fs.readFileSync(calls, 'utf8').trim(), 'called');
    assert.strictEqual(JSON.parse(fs.readFileSync(fixtureConfig, 'utf8')).workshopId, '123');

    fs.writeFileSync(failFlag, '');
    const failedApply = await post('/api/apply', { workshopId: '123', autoRestart: false });
    assert.strictEqual(failedApply.status, 500);
    assert.deepStrictEqual(JSON.parse(failedApply.text),
        { success: false, code: 'APPLY_FAILED', error: '应用失败，请查看服务端日志。' });
    assert.doesNotMatch(failedApply.text, /PRIVATE_LOCALIZER_DETAILS|details|stderr|localization_engine/);
    assert.match(server.output.stderr, /PRIVATE_LOCALIZER_DETAILS/);

    fs.renameSync(fixtureConfig, fixtureConfig + '.saved');
    fs.mkdirSync(fixtureConfig);
    const failedWrite = await post('/api/apply', { workshopId: '123', autoRestart: false });
    assert.strictEqual(failedWrite.status, 500);
    assert.deepStrictEqual(JSON.parse(failedWrite.text),
        { success: false, code: 'APPLY_FAILED', error: '应用失败，请查看服务端日志。' });
    assert.doesNotMatch(failedWrite.text, /wallpaper_config|EISDIR|details/);
    assert.strictEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 2);
    fs.rmdirSync(fixtureConfig);
    fs.renameSync(fixtureConfig + '.saved', fixtureConfig);

    competingServer = spawnHub();
    const conflictingExit = await waitForExit(competingServer);
    assert.strictEqual(conflictingExit, 1);
    assert.match(competingServer.output.stderr, /端口 127\.0\.0\.1:3210 已被占用/);
    assert.strictEqual((await request('/')).status, 200);

    await request('/api/wallpapers?refresh=1');
    fs.rmdirSync(path.join(fixture, 'workshop', '123'));
    const vanishedFolder = await post('/api/open-folder', { id: '123' });
    assert.strictEqual(vanishedFolder.status, 500);
    assert.deepStrictEqual(JSON.parse(vanishedFolder.text),
        { success: false, code: 'OPEN_FOLDER_FAILED', error: '无法打开壁纸目录。' });
    assert.ok(!vanishedFolder.text.includes(fixture));
    assert.doesNotMatch(vanishedFolder.text, /ENOENT|realpath|lstat/);

    const engine = fs.readFileSync(path.join(__dirname, 'localization_engine.js'), 'utf8');
    assert.match(engine, /execFileSync\('python', \[prepScript, String\(userCfg\.workshopId\)\]/);
    assert.doesNotMatch(engine, /execSync\(`python/);
    assert.strictEqual(hash(realConfig), realConfigBefore, 'Real config changed');
    console.log('security regression: PASS; EADDRINUSE exit=' + conflictingExit +
        '; real config sha256=' + realConfigBefore);
}

main().catch(error => { console.error(error, server?.output, competingServer?.output); process.exitCode = 1; })
    .finally(async () => {
        if (competingServer?.exitCode === null) competingServer.kill();
        if (server?.exitCode === null) server.kill();
        if (competingServer) await waitForExit(competingServer);
        if (server) await waitForExit(server);
        fs.rmSync(fixture, { recursive: true, force: true });
        assert.strictEqual(hash(realConfig), realConfigBefore, 'Real config changed');
        console.log('fixture servers exited: ' + (server?.pid ?? 'none') + ', ' +
            (competingServer?.pid ?? 'none'));
    });
