'use strict';

const fs = require('fs');
const path = require('path');

function normalizeText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ')
        .trim()
        .replace(/’/g, "'")
        .replace(/‘/g, "'")
        .replace(/“/g, '"')
        .replace(/”/g, '"')
        .replace(/…/g, '...');
}

function loadDictionary(rootDir, locale, brandTitleMode) {
    const dictsFolder = locale === 'zh-TW' ? 'dicts_tw' : 'dicts';
    const totalMap = {};
    const dictsDir = path.join(rootDir, dictsFolder);
    if (fs.existsSync(dictsDir)) {
        const files = fs.readdirSync(dictsDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(dictsDir, file);
                    const fileContent = fs.readFileSync(filePath, 'utf-8');
                    const data = JSON.parse(fileContent);
                    for (const [k, v] of Object.entries(data)) {
                        const normK = normalizeText(k);
                        if (normK) totalMap[normK] = v;
                    }
                } catch (e) {
                    // ignore
                }
            }
        }
    }
    if (brandTitleMode === 'english') {
        delete totalMap[normalizeText('Antigravity')];
    } else if (brandTitleMode === 'hidden') {
        totalMap[normalizeText('Antigravity')] = '';
    }
    return totalMap;
}

function cleanMenuJsContent(content) {
    const startMark = "// ==========================================";
    const endMark = "translateMenu(menu.items);";
    const startIdx = content.indexOf(startMark);
    const endIdx = content.indexOf(endMark);
    if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
        return content.substring(0, startIdx) + content.substring(endIdx + endMark.length);
    }
    return content;
}

function cleanTrayJsContent(content) {
    const pairs = [
        ["/* --- TRAY TRANSLATION START --- */", "/* --- TRAY TRANSLATION END --- */"],
        ["/* --- TRAY DOUBLE CLICK START --- */", "/* --- TRAY DOUBLE CLICK END --- */"],
        ["/* --- TRAY INSERT TRANSLATION START --- */", "/* --- TRAY INSERT TRANSLATION END --- */"]
    ];
    for (const [startMark, endMark] of pairs) {
        const startIdx = content.indexOf(startMark);
        const endIdx = content.indexOf(endMark);
        if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
            content = content.substring(0, startIdx) + content.substring(endIdx + endMark.length);
        }
    }
    return content;
}

function getI18nState(ctx) {
    if (ctx.shared && ctx.shared.i18n) return ctx.shared.i18n;
    const cfg = ctx.pluginConfig || {};
    const useTw = cfg.locale === 'zh-TW' || Boolean(ctx.cliFlags && ctx.cliFlags.USE_TW);
    const locale = useTw ? 'zh-TW' : 'zh-CN';
    const brandTitle = cfg.brandTitle || (ctx.cliFlags && ctx.cliFlags.BRAND_TITLE_MODE) || 'english';
    const fullDict = loadDictionary(ctx.rootDir, locale, brandTitle);
    const longEntries = Object.entries(fullDict).sort((a, b) => b[0].length - a[0].length);
    const state = {
        useTw,
        locale,
        brandTitle,
        dictJson: JSON.stringify(fullDict, null, 4),
        entriesJson: JSON.stringify(longEntries)
    };
    if (ctx.shared) ctx.shared.i18n = state;
    return state;
}

