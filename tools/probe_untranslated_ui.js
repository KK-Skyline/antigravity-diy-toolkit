// 用法: node tools/probe_untranslated_ui.js (通过 tools/agcdp.js eval 执行)
// 只读采集 UI 壳层短英文候选词条，严格排除代码区、编辑器、终端、对话正文、侧栏会话、文件标签与邮箱信息。
(async () => {
  const EXCLUSION_SELECTOR = [
    'pre', 'code', '.monaco-editor', '.cm-editor', '.cm-line', '[contenteditable="true"]',
    '.terminal', '.xterm', '.code-line', '.code-block', '.line-content',
    '[aria-label="File Viewer"]', '[data-file-uri]', '[class*="diffEditor"]',
    '.token', '.hljs', '[class*="mtk"]', '[data-testid="background-task-command"]',
    '[data-testid="browser-url-display"]', '[data-browser-hole]', 'webview',
    'textarea', 'input', 'aside', '[role="tablist"]',
    '[data-testid="conversation-view"]', '[data-testid="conversation-row-sidebar"]',
    '.agy-sidebar-row', '[data-testid="sidebar-navigation-items"]',
    '[data-testid="lifted-context-menu-trigger"]',
    '[data-testid*="workspace"]', '[data-testid*="project"]', '[data-testid*="history"]',
    '[data-testid*="account"]', '[data-testid*="user"]', '[data-testid*="email"]',
    '[data-testid*="terminal"]', '[data-testid*="message"]', '[data-testid*="chat"]',
    '[class*="markdown"]', '[class*="prose"]'
  ].join(', ');

  function isExcluded(node) {
    try {
      let el = node && node.nodeType === 1 ? node : node?.parentElement;
      while (el) {
        if (typeof el.closest === 'function' && el.closest(EXCLUSION_SELECTOR)) return true;
        const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
        el = (root && root.host) ? root.host : null;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  function isCandidateText(raw) {
    if (typeof raw !== 'string') return false;
    const t = raw.replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 80) return false;
    if (!/[A-Za-z]{2}/.test(t)) return false;
    if (/[\u4e00-\u9fff]/.test(t)) return false;
    if (t.includes('@') || t.includes('://') || t.includes('/') || t.includes('\\')) return false;
    if (/\.[a-z0-9]{1,8}$/i.test(t)) return false;
    if (/Send feedback as/i.test(t)) return false;
    if (/'[^']+'/.test(t)) return false;
    if (/^[^\s]+[_-][^\s]+$/.test(t)) return false;
    return true;
  }

  const SCAN_SELECTOR = [
    'button', '[role="button"]', '[role="menuitem"]',
    '[role="dialog"] [role="tab"]', '[role="dialog"] [role="option"]', '[role="menu"] [role="option"]',
    '[role="dialog"] h1', '[role="dialog"] h2', '[role="dialog"] h3', '[role="dialog"] label',
    'header span'
  ].join(', ');

  const seen = new Set();
  const labels = [];
  for (const el of document.querySelectorAll(SCAN_SELECTOR)) {
    if (isExcluded(el)) continue;
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (isCandidateText(text) && !seen.has(text)) {
      seen.add(text);
      labels.push(text);
      if (labels.length >= 80) break;
    }
  }

  return JSON.stringify({
    appVersion: (window.__APP_CONFIG__ && window.__APP_CONFIG__.appVersion) || null,
    selectors: {
      agyShell: !!document.querySelector('.agy-shell'),
      insetShell: !!document.querySelector('.agy-inset-shell'),
      mainBody: !!document.querySelector('[data-main-content-body]'),
      composerCard: !!document.querySelector('.surface-composer-card'),
      agyThemeAttr: !!document.body?.hasAttribute('data-agy-theme')
    },
    labels
  });
})();
