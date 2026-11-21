'use strict';

/* 用无头 Chrome 打开页面并截图，供界面核对使用。
   例：node scripts/shot.mjs --out shots/overview.png --hash "#/overview" --width 1440 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function parseArgs(argv) {
  const out = {
    out: '.shots/shot.png',
    hash: '#/overview',
    width: 1440,
    height: 1000,
    dpr: 1,
    theme: '',
    wait: 900,
    js: '',
    full: true
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    let value = argv[i + 1];
    if (key === 'width' || key === 'height' || key === 'wait' || key === 'dpr') value = Number(value);
    else if (key === 'full') value = value !== 'false';
    out[key] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method) this.listeners.forEach((fn) => fn(msg));
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  once(method, sessionId, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((fn) => fn !== handler);
        reject(new Error('等待 ' + method + ' 超时'));
      }, timeout);
      const handler = (msg) => {
        if (msg.method !== method) return;
        if (sessionId && msg.sessionId !== sessionId) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((fn) => fn !== handler);
        resolve(msg.params);
      };
      this.listeners.push(handler);
    });
  }
}

async function waitPort(dir) {
  const file = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').trim().split('\n');
      if (text[0]) return { port: Number(text[0]), path: text[1] || '' };
    }
    await sleep(50);
  }
  throw new Error('Chrome 没有写出 DevToolsActivePort');
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chengji-shot-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--user-data-dir=' + dir,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--window-size=' + args.width + ',' + args.height,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let ws;
  try {
    const info = await waitPort(dir);
    ws = new WebSocket('ws://127.0.0.1:' + info.port + info.path);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new CDP(ws);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: args.width, height: args.height, deviceScaleFactor: args.dpr, mobile: false },
      sessionId
    );

    const base = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?t=' + Date.now();
    const url = base + args.hash;

    let loaded = cdp.once('Page.loadEventFired', sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await loaded;

    /* 关掉首次引导层，再按需要的深浅色重载一次 */
    let setup =
      "localStorage.setItem('scorebook.tour.v1', '1');" +
      (args.theme ? "localStorage.setItem('scorebook.theme', '" + args.theme + "');" : '');
    if (args['pre-file']) setup += '\n' + fs.readFileSync(path.resolve(ROOT, args['pre-file']), 'utf8');
    await cdp.send('Runtime.evaluate', { expression: setup }, sessionId);

    loaded = cdp.once('Page.loadEventFired', sessionId);
    await cdp.send('Page.reload', { ignoreCache: false }, sessionId);
    await loaded;
    await sleep(args.wait);

    if (args['js-file']) args.js = fs.readFileSync(path.resolve(ROOT, args['js-file']), 'utf8');

    if (args.js) {
      const res = await cdp.send(
        'Runtime.evaluate',
        { expression: args.js, awaitPromise: true, returnByValue: true },
        sessionId
      );
      if (res.exceptionDetails) {
        const detail = res.exceptionDetails.exception;
        throw new Error(
          '页面脚本出错：' + ((detail && (detail.description || detail.value)) || res.exceptionDetails.text)
        );
      }
      if (res.result && res.result.value !== undefined) console.log('页面返回：' + JSON.stringify(res.result.value));
      await sleep(400);
    }

    const shot = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: args.full },
      sessionId
    );
    const target = path.resolve(ROOT, args.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(shot.data, 'base64'));
    console.log('已保存 ' + path.relative(ROOT, target));

    await cdp.send('Browser.close').catch(() => {});
  } finally {
    if (ws) ws.close();
    await new Promise((resolve) => {
      if (chrome.exitCode !== null) return resolve();
      chrome.once('exit', resolve);
      setTimeout(() => {
        chrome.kill();
        resolve();
      }, 4000);
    });
    /* 进程退出后再删，否则 Windows 会报 EPERM */
    for (let i = 0; i < 20; i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(200);
      }
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);
