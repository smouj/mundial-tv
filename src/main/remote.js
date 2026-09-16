'use strict';

/**
 * Mando desde el móvil.
 *
 * Levanta un servidor web mínimo dentro de la red local y sirve una página
 * pensada para el teléfono, desde la que se cambia de canal, se pausa y se
 * ajusta el volumen. No hace falta instalar nada ni emparejar nada: se abre la
 * dirección (o se escanea el código QR que muestra la aplicación) y ya está.
 *
 * Todo el tráfico se queda en la red local y cada arranque genera una clave
 * nueva, así que la página solo responde a quien haya visto el código.
 */

const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');

const DEFAULT_PORT = 8712;

/** Adaptadores que no llevan a ningún sitio desde el teléfono. */
const VIRTUAL_ADAPTER = /(vethernet|wsl|hyper-v|virtualbox|vmware|docker|loopback|bluetooth|tap-)/i;

/**
 * Dirección de la red local por la que el móvil podrá llegar.
 *
 * Se descartan los adaptadores virtuales (WSL, Hyper-V, Docker…) porque desde
 * el teléfono no son alcanzables: lo útil es la dirección real de la Wi-Fi o
 * del cable.
 */
function localAddress() {
  const real = [];
  const virtual = [];

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)) continue;
      if (VIRTUAL_ADAPTER.test(name)) virtual.push(entry.address);
      else real.push(entry.address);
    }
  }

  return real[0] || virtual[0] || '127.0.0.1';
}

