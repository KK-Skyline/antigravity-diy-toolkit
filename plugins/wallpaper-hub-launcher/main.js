'use strict';

module.exports = function registerWallpaperHub(config) {
    const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const http = require('node:http');
    const path = require('node:path');
    const { setTimeout: delay } = require('node:timers/promises');

    const DEFAULT_MESSAGES = {
        hubScriptMissing: 'Wallpaper Hub script not found. Please re-run the installer.',
        hubReadFailed: 'Unable to read Wallpaper Hub files. Please check toolkit permissions.',
        hubStartTimeout: 'Wallpaper Hub timed out while starting. Check port 3210 and try again.',
        hubStartFailed: 'Unable to start Wallpaper Hub. Check Node.js and the toolkit, then try again.',
        hubPortInUse: 'The service on port 3210 could not be verified as Antigravity Wallpaper Hub.',
        hubOpenFailed: 'Could not open Wallpaper Hub. Please try again.'
    };
    const title = typeof config.title === 'string' && config.title ? config.title : 'Antigravity Wallpaper Hub';
    const messages = {
        ...DEFAULT_MESSAGES,
        ...(config.messages && typeof config.messages === 'object' ? config.messages : {})
    };
    const HUB_WEB_PREFERENCES = { contextIsolation: true, nodeIntegration: false, sandbox: true };
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

    function isValidHubConfig(cfg) {
        return Boolean(cfg && typeof cfg === 'object' && !Array.isArray(cfg) &&
            typeof cfg.enabled === 'boolean' &&
            typeof cfg.workshopId === 'string' &&
            typeof cfg.opacity === 'number' &&
            typeof cfg.blur === 'number');
    }

    async function probeHub(deadline) {
        try {
            const body = await getBody('/api/config', 65536, deadline);
            if (!body) return 'foreign';
            const cfg = JSON.parse(body.toString('utf8'));
            return isValidHubConfig(cfg) ? 'ready' : 'foreign';
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
                    else {
                        const err = Object.assign(new Error('Hub starter failed'), { code: 'STARTER_EXIT_' + code });
                        if (/^[\w-]{1,48}$/.test(reason)) err.starterReason = reason;
                        reject(err);
                    }
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
            width: 1220, height: 820, title,
            autoHideMenuBar: true, backgroundColor: '#0b0f19',
            webPreferences: HUB_WEB_PREFERENCES
        });
        hubWindow = win;
        win.once('closed', () => { if (hubWindow === win) hubWindow = null; });
        const guard = (event, target) => { if (!allowedNavigation(event.url || target)) event.preventDefault(); };
        win.webContents.on('will-navigate', guard);
        win.webContents.on('will-redirect', guard);
        win.webContents.setWindowOpenHandler(({ url: target }) => {
            if (!allowedNavigation(target)) return { action: 'deny' };
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    autoHideMenuBar: true,
                    webPreferences: HUB_WEB_PREFERENCES
                }
            };
        });
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
            const safeCode = typeof code === 'string' && /^[\w-]{1,48}$/.test(code) ? code : 'UNKNOWN_ERROR';
            const safeReason = typeof cause.starterReason === 'string' && /^[\w-]{1,48}$/.test(cause.starterReason)
                ? cause.starterReason
                : null;
            console.error('[Wallpaper Hub]', error, safeReason ? `${safeCode}:${safeReason}` : safeCode);
        }
        try {
            await dialog.showMessageBox({ type: 'error', title, message });
        } catch {
            console.error('[Wallpaper Hub]', message);
        }
        return { ok: false, error, message };
    }

    async function waitForHub(deadline, shouldStop, delayFirst) {
        let state;
        while (Date.now() < deadline) {
            if (delayFirst) await delay(Math.min(150, Math.max(0, deadline - Date.now())));
            state = await probeHub(Math.min(deadline, Date.now() + 600));
            if (shouldStop(state)) break;
            if (!delayFirst) await delay(Math.min(150, Math.max(0, deadline - Date.now())));
        }
        return state;
    }

    async function launch() {
        const timeout = () => fail('hub_start_timeout', messages.hubStartTimeout);
        let state = await probeHub(Date.now() + 600);
        if (state === 'pending') {
            state = await waitForHub(Date.now() + 5000, s => s !== 'pending', true) ?? state;
        }
        if (state === 'offline') {
            try {
                await fs.promises.access(hubScript, fs.constants.R_OK);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return fail('hub_script_missing', messages.hubScriptMissing);
                }
                return fail('hub_read_failed', messages.hubReadFailed, error);
            }
            const deadline = Date.now() + 5000;
            try {
                await startHub(deadline);
            } catch (error) {
                if (error.code === 'ABORT_ERR') return timeout();
                return fail('hub_start_failed', messages.hubStartFailed, error);
            }
            state = await waitForHub(deadline, s => s === 'ready' || s === 'foreign', false) ?? state;
        }
        if (state === 'foreign') return fail('hub_port_in_use', messages.hubPortInUse);
        if (state !== 'ready') return timeout();
        if (config.openMode === 'window') await openWindow();
        else await shell.openExternal(url);
        return { ok: true, mode: config.openMode, url };
    }

    function openWallpaperHub() {
        if (!inFlight) {
            inFlight = launch()
                .catch(error => fail('hub_open_failed', messages.hubOpenFailed, error))
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
