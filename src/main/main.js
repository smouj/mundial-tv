'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, net, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const QRCode = require('qrcode');

const { parseM3U, groupChannels } = require('./playlist');
const { Remote } = require('./remote');
const { officialChannels } = require('./official-channels');
const { Settings } = require('./settings');
const { EPG_URL, EPG_TTL_MS, normalizeEpg } = require('./epg');
const { sanitizeSettingsPatch, publicSettings, validExternalUrl, validOfficialUrl } = require('./ipc-security');
const { recordSourceResult, rankSources } = require('./source-health');
const { responseTextLimited, responseJsonLimited } = require('./http-utils');

/** Lista pública de canales, mantenida por el proyecto TDTChannels (Apache-2.0). */
const PLAYLIST_URL = 'https://www.tdtchannels.com/lists/tv.m3u8';

/** Se reutiliza la copia local durante este tiempo antes de volver a descargar. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MEDIA_RE = /\.(m3u8|ts|m4s|mp4|m4a|aac|vtt|key)(\?|#|$)/i;

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {WebContentsView|null} */
let officialView = null;
/** @type {Settings} */
let settings = null;
/** @type {{channels: object[], meta: object}} */
let catalogue = { channels: [], meta: { fetchedAt: null, source: 'none', count: 0 } };
let epg = { programmes: [], meta: { fetchedAt: null, source: 'none', count: 0 } };
let epgRefreshPromise = null;
let epgRefreshTimer = null;
let saveBoundsTimer = null;
/** Ventana flotante del minirreproductor. */
let miniWindow = null;
/** Última zona que la interfaz reservó para el vídeo, para poder restaurarla. */
let stageBounds = { x: 0, y: 0, width: 640, height: 360 };
let adWatcher = null;
let adsSkipped = 0;
/** Mando del móvil. */
let remote = null;
/** Último estado publicado por la interfaz, que es lo que ve el móvil. */
let remoteState = { actual: null, nombre: null, reproduciendo: false, volumen: 1 };
let updateState = { status: 'idle', version: null, progress: null, error: null };
let restoreAutoDownloadAfterCheck = false;

function cacheDir() {
  return path.join(app.getPath('userData'), 'cache');
}

function epgCachePath() {
  return path.join(cacheDir(), 'epg.json');
}

function snapshotPath() {
  return path.join(app.getAppPath(), 'resources', 'canales.m3u');
}

/**
 * Un navegador de escritorio normal envía cabeceras que algunos servidores de
 * streaming rechazan cuando el origen es `file://`. Se normaliza la petición
 * únicamente para los recursos de vídeo y se añade CORS donde falta, que es
 * justo lo que hace cualquier reproductor de escritorio.
 */
function installMediaRequestShims() {
  const ses = session.defaultSession;

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    if (MEDIA_RE.test(details.url)) {
      delete headers.Origin;
      delete headers.origin;
      delete headers.Referer;
      delete headers.referer;
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
    const isMedia = MEDIA_RE.test(details.url) || /mpegurl|video\/|audio\//.test(contentType);
    if (isMedia) {
      headers['access-control-allow-origin'] = ['*'];
      headers['access-control-allow-headers'] = ['*'];
      headers['access-control-allow-methods'] = ['GET,HEAD,OPTIONS'];
    }
    callback({ responseHeaders: headers });
  });
}

function readCache() {
  try {
    const metadataPath = path.join(cacheDir(), 'playlist.json');
    const playlistPath = path.join(cacheDir(), 'playlist.m3u');
    if (fs.statSync(metadataPath).size > 1024 * 1024 || fs.statSync(playlistPath).size > 20 * 1024 * 1024) {
      throw new Error('caché demasiado grande');
    }
    const raw = fs.readFileSync(metadataPath, 'utf8');
    const meta = JSON.parse(raw);
    const text = fs.readFileSync(playlistPath, 'utf8');
    if (!text.includes('#EXTM3U')) throw new Error('caché ilegible');
    return { text, meta };
  } catch {
    return null;
  }
}

