'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const ROOT = path.resolve(__dirname, '..');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function until(description, fn, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Tiempo de espera agotado: ${description}${lastError ? ` (${lastError.message})` : ''}`);
}

function connectCdp(socketUrl) {
  const socket = new WebSocket(socketUrl);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result || {});
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({
      async send(method, params = {}) {
        const id = ++nextId;
        const response = new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
        socket.send(JSON.stringify({ id, method, params }));
        return response;
      },
      async evaluate(expression) {
        const response = await this.send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'falló la expresión CDP');
        return response.result && response.result.value;
      },
      close() { socket.close(); },
    }));
    socket.addEventListener('error', () => reject(new Error('No se pudo conectar al depurador de Electron')));
  });
}

test('Electron abre la rejilla y reproduce un canal de prueba', { timeout: 45_000 }, async (t) => {
  const electronRequired = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const skipOrFail = (message) => {
    if (electronRequired) throw new Error(message);
    t.skip(message);
  };
  let electronPath;
  try { electronPath = require('electron'); } catch {
    skipOrFail('Electron no está instalado');
    return;
  }
  if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
    skipOrFail('Electron está declarado, pero su binario no está instalado');
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mundial-tv-smoke-'));
  const userData = path.join(tempRoot, 'user-data');
  fs.mkdirSync(userData);
  const port = await freePort();
  const child = spawn(electronPath, [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    '.',
  ], {
    cwd: ROOT,
    env: { ...process.env, MUNDIAL_TEST_MODE: '1', MUNDIAL_TEST_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-4000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-4000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, delay(2500)]);
    }
    if (tempRoot.startsWith(os.tmpdir())) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 3) t.diagnostic(`No se pudo limpiar el perfil temporal: ${error.message}`);
          else await delay(200);
        }
      }
    }
  });

  let cdp;
  try {
    const page = await until('ventana Electron', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return null;
      const targets = await response.json();
      return targets.find((target) => target.type === 'page' && target.url.startsWith('file:')) || null;
    });
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await until('interfaz y catálogo de prueba', async () => {
      const ready = await cdp.evaluate('Boolean(window.__MUNDIAL_TEST__)');
      if (!ready) return null;
      const state = await cdp.evaluate('({title: document.title, ready: document.readyState})');
      return state.ready === 'complete' && state.title === 'Mundial TV' ? state : null;
    });

    await cdp.evaluate('window.__MUNDIAL_TEST__.installPlayerMock()');
    await cdp.evaluate(`window.__MUNDIAL_TEST__.setChannels(${JSON.stringify([{
      id: 'smoke.channel',
      name: 'Canal de prueba',
      group: 'Generalistas',
      kind: 'hls',
      logo: '',
      sources: [{ url: 'https://stream.example/live.m3u8', geo: false }],
    }])})`);
    assert.equal(await cdp.evaluate("document.querySelectorAll('.card').length"), 1);
    await cdp.evaluate("document.querySelector('.card').click()");

    const player = await until('reproducción simulada del canal', async () => {
      const state = await cdp.evaluate('window.__MUNDIAL_TEST__.snapshot()');
      return state && state.current === 'smoke.channel' && state.playing ? state : null;
    });
    assert.equal(player.title, 'Canal de prueba');
    assert.equal(player.errorVisible, false);
  } catch (error) {
    cdp?.close();
    throw new Error(`${error.message}\nElectron output:\n${output}`);
  } finally {
    cdp?.close();
  }
});