/** Página del mando. HTML, CSS y JavaScript sin dependencias, válido para cualquier móvil. */
function mobilePage(token) {
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="color-scheme" content="dark">',
    '<meta name="theme-color" content="#0b0f14">',
    '<title>Mando de Mundial TV</title>',
    '<style>',
    ':root{--bg:#0b0f14;--surface:#121821;--surface2:#182230;--border:#223040;--text:#e7eef5;',
    '--muted:#8494a4;--accent:#f0a53c;--live:#e5484d}',
    '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}',
    'body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,',
    '"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding-bottom:env(safe-area-inset-bottom)}',
    'header{position:sticky;top:0;z-index:5;background:#0e141b;border-bottom:1px solid var(--border);',
    'padding:calc(12px + env(safe-area-inset-top)) 14px 12px}',
    '.brand{display:flex;align-items:center;gap:8px;font-weight:600}',
    '.brand span{width:9px;height:9px;border-radius:50%;background:var(--live);flex:none}',
    '.now{margin-top:6px;color:var(--muted);font-size:13px;min-height:18px}',
    '.now b{color:var(--text);font-weight:600}',
    '.controls{display:flex;align-items:center;gap:10px;margin-top:12px}',
    'button{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);',
    'border-radius:10px;padding:0 14px;height:40px;cursor:pointer}',
    'button:active{background:var(--surface2)}',
    'button.primary{background:var(--accent);border-color:var(--accent);color:#241704;font-weight:600}',
    '.vol{flex:1;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}',
    'input[type=range]{flex:1;accent-color:var(--accent);height:32px}',
    '.search{padding:12px 14px 6px}',
    'input[type=search]{width:100%;height:42px;padding:0 12px;background:var(--surface);',
    'border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:16px;outline:none}',
    'input[type=search]:focus{border-color:#33465c}',
    'ul{list-style:none;margin:0;padding:6px 8px 24px}',
    'li{display:flex;align-items:center;gap:12px;padding:9px 8px;border-radius:12px;cursor:pointer}',
    'li:active{background:var(--surface2)}',
    'li.on{background:var(--surface2);box-shadow:inset 3px 0 0 var(--accent)}',
    '.logo{width:46px;height:32px;flex:none;border-radius:6px;background:#0d131a;display:flex;',
    'align-items:center;justify-content:center;overflow:hidden;font-size:12px;font-weight:600;color:var(--muted)}',
    '.logo img{max-width:100%;max-height:100%;object-fit:contain}',
    '.meta{min-width:0}',
    '.meta b{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.meta small{color:var(--muted)}',
    '.hint{padding:0 14px 8px;color:var(--muted);font-size:12px}',
    '.error{margin:14px;padding:12px;border:1px solid var(--border);border-radius:10px;color:var(--muted)}',
    '</style>',
    '</head>',
    '<body>',
    '<header>',
    '  <div class="brand"><span></span>Mundial TV</div>',
    '  <div class="now" id="now">Conectando con el ordenador…</div>',
    '  <div class="controls">',
    '    <button id="play" class="primary">Pausa</button>',
    '    <button id="stop">Parar</button>',
    '    <div class="vol"><span>Vol</span><input id="vol" type="range" min="0" max="1" step="0.05" value="1"></div>',
    '  </div>',
    '</header>',
    '<div class="search"><input id="q" type="search" placeholder="Buscar canal" autocomplete="off"></div>',
    '<p class="hint" id="hint"></p>',
    '<ul id="list"></ul>',
    '<script>',
    'var TOKEN = ' + JSON.stringify(token) + ';',
    'var canales = [];',
    'var actual = null;',
    'var reproduciendo = false;',
    'function pedir(ruta, opciones) {',
    '  opciones = opciones || {};',
    '  opciones.headers = { "Content-Type": "application/json", "X-Clave": TOKEN };',
    '  return fetch(ruta, opciones).then(function (r) { return r.json(); });',
    '}',
    'function comando(accion, datos) {',
    '  var cuerpo = Object.assign({ accion: accion }, datos || {});',
    '  return pedir("/api/comando", { method: "POST", body: JSON.stringify(cuerpo) });',
    '}',
    'function pintar() {',
    '  var q = (document.getElementById("q").value || "").toLowerCase();',
    '  var lista = document.getElementById("list");',
    '  var filtrados = canales.filter(function (c) {',
    '    return !q || c.nombre.toLowerCase().indexOf(q) >= 0 || (c.grupo || "").toLowerCase().indexOf(q) >= 0;',
    '  });',
    '  lista.innerHTML = "";',
    '  filtrados.forEach(function (c) {',
    '    var li = document.createElement("li");',
    '    if (c.id === actual) li.className = "on";',
    '    var logo = document.createElement("div");',
    '    logo.className = "logo";',
    '    if (c.logo) {',
    '      var img = document.createElement("img");',
    '      img.loading = "lazy";',
    '      img.src = c.logo;',
    '      img.onerror = function () { logo.textContent = c.iniciales; img.remove(); };',
    '      logo.appendChild(img);',
    '    } else {',
    '      logo.textContent = c.iniciales;',
    '    }',
    '    var meta = document.createElement("div");',
    '    meta.className = "meta";',
    '    var b = document.createElement("b");',
    '    b.textContent = c.nombre;',
    '    var s = document.createElement("small");',
    '    s.textContent = c.grupo;',
    '    meta.appendChild(b); meta.appendChild(s);',
    '    li.appendChild(logo); li.appendChild(meta);',
    '    li.addEventListener("click", function () {',
    '      comando("canal", { canalId: c.id }).then(estado);',
    '    });',
    '    lista.appendChild(li);',
    '  });',
    '  document.getElementById("hint").textContent = filtrados.length + " canales";',
    '}',
    'function estado() {',
    '  return pedir("/api/estado").then(function (d) {',
    '    actual = d.actual;',
    '    reproduciendo = !!d.reproduciendo;',
    '    document.getElementById("play").textContent = reproduciendo ? "Pausa" : "Reproducir";',
    '    document.getElementById("now").innerHTML = d.nombre',
    '      ? "En el ordenador: <b>" + d.nombre + "</b>"',
    '      : "Ningún canal en el ordenador";',
    '    if (d.volumen !== null && d.volumen !== undefined) {',
    '      document.getElementById("vol").value = d.volumen;',
    '    }',
    '    if (!canales.length && d.canales) { canales = d.canales; }',
    '    pintar();',
    '  }).catch(function () {',
    '    document.getElementById("now").textContent = "Se ha perdido la conexión con el ordenador";',
    '  });',
    '}',
    'document.getElementById("q").addEventListener("input", pintar);',
    'document.getElementById("play").addEventListener("click", function () {',
    '  comando(reproduciendo ? "pausa" : "reanudar").then(estado);',
    '});',
    'document.getElementById("stop").addEventListener("click", function () {',
    '  comando("detener").then(estado);',
    '});',
    'document.getElementById("vol").addEventListener("change", function () {',
    '  comando("volumen", { valor: Number(this.value) }).then(estado);',
    '});',
    'estado();',
    'setInterval(estado, 3000);',
    '</' + 'script>',
    '</body>',
    '</html>',
  ].join('\n');
}

