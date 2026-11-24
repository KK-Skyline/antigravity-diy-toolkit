'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

// IMPORTANT: Always call child_process.execFileSync(...) via the module object
// rather than destructuring at top-level, so test shims (--require) can intercept
// tasklist, taskkill, /usr/bin/pgrep, and /usr/bin/osascript.

function macClientPids(installDir) {
    let output;
    try {
        output = child_process.execFileSync('/usr/bin/pgrep', ['-x', 'Antigravity'], { encoding: 'utf8' });
    } catch (error) {
        if (error.status === 1) return [];
        throw error;
    }
    const values = output.trim().split(/\s+/).filter(Boolean);
    if (values.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
        throw new Error('无法核验 macOS 客户端 PID。');
    }
    const pids = values.map(Number).filter(pid => pid !== process.pid);
    if (!pids.length) return [];
    let app = fs.realpathSync(installDir);
    while (!app.endsWith('.app') && path.dirname(app) !== app) app = path.dirname(app);
    if (!app.endsWith('.app')) throw new Error('无法定位 macOS 客户端应用包。');
    const expected = fs.realpathSync(path.join(app, 'Contents', 'MacOS', 'Antigravity'));
    return pids.filter(pid => {
        const script = `ObjC.import('AppKit'); function run(args) {
            const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(args[0]));
            if (!app) return 'null';
            return JSON.stringify({ pid: Number(app.processIdentifier), path: ObjC.unwrap(app.executableURL.path) });
        }`;
        const out = child_process.execFileSync('/usr/bin/osascript',
            ['-l', 'JavaScript', '-e', script, String(pid)], { encoding: 'utf8' });
        const identity = JSON.parse(out.trim());
        if (identity?.pid !== pid || typeof identity.path !== 'string' ||
            !path.isAbsolute(identity.path) || /[\r\n]/.test(identity.path)) {
            throw new Error(`无法核验 macOS 客户端进程 ${pid} 的可执行路径。`);
        }
        return fs.realpathSync(identity.path) === expected;
    });
}

function checkIfAppIsRunning(installDir) {
    if (process.platform === 'win32') {
        const stdout = child_process.execFileSync('tasklist', ['/fi', 'imagename eq Antigravity.exe', '/nh'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
        });
        return stdout.split(/\r?\n/).some(line => /^Antigravity\.exe\s/i.test(line.trim()));
    }
    if (process.platform === 'darwin') {
        return macClientPids(installDir).length > 0;
    }
    return false;
}

function closeAntigravityProcesses(installDir) {
    console.log("[1] 检测到 Antigravity 客户端正在运行，正在关闭以解除文件锁...");
    try {
        if (process.platform === 'win32') {
            child_process.execFileSync('taskkill', ['/f', '/im', 'Antigravity.exe', '/t'], { stdio: 'ignore', windowsHide: true });
        } else if (process.platform === 'darwin') {
            for (const pid of macClientPids(installDir)) process.kill(pid, 'SIGTERM');
        }
    } catch (e) {
        // ignore
    }
    const start = Date.now();
    while (Date.now() - start < 1500) {}
}

function detectInstallationDir(manualDir) {
    if (manualDir) {
        if (fs.existsSync(manualDir)) {
            let resolved = process.platform === 'darwin' ? fs.realpathSync(manualDir) : path.resolve(manualDir);
            if (fs.statSync(resolved).isFile() && resolved.endsWith('app.asar')) {
                resolved = path.dirname(resolved);
            }
            return resolved;
        } else {
            console.error(`[错误] 手动指定的路径不存在: ${manualDir}`);
            process.exit(1);
        }
    }

    const candidates = [];
    const seenCandidates = new Set();
    const addCandidate = (candidate) => {
        if (!candidate) return;
        const normalized = path.resolve(candidate);
        const key = normalized.toLowerCase();
        if (!seenCandidates.has(key)) {
            candidates.push(normalized);
            seenCandidates.add(key);
        }
    };
    const hasAntigravityResources = (candidate) => {
        return fs.existsSync(path.join(candidate, "resources", "app.asar")) ||
            fs.existsSync(path.join(candidate, "resources", "app.asar.rollback")) ||
            fs.existsSync(path.join(candidate, "resources", "app.asar.baseline.json")) ||
            fs.existsSync(path.join(candidate, "app.asar")) ||
            fs.existsSync(path.join(candidate, "app.asar.rollback")) ||
            fs.existsSync(path.join(candidate, "Contents", "Resources", "app.asar")) ||
            fs.existsSync(path.join(candidate, "Contents", "Resources", "app.asar.rollback")) ||
            fs.existsSync(path.join(candidate, "resources", "app", "product.json"));
    };

    if (process.platform === 'win32') {
        addCandidate(process.env.ANTIGRAVITY_INSTALL_DIR);
        addCandidate(process.env.ANTIGRAVITY_HOME);

        const registryRoots = [
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        ];
        for (const root of registryRoots) {
            try {
                const output = child_process.execFileSync('reg', ['query', root, '/s', '/f', 'Antigravity', '/d'], { encoding: 'utf-8', stdio: 'pipe' });
                for (const line of output.split(/\r?\n/)) {
                    const match = line.match(/^\s*(InstallLocation|DisplayIcon)\s+REG_\w+\s+(.+)$/i);
                    if (!match) continue;
                    let value = match[2].trim().replace(/^"|"$/g, '');
                    if (/Antigravity\.exe/i.test(value)) {
                        value = path.dirname(value);
                    }
                    addCandidate(value);
                }
            } catch (e) {
                // Registry probing is best-effort; fall back to common locations below.
            }
        }

        const driveLetters = ['C', 'D', 'E', 'F'];
        for (const drive of driveLetters) {
            addCandidate(`${drive}:\\Programs\\Antigravity`);
            addCandidate(`${drive}:\\Antigravity`);
        }
        addCandidate("C:\\Program Files\\Antigravity");

        const localAppdata = process.env.LOCALAPPDATA;
        if (localAppdata) {
            addCandidate(path.join(localAppdata, 'Programs', 'antigravity'));
        }
    } else if (process.platform === 'darwin') {
        addCandidate("/Applications/Antigravity.app");
        addCandidate(path.join(process.env.HOME || '', 'Applications', 'Antigravity.app'));
    }

    for (const p of candidates) {
        if (fs.existsSync(p) && hasAntigravityResources(p)) {
            console.log(`[探测] 成功自动识别到 Antigravity 安装目录: ${p}`);
            return path.resolve(p);
        }
    }

    console.error("[错误] 未找到默认安装目录，请使用 --install-dir 手动指定您的安装路径！");
    process.exit(1);
}

