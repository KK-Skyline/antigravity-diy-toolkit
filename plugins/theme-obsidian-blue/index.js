'use strict';

const OBSIDIAN_BLUE_CSS = [
    ':root, html, body, body[data-agy-theme], body[data-agy-theme].dark, .dark, .dark-theme, .theme-dark, .vscode-dark, .agy-inset-shell, body[data-agy-theme] .agy-inset-shell {',
    '  --primary: #4176e6 !important;',
    '  --primary-foreground: #ffffff !important;',
    '  --cta: #4176e6 !important;',
    '  --cta-foreground: #ffffff !important;',
    '  --link: #5686fe !important;',
    '  --color-primary: #4176e6 !important;',
    '  --color-primary-foreground: #ffffff !important;',
    '  --background: #0d1117 !important;',
    '  --foreground: #e6edf3 !important;',
    '  --color-background: #0d1117 !important;',
    '  --color-foreground: #e6edf3 !important;',
    '  --shell: #090d13 !important;',
    '  --shell-canvas: #090d13 !important;',
    '  --sidebar: #090d13 !important;',
    '  --sidebar-secondary: #131722 !important;',
    '  --sidebar-muted: #0d1117 !important;',
    '  --color-sidebar: #090d13 !important;',
    '  --color-sidebar-secondary: #131722 !important;',
    '  --color-sidebar-muted: #0d1117 !important;',
    '  --card: #161b22 !important;',
    '  --card-border: #21262d !important;',
    '  --border: #21262d !important;',
    '  --glass: #161b22 !important;',
    '  --glass-border: #21262d !important;',
    '  --onyx-frame: #0d1117 !important;',
    '  --onyx-well: #10151d !important;',
    '  --onyx-raised: #161b22 !important;',
    '  --onyx-selected: #1c2333 !important;',
    '  --onyx-key: #1f2736 !important;',
    '  --color-card: #161b22 !important;',
    '  --color-card-border: #21262d !important;',
    '  --color-border: #21262d !important;',
    '  --secondary: #161b22 !important;',
    '  --secondary-foreground: #a0a6b5 !important;',
    '  --muted: #12161f !important;',
    '  --muted-foreground: #7d8590 !important;',
    '  --placeholder: #484f58 !important;',
    '  --success: #22c55e !important;',
    '  --warning: #f59e0b !important;',
    '  --error: #ef4444 !important;',
    '  --code-foreground: #79c0ff !important;',
    '  --editor-selection-background: rgba(65, 118, 230, 0.35) !important;',
    '  --color-selection-background: rgba(65, 118, 230, 0.35) !important;',
    '  --focus-ring-color: rgba(65, 118, 230, 0.45) !important;',
    '}',
    '::-webkit-scrollbar { width: 5px !important; height: 5px !important; }',
    '::-webkit-scrollbar-track { background: transparent !important; }',
    '::-webkit-scrollbar-thumb { background: #282f3d !important; border-radius: 999px !important; }',
    '::-webkit-scrollbar-thumb:hover { background: #4176e6 !important; }',
    '.bg-sidebar-secondary { background-color: #131722 !important; border: 1px solid #21262d !important; }',
    'button[class*="bg-primary"], .bg-primary { background-color: #4176e6 !important; color: #ffffff !important; }',
    'button[class*="bg-primary"]:hover, .bg-primary:hover { background-color: #5686fe !important; box-shadow: 0 0 10px rgba(65, 118, 230, 0.4) !important; }',
    'textarea:focus, input[type="text"]:focus { border-color: #4176e6 !important; box-shadow: 0 0 0 1px #4176e6, 0 0 8px rgba(65, 118, 230, 0.25) !important; }'
].join('\n');

module.exports = {
    getStyles() {
        return {
            id: 'antigravity-dark-blue-theme',
            layerOrder: 10,
            css: OBSIDIAN_BLUE_CSS
        };
    }
};