class Remote {
  /**
   * @param {object} options
   * @param {() => Array<object>} options.getChannels catálogo que se ofrece al móvil
   * @param {() => object} options.getState estado actual de reproducción
   * @param {(command: object) => void} options.onCommand aviso a la ventana principal
   */
  constructor({ getChannels, getState, onCommand, port = DEFAULT_PORT }) {
    this.getChannels = getChannels;
    this.getState = getState;
    this.onCommand = onCommand;
    this.port = port;
    this.token = crypto.randomBytes(9).toString('hex');
    this.server = null;
    this.address = localAddress();
    this.error = null;
  }

  get url() {
    return `http://${this.address}:${this.port}/?k=${this.token}`;
  }

  get info() {
    return {
      running: Boolean(this.server),
      url: this.url,
      port: this.port,
      address: this.address,
      error: this.error,
    };
  }

  /** Canales en la forma reducida que consume el móvil. */
  channelsForPhone() {
    return this.getChannels().map((channel) => ({
      id: channel.id,
      nombre: channel.name,
      grupo: channel.group,
      logo: /^https:\/\//i.test(channel.logo || '') ? channel.logo : '',
      iniciales: (channel.name || '?').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().split(/\s+/).slice(0, 2)
        .map((word) => word[0] || '')
        .join('')
        .toUpperCase(),
    }));
  }

  handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
    };

    const token = request.headers['x-clave'] || url.searchParams.get('k');
    if (token !== this.token) {
      send(403, JSON.stringify({ error: 'clave incorrecta' }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/') {
      send(200, mobilePage(this.token), 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/estado') {
      send(200, JSON.stringify({ ...this.getState(), canales: this.channelsForPhone() }));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/comando') {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) request.destroy();
      });
      request.on('end', () => {
        let command = null;
        try {
          command = JSON.parse(body || '{}');
        } catch {
          send(400, JSON.stringify({ error: 'petición ilegible' }));
          return;
        }
        if (typeof command.accion !== 'string') {
          send(400, JSON.stringify({ error: 'falta la acción' }));
          return;
        }
        this.onCommand(command);
        send(200, JSON.stringify({ ok: true }));
      });
      return;
    }

    send(404, JSON.stringify({ error: 'no encontrado' }));
  }

  /** Arranca el servidor. Si el puerto está ocupado, prueba el siguiente. */
  start(attempt = 0) {
    return new Promise((resolve) => {
      const server = http.createServer((request, response) => this.handle(request, response));
      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE' && attempt < 5) {
          this.port += 1;
          resolve(this.start(attempt + 1));
          return;
        }
        this.error = error.code || String(error.message);
        this.server = null;
        resolve(this.info);
      });
      server.listen(this.port, '0.0.0.0', () => {
        this.server = server;
        this.error = null;
        resolve(this.info);
      });
    });
  }

  stop() {
    if (!this.server) return;
    try {
      this.server.close();
    } catch {
      /* ya estaba cerrado */
    }
    this.server = null;
  }
}

module.exports = { Remote, localAddress, mobilePage, DEFAULT_PORT };