function runCommandSync(file, args) {
    try {
        const out = child_process.execFileSync(file, args, { encoding: 'utf-8', stdio: 'pipe' });
        return { success: true, stdout: out, stderr: '' };
    } catch (e) {
        return { success: false, stdout: e.stdout || '', stderr: e.stderr || e.message };
    }
}

function cleanElectronCache() {
    let appSupportDir = "";
    if (process.platform === 'darwin') {
        appSupportDir = path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity');
    } else if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        appSupportDir = path.join(appData, 'Antigravity');
    } else {
        appSupportDir = path.join(os.homedir(), '.config', 'Antigravity');
    }

    if (!fs.existsSync(appSupportDir)) return;

    const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache'];
    let cleanedCount = 0;
    for (const c of cacheDirs) {
        const p = path.join(appSupportDir, c);
        if (fs.existsSync(p)) {
            try {
                fs.rmSync(p, { recursive: true, force: true });
                cleanedCount++;
            } catch (e) {}
        }
    }
    if (cleanedCount > 0) {
        console.log(`[缓存] 已自动清理 ${cleanedCount} 个应用缓存目录，避免新旧版本字节码冲突。`);
    }
}

function resignAppOnMac(anyPath) {
    if (process.platform !== 'darwin') return;

    let targetApp = "";
    let current = path.resolve(anyPath);
    for (let i = 0; i < 10; i++) {
        if (current.endsWith(".app")) {
            targetApp = current;
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    if (targetApp && fs.existsSync(targetApp)) {
        try {
            runCommandSync('xattr', ['-d', '-r', 'com.apple.quarantine', targetApp]);
        } catch (e) {}
        console.log(`[签名] 检测到 macOS 平台，正在对应用包进行本地 ad-hoc 深度重签名: ${targetApp} ...`);
        const signRes = runCommandSync('codesign', ['--force', '--deep', '--sign', '-', targetApp]);
        if (signRes.success) {
            console.log(`[签名] 重新签名成功！`);
        } else {
            console.warn(`[警告] 重新签名失败。可能会导致应用无法打开。详情:\n${signRes.stderr}\n${signRes.stdout}`);
        }
    } else {
        console.warn(`[警告] 未能从路径 ${anyPath} 识别到有效的 .app 路径，跳过重新签名。`);
    }
}

function ensureWritePermission(targetDir) {
    if (process.platform !== 'darwin') return true;
    try {
        fs.accessSync(targetDir, fs.constants.W_OK);
        return true;
    } catch (err) {
        if (process.getuid && process.getuid() !== 0) {
            console.log("[权限] 检测到当前用户对 macOS 应用目录缺少写入权限，正在尝试请求管理员权限 (sudo) 重新运行...");
            const args = process.argv.slice(1);
            const res = child_process.spawnSync('sudo', [process.execPath, ...args], {
                stdio: 'inherit'
            });
            if (res.status === 0) {
                process.exit(0);
            } else {
                console.error("\n[错误] 管理员提权执行失败或用户取消了密码输入。");
                process.exit(res.status || 1);
            }
        }
        return false;
    }
}

module.exports = {
    macClientPids,
    checkIfAppIsRunning,
    closeAntigravityProcesses,
    detectInstallationDir,
    runCommandSync,
    cleanElectronCache,
    resignAppOnMac,
    ensureWritePermission
};