function writeCache(text, meta) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), 'playlist.m3u'), text, 'utf8');
    fs.writeFileSync(path.join(cacheDir(), 'playlist.json'), JSON.stringify(meta, null, 2), 'utf8');
  } catch {
    /* sin caché se seguirá tirando de la copia incluida en la aplicación */
  }
}

function readSnapshot() {
  try {
    return fs.readFileSync(snapshotPath(), 'utf8');
  } catch {
    return null;
  }
}

/** Descarga la lista pública. Devuelve `null` si no hay red o la respuesta no es válida. */
async function downloadPlaylist() {
  const response = await net.fetch(PLAYLIST_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain,application/vnd.apple.mpegurl,*/*' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await responseTextLimited(response, 20 * 1024 * 1024);
  if (!text.includes('#EXTINF')) throw new Error('respuesta sin canales');
  return text;
}

function buildCatalogue(text, meta) {
  const channels = rankCatalogueSources([...groupChannels(parseM3U(text)), ...officialChannels()]);
  return {
    channels,
    meta: { ...meta, count: channels.length },
  };
}

function sourceHealthKey(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex');
}

function rankCatalogueSources(channels) {
  const health = settings ? settings.get('sourceHealth') : {};
  return channels.map((channel) => {
    const sources = (channel.sources || []).map((source) => ({ ...source, healthKey: sourceHealthKey(source.url) }));
    return { ...channel, sources: rankSources(sources, health) };
  });
}

function applySource(text, meta) {
  catalogue = buildCatalogue(text, meta);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('channels:updated', catalogue);
  }
  return catalogue;
}

/**
 * Deja el catálogo listo a partir de la caché o de la copia incluida.
 *
 * Es deliberadamente síncrona y se ejecuta antes de crear la ventana: así la
 * interfaz nunca recibe una lista vacía en el primer arranque, que es lo que
 * dejaba sin efecto la memoria del último canal visto.
 *
 * @returns {boolean} si la copia local sigue vigente y no hace falta red.
 */
function loadLocalCatalogue() {
  const cached = readCache();
  if (cached) {
    const fresh = Date.now() - Number(cached.meta.fetchedAt || 0) < CACHE_TTL_MS;
    applySource(cached.text, { ...cached.meta, source: fresh ? 'cache' : 'cache-stale' });
    return fresh;
  }

  const snapshot = readSnapshot();
  if (snapshot) applySource(snapshot, { fetchedAt: 0, source: 'snapshot' });
  return false;
}

/** Refresca la lista por red solo si la copia local ya no sirve. */
async function warmCatalogue() {
  if (loadLocalCatalogue()) return catalogue;
  return refreshCatalogue();
}

async function refreshCatalogue() {
  try {
    const text = await downloadPlaylist();
    const now = Date.now();
    writeCache(text, { fetchedAt: now, source: 'download' });
    return applySource(text, { fetchedAt: now, source: 'download' });
  } catch (error) {
    if (!catalogue.channels.length) {
      const snapshot = readSnapshot();
      if (snapshot) return applySource(snapshot, { fetchedAt: 0, source: 'snapshot' });
    }
    catalogue.meta = { ...catalogue.meta, error: String(error && error.message ? error.message : error) };
    return catalogue;
  }
}

function applyEpg(programmes, meta) {
  epg = { programmes, meta: { ...meta, count: programmes.length } };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('epg:updated', epg);
  return epg;
}

function loadEpgCache() {
  try {
    const file = epgCachePath();
    if (fs.statSync(file).size > 40 * 1024 * 1024) return false;
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!cached || !Array.isArray(cached.programmes) || !cached.programmes.length) return false;
    const programmes = normalizeEpg(cached.programmes);
    const fetchedAt = Number(cached.meta && cached.meta.fetchedAt) || 0;
    applyEpg(programmes, { fetchedAt, source: Date.now() - fetchedAt < EPG_TTL_MS ? 'cache' : 'cache-stale' });
    return Date.now() - fetchedAt < EPG_TTL_MS;
  } catch {
    return false;
  }
}

async function refreshEpg() {
  if (epgRefreshPromise) return epgRefreshPromise;
  epgRefreshPromise = (async () => {
    try {
      const response = await net.fetch(EPG_URL, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,*/*' },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await responseJsonLimited(response, 40 * 1024 * 1024);
      const programmes = normalizeEpg(data);
      const fetchedAt = Date.now();
      const next = { programmes, meta: { fetchedAt, source: 'download', count: programmes.length } };
      const file = epgCachePath();
      const temporaryFile = `${file}.tmp`;
      try {
        fs.mkdirSync(cacheDir(), { recursive: true });
        fs.writeFileSync(temporaryFile, JSON.stringify(next), 'utf8');
        fs.renameSync(temporaryFile, file);
      } catch {
        try { fs.rmSync(temporaryFile, { force: true }); } catch { /* limpieza best-effort */ }
      }
      return applyEpg(programmes, next.meta);
    } catch (error) {
      return applyEpg(epg.programmes, {
        ...epg.meta,
        error: String(error && error.message ? error.message : error),
      });
    } finally {
      epgRefreshPromise = null;
    }
  })();
  return epgRefreshPromise;
}

