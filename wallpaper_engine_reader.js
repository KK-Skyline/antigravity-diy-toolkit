const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

/**
 * 高鲁棒性 Steam 路径嗅探与 Wallpaper Engine 创意工坊壁纸发现引擎
 * 通过 Windows 注册表 HKCU\Software\Valve\Steam\SteamPath 与 libraryfolders.vdf 解析，
 * 全自动发现安装在任意磁盘分区的 Steam 与 Wallpaper Engine (AppID 431960)
 */
function getSteamPathFromRegistry() {
    try {
        const out = child_process.execSync('reg query HKCU\\Software\\Valve\\Steam /v SteamPath', { encoding: 'utf8', windowsHide: true });
        const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
        return match ? match[1].trim() : null;
    } catch (e) {
        return null;
    }
}

function parseLibraryFolders(vdfPath) {
    if (!fs.existsSync(vdfPath)) return [];
    try {
        const text = fs.readFileSync(vdfPath, 'utf8');
        const libs = [];
        let current = null;
        for (const line of text.split(/\r?\n/)) {
            const m = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
            if (m) {
                current = m[1].replace(/\\\\/g, '\\');
                continue;
            }
            if (current && line.includes('431960')) {
                if (!libs.includes(current)) libs.push(current);
            }
        }
        return libs;
    } catch (e) {
        return [];
    }
}

function getSteamRoots() {
    const probeCandidates = [];

    // 1. 尝试从 Windows 注册表与 libraryfolders.vdf 读取实际库路径
    const steamRoot = getSteamPathFromRegistry();
    if (steamRoot) {
        probeCandidates.push(steamRoot);
        const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
        const vdfLibs = parseLibraryFolders(vdf);
        probeCandidates.push(...vdfLibs);
    }

    // 2. 常见兜底路径
    const commonRoots = [
        'E:/SteamLibrary',
        'C:/Program Files (x86)/Steam',
        'C:/Program Files/Steam',
        'C:/SteamLibrary',
        'D:/SteamLibrary',
        'D:/Steam',
        'F:/SteamLibrary',
        'G:/SteamLibrary'
    ];
    for (const r of commonRoots) {
        if (!probeCandidates.includes(r)) {
            probeCandidates.push(r);
        }
    }
    return probeCandidates;
}

function findWallpaperEngineConfig() {
    const roots = getSteamRoots();
    for (const root of roots) {
        const cfgPath = path.join(root, 'steamapps', 'common', 'wallpaper_engine', 'config.json');
        if (fs.existsSync(cfgPath)) {
            return cfgPath.replace(/\\/g, '/');
        }
    }
    return null;
}

function parseWallpaperDir(dir, monitorKey = 'Default', configPath = '') {
    const result = {
        configPath,
        monitor: monitorKey,
        filePath: path.join(dir, 'scene.pkg').replace(/\\/g, '/'),
        dir,
        title: 'Wallpaper Engine 壁纸',
        type: 'image',
        mediaPath: null,
        mediaType: 'image/jpeg',
        fileSize: 0
    };

    const projectPath = path.join(dir, 'project.json');
    let project = {};
    if (fs.existsSync(projectPath)) {
        try {
            project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
            if (project.title) result.title = project.title;
        } catch (e) {}
    }

    // 1. 视频壁纸：直接播放原视频（原始分辨率、完整时长、原生帧率、硬件解码），
    //    这里只记录视频路径，另外挑一张静态图作为加载完成前的占位封面
    const projectFile = String(project.file || '').toLowerCase();
    const isProjectVideo = projectFile.endsWith('.mp4') || projectFile.endsWith('.webm');
    // 场景壁纸的主画面如果是嵌入视频，prepare_hd_wallpaper.py 会把它提取成 scene_video.mp4，同样按视频播放
    const sceneVideo = path.join(dir, 'scene_video.mp4');
    const videoPath = isProjectVideo ? path.join(dir, project.file) : (fs.existsSync(sceneVideo) ? sceneVideo : null);
    if (videoPath && fs.existsSync(videoPath)) {
        result.type = 'video';
        result.videoPath = videoPath.replace(/\\/g, '/');
        result.videoMime = videoPath.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
        const posters = [
            path.join(dir, 'preview_hd.jpg'),
            path.join(dir, 'preview.jpg'),
            path.join(dir, 'preview.png'),
            project.preview ? path.join(dir, project.preview) : null,
            path.join(dir, 'preview.gif')
        ].filter(Boolean);
        for (const p of posters) {
            if (fs.existsSync(p)) {
                result.mediaPath = p;
                const ext = path.extname(p).toLowerCase();
                result.mediaType = ext === '.gif' ? 'image/gif' : ext === '.png' ? 'image/png' : 'image/jpeg';
                result.fileSize = fs.statSync(p).size;
                break;
            }
        }
        return result;
    }
    // project.json 声明是视频，但视频文件不存在（通常是创意工坊还没下载完）
    if (projectFile.endsWith('.mp4') || projectFile.endsWith('.webm')) {
        result.videoMissing = true;
    }

    // 2. 场景 / 图片壁纸的智能多级回退候选链：
    // ① 高清超清动画帧 preview_animated.webp (1600x900 丝滑动态，清晰度与动感兼得)
    // ② 高清重构原画 preview_hd.jpg / preview_hd.png (2560x1440 4K 超清)
    // ③ preview.gif 动画帧
    // ④ project.preview 指定的预览帧
    // ⑤ 高清 preview.png / preview.jpg
    const candidates = [
        path.join(dir, 'preview_animated.webp'),
        path.join(dir, 'preview_hd.jpg'),
        path.join(dir, 'preview_hd.png'),
        path.join(dir, 'preview.gif'),
        project.preview ? path.join(dir, project.preview) : null,
        path.join(dir, 'preview.png'),
        path.join(dir, 'preview.jpg'),
        path.join(dir, 'preview.jpeg')
    ].filter(Boolean);

    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            result.mediaPath = cand;
            const ext = path.extname(cand).toLowerCase().replace('.', '');
            if (ext === 'gif') {
                result.type = 'gif';
                result.mediaType = 'image/gif';
            } else if (ext === 'webp') {
                result.type = 'webp';
                result.mediaType = 'image/webp';
            } else if (ext === 'png') {
                result.type = 'image';
                result.mediaType = 'image/png';
            } else {
                result.type = 'image';
                result.mediaType = 'image/jpeg';
            }
            result.fileSize = fs.statSync(cand).size;
            return result;
        }
    }

    return result;
}

