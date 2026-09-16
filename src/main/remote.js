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
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { mobilePage } = require('./remote-page');

const DEFAULT_PORT = 8712;

/** Carpeta de recursos de la aplicación, dentro del paquete. */
const RESOURCES = path.join(__dirname, '..', '..', 'resources');

/**
 * Controlador de servicio mínimo.
 *
 * No hace falta para cambiar de canal, pero es lo que permite que el móvil
 * ofrezca «añadir a la pantalla de inicio» y que el mando abra a pantalla
 * completa y con su propio icono, como una aplicación.
 */
const SERVICE_WORKER = [
  "const CACHE = 'mundial-mando';",
  "self.addEventListener('install', () => self.skipWaiting());",
  "self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));",
  "self.addEventListener('fetch', (event) => {",
  "  const request = event.request;",
  "  if (request.method !== 'GET') return;",
  "  const url = new URL(request.url);",
  "  if (url.origin !== self.location.origin) return;",
  "  if (url.pathname !== '/' && !url.pathname.startsWith('/icono-')) return;",
  "  event.respondWith(",
  "    fetch(request)",
  "      .then((response) => {",
  "        const copy = response.clone();",
  "        caches.open(CACHE).then((cache) => cache.put(request, copy));",
  "        return response;",
  "      })",
  "      .catch(() => caches.match(request).then((hit) => hit || Response.error())),",
  "  );",
  "});",
  "",
].join('\n');

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


/** Grupos que la lista marca como internacionales. */
function isWorld(name) {
  return /^Int\./.test(name);
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

  /** Grupos en el orden en que deben aparecer los filtros del móvil. */
  groupsForPhone() {
    const nombres = [];
    for (const channel of this.getChannels()) {
      if (!nombres.includes(channel.group)) nombres.push(channel.group);
    }
    const orden = (a, b) => a.localeCompare(b, 'es');
    const oficiales = ['Atresmedia', 'Mediaset'].filter((name) => nombres.includes(name));
    // Primero los géneros nacionales y después las comunidades y el mundo.
    const generos = ['Generalistas', 'Informativos', 'Deportivos', 'Infantiles', 'Musicales', 'Religiosos', 'Eventuales']
      .filter((name) => nombres.includes(name));
    const restoEspana = nombres
      .filter((n) => !oficiales.includes(n) && !generos.includes(n) && !isWorld(n))
      .sort(orden);
    const mundo = nombres.filter(isWorld).sort(orden);
    return [...oficiales, ...generos, ...restoEspana, ...mundo];
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
    // El navegador pide el controlador de servicio sin la clave, así que es lo
    // único que se sirve sin comprobarla. No contiene nada sensible.
    if (request.method === 'GET' && url.pathname === '/sw.js') {
      send(200, SERVICE_WORKER, 'application/javascript; charset=utf-8');
      return;
    }

    if (token !== this.token) {
      send(403, JSON.stringify({ error: 'clave incorrecta' }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/manifest.webmanifest') {
      send(
        200,
        JSON.stringify({
          name: 'Mando de Mundial TV',
          short_name: 'Mando TV',
          description: 'Cambia de canal en Mundial TV desde el teléfono.',
          start_url: `/?k=${this.token}`,
          scope: '/',
          display: 'standalone',
          background_color: '#0b0f14',
          theme_color: '#0b0f14',
          icons: [
            { src: `/icono-192.png?k=${this.token}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `/icono-512.png?k=${this.token}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `/icono-512.png?k=${this.token}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        }),
        'application/manifest+json; charset=utf-8',
      );
      return;
    }

    const iconMatch = url.pathname.match(/^\/icono-(192|512)\.png$/);
    if (request.method === 'GET' && iconMatch) {
      try {
        send(200, fs.readFileSync(path.join(RESOURCES, `mando-${iconMatch[1]}.png`)), 'image/png');
      } catch {
        send(404, JSON.stringify({ error: 'sin icono' }));
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/') {
      send(200, mobilePage(this.token), 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/estado') {
      send(
        200,
        JSON.stringify({
          ...this.getState(),
          grupos: this.groupsForPhone(),
          canales: this.channelsForPhone(),
        }),
      );
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
