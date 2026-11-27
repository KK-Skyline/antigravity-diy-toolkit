'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

// The Windows installer closes the client's process tree. Exit before the Hub is opened.
// Windows 安装器会关闭客户端进程树，打开壁纸库前先退出这个启动进程。
const hubDir = path.resolve(__dirname, '..', '..');
const child = spawn(process.execPath, [path.join(hubDir, 'wallpaper_hub_server.js')], {
    cwd: hubDir, detached: true, stdio: 'ignore', windowsHide: true, shell: false
});
child.once('error', error => {
    console.error(error.code || 'SPAWN_FAILED');
    process.exitCode = 1;
});
child.once('spawn', () => child.unref());
