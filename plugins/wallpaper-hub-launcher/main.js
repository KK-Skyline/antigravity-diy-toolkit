'use strict';

module.exports = function registerWallpaperHub(config) {
    const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const http = require('node:http');
    const path = require('node:path');
    const { setTimeout: delay } = require('node:timers/promises');

    const url = 'http://127.0.0.1:3210';
    const hubScript = path.join(config.hubDir, 'wallpaper_hub_server.js');
    let inFlight;
    let hubWindow;

    function getBody(route, limit, deadline) {
        return new Promise((resolve, reject) => {
            const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
            const request = http.get(url + route, { signal }, response => {
                response.on('error', reject);
                if (response.statusCode !== 200) {
                    resolve(null);
                    response.destroy();
                    return;
                }
                const chunks = [];
                let size = 0;
                response.on('data', chunk => {
                    size += chunk.length;
                    if (size > limit) {
                        resolve(null);
                        response.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => resolve(Buffer.concat(chunks)));
            });
            request.on('error', reject);
        });
    }

    async function probeHub(expectedJs, deadline) {
        try {
            const body = await getBody('/api/config', 65536, deadline);
            if (!body) return 'foreign';
            const cfg = JSON.parse(body.toString('utf8'));
            if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'foreign';
            const asset = await getBody('/hub.js', expectedJs.length, deadline);
            return asset?.equals(expectedJs) ? 'ready' : 'foreign';
        } catch (error) {
            if (error instanceof SyntaxError) return 'foreign';
            if (error.code === 'ECONNREFUSED') return 'offline';
            if (['ABORT_ERR', 'ECONNRESET', 'EPIPE'].includes(error.code)) return 'pending';
            throw error;
        }
    }

    async function startHub(deadline) {
        const onWindows = process.platform === 'win32';
        const entry = onWindows
            ? path.join(config.hubDir, 'plugins', 'wallpaper-hub-launcher', 'start-hub.js')
            : hubScript;
        const node = fs.existsSync(config.nodeExec) ? config.nodeExec : 'node';
        await fs.promises.access(entry, fs.constants.R_OK);
        return new Promise((resolve, reject) => {
            const child = spawn(node, [entry], {
                cwd: config.hubDir, detached: !onWindows,
                stdio: onWindows ? ['ignore', 'ignore', 'pipe'] : 'ignore',
                windowsHide: true, shell: false,
                signal: onWindows ? AbortSignal.timeout(Math.max(1, deadline - Date.now())) : undefined
            });
            child.once('error', reject);
            if (onWindows) {
                let reason = '';
                child.stderr.on('data', chunk => { if (!reason) reason = chunk.toString().trim(); });
                child.once('close', code => {
                    if (code === 0) resolve();
                    else reject(Object.assign(new Error('Hub starter failed'), { code: reason || 'STARTER_EXIT_' + code }));
                });
            } else {
                child.once('spawn', () => { child.unref(); resolve(); });
            }
        });
    }

    function allowedNavigation(target) {
        try {
            const dest = new URL(target);
            return !dest.username && !dest.password &&
                (dest.origin === url || dest.origin === 'http://localhost:3210');
        } catch {
            return false;
        }
    }

    async function openWindow() {
        if (hubWindow && !hubWindow.isDestroyed()) {
            if (hubWindow.isMinimized()) hubWindow.restore();
            hubWindow.focus();
            return;
        }
        const win = new BrowserWindow({
            width: 1220, height: 820, title: 'Antigravity 壁纸选择库',
            autoHideMenuBar: true, backgroundColor: '#0b0f19',
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
        });
        hubWindow = win;
        win.once('closed', () => { if (hubWindow === win) hubWindow = null; });
        const guard = (event, target) => { if (!allowedNavigation(event.url || target)) event.preventDefault(); };
        win.webContents.on('will-navigate', guard);
        win.webContents.on('will-redirect', guard);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        try {
            await win.loadURL(url);
        } catch (error) {
            if (!win.isDestroyed()) win.destroy();
            throw error;
        }
    }

    async function fail(error, message, cause) {
        if (cause) {
            const code = cause.code || cause.name;
            console.error('[Wallpaper Hub]', error,
                typeof code === 'string' && /^[\w-]{1,48}$/.test(code) ? code : 'UNKNOWN_ERROR');
        }
        try {
            await dialog.showMessageBox({ type: 'error', title: 'Antigravity 壁纸选择库', message });
        } catch {
            console.error('[Wallpaper Hub]', message);
        }
        return { ok: false, error, message };
    }

    async function launch() {
        let expectedJs;
        try {
            await fs.promises.access(hubScript, fs.constants.R_OK);
            expectedJs = await fs.promises.readFile(path.join(config.hubDir, 'hub.js'));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return fail('hub_script_missing', '未找到壁纸选择库脚本，请重新运行安装器。');
            }
            return fail('hub_read_failed', '无法读取壁纸选择库文件，请检查工具包的访问权限。', error);
        }
        const timeout = () => fail('hub_start_timeout', '壁纸选择库启动超时，请检查端口 3210 后重试。');
        let state = await probeHub(expectedJs, Date.now() + 600);
        if (state === 'pending') return fail('hub_probe_failed', '无法核验端口 3210 上的壁纸选择库，请重试。');
        if (state === 'offline') {
            const deadline = Date.now() + 5000;
            try {
                await startHub(deadline);
            } catch (error) {
                if (error.code === 'ABORT_ERR') return timeout();
                return fail('hub_start_failed', '无法启动壁纸选择库，请检查 Node.js 和工具包后重试。', error);
            }
            while (Date.now() < deadline) {
                state = await probeHub(expectedJs, Math.min(deadline, Date.now() + 600));
                if (state === 'ready' || state === 'foreign') break;
                await delay(Math.min(150, Math.max(0, deadline - Date.now())));
            }
        }
        if (state === 'foreign') return fail('hub_port_in_use', '端口 3210 的服务未能确认为本工具的壁纸选择库。');
        if (state !== 'ready') return timeout();
        if (config.openMode === 'window') await openWindow();
        else await shell.openExternal(url);
        return { ok: true, mode: config.openMode, url };
    }

    function openWallpaperHub() {
        if (!inFlight) {
            inFlight = launch()
                .catch(error => fail('hub_open_failed', '无法打开壁纸选择库，请重试。', error))
                .finally(() => { inFlight = null; });
        }
        return inFlight;
    }

    ipcMain.handle('antigravity:open-wallpaper-hub', (event, ...args) => {
        if (args.length || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
            return { ok: false, error: 'invalid_invocation' };
        }
        return openWallpaperHub();
    });
    return { openWallpaperHub };
};
