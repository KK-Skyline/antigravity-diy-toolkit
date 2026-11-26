#!/usr/bin/env node
// Antigravity 调试小工具：通过 Chrome DevTools Protocol 检查正在运行的 Antigravity 主窗口。
//
// 用法:
//   node tools/agcdp.js eval <file.js>      在主窗口执行一段表达式（可以是 async IIFE），打印结果
//   node tools/agcdp.js eval-inline "<expr>"
//   node tools/agcdp.js shot <out.png>      截取主窗口（只含网页内容，不含原生窗口按钮）
//   node tools/agcdp.js logs [正则]          读取控制台缓冲区里的消息（含 preload 的日志）
//   node tools/agcdp.js close               让 Antigravity 正常退出（Browser.close）
//
// 端口：先读 %APPDATA%\Antigravity\DevToolsActivePort，再试 9222，
// 最后回退到 language_server.log（Antigravity 2.34+ 需带 --remote-debugging-port=9222 启动）。
const fs = require('fs');
const path = require('path');

function getExplicitPort() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) return args[i + 1];
    if (args[i].startsWith('--port=')) return args[i].slice('--port='.length);
  }
  return process.env.AG_CDP_PORT || null;
}

async function findEndpoint() {
  const explicitPort = getExplicitPort();
  if (explicitPort) {
    const n = Number(explicitPort);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`无效的 CDP 端口: ${explicitPort}`);
    }
    const base = 'http://127.0.0.1:' + n;
    const res = await fetch(base + '/json/list', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('CDP /json/list 响应格式无效');
    return { base, list, browserWs: '' };
  }

  const candidates = [];
  const seenPorts = new Set();
  const addCandidate = (port, wsPath = '') => {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535 || seenPorts.has(n)) return;
    seenPorts.add(n);
    candidates.push({ port: String(n), wsPath: typeof wsPath === 'string' && wsPath.startsWith('/') ? wsPath : '' });
  };
  const appData = process.env.APPDATA || '';
  if (appData) {
    const activePortFile = path.join(appData, 'Antigravity', 'DevToolsActivePort');
    if (fs.existsSync(activePortFile)) {
      const lines = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
      if (lines[0] && /^\d+$/.test(lines[0].trim())) {
        addCandidate(lines[0].trim(), lines[1] ? lines[1].trim() : '');
      }
    }
  }
  addCandidate('9222', '');
  for (const c of candidates) {
    try {
      const base = 'http://127.0.0.1:' + c.port;
      const res = await fetch(base + '/json/list', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const list = await res.json();
      if (!Array.isArray(list)) continue;
      const browserWs = c.wsPath ? `ws://127.0.0.1:${c.port}${c.wsPath}` : '';
      return { base, list, browserWs };
    } catch (e) {}
  }
  const notFoundErr = '找不到调试端口：Antigravity 未运行，或 2.34+ 未带 --remote-debugging-port=9222 启动。';
  if (!appData) throw new Error(notFoundErr);
  const log = path.join(appData, 'Antigravity', 'logs', 'language_server.log');
  const txt = fs.existsSync(log) ? fs.readFileSync(log, 'latin1') : '';
  const all = [...txt.matchAll(/ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[a-f0-9-]+/g)];
  if (!all.length) throw new Error(notFoundErr);
  const port = Number(all[all.length - 1][1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(notFoundErr);
  const base = 'http://127.0.0.1:' + port;
  try {
    const res = await fetch(base + '/json/list', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(notFoundErr);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error(notFoundErr);
    return { base, list, browserWs: all[all.length - 1][0] };
  } catch (e) {
    throw new Error(notFoundErr);
  }
}

async function mainPage() {
  const ep = await findEndpoint();
  const page = ep.list.find(p => p.type === 'page' && p.url.startsWith('https://127.0.0.1'));
  if (!page) throw new Error('没找到 Antigravity 主窗口页面');
  return { ep, page };
}

function open(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const entry = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(entry.timer);
      entry.resolve(m);
    } else if (m.method) {
      events.push(m);
    }
  };
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      reject(new Error('CDP WebSocket 连接超时'));
    }, 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = err => { clearTimeout(timer); reject(err instanceof Error ? err : new Error('CDP WebSocket error')); };
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    const timer = setTimeout(() => {
      pending.delete(i);
      try { ws.close(); } catch (e) {}
      reject(new Error(`CDP send(${method}) 超时`));
    }, 5000);
    pending.set(i, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ready, send, events, close: () => ws.close() };
}

async function evaluate(expression) {
  const { page } = await mainPage();
  const c = open(page.webSocketDebuggerUrl); await c.ready;
  const m = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  c.close();
  if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails, null, 1));
  const v = m.result && m.result.result && m.result.result.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
}

(async () => {
  const cleanArgs = [];
  const rawArgs = process.argv.slice(2);
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--port') { i++; continue; }
    if (rawArgs[i].startsWith('--port=')) continue;
    cleanArgs.push(rawArgs[i]);
  }
  const [cmd, arg] = cleanArgs;
  if (cmd === 'eval') return evaluate(fs.readFileSync(arg, 'utf8'));
  if (cmd === 'eval-inline') return evaluate(arg);
  if (cmd === 'shot') {
    const { page } = await mainPage();
    const c = open(page.webSocketDebuggerUrl); await c.ready;
    const m = await c.send('Page.captureScreenshot', { format: 'png' });
    c.close();
    fs.writeFileSync(arg || 'antigravity.png', Buffer.from(m.result.data, 'base64'));
    return console.log('saved', arg || 'antigravity.png');
  }
  if (cmd === 'logs') {
    const { page } = await mainPage();
    const c = open(page.webSocketDebuggerUrl); await c.ready;
    await c.send('Runtime.enable'); await c.send('Log.enable');
    await new Promise(r => setTimeout(r, 1500));
    c.close();
    const f = arg ? new RegExp(arg, 'i') : null;
    const lines = c.events.map(m =>
      m.method === 'Runtime.consoleAPICalled' ? '[' + m.params.type + '] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ') :
      m.method === 'Runtime.exceptionThrown' ? '[exception] ' + JSON.stringify(m.params.exceptionDetails) :
      m.method === 'Log.entryAdded' ? '[log ' + m.params.entry.level + '] ' + m.params.entry.text : null
    ).filter(Boolean).map(l => l.slice(0, 500)).filter(l => !f || f.test(l));
    return console.log(lines.join('\n') || '(没有匹配的消息)');
  }
  if (cmd === 'close') {
    const ep = await findEndpoint();
    const url = ep.browserWs || (await (await fetch(ep.base + '/json/version')).json()).webSocketDebuggerUrl;
    const c = open(url); await c.ready;
    c.send('Browser.close');
    await new Promise(r => setTimeout(r, 1500));
    return console.log('close requested');
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).join('\n'));
})().catch(e => { console.error(String(e.message || e)); process.exit(1); });
