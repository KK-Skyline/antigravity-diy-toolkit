'use strict';

module.exports = function mountLauncher(labels, showShortcut) {
    if (window.top !== window) return;
    const { ipcRenderer } = require('electron');
    const isMac = process.platform === 'darwin';
    const titlebarControls = '[data-testid*="sidebar-toggle"], header button, header a, [role="toolbar"] button, [class*="titlebar"] button';
    let button;
    let observedBody;
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

    function positionButton() {
        let left = isMac ? 78 : 10;
        const controls = document.querySelectorAll(titlebarControls);
        const rects = Array.from(controls, el => el.getBoundingClientRect())
            .filter(r => r.width && r.bottom > 7 && r.top < 33)
            .sort((a, b) => a.left - b.left);
        for (const r of rects) {
            if (r.left < left + 30 && r.right > left - 4) left = Math.ceil(r.right) + 4;
        }
        button.style.left = Math.min(left, Math.max(0, window.innerWidth - 30)) + 'px';
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
            if (button?.isConnected) positionButton();
        });
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
            positionButton();
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