module.exports = {
    prepare(ctx) {
        getI18nState(ctx);
    },

    patchMain(ctx) {
        if (!ctx.isV2 || !ctx.distDir) return;
        const { useTw: USE_TW } = getI18nState(ctx);

        // 3.1 注入 menu.js (系统菜单汉化)
        const menuPath = path.join(ctx.distDir, 'menu.js');
        if (fs.existsSync(menuPath)) {
            console.log(`[修改] 正在向 menu.js 注入菜单汉化代码...`);
            const menuContent = fs.readFileSync(menuPath, 'utf-8');
            const menuCleaned = cleanMenuJsContent(menuContent);

            const menuTranslationJs = `
    // ==========================================
    // Antigravity Native Menu Chinese Translation
    // ==========================================
    const translations = ${USE_TW ? `{
        'File': '檔案',
        'Edit': '編輯',
        'View': '檢視',
        'Window': '視窗',
        'Help': '說明',
        'New Window': '開新視窗',
        'Create Project': '建立專案',
        'Command Palette': '命令選擇區',
        'Docs': '說明文件',
        'Check for Updates': '檢查更新',
        'Toggle Developer Tools': '切換開發人員工具',
        'Undo': '復原',
        'Redo': '重做',
        'Cut': '剪下',
        'Copy': '複製',
        'Paste': '貼上',
        'Select All': '全選',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '關閉',
        'Zoom': '縮放',
        'Reset Zoom': '重設縮放',
        'Zoom In': '放大',
        'Zoom Out': '縮小',
        'Toggle Full Screen': '切換全螢幕',
        'Split Terminal': '分割終端機',
        'Split Conversation Horizontally': '水平分割對話',
        'Split Conversation Vertically': '垂直分割對話',
        'Find in conversation': '在對話中尋找',
        'Connect to WSL': '連線到 WSL',
        'Reopen Locally': '在本機重新開啟',
        'Version': '版本'
    }` : `{
        'File': '文件',
        'Edit': '编辑',
        'View': '视图',
        'Window': '窗口',
        'Help': '帮助',
        'New Window': '新建窗口',
        'Create Project': '创建项目',
        'Command Palette': '命令面板',
        'Docs': '文档',
        'Check for Updates': '检查更新',
        'Toggle Developer Tools': '切换开发者工具',
        'Undo': '撤销',
        'Redo': '重做',
        'Cut': '剪切',
        'Copy': '复制',
        'Paste': '粘贴',
        'Select All': '全选',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '关闭',
        'Zoom': '缩放',
        'Reset Zoom': '重置缩放',
        'Zoom In': '放大',
        'Zoom Out': '缩小',
        'Toggle Full Screen': '切换全屏',
        'Split Terminal': '拆分终端',
        'Split Conversation Horizontally': '水平拆分会话',
        'Split Conversation Vertically': '垂直拆分会话',
        'Find in conversation': '在会话中查找',
        'Connect to WSL': '连接到 WSL',
        'Reopen Locally': '在本地重新打开',
        'Version': '版本'
    }`};
    function translateMenu(items) {
        for (const item of items) {
            let label = item.label || '';
            let mnemonic = '';
            let cleanLabel = label;
            const m = label.match(/&([a-zA-Z])/);
            if (m) {
                mnemonic = "(&" + m[1] + ")";
                cleanLabel = label.replace('&', '');
            }
            if (translations[cleanLabel]) {
                item.label = translations[cleanLabel] + mnemonic;
            } else if (translations[label]) {
                item.label = translations[label];
            } else if (/^Version\\s*([\\d\\.]*)$/i.test(cleanLabel)) {
                item.label = cleanLabel.replace(/^Version\\s*([\\d\\.]*)$/i, (match, v) => v ? "版本 " + v : "版本");
            }
            if (item.submenu && item.submenu.items) {
                translateMenu(item.submenu.items);
            }
        }
    }
    translateMenu(menu.items);
    `;

            const targetStr = "electron_1.Menu.setApplicationMenu(menu);";
            const idx = menuCleaned.indexOf(targetStr);
            if (idx !== -1) {
                let patchedMenuContent = menuCleaned.substring(0, idx) + menuTranslationJs + "\n    " + menuCleaned.substring(idx);
                const wslLabelConnect = USE_TW ? '連線到 WSL' : '连接到 WSL';
                const wslLabelLocal = USE_TW ? '在本機重新開啟' : '在本地重新打开';
                patchedMenuContent = patchedMenuContent
                    .replace(/return \{ label: '(?:Connect to WSL|连接到 WSL|連線到 WSL)', submenu \};/, `return { label: '${wslLabelConnect}', submenu };`)
                    .replace(/return \{ label: '(?:Reopen Locally|在本地重新打开|在本機重新開啟)', click: \(\) => relaunchWithWslDistro\(''\) \};/, `return { label: '${wslLabelLocal}', click: () => relaunchWithWslDistro('') };`)
                    .replace(
                        "const submenuItem = appMenu.items.find((item) => item.label === submenuLabel);",
                        `const submenuAliases = submenuLabel === 'File' ? ['File', '文件', '檔案', '文件(&F)', '檔案(&F)'] : [submenuLabel];\n    const submenuItem = appMenu.items.find((item) => submenuAliases.includes(item.label) || (submenuLabel === 'File' && /^(文件|檔案)/.test(item.label || '')));`
                    );
                fs.writeFileSync(menuPath, patchedMenuContent, 'utf-8');
                console.log(`[修改] 菜单汉化注入成功！`);
            } else {
                console.warn(`[警告] 未能在 menu.js 中找到设定的插入点。`);
            }
        }

        // 3.2 注入 tray.js (任务栏右键菜单汉化)
        const trayPath = path.join(ctx.distDir, 'tray.js');
        if (fs.existsSync(trayPath)) {
            console.log(`[修改] 正在向 tray.js 注入任务栏菜单汉化...`);
            const trayContent = fs.readFileSync(trayPath, 'utf-8');
            const trayCleaned = cleanTrayJsContent(trayContent);

            const createTrayRegex = /function createTray\(([^)]*)\)\s*\{/;
            const trayTransBlock = `/* --- TRAY TRANSLATION START --- */
    const translations = ${USE_TW ? `{
        'No agents running': '無執行中的代理',
        'Open Antigravity': '開啟 Antigravity',
        'Connect to WSL': '連線到 WSL',
        'Reopen Locally': '在本機重新開啟',
        'Quit': '結束'
    }` : `{
        'No agents running': '无运行中的智能体',
        'Open Antigravity': '打开反重力智能编程',
        'Connect to WSL': '连接到 WSL',
        'Reopen Locally': '在本地重新打开',
        'Quit': '退出'
    }`};
    for (const item of actions) {
        if (item && translations[item.label]) {
            item.label = translations[item.label];
        }
    }
    /* --- TRAY TRANSLATION END --- */`;

            let trayPatched = trayCleaned.replace(createTrayRegex, (m, params) => `function createTray(${params}) {\n    ${trayTransBlock}`);

            const insertTrayRegex = /function insertTrayMenuItem\(([^)]*)\)\s*\{/;
            const trayInsertBlock = `/* --- TRAY INSERT TRANSLATION START --- */
    const insertTranslations = ${USE_TW ? `{
        'Connect to WSL': '連線到 WSL',
        'Reopen Locally': '在本機重新開啟'
    }` : `{
        'Connect to WSL': '连接到 WSL',
        'Reopen Locally': '在本地重新打开'
    }`};
    if (options && insertTranslations[options.label]) {
        options = { ...options, label: insertTranslations[options.label] };
    }
    /* --- TRAY INSERT TRANSLATION END --- */`;
            trayPatched = trayPatched.replace(insertTrayRegex, (m, params) => `function insertTrayMenuItem(${params}) {\n    ${trayInsertBlock}`);

            const dblClickTarget = /tray\.setContextMenu\(contextMenu\);/;
            const dblClickReplacement = `tray.setContextMenu(contextMenu);
    /* --- TRAY DOUBLE CLICK START --- */
    const openAction = actions.find(item => item && typeof item.click === 'function' && !['Quit', '退出', '結束'].includes(item.label));
    if (openAction) {
        tray.on('double-click', () => {
            const wins = (typeof utils_1 !== 'undefined' && typeof utils_1.getLocalHubWindows === 'function' ? (0, utils_1.getLocalHubWindows)() : null)
                || (electron_1.BaseWindow && typeof electron_1.BaseWindow.getAllWindows === 'function' ? electron_1.BaseWindow.getAllWindows() : null)
                || electron_1.BrowserWindow.getAllWindows();
            if (wins.length > 0 && wins[0].isMinimized && wins[0].isMinimized()) {
                wins[0].restore();
            }
            openAction.click();
        });
    }
    /* --- TRAY DOUBLE CLICK END --- */`;
            trayPatched = trayPatched.replace(dblClickTarget, dblClickReplacement);

            const countRegex = /countItem\.label\s*=\s*(?:\([\s\S]*?' running'|count > 0 \? `\$\{count\} (?:个智能体运行中|個代理執行中)` : '(?:无运行中的智能体|無執行中的代理)');/g;
            const replacementCount = USE_TW
                ? "countItem.label = count > 0 ? `${count} 個代理執行中` : '無執行中的代理';"
                : "countItem.label = count > 0 ? `${count} 个智能体运行中` : '无运行中的智能体';";
            trayPatched = trayPatched.replace(countRegex, replacementCount);

            fs.writeFileSync(trayPath, trayPatched, 'utf-8');
            console.log(`[修改] 任务栏菜单汉化注入成功！`);
        }

        // 3.3 注入 loadingOverlay.js (加载页汉化)
        const loadingPath = path.join(ctx.distDir, 'loadingOverlay.js');
        if (fs.existsSync(loadingPath)) {
            const loadingContent = fs.readFileSync(loadingPath, 'utf-8');
            const replacementText = USE_TW
                ? '<div class="text">正在載入 Antigravity…</div>'
                : '<div class="text">正在加载 Antigravity…</div>';
            const updatedLoading = loadingContent
                .replace('<div class="text">Loading Antigravity</div>', replacementText)
                .replace('<div class="text">反重力引擎已啟動，正在努力擺脫地心引力...</div>', replacementText)
                .replace('<div class="text">反重力引擎已启动，正在努力摆脱地心引力...</div>', replacementText);
            if (updatedLoading !== loadingContent) {
                fs.writeFileSync(loadingPath, updatedLoading, 'utf-8');
                console.log(`[修改] 加载页汉化注入成功！`);
            } else {
                console.log(`[跳过] 当前版本的 loadingOverlay.js 为纯图标加载页，无需文本汉化。`);
            }
        }

        // 3.4 注入 updater.js (更新弹窗汉化)
        const updaterPath = path.join(ctx.distDir, 'updater.js');
        if (fs.existsSync(updaterPath)) {
            console.log(`[修改] 正在向 updater.js 注入更新弹窗汉化...`);
            let updaterContent = fs.readFileSync(updaterPath, 'utf-8');

            const targetOptions = `                title: 'Check for Updates',
                message: 'No updates available',
                buttons: ['OK'],`;
            const replacementOptions = USE_TW
                ? `                title: '檢查更新',
                message: '目前沒有可用的更新',
                buttons: ['好'],`
                : `                title: '检查更新',
                message: '暂无可用更新',
                buttons: ['确定'],`;

            updaterContent = updaterContent.replace(targetOptions, replacementOptions);
            fs.writeFileSync(updaterPath, updaterContent, 'utf-8');
            console.log(`[修改] 更新弹窗汉化注入成功！`);
        }
    },

    getPreloadRuntime(ctx) {
        const { useTw: USE_TW, dictJson, entriesJson } = getI18nState(ctx);
        const runtimeTemplate = `
    // V12.0 终极隔离版：基于容器回溯的物理隔离引擎
    // 逻辑：不再仅仅检查当前标签，而是向上回溯父级，识别“代码/编辑器”禁区
    const USE_TW = ${USE_TW ? "true" : "false"};
    const map = new Map(Object.entries(DICT_PLACEHOLDER));
    const lowerMap = new Map();
    for (const [k, v] of map.entries()) lowerMap.set(k.toLowerCase(), v);

    const longEntries = REPLACEMENT_ENTRIES_PLACEHOLDER;
    const translatedValues = new WeakMap();

    // 轻量级安全隔离：跳过脚本、样式、代码块(pre/code)、编辑器区域以及终端容器
    const SKIP_TAGS = ['SCRIPT', 'STYLE', 'PRE', 'CODE'];

    // 代码及编辑器隔离选择器：排除代码块、编辑器、文件预览器、代码差异区、终端、浏览器地址栏与嵌入视口及语法高亮 Token
    const CODE_ISOLATION_SELECTOR = 'pre, code, .monaco-editor, .cm-editor, .cm-line, [contenteditable="true"], .terminal, .xterm, .code-line, .code-block, .line-content, [aria-label="File Viewer"], [data-file-uri], [class*="diffEditor"], .token, .hljs, [class*="mtk"], [data-testid="background-task-command"], [data-testid="browser-url-display"], [data-browser-hole], webview';

    function isCodeOrEditor(node) {
        try {
            if (!node) return false;
            let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            while (el) {
                if (typeof el.closest === 'function' && el.closest(CODE_ISOLATION_SELECTOR)) {
                    return true;
                }
                const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
                el = (root && root.host) ? root.host : null;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    function norm(s) {
        if (!s) return '';
        return s.replace(/\\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').trim();
    }

    function translateWithShortcut(val) {
        if (!val) return null;
        const match = val.match(/^(.+?)\\s*\\((Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\\+?([^)]*)\\)$/i);
        if (match) {
            const prefix = match[1].trim();
            const normPref = norm(prefix);
            const lowerPref = normPref.toLowerCase();
            let transPref = null;
            if (map.has(normPref)) {
                transPref = map.get(normPref);
            } else if (lowerMap.has(lowerPref)) {
                transPref = lowerMap.get(lowerPref);
            }
            if (transPref) {
                return transPref + " (" + match[2] + (match[3] ? "+" + match[3] : "") + ")";
            }
        }
        return null;
    }

    function translateNode(node) {
        try {
            if (!node) return;
            if (isCodeOrEditor(node)) return;

            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toUpperCase();
                if (SKIP_TAGS.includes(tag)) return;
                if (node.isContentEditable) return;
                if (node.classList && (node.classList.contains('monaco-editor') || node.classList.contains('terminal') || node.classList.contains('xterm'))) return;

                // 翻译属性：placeholder, title, aria-label
                for (const attr of ['placeholder', 'title', 'aria-label']) {
                    const v = node.getAttribute(attr);
                    if (v) {
                        const t = norm(v);
                        const shortcutTrans = translateWithShortcut(t);
                        if (shortcutTrans) node.setAttribute(attr, shortcutTrans);
                        else if (map.has(t)) node.setAttribute(attr, map.get(t));
                        else if (lowerMap.has(t.toLowerCase())) node.setAttribute(attr, lowerMap.get(t.toLowerCase()));
                        else if (/^Show\\s+(\\d+)\\s+more/i.test(t)) {
                            const trans = t.replace(/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i, (m, num, p2, type) => {
                                if (type) {
                                    if (/result/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個結果...") : ("显示另外 " + num + " 个结果...");
                                    if (/command/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個命令...") : ("显示另外 " + num + " 个命令...");
                                    if (/item/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個項目...") : ("显示另外 " + num + " 个项目...");
                                    if (/option/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個選項...") : ("显示另外 " + num + " 个选项...");
                                }
                                return USE_TW ? ("顯示另外 " + num + " 個...") : ("显示另外 " + num + " 个...");
                            });
                            node.setAttribute(attr, trans);
                        } else if (/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(t)) {
                            const trans = t.replace(/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, del, name, count, dot) => {
                                const delPrefix = del ? (USE_TW ? "永久刪除 " : "永久删除 ") : "";
                                const suffix = dot ? "。" : "";
                                return delPrefix + name + (USE_TW ? ("（包含 " + count + " 個活躍對話）") : ("（包含 " + count + " 个活跃会话）")) + suffix;
                            });
                            node.setAttribute(attr, trans);
                        }
                    }
                }

                if (node.shadowRoot) translateNode(node.shadowRoot);
                for (const child of node.childNodes) translateNode(child);

            } else if (node.nodeType === Node.TEXT_NODE) {
                if (isCodeOrEditor(node)) return;

                let originalVal = node.nodeValue;
                if (!originalVal || originalVal.trim().length < 1) return;

                if (originalVal.toLowerCase().includes('pack.info')) {
                    const parent = node.parentElement;
                    if (parent) {
                        if (parent.getAttribute('translate') !== 'no') {
                            parent.setAttribute('translate', 'no');
                        }
                        try {
                            if (!parent.classList.contains('notranslate')) {
                                parent.classList.add('notranslate');
                            }
                        } catch (e) {}
                    }
                    return;
                }

                if (translatedValues.get(node) === originalVal) return;

                let newVal = originalVal;
                const valNorm = norm(originalVal);
                const valLower = valNorm.toLowerCase();

                const shortcutTrans = translateWithShortcut(valNorm);
                if (shortcutTrans) {
                    newVal = shortcutTrans;
                } else if (map.has(valNorm)) {
                    newVal = map.get(valNorm);
                } else if (lowerMap.has(valLower)) {
                    newVal = lowerMap.get(valLower);
                } else if (/^The AlloyDB for PostgreSQL remote/i.test(valNorm)) {
                    newVal = USE_TW ? "AlloyDB for PostgreSQL 遠端 MCP 伺服器可讓您存取並執行 AlloyDB 工具，用於管理 AlloyDB 叢集及執行個體、管理使用者，以及建立和復原資料備份。" : "AlloyDB for PostgreSQL 远程 MCP 服务器可让您访问并运行 AlloyDB 工具，用于管理 AlloyDB 集群及实例、管理用户，以及创建和恢复数据备份。";
                } else if (/^The Cloud SQL remote/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud SQL 遠端 MCP 伺服器可讓您存取並執行 Cloud SQL 工具，用於管理 Cloud SQL 執行個體、管理使用者、建立和復原資料備份及資料庫維運。" : "Cloud SQL 远程 MCP 服务器可让您访问并运行 Cloud SQL 工具，用于管理 Cloud SQL 实例、管理用户、创建和恢复数据备份及数据库运维。";
                } else if (/^The Spanner remote/i.test(valNorm)) {
                    newVal = USE_TW ? "Spanner 遠端 MCP 伺服器可讓您從 AI 開發環境中存取並執行 Spanner 工具，以建立、管理和查詢分散式資料庫資源。" : "Spanner 远程 MCP 服务器可让您从 AI 开发环境中访问并运行 Spanner 工具，以创建、管理和查询分布式数据库资源。";
                } else if (/^Ask questions\\.\\s*Get answers\\./i.test(valNorm) || /PostHog data/i.test(valNorm)) {
                    newVal = USE_TW ? "提問，即得答案。該 MCP 是供您的程式設計代理呼叫的伺服器。用英語提出問題，它會針對您的 PostHog 資料執行查詢，結果將直接呈現在您的編輯器中。" : "提问，即得答案。该 MCP 是供您的编程智能体调用的服务器。用英语提出问题，它会针对您的 PostHog 数据运行查询，结果将直接呈现在您的编辑器中。";
                } else if (/^The GKE remote MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "GKE 遠端 MCP 伺服器提供對 GKE Kubernetes 資源的讀寫存取權限。允許 AI 代理檢查並監控您的執行環境。" : "GKE 远程 MCP 服务器提供对 GKE Kubernetes 资源的读写权限。允许 AI 智能体检查并监控您的运行环境。";
                } else if (/^Cloud CLI MCP Server/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud CLI MCP 伺服器提供在遠端沙箱環境中執行 gcloud 與 bq CLI 指令的工具集。" : "Cloud CLI MCP 服务器提供在远程沙箱环境中运行 gcloud 与 bq CLI 命令的工具集。";
                } else if (/^The Apigee API hub remote MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Apigee API hub 遠端 MCP 伺服器可讓您管理註冊在 Apigee API hub 中的 API、版本、規格、操作、部署、屬性、外部 API 以及相依性。" : "Apigee API hub 远程 MCP 服务器可让您管理注册在 Apigee API hub 中的 API、版本、规范、操作、部署、属性、外部 API 以及依赖项。";
                } else if (/^The Google Home Developer MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Google Home Developer MCP 伺服器支援檢索 Google Home 文件、OpenThread 與 Matter 規格文件。" : "Google Home Developer MCP 服务器支持检索 Google Home 文档、OpenThread 与 Matter 规范文档。";
                } else if (/^The Cloud Quotas MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud Quotas MCP 伺服器支援檢視配額分配、申請提升配額以及管理 Quota Adjuster 自動調整設定。" : "Cloud Quotas MCP 服务器支持查看配额分配、申请提升配额以及管理 Quota Adjuster 自动调整配置。";
                } else if (/^Build, edit, deploy, and manage full-stack web apps with Lovable/i.test(valNorm)) {
                    newVal = USE_TW ? "使用自然語言，藉助 AI 應用程式建構工具 Lovable 建構、編輯、部署和管理全端 Web 應用程式。該 MCP 伺服器將您的 AI 用戶端連接至 Lovable，允許您的 AI 代理直接在偏好的編輯器或助手內互動、建立和管理 Lovable 專案。" : "使用自然语言，借助 AI 应用构建工具 Lovable 构建、编辑、部署和管理全栈 Web 应用。该 MCP 服务器将您的 AI 客户端连接至 Lovable，允许您的 AI 智能体直接在偏好的编辑器或助手中交互、创建和管理 Lovable 项目。";
                } else if (/^Build applications with the Gemini Interactions API and Live API/i.test(valNorm)) {
                    newVal = USE_TW ? "使用 Gemini Interactions API 與 Live API 建構應用程式，涵蓋文字生成、多輪對話、串流、函式呼叫、託管代理及即時音訊與視訊互動。" : "使用 Gemini Interactions API 和 Live API 构建应用，涵盖文本生成、多轮对话、流式传输、函数调用、托管智能体以及实时音视频交互。";
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?, (\\d+) hours?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?, (\\d+) hours?\\.?$/i, (match, d, h) => {
                        return USE_TW ? (d + " 天 " + h + " 小時後更新") : (d + " 天 " + h + " 小时后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?, (\\d+) minutes?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?, (\\d+) minutes?\\.?$/i, (match, h, m) => {
                        return USE_TW ? (h + " 小時 " + m + " 分鐘後更新") : (h + " 小时 " + m + " 分钟后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?\\.?$/i, (match, d) => {
                        return USE_TW ? (d + " 天後更新") : (d + " 天后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?\\.?$/i, (match, h) => {
                        return USE_TW ? (h + " 小時後更新") : (h + " 小时后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) minutes?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) minutes?\\.?$/i, (match, m) => {
                        return USE_TW ? (m + " 分鐘後更新") : (m + " 分钟后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in less than a minute\\.?$/i.test(valNorm)) {
                    newVal = USE_TW ? "不到 1 分鐘後更新" : "不到 1 分钟后刷新";
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in a few seconds\\.?$/i.test(valNorm)) {
                    newVal = USE_TW ? "幾秒後更新" : "几秒后刷新";
                } else if (/^Learn more about$/i.test(valNorm)) {
                    newVal = USE_TW ? "瞭解更多關於" : "了解更多关于";
                } else if (/^Learn more about (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Learn more about (.+)$/i, (match, p) => {
                        let translatedPreset = p;
                        const pLow = p.toLowerCase();
                        if (pLow === 'default' || pLow.includes('默认') || pLow.includes('預設')) translatedPreset = USE_TW ? "預設 (Default)" : "默认 (Default)";
                        else if (pLow === 'full machine' || pLow.includes('全机') || pLow.includes('全機')) translatedPreset = USE_TW ? "全機存取 (Full Machine)" : "全机访问 (Full Machine)";
                        else if (pLow === 'turbo mode' || pLow.includes('极速') || pLow.includes('極速')) translatedPreset = USE_TW ? "極速模式 (Turbo Mode)" : "极速模式 (Turbo Mode)";
                        else if (pLow === 'custom' || pLow.includes('自定义') || pLow.includes('自訂')) translatedPreset = USE_TW ? "自訂 (Custom)" : "自定义 (Custom)";
                        return USE_TW ? ("瞭解更多關於 " + translatedPreset + " 的詳細資訊") : ("了解更多关于 " + translatedPreset + " 的信息");
                    });
                } else if (/^Yes, and always allow '(.+)' in this project$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Yes, and always allow '(.+)' in this project$/i, (match, cmd) => {
                        return USE_TW ? ("是，且在此專案中一律允許執行 '" + cmd + "'") : ("是，且在此项目中始终允许运行 '" + cmd + "'");
                    });
                } else if (/^Yes, and always allow '(.+)'$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Yes, and always allow '(.+)'$/i, (match, cmd) => {
                        return USE_TW ? ("是，且一律允許執行 '" + cmd + "'") : ("是，且始终允许运行 '" + cmd + "'");
                    });
                } else if (/^(\\d+) tools? enabled$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+) tools? enabled$/i, (match, num) => {
                        return USE_TW ? (num + " 個工具已啟用") : (num + " 个工具已启用");
                    });
                } else if (/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i, (match, num, p2, type) => {
                        if (type) {
                            if (/result/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個結果...") : ("显示另外 " + num + " 个结果...");
                            if (/command/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個指令...") : ("显示另外 " + num + " 个命令...");
                            if (/item/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個項目...") : ("显示另外 " + num + " 个项目...");
                            if (/option/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個選項...") : ("显示另外 " + num + " 个选项...");
                        }
                        return USE_TW ? ("顯示另外 " + num + " 個...") : ("显示另外 " + num + " 个...");
                    });
                } else if (/^See all\\s*\\((\\d+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^See all\\s*\\((\\d+)\\)$/i, (match, num) => {
                        return USE_TW ? ("顯示全部 (" + num + ")") : ("显示全部 (" + num + ")");
                    });
                } else if (/^Available AI Credits: (\\d+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Available AI Credits: (\\d+)$/i, (match, num) => {
                        return USE_TW ? ("可用 AI 額度: " + num) : ("可用 AI 额度: " + num);
                    });
                } else if (/^Version\\s+([\\d\\.]+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Version\\s+([\\d\\.]+)$/i, (match, v) => {
                        return "版本 " + v;
                    });
                } else if (/^(\\d+)(s|m|h|d|w|mo|yr)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)(s|m|h|d|w|mo|yr)$/i, (match, num, unit) => {
                        const unitLower = unit.toLowerCase();
                        let unitStr = "";
                        if (unitLower === "s") unitStr = USE_TW ? "秒前" : "秒前";
                        else if (unitLower === "m") unitStr = USE_TW ? "分鐘前" : "分钟前";
                        else if (unitLower === "h") unitStr = USE_TW ? "小時前" : "小时前";
                        else if (unitLower === "d") unitStr = USE_TW ? "天前" : "天前";
                        else if (unitLower === "w") unitStr = USE_TW ? "週前" : "周前";
                        else if (unitLower === "mo") unitStr = USE_TW ? "個月前" : "个月前";
                        else if (unitLower === "yr") unitStr = USE_TW ? "年前" : "年前";
                        return num + unitStr;
                    });
                } else if (/^(.+?): context deadline exceeded$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): context deadline exceeded$/i, (match, prefix) => {
                        return prefix + (USE_TW ? ": 要求逾時 (context deadline exceeded)" : ": 请求超时 (context deadline exceeded)");
                    });
                } else if (/^(.+?): i\\/o timeout$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): i\\/o timeout$/i, (match, prefix) => {
                        return prefix + (USE_TW ? ": I/O 逾時 (i/o timeout)" : ": I/O 超时 (i/o timeout)");
                    });
                } else if (/^Are you sure you want to delete (the |this )?project (.+?)\\??$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Are you sure you want to delete (the |this )?project (.+?)\\??$/i, (match, article, name) => {
                        return USE_TW ? ("您確定要刪除專案 " + name + " 嗎？") : ("您确定要删除项目 " + name + " 吗？");
                    });
                } else if (/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, del, name, count, dot) => {
                        const delPrefix = del ? (USE_TW ? "永久刪除 " : "永久删除 ") : "";
                        const suffix = dot ? "。" : "";
                        return delPrefix + name + (USE_TW ? ("（包含 " + count + " 個活躍對話）") : ("（包含 " + count + " 个活跃会话）")) + suffix;
                    });
                } else if (/^including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, count, dot) => {
                        const suffix = dot ? "。" : "";
                        return (USE_TW ? ("包含 " + count + " 個活躍對話") : ("包含 " + count + " 个活跃会话")) + suffix;
                    });
                } else if (/^(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)\\s+active conversations?([.。])?$/i, (match, count, dot) => {
                        const suffix = dot ? "。" : "";
                        return (USE_TW ? (count + " 個活躍對話") : (count + " 个活跃会话")) + suffix;
                    });
                } else if (/^The (.+?) remote MCP server lets you access and run (.+?) tools to (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^The (.+?) remote MCP server lets you access and run (.+?) tools to (.+)$/i, (match, name, tools, action) => {
                        return name + (USE_TW ? " 遠端 MCP 伺服器可讓您存取並執行 " : " 远程 MCP 服务器可让您访问并运行 ") + tools + (USE_TW ? " 工具以進行管理與操作。" : " 工具以进行管理与操作。");
                    });
                } else if (/^The (.+?) remote MCP server lets you manage (.+) resources\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^The (.+?) remote MCP server lets you manage (.+) resources\\.?$/i, (match, name, res) => {
                        return name + (USE_TW ? " 遠端 MCP 伺服器可讓您管理 " : " 远程 MCP 服务器可让您管理 ") + res + (USE_TW ? " 資源。" : " 资源。");
                    });
                } else if (/^Send feedback as(\\s+(.+))?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Send feedback as(\\s+(.+))?$/i, (match, p1, email) => {
                        if (email) {
                            return "以 " + email + (USE_TW ? " 身分傳送意見回饋" : " 身份发送反馈");
                        }
                        return USE_TW ? "以此身分傳送意見回饋：" : "以如下身份发送反馈：";
                    });
                } else {
                    const truncatedPrefix = valNorm.endsWith('...') && valLower.length >= 27 ? valLower.slice(0, -3) : '';
                    for (const [key, translated] of longEntries) {
                        if (key.length > 15 && valNorm.includes(key)) {
                            newVal = newVal.split(key).join(translated);
                            break;
                        } else if (truncatedPrefix && key.length >= 32 && key.toLowerCase().startsWith(truncatedPrefix)) {
                            newVal = translated;
                            break;
                        }
                    }
                }

                if (newVal !== originalVal) {
                    translatedValues.set(node, newVal);
                    node.nodeValue = newVal;
                }
            }
        } catch (e) {}
    }

    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const n of m.addedNodes) translateNode(n);
            } else if (m.type === 'characterData') {
                translateNode(m.target);
            }
        }
    });

    const obsOpts = { childList: true, subtree: true, characterData: true };

    const startEngine = () => {
        const target = document.body || document.documentElement;
        if (target) {
            try {
                observer.observe(target, obsOpts);
                translateNode(target);
            } catch (e) {}
        }
    };

    const origAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function() {
        const sr = origAttachShadow.apply(this, arguments);
        try { observer.observe(sr, obsOpts); } catch(e) {}
        return sr;
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEngine);
    } else {
        startEngine();
    }
    window.addEventListener('load', startEngine);
    setTimeout(startEngine, 100);
    setTimeout(startEngine, 300);
    setTimeout(startEngine, 1000);
    setTimeout(startEngine, 3000);
    setTimeout(startEngine, 6000);
`;
        return runtimeTemplate
            .replace('DICT_PLACEHOLDER', () => dictJson)
            .replace('REPLACEMENT_ENTRIES_PLACEHOLDER', () => entriesJson);
    }
};
