'use strict';

module.exports = function mountLauncher(labels, showShortcut) {
    if (window.top !== window) return;
    const { ipcRenderer } = require('electron');
    const isMac = process.platform === 'darwin';
    const MENUBAR_SELECTOR = '[data-testid="title-menu-bar"], .agy-titlebar';
    const MENU_ITEM_SELECTOR = '[data-testid="title-menu-bar-item"], [data-testid="title-menu-bar"] button, [data-testid="title-menu-bar"] [role="menuitem"], .agy-titlebar button, .agy-titlebar [role="menuitem"]';
    const titlebarControls = '[data-testid*="sidebar-toggle"], header button, header a, [role="toolbar"] button, [class*="titlebar"] button';
    let button;
    let observedBody;
    let observedMenuBar;
    let toastTimer;
    let rafId = 0;

    function showError(message) {
        let toast = document.getElementById('ag-hub-launcher-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ag-hub-launcher-toast';
            toast.setAttribute('role', 'alert');
            toast.setAttribute('translate', 'no');
            toast.className = 'notranslate';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.remove(), 4000);
    }

    function findMenuAnchor() {
        const items = Array.from(document.querySelectorAll(MENU_ITEM_SELECTOR));
        const visible = [];
        for (const el of items) {
            if (el === button) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= 48 && rect.left < window.innerWidth * 0.7) {
                visible.push({ el, rect });
            }
        }
        if (!visible.length) return null;
        let match = visible.find(({ el }) => /^(窗口|視窗|Window)$/i.test((el.textContent || '').replace(/\(&[a-z]\)|&/gi, '').trim()));
        if (!match) {
            match = visible.reduce((best, cur) => (cur.rect.right > best.rect.right ? cur : best));
        }
        const menuBar = match.el.closest?.(MENUBAR_SELECTOR) || document.querySelector(MENUBAR_SELECTOR);
        return { menuBar, anchor: match.el, rect: match.rect };
    }

    function positionButton() {
        const info = findMenuAnchor();
        if (info) {
            const { anchor, rect } = info;
            const h = rect.height >= 18 && rect.height <= 32 ? Math.round(rect.height) : 24;
            button.style.height = h + 'px';
            button.style.top = Math.max(2, Math.round(rect.top + (rect.height - h) / 2)) + 'px';
            const rawLeft = Math.round(rect.right + 4);
            const btnWidth = button.offsetWidth || 64;
            const maxLeft = Math.max(10, window.innerWidth - btnWidth - 140);
            button.style.left = Math.min(rawLeft, maxLeft) + 'px';
            const cs = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(anchor) : null;
            if (cs?.color) button.style.setProperty('--ag-hub-btn-fg', cs.color);
            if (cs?.fontSize) button.style.fontSize = cs.fontSize;
            return info.menuBar;
        }
        button.style.height = '24px';
        button.style.top = '6px';
        let left = isMac ? 78 : 10;
        const controls = document.querySelectorAll(titlebarControls);
        const rects = Array.from(controls, el => el.getBoundingClientRect())
            .filter(r => r.width && r.bottom > 7 && r.top < 33)
            .sort((a, b) => a.left - b.left);
        for (const r of rects) {
            if (r.left < left + 30 && r.right > left - 4) left = Math.ceil(r.right) + 4;
        }
        button.style.left = Math.min(left, Math.max(0, window.innerWidth - 30)) + 'px';
        return document.querySelector(MENUBAR_SELECTOR);
    }

    function createButton() {
        const btn = document.createElement('button');
        btn.id = 'ag-hub-launcher-btn';
        btn.type = 'button';
        btn.className = 'notranslate';
        btn.setAttribute('translate', 'no');
        btn.dataset.agHubLauncher = 'true';
        btn.setAttribute('aria-label', labels.open);
        btn.title = labels.open + (showShortcut ? (isMac ? ' (Cmd+Alt+W)' : ' (Ctrl+Alt+W)') : '');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        const icon = document.createElementNS(svg.namespaceURI, 'path');
        icon.setAttribute('d', 'M2 2.5h12v11H2z M2 11l4-4 3 3 2-2 3 3 M10.5 5.5h1');
        svg.appendChild(icon);
        btn.appendChild(svg);
        const labelSpan = document.createElement('span');
        labelSpan.className = 'ag-hub-launcher-label';
        labelSpan.textContent = labels.short || 'Wallpaper';
        btn.appendChild(labelSpan);
        btn.addEventListener('click', async event => {
            if (!event.isTrusted || btn.disabled) return;
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            try {
                const result = await ipcRenderer.invoke('antigravity:open-wallpaper-hub');
                if (!result?.ok) showError(result?.message || labels.failure);
            } catch (error) {
                console.error('[Wallpaper Hub] IPC invoke failed:', error);
                showError(labels.failure);
            } finally {
                btn.disabled = false;
                btn.removeAttribute('aria-busy');
            }
        });
        return btn;
    }

    function schedulePosition() {
        if (rafId) return;
        const schedule = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : fn => setTimeout(fn, 16);
        rafId = schedule(() => {
            rafId = 0;
            if (button?.isConnected) {
                const menuBar = positionButton();
                syncMenuBarObserver(menuBar);
            }
        });
    }

    const menubarObserver = new MutationObserver(schedulePosition);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePosition) : null;
    const MENU_OBS_OPTS = { childList: true, subtree: true, characterData: true };

    function syncMenuBarObserver(menuBar) {
        if (!menuBar || menuBar === observedMenuBar) return;
        menubarObserver.disconnect();
        resizeObserver?.disconnect();
        menubarObserver.observe(menuBar, MENU_OBS_OPTS);
        resizeObserver?.observe(menuBar);
        observedMenuBar = menuBar;
    }

    const observer = new MutationObserver(() => {
        if (!button?.isConnected || document.body !== observedBody) {
            ensureLauncherBtn();
        }
    });
    function ensureLauncherBtn() {
        const body = document.body;
        if (!body) return;
        if (body !== observedBody) {
            observer.disconnect();
            observer.observe(document.documentElement, { childList: true });
            observer.observe(body, { childList: true, subtree: false });
            observedBody = body;
        }
        const wasConnected = Boolean(button?.isConnected);
        if (!wasConnected) {
            button = document.getElementById('ag-hub-launcher-btn') || createButton();
            if (!button.isConnected) body.appendChild(button);
            const menuBar = positionButton();
            syncMenuBarObserver(menuBar);
        } else {
            schedulePosition();
        }
    }

    document.addEventListener('DOMContentLoaded', ensureLauncherBtn);
    window.addEventListener('load', ensureLauncherBtn);
    window.addEventListener('resize', ensureLauncherBtn);
    for (const ms of [150, 600, 2000, 5000]) setTimeout(ensureLauncherBtn, ms);
    ensureLauncherBtn();
};