async function warmEpg() {
  if (loadEpgCache()) return epg;
  return refreshEpg();
}

function windowOptions() {
  const saved = settings.get('windowBounds');
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const options = {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    title: 'Mundial TV',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  };

  options.width = Math.min(options.width, Math.max(960, workArea.width - 40));
  options.height = Math.min(options.height, Math.max(640, workArea.height - 40));

  const iconPath = path.join(app.getAppPath(), 'build', 'icon.ico');
  if (fs.existsSync(iconPath)) options.icon = iconPath;

  if (process.platform === 'win32' || process.platform === 'linux') {
    options.titleBarStyle = 'hidden';
    options.titleBarOverlay = { color: '#0e141b', symbolColor: '#c9d5e0', height: 46 };
  }
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
    options.width = Math.max(960, Math.round(saved.width));
    options.height = Math.max(640, Math.round(saved.height));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      options.x = Math.round(saved.x);
      options.y = Math.round(saved.y);
    }
  }
  return options;
}

function rememberBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    settings.patch({ windowBounds: mainWindow.getNormalBounds() });
  }, 400);
}

/**
 * Muestra la ventana una sola vez.
 *
 * No basta con esperar a `ready-to-show`: en algunos equipos ese aviso no
 * llega y la aplicación se quedaría arrancada pero invisible, que es el peor
 * fallo posible. Se atiende también la carga terminada y, como última red,
 * un temporizador corto.
 */
function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
  mainWindow.show();
  mainWindow.focus();
}

function rendererUrl() {
  return pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href;
}

function isTrustedRenderer(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event &&
    event.sender === mainWindow.webContents && event.senderFrame && event.senderFrame.url === rendererUrl());
}

function assertTrustedRenderer(event) {
  if (!isTrustedRenderer(event)) throw new Error('Origen IPC no autorizado');
}

function isAllowedExternal(value) {
  if (!validExternalUrl(value, { allowLanHttp: true })) return false;
  try {
    const url = new URL(String(value));
    if (url.protocol === 'http:') return true;
    const host = url.hostname.toLowerCase();
    return validOfficialUrl(url.href) || host === 'github.com' || host === 'www.github.com' ||
      host === 'tdtchannels.com' || host.endsWith('.tdtchannels.com');
  } catch {
    return false;
  }
}

