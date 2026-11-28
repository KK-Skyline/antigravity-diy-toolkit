'use strict';

module.exports = function mountLauncher(labels, showShortcut) {
    if (window.top !== window) return;
    const { ipcRenderer } = require('electron');
    const isMac = process.platform === 'darwin';
    const MENUBAR_SELECTOR = '[data-testid="title-menu-bar"], .agy-titlebar';
    const MENU_ITEM_SELECTOR = '[data-testid="title-menu-bar-item"], [data-testid="title-menu-bar"] button, [data-testid="title-menu-bar"] [role="menuitem"], .agy-titlebar button, .agy-titlebar [role="menuitem"]';
    const PRIMARY_ANCHOR_RE = /^(窗口|視窗|Window)$/i;
    const SECONDARY_MENU_RE = /^(帮助|說明|Help|视图|檢視|View|工作区|工作區|Workspace|文件|檔案|File|编辑|編輯|Edit)$/i;
    const titlebarControls = '[data-testid*="sidebar-toggle"], header button, header a, [role="toolbar"] button, [class*="titlebar"] button';
    let button;
    let observedBody;
    let observedMenuBar;
    let toastTimer;
    let pollTimer = null;
    let pollMs = 0;
    let pollStartedAt = 0;
    let rafId = 0;

    function normMenuText(str) {
        return (str || '').replace(/\(&[a-z]\)|&/gi, '').replace(/\s+/g, ' ').trim();
    }

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

    function collectTopBarCandidates() {
        const candidates = new Set();
        const selectorHits = new Set();
        const add = el => {
            if (!el || el === button || button?.contains?.(el)) return false;
            candidates.add(el);
            return true;
        };

        for (const el of document.querySelectorAll(MENU_ITEM_SELECTOR)) {
            if (add(el)) selectorHits.add(el);
        }

        if (typeof document.elementsFromPoint === 'function') {
            const visitedRoots = new Set();
            const hitPoint = (root, x, y) => {
                if (!root || visitedRoots.has(root) || typeof root.elementsFromPoint !== 'function') return;
                visitedRoots.add(root);
                for (const el of root.elementsFromPoint(x, y)) {
                    add(el);
                    if (el?.shadowRoot?.elementsFromPoint) hitPoint(el.shadowRoot, x, y);
                }
            };
            const maxX = Math.min(560, Math.floor(window.innerWidth * 0.65));
            for (const y of [12, 18, 26]) {
                for (let x = 16; x <= maxX; x += 24) {
                    visitedRoots.clear();
                    hitPoint(document, x, y);
                }
            }
        }

        if (document.body) {
            const stack = [document.body];
            let visited = 0;
            while (stack.length && visited < 400) {
                const node = stack.pop();
                if (!node || node === button || button?.contains?.(node)) continue;
                visited++;
                if (node !== document.body) {
                    const r = node.getBoundingClientRect?.();
                    if (r && r.height > 0 && (r.top > 48 || (r.top >= 26 && r.height > 60))) continue;
                    if (r && r.width > 0 && r.width <= 200 && r.height >= 12 && r.height <= 44 &&
                        r.top >= -6 && r.bottom <= 52 && r.left < window.innerWidth * 0.7) {
                        candidates.add(node);
                    }
                }
                const shadowChildren = node.shadowRoot?.children;
                if (shadowChildren) {
                    for (let i = shadowChildren.length - 1; i >= 0; i--) stack.push(shadowChildren[i]);
                }
                const children = node.children;
                if (children) {
                    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
                }
            }
        }

        return { candidates, selectorHits };
    }

    function liftToMenuBox(el, targetText) {
        let cur = el;
        while (cur) {
            const parent = cur.parentElement || cur.getRootNode?.()?.host || null;
            if (!parent || parent === document.body) break;
            if (normMenuText(parent.textContent) !== targetText) break;
            const pr = parent.getBoundingClientRect?.();
            if (!pr || pr.width <= 0 || pr.width > 200 || pr.height > 44 || pr.top < -6 || pr.bottom > 52) break;
            cur = parent;
        }
        return cur;
    }

    function findMenuAnchor() {
        const { candidates, selectorHits } = collectTopBarCandidates();
        const seen = new Set();
        const visible = [];
        for (const rawEl of candidates) {
            const text = normMenuText(rawEl.textContent);
            if (!text || text.length > 20) continue;
            const el = liftToMenuBox(rawEl, text);
            if (seen.has(el)) continue;
            seen.add(el);
            const rect = el.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.width > 200 || rect.height < 12 || rect.height > 44 ||
                rect.top < -6 || rect.bottom > 52 || rect.left >= window.innerWidth * 0.7) {
                continue;
            }
            visible.push({ el, rect, text, isSelectorHit: selectorHits.has(rawEl) || selectorHits.has(el) });
        }
        if (!visible.length) return null;

        const pickRightmost = list => list.reduce((best, cur) => (cur.rect.right > best.rect.right ? cur : best));
        const primary = visible.filter(item => PRIMARY_ANCHOR_RE.test(item.text));
        const secondary = primary.length ? [] : visible.filter(item => SECONDARY_MENU_RE.test(item.text));
        const fallback = (primary.length || secondary.length) ? [] : visible.filter(item => item.isSelectorHit);
        const match = primary.length
            ? pickRightmost(primary)
            : secondary.length
                ? pickRightmost(secondary)
                : fallback.length
                    ? pickRightmost(fallback)
                    : null;
        if (!match) return null;

        let menuBar = match.el.closest?.(MENUBAR_SELECTOR);
        if (!menuBar) {
            let p = match.el.parentElement || match.el.getRootNode?.()?.host || null;
            while (p && p !== document.body) {
                const pr = p.getBoundingClientRect?.();
                if (!pr || pr.top < -6 || pr.bottom > 56 || pr.height > 52) break;
                menuBar = p;
                p = p.parentElement || p.getRootNode?.()?.host || null;
            }
        }
        return { menuBar, anchor: match.el, rect: match.rect };
    }

    function positionButton() {
        const info = findMenuAnchor();
        if (info) {
            const { anchor, rect } = info;
            const h = rect.height >= 18 && rect.height <= 32 ? Math.round(rect.height) : 24;
            button.style.height = h + 'px';
            button.style.top = Math.max(2, Math.round(rect.top + (rect.height - h) / 2)) + 'px';
            const rawLeft = Math.round(rect.right + 8);
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
                scheduleKeepAlive();
            }
        });
    }

    const menubarObserver = new MutationObserver(schedulePosition);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePosition) : null;
    const MENU_OBS_OPTS = { childList: true, subtree: true, characterData: true };

    function syncMenuBarObserver(menuBar) {
        if (observedMenuBar && !observedMenuBar.isConnected) observedMenuBar = null;
        if (!menuBar || menuBar === observedMenuBar) return;
        menubarObserver.disconnect();
        resizeObserver?.disconnect();
        menubarObserver.observe(menuBar, MENU_OBS_OPTS);
        resizeObserver?.observe(menuBar);
        observedMenuBar = menuBar;
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
            pollMs = 0;
        }
    }

    function scheduleKeepAlive() {
        let targetMs;
        if (!observedMenuBar?.isConnected) {
            if (!pollStartedAt) pollStartedAt = Date.now();
            targetMs = (Date.now() - pollStartedAt) > 60000 ? 2500 : 500;
        } else {
            pollStartedAt = 0;
            targetMs = 2500;
        }
        if (pollMs === targetMs && pollTimer) return;
        stopPolling();
        pollMs = targetMs;
        pollTimer = setInterval(() => {
            if (!button?.isConnected || !observedMenuBar?.isConnected) {
                ensureLauncherBtn();
            } else {
                scheduleKeepAlive();
            }
        }, targetMs);
        pollTimer?.unref?.();
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
        scheduleKeepAlive();
    }

    document.addEventListener('DOMContentLoaded', ensureLauncherBtn);
    window.addEventListener('load', ensureLauncherBtn);
    window.addEventListener('resize', ensureLauncherBtn);
    for (const ms of [150, 400, 1100, 3100, 6200]) setTimeout(ensureLauncherBtn, ms);
    ensureLauncherBtn();
};
