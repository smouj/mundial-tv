'use strict';

/**
 * Mando desde el móvil.
 *
 * Levanta un servidor web mínimo dentro de la red local y sirve una página
 * pensada para el teléfono, desde la que se cambia de canal, se pausa y se
 * ajusta el volumen. No hace falta instalar nada ni emparejar nada: se abre la
 * dirección (o se escanea el código QR que muestra la aplicación) y ya está.
 *
 * Todo el tráfico se queda en la red local. La clave persiste entre arranques
 * y se puede invalidar desde la aplicación cuando el usuario la rota.
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
  constructor({ getChannels, getState, getProgrammes = () => [], onCommand, port = DEFAULT_PORT, token } = {}) {
    this.getChannels = getChannels;
    this.getState = getState;
    this.getProgrammes = getProgrammes;
    this.onCommand = onCommand;
    this.port = port;
    // La clave se reutiliza entre arranques (la guarda la aplicación) para que
    // el móvil que ya la tenía guardada siga funcionando sin volver al QR.
    const candidateToken = String(token || '');
    this.token = /^[a-f0-9]{32}$/i.test(candidateToken) ? candidateToken : crypto.randomBytes(16).toString('hex');
    this.server = null;
    this.address = localAddress();
    this.error = null;
    /** Puerto en el que realmente se ha escuchado. */
    this.activePort = null;
    this.requestHistory = new Map();
    this.commandHistory = new Map();
  }

  get url() {
    return `http://${this.address}:${this.boundPort}/?k=${this.token}`;
  }

  /** Puerto en uso: el pedido o, si estaba ocupado, el que se pudo abrir. */
  get boundPort() {
    return this.activePort || this.port;
  }

  get info() {
    return {
      running: Boolean(this.server),
      url: this.url,
      port: this.boundPort,
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
    const state = this.getState() || {};
    const favourites = new Set(Array.isArray(state.favorites) ? state.favorites : []);
    const programmes = this.getProgrammes() || [];
    const byChannel = new Map();
    for (const programme of programmes) {
      let list = byChannel.get(programme.channelId);
      if (!list) byChannel.set(programme.channelId, (list = []));
      list.push(programme);
    }
    return this.getChannels().map((channel) => {
      const channelProgrammes = byChannel.get(String(channel.id).toLowerCase()) || [];
      const now = Date.now();
      const current = channelProgrammes.find((programme) => programme.start <= now && programme.stop > now) || null;
      const next = channelProgrammes.find((programme) => programme.start >= (current ? current.stop : now)) || null;
      return {
        id: channel.id,
        nombre: channel.name,
        grupo: channel.group,
        logo: /^https:\/\//i.test(channel.logo || '') ? channel.logo : '',
        favorito: favourites.has(channel.id),
        ahora: current ? current.title : '',
        despues: next ? next.title : '',
        inicio: current ? current.start : null,
        fin: current ? current.stop : null,
        progreso: current ? Math.max(0, Math.min(100, Math.round((now - current.start) / (current.stop - current.start) * 100))) : null,
        iniciales: (channel.name || '?').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().split(/\s+/).slice(0, 2)
          .map((word) => word[0] || '')
          .join('')
          .toUpperCase(),
      };
    });
  }

  rateLimit(request, command = false) {
    const now = Date.now();
    const address = request.socket.remoteAddress || 'unknown';
    const history = command ? this.commandHistory : this.requestHistory;
    const windowMs = command ? 10_000 : 60_000;
    const limit = command ? 30 : 150;
    const recent = (history.get(address) || []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) {
      history.set(address, recent);
      return false;
    }
    recent.push(now);
    history.set(address, recent);
    if (history.size > 256) {
      for (const [key, times] of history) {
        if (!times.length || now - times[times.length - 1] >= windowMs) history.delete(key);
      }
    }
    return true;
  }

  validCommand(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) return null;
    const onlyKeys = (...keys) => Object.keys(command).every((key) => keys.includes(key));
    switch (command.accion) {
      case 'canal':
      case 'favorito':
        return onlyKeys('accion', 'canalId') && typeof command.canalId === 'string' && this.getChannels().some((channel) => channel.id === command.canalId)
          ? { accion: command.accion, canalId: command.canalId }
          : null;
      case 'pausa':
      case 'reanudar':
      case 'detener':
        return onlyKeys('accion') ? { accion: command.accion } : null;
      case 'volumen':
        return onlyKeys('accion', 'valor') && typeof command.valor === 'number' && Number.isFinite(command.valor) && command.valor >= 0 && command.valor <= 1
          ? { accion: 'volumen', valor: command.valor }
          : null;
      default:
        return null;
    }
  }

  handle(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      });
      response.end(body);
    };

    if (!this.rateLimit(request)) {
      send(429, JSON.stringify({ error: 'demasiadas peticiones' }));
      return;
    }

    const token = request.headers['x-clave'] || url.searchParams.get('k');
    // El navegador pide el controlador de servicio sin la clave, así que es lo
    // único que se sirve sin comprobarla. No contiene nada sensible.
    if (request.method === 'GET' && url.pathname === '/sw.js') {
      send(200, SERVICE_WORKER, 'application/javascript; charset=utf-8');
      return;
    }

    const suppliedToken = Buffer.from(String(token || ''));
    const expectedToken = Buffer.from(this.token);
    if (suppliedToken.length !== expectedToken.length || !crypto.timingSafeEqual(suppliedToken, expectedToken)) {
      send(403, JSON.stringify({ error: 'clave incorrecta' }));
      return;
    }

    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) {
      send(403, JSON.stringify({ error: 'origen no permitido' }));
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
      if (!/^application\/json(?:;|$)/i.test(String(request.headers['content-type'] || ''))) {
        send(415, JSON.stringify({ error: 'se esperaba JSON' }));
        request.resume();
        return;
      }
      if (!this.rateLimit(request, true)) {
        send(429, JSON.stringify({ error: 'demasiadas órdenes' }));
        return;
      }
      if (Number(request.headers['content-length']) > 4096) {
        send(413, JSON.stringify({ error: 'orden demasiado grande' }));
        request.resume();
        return;
      }
      let body = '';
      let tooLarge = false;
      request.on('data', (chunk) => {
        if (Buffer.byteLength(body) + chunk.length > 4096) tooLarge = true;
        else if (!tooLarge) body += chunk.toString('utf8');
      });
      request.on('end', () => {
        if (tooLarge) {
          send(413, JSON.stringify({ error: 'orden demasiado grande' }));
          return;
        }
        let command = null;
        try {
          command = JSON.parse(body || '{}');
        } catch {
          send(400, JSON.stringify({ error: 'petición ilegible' }));
          return;
        }
        const safeCommand = this.validCommand(command);
        if (!safeCommand) {
          send(400, JSON.stringify({ error: 'orden no válida' }));
          return;
        }
        this.onCommand(safeCommand);
        send(200, JSON.stringify({ ok: true }));
      });
      return;
    }

    send(404, JSON.stringify({ error: 'no encontrado' }));
  }

  /** Arranca el servidor. Si el puerto está ocupado, prueba el siguiente. */
  start(attempt = 0) {
    return new Promise((resolve) => {
      const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => this.handle(request, response));
      server.requestTimeout = 10_000;
      server.headersTimeout = 15_000;
      server.keepAliveTimeout = 5_000;
      server.maxHeadersCount = 32;
      server.maxConnections = 64;
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
        // Se pregunta al sistema: así también vale pedir el puerto 0.
        this.activePort = server.address().port;
        this.error = null;
        resolve(this.info);
      });
    });
  }

  /** Deja de escuchar y olvida el puerto, para poder volver a arrancar. */
  stop() {
    this.activePort = null;
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