function openExternalSafely(value) {
  if (!isAllowedExternal(value)) return false;
  try {
    void shell.openExternal(String(value)).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow(windowOptions());
  mainWindow.once('ready-to-show', revealWindow);
  mainWindow.webContents.once('did-finish-load', revealWindow);
  const revealTimer = setTimeout(revealWindow, 2500);
  mainWindow.on('closed', () => clearTimeout(revealTimer));
  mainWindow.on('resize', rememberBounds);
  mainWindow.on('move', rememberBounds);
  mainWindow.on('closed', () => {
    closeOfficialView();
    mainWindow = null;
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl()) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function clampBounds(bounds) {
  const content = mainWindow.getContentBounds();
  const x = Math.max(0, Math.round(Number(bounds && bounds.x) || 0));
  const y = Math.max(0, Math.round(Number(bounds && bounds.y) || 0));
  const width = Math.max(1, Math.min(content.width - x, Math.round(Number(bounds && bounds.width) || 1)));
  const height = Math.max(1, Math.min(content.height - y, Math.round(Number(bounds && bounds.height) || 1)));
  return { x, y, width, height };
}

/**
 * Muestra el directo oficial dentro de la ventana. Se usa una vista de nivel
 * superior (no un iframe) para que la web oficial se comporte igual que en un
 * navegador normal.
 */
function openOfficialView({ url, bounds }) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'sin ventana' };
  if (!validOfficialUrl(url)) {
    return { ok: false, error: 'dirección no permitida' };
  }

  closeMiniView();
  closeOfficialView();

  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:official',
    },
  });
  officialView = view;
  view.webContents.setUserAgent(USER_AGENT);
  view.webContents.on('will-navigate', (event, nextUrl) => {
    if (validOfficialUrl(nextUrl)) return;
    event.preventDefault();
    openExternalSafely(nextUrl);
  });
  view.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    openExternalSafely(nextUrl);
    return { action: 'deny' };
  });
  mainWindow.contentView.addChildView(view);
  view.setBounds(clampBounds(bounds));
  view.webContents.loadURL(url);
  startAdWatcher();
  return { ok: true };
}

function notifyMini(active) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('official:mini-changed', { active: Boolean(active) });
  }
}

function closeMiniView() {
  if (!miniWindow || miniWindow.isDestroyed()) {
    miniWindow = null;
    return;
  }
  miniWindow.destroy();
  miniWindow = null;
  notifyMini(false);
}

function closeOfficialView() {
  stopAdWatcher();
  closeMiniView();
  if (!officialView) return;
  const view = officialView;
  officialView = null;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(view);
  } catch {
    /* la vista ya no pertenece a la ventana */
  }
  try {
    view.webContents.close();
  } catch {
    /* ya estaba cerrada */
  }
}

