'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sanitizeHealthMap } = require('./source-health');

/** Preferencias por defecto de la aplicación. */
const DEFAULTS = Object.freeze({
  volume: 1,
  muted: false,
  favourites: [],
  recentChannels: [],
  lastChannelId: null,
  resumeLast: true,
  showInternational: true,
  skipAds: true,
  automaticUpdates: true,
  sourceHealth: {},
  /** Clave del mando: se guarda para no tener que volver a escanear el QR. */
  remoteToken: null,
  /** Puerto en el que funcionó el mando la última vez. */
  remotePort: null,
  windowBounds: null,
});

/**
 * Almacén de preferencias en un único JSON dentro del directorio de usuario.
 * Cualquier error de lectura o escritura degrada a los valores por defecto:
 * una preferencia corrupta nunca debe impedir abrir la aplicación.
 */
class Settings {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
  }

  load() {
    try {
      if (fs.statSync(this.file).size > 4 * 1024 * 1024) throw new Error('Preferencias demasiado grandes');
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (Object.hasOwn(DEFAULTS, key)) this.data[key] = value;
        }
      }
    } catch {
      /* primera ejecución o archivo corrupto */
    }
    this.data.volume = Number.isFinite(this.data.volume) ? Math.max(0, Math.min(1, this.data.volume)) : DEFAULTS.volume;
    this.data.muted = typeof this.data.muted === 'boolean' ? this.data.muted : DEFAULTS.muted;
    this.data.favourites = cleanIds(this.data.favourites, 500);
    this.data.recentChannels = cleanIds(this.data.recentChannels, 20);
    this.data.lastChannelId = typeof this.data.lastChannelId === 'string' && this.data.lastChannelId.length <= 180
      ? this.data.lastChannelId
      : null;
    this.data.resumeLast = typeof this.data.resumeLast === 'boolean' ? this.data.resumeLast : DEFAULTS.resumeLast;
    this.data.showInternational = typeof this.data.showInternational === 'boolean' ? this.data.showInternational : DEFAULTS.showInternational;
    this.data.skipAds = typeof this.data.skipAds === 'boolean' ? this.data.skipAds : DEFAULTS.skipAds;
    this.data.automaticUpdates = this.data.automaticUpdates !== false;
    this.data.sourceHealth = sanitizeHealthMap(this.data.sourceHealth);
    this.data.remoteToken = typeof this.data.remoteToken === 'string' && /^[a-f0-9]{32}$/i.test(this.data.remoteToken)
      ? this.data.remoteToken
      : null;
    this.data.remotePort = Number.isInteger(this.data.remotePort) && this.data.remotePort > 1024 && this.data.remotePort < 65536
      ? this.data.remotePort
      : null;
    this.data.windowBounds = cleanBounds(this.data.windowBounds);
    return this.data;
  }

  get(key) {
    return key === undefined ? this.data : this.data[key];
  }

  patch(changes) {
    Object.assign(this.data, changes);
    this.save();
    return this.data;
  }

  save() {
    const temporaryFile = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temporaryFile, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryFile, this.file);
    } catch {
      try { fs.rmSync(temporaryFile, { force: true }); } catch { /* limpieza best-effort */ }
      /* sin permiso de escritura: se sigue funcionando en memoria */
    }
  }
}

function cleanIds(value, maximum) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim() && item.length <= 180).map((item) => item.trim()))]
    .slice(0, maximum);
}

function cleanBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { x, y, width, height } = value;
  if (![width, height].every((item) => Number.isFinite(item) && item > 0 && item < 20_000)) return null;
  return {
    ...(Number.isFinite(x) ? { x: Math.max(-20_000, Math.min(20_000, Math.round(x))) } : {}),
    ...(Number.isFinite(y) ? { y: Math.max(-20_000, Math.min(20_000, Math.round(y))) } : {}),
    width: Math.round(width),
    height: Math.round(height),
  };
}

module.exports = { Settings, DEFAULTS, cleanIds, cleanBounds };