function getWallpaperById(workshopId) {
    if (!workshopId) return null;
    const roots = getSteamRoots();
    for (const root of roots) {
        const itemDir = path.join(root, 'steamapps', 'workshop', 'content', '431960', String(workshopId));
        if (fs.existsSync(itemDir)) {
            return parseWallpaperDir(itemDir, 'Workshop_' + workshopId);
        }
    }
    return null;
}

function getActiveWallpaper(customMonitor = null, targetWorkshopId = null) {
    // 1. 如果显式指定了创意工坊 ID (例如 3284620554 兵长利威尔)
    if (targetWorkshopId) {
        const specific = getWallpaperById(targetWorkshopId);
        if (specific && (specific.mediaPath || specific.videoPath)) {
            return specific;
        }
    }

    // 2. 自动从 Wallpaper Engine config.json 提取当前激活的壁纸
    const configPath = findWallpaperEngineConfig();
    if (!configPath) {
        // 如果没找到 config.json，尝试 fallback 兵长壁纸
        const fallbackLevi = getWallpaperById('3284620554');
        if (fallbackLevi && fallbackLevi.mediaPath) return fallbackLevi;
        return { error: '未找到 Wallpaper Engine 配置文件 config.json' };
    }

    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const cfg = JSON.parse(raw);
        let selectedWallpapers = null;

        for (const k of Object.keys(cfg)) {
            if (cfg[k] && cfg[k].general && cfg[k].general.wallpaperconfig && cfg[k].general.wallpaperconfig.selectedwallpapers) {
                selectedWallpapers = cfg[k].general.wallpaperconfig.selectedwallpapers;
                break;
            }
        }

        if (!selectedWallpapers) {
            const fallbackLevi = getWallpaperById('3284620554');
            if (fallbackLevi && fallbackLevi.mediaPath) return fallbackLevi;
            return { error: '未能从 config.json 解析到选中的壁纸配置' };
        }

        let monKey = customMonitor;
        if (!monKey || !selectedWallpapers[monKey]) {
            monKey = selectedWallpapers.Monitor0 ? 'Monitor0' : Object.keys(selectedWallpapers)[0];
        }

        const selected = selectedWallpapers[monKey];
        if (!selected || !selected.file) {
            const fallbackLevi = getWallpaperById('3284620554');
            if (fallbackLevi && fallbackLevi.mediaPath) return fallbackLevi;
            return { error: `显示器 [${monKey}] 未设置有效壁纸` };
        }

        const filePath = selected.file.replace(/\\\\/g, '/');
        const dir = path.dirname(filePath);
        return parseWallpaperDir(dir, monKey, configPath);
    } catch (e) {
        const fallbackLevi = getWallpaperById('3284620554');
        if (fallbackLevi && fallbackLevi.mediaPath) return fallbackLevi;
        return { error: '解析壁纸时出错: ' + e.message };
    }
}

if (require.main === module) {
    const res = getActiveWallpaper(null, '3284620554');
    console.log(JSON.stringify(res, null, 2));
}

module.exports = {
    findWallpaperEngineConfig,
    getActiveWallpaper,
    getWallpaperById
};