/** Zona útil de la ventana flotante: el vídeo ocupa todo su contenido. */
function miniContentBounds() {
  const bounds = miniWindow.getContentBounds();
  return { x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
}

/** Devuelve el reproductor a su sitio en la ventana principal. */
function detachMiniView() {
  if (officialView && miniWindow && !miniWindow.isDestroyed()) {
    try {
      miniWindow.contentView.removeChildView(officialView);
    } catch {
      /* la vista ya no estaba ahí */
    }
  }
  if (officialView && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.addChildView(officialView);
    officialView.setBounds(clampBounds(stageBounds));
  }
}

/**
 * Lleva el reproductor oficial a una ventana pequeña que permanece por encima
 * del resto de ventanas.
 *
 * No se abre ninguna conexión nueva: es exactamente la misma vista cambiando de
 * ventana, así que el canal no se corta ni se consume el doble de ancho de
 * banda.
 */
function enterMiniView() {
  if (!officialView || !mainWindow || mainWindow.isDestroyed()) return { ok: false, mini: false };

  if (!miniWindow || miniWindow.isDestroyed()) {
    miniWindow = new BrowserWindow({
      width: 520,
      height: 330,
      minWidth: 320,
      minHeight: 200,
      alwaysOnTop: true,
      title: 'Minirreproductor',
      backgroundColor: '#05080b',
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    miniWindow.setMenuBarVisibility(false);
    miniWindow.on('close', () => detachMiniView());
    miniWindow.on('closed', () => {
      miniWindow = null;
      notifyMini(false);
    });
    miniWindow.on('resize', () => {
      if (officialView && miniWindow && !miniWindow.isDestroyed()) {
        officialView.setBounds(miniContentBounds());
      }
    });
  }

  try {
    mainWindow.contentView.removeChildView(officialView);
  } catch {
    /* ya estaba fuera */
  }
  miniWindow.contentView.addChildView(officialView);
  officialView.setBounds(miniContentBounds());
  miniWindow.show();
  miniWindow.focus();
  notifyMini(true);
  return { ok: true, mini: true };
}

function leaveMiniView() {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
  else detachMiniView();
  return { ok: true, mini: false };
}

/**
 * Salto de anuncios.
 *
 * No bloquea ni elimina publicidad: únicamente busca el botón que la propia web
 * ofrece para saltar el anuncio («Saltar anuncio», «Omitir», «Skip»…) y lo
 * pulsa en cuanto aparece. Si el reproductor no muestra ese botón, no se toca
 * nada.
 */
const AD_SKIP_SCRIPT = `
(() => {
  const PATTERN = /(saltar|omitir|obviar|ignorar|skip)/i;
  const nodes = document.querySelectorAll('button, [role="button"], [class*="skip" i]');
  for (const node of nodes) {
    const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const label = node.getAttribute('aria-label') || node.getAttribute('title') || '';
    if (text.length > 32) continue;
    if (!PATTERN.test(text) && !PATTERN.test(label)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1) continue;
    node.click();
    return text || label;
  }
  return null;
})()
`;

function stopAdWatcher() {
  if (adWatcher) clearInterval(adWatcher);
  adWatcher = null;
}

function startAdWatcher() {
  stopAdWatcher();
  if (!settings.get('skipAds')) return;
  adWatcher = setInterval(async () => {
    if (!officialView) {
      stopAdWatcher();
      return;
    }
    try {
      const clicked = await officialView.webContents.executeJavaScript(AD_SKIP_SCRIPT, true);
      if (clicked && mainWindow && !mainWindow.isDestroyed()) {
        adsSkipped += 1;
        mainWindow.webContents.send('official:ad-skipped', {
          label: String(clicked).slice(0, 32),
          total: adsSkipped,
        });
      }
    } catch {
      /* la página todavía no está lista o ya se cerró */
    }
  }, 1500);
}

/**
 * Clave del mando.
 *
 * Se genera una sola vez y se guarda: así el teléfono que ya la tenía —o el
 * icono que se haya añadido a su pantalla de inicio— sigue funcionando en los
 * siguientes arranques, sin volver a escanear el código.
 */
function remoteToken() {
  const saved = settings.get('remoteToken');
  if (typeof saved === 'string' && /^[a-f0-9]{16,}$/.test(saved)) return saved;
  const token = crypto.randomBytes(16).toString('hex');
  settings.patch({ remoteToken: token });
  return token;
}

/** Arranca el servidor del mando dentro de la red local. */
function startRemote() {
  const savedPort = Number(settings.get('remotePort'));
  const port = Number.isInteger(savedPort) && savedPort > 1024 ? savedPort : undefined;

  remote = new Remote({
    token: remoteToken(),
    port,
    getChannels: () => catalogue.channels,
    getState: () => ({ ...remoteState, favorites: settings.get('favourites') || [] }),
    getProgrammes: () => epg.programmes,
    onCommand: (command) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('remote:command', command);
      }
    },
  });

  return remote.start().then((info) => {
    if (info.running) {
      if (settings.get('remotePort') !== info.port) settings.patch({ remotePort: info.port });
    }
    return info;
  });
}

/** Cambia la clave por una nueva y vuelve a levantar el mando. */
async function rotateRemoteToken() {
  settings.patch({ remoteToken: crypto.randomBytes(16).toString('hex') });
  if (remote) remote.stop();
  await startRemote();
  return remoteInfo();
}

/** Información del mando para la ventana, con el código QR ya dibujado. */
async function remoteInfo() {
  if (!remote) return { running: false };
  const info = remote.info;
  let qr = null;
  try {
    qr = await QRCode.toDataURL(info.url, { margin: 1, width: 280 });
  } catch {
    /* si falla el dibujo, la ventana enseña solo la dirección */
  }
  return { ...info, qr };
}

/**
 * Control básico del reproductor oficial (pausa, reproducción y volumen).
 *
 * Se actúa sobre el elemento de vídeo de la propia web oficial; es la única
 * forma de gobernar un reproductor que no es nuestro.
 */
function controlOfficialPlayback(action, value) {
  if (!officialView) return { ok: false };
  const scripts = {
    pausa: 'document.querySelectorAll("video").forEach((v) => v.pause())',
    reanudar: 'document.querySelectorAll("video").forEach((v) => v.play())',
    volumen: Number.isFinite(value) && value >= 0 && value <= 1
      ? `document.querySelectorAll("video").forEach((v) => { v.volume = ${value}; v.muted = false; })`
      : null,
  };
  const script = scripts[action];
  if (typeof script !== 'string') return { ok: false };
  officialView.webContents.executeJavaScript(script, true).catch(() => {});
  return { ok: true };
}

function publishUpdateState(next) {
  updateState = { ...updateState, ...next };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:status', updateState);
  return updateState;
}

function restoreAutoDownloadPreference() {
  if (!restoreAutoDownloadAfterCheck) return;
  restoreAutoDownloadAfterCheck = false;
  autoUpdater.autoDownload = settings.get('automaticUpdates') !== false;
}

function configureUpdater() {
  autoUpdater.autoDownload = settings.get('automaticUpdates') !== false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => publishUpdateState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => publishUpdateState({ status: 'available', version: info.version, error: null }));
  autoUpdater.on('update-not-available', () => {
    restoreAutoDownloadPreference();
    publishUpdateState({ status: 'current', progress: null, error: null });
  });
  autoUpdater.on('download-progress', (progress) => publishUpdateState({ status: 'downloading', progress: Math.round(progress.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    restoreAutoDownloadPreference();
    publishUpdateState({ status: 'downloaded', version: info.version, progress: 100, error: null });
  });
  autoUpdater.on('error', () => {
    restoreAutoDownloadPreference();
    publishUpdateState({ status: 'error', error: 'No se pudo buscar o descargar la actualización.' });
  });
}

async function requestUpdateCheck({ manual = false } = {}) {
  if (!app.isPackaged) return publishUpdateState({ status: 'development', error: null });
  const automatic = settings.get('automaticUpdates') !== false;
  if (!automatic && !manual) return publishUpdateState({ status: 'disabled', error: null });
  if (!automatic && manual) {
    autoUpdater.autoDownload = true;
    restoreAutoDownloadAfterCheck = true;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    restoreAutoDownloadPreference();
    publishUpdateState({ status: 'error', error: 'No se pudo buscar o descargar la actualización.' });
  }
  return updateState;
}

function registerIpc() {
  const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
    assertTrustedRenderer(event);
    return callback(event, ...args);
  });
  handle('channels:list', () => catalogue);
  handle('channels:refresh', () => refreshCatalogue());
  handle('epg:get', () => epg);
  handle('epg:refresh', () => refreshEpg());
  handle('settings:get', () => publicSettings(settings.get()));
  handle('settings:set', (_event, changes) => {
    const safeChanges = sanitizeSettingsPatch(changes);
    const updated = settings.patch(safeChanges);
    // Activar o desactivar el salto de anuncios surte efecto sin cambiar de canal.
    if ('skipAds' in safeChanges && officialView) startAdWatcher();
    if ('automaticUpdates' in safeChanges) {
      autoUpdater.autoDownload = safeChanges.automaticUpdates;
      if (!safeChanges.automaticUpdates) publishUpdateState({ status: 'disabled', error: null });
    }
    return publicSettings(updated);
  });
  handle('source-health:record', (_event, payload) => {
    if (!payload || typeof payload !== 'object' || !['success', 'failure'].includes(payload.result)) return { ok: false };
    const url = typeof payload.url === 'string' ? payload.url : '';
    const isKnownSource = catalogue.channels.some((channel) => (channel.sources || []).some((source) => source.url === url));
    if (!isKnownSource) return { ok: false };
    const startupMs = Number(payload.startupMs);
    const sourceHealth = recordSourceResult(
      settings.get('sourceHealth'),
      sourceHealthKey(url),
      payload.result === 'success',
      Number.isFinite(startupMs) ? startupMs : null,
    );
    settings.patch({ sourceHealth });
    catalogue = { ...catalogue, channels: rankCatalogueSources(catalogue.channels) };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('channels:updated', catalogue);
    return { ok: true, sourceHealth };
  });
  handle('official:open', (_event, payload) => openOfficialView(payload || {}));
  handle('official:bounds', (_event, bounds) => {
    stageBounds = clampBounds(bounds);
    if (officialView && !miniWindow) officialView.setBounds(stageBounds);
    return { ok: Boolean(officialView) };
  });
  handle('official:mini', (_event, active) => (active ? enterMiniView() : leaveMiniView()));
  handle('official:visible', (_event, visible) => {
    // La vista del reproductor oficial se pinta siempre por encima de la
    // página: hay que apartarla mientras se muestra un cuadro de diálogo, o el
    // diálogo quedaría oculto detrás del vídeo.
    if (officialView) officialView.setVisible(Boolean(visible));
    return { ok: Boolean(officialView) };
  });
  handle('official:close', () => {
    closeOfficialView();
    return { ok: true };
  });
  handle('app:openExternal', (_event, url) => {
    return { ok: openExternalSafely(url) };
  });
  handle('remote:info', () => remoteInfo());
  handle('remote:rotate', () => rotateRemoteToken());
  handle('remote:refresh', () => remoteInfo());
  handle('updates:status', () => updateState);
  handle('updates:check', () => requestUpdateCheck({ manual: true }));
  handle('updates:install', () => {
    if (updateState.status !== 'downloaded') return { ok: false };
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });
  ipcMain.on('remote:state', (event, payload) => {
    if (!isTrustedRenderer(event) || !payload || typeof payload !== 'object') return;
    const channel = catalogue.channels.find((item) => item.id === payload.actual) || null;
    const volume = Number(payload.volumen);
    remoteState = {
      actual: channel ? channel.id : null,
      nombre: channel ? channel.name : null,
      reproduciendo: Boolean(channel && payload.reproduciendo),
      volumen: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : remoteState.volumen,
    };
  });
  handle('official:control', (_event, action, value) => controlOfficialPlayback(action, value));
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    playlist: catalogue.meta,
    epg: epg.meta,
    updates: updateState,
    testMode: process.env.MUNDIAL_TEST_MODE === '1',
    repository: 'https://github.com/smouj/mundial-tv',
    attribution: 'Lista de canales: proyecto TDTChannels (LaQuay), Apache-2.0',
  }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.userAgentFallback = USER_AGENT;
  app.setAppUserModelId('es.smouj.mundialtv');

  app.whenReady().then(async () => {
    const testMode = process.env.MUNDIAL_TEST_MODE === '1';
    if (testMode && process.env.MUNDIAL_TEST_USER_DATA) {
      app.setPath('userData', process.env.MUNDIAL_TEST_USER_DATA);
    }
    settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
    settings.load();

    installMediaRequestShims();
    session.fromPartition('persist:official').setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );

    registerIpc();
    if (testMode) {
      createWindow();
      return;
    }
    loadLocalCatalogue();
    loadEpgCache();
    createWindow();
    warmCatalogue();
    warmEpg();
    clearInterval(epgRefreshTimer);
    epgRefreshTimer = setInterval(() => refreshEpg(), EPG_TTL_MS);
    startRemote();
    configureUpdater();
    if (settings.get('automaticUpdates') !== false && app.isPackaged) requestUpdateCheck();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (remote) remote.stop();
    if (epgRefreshTimer) clearInterval(epgRefreshTimer);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
