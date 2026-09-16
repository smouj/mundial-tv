'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Preferencias por defecto de la aplicación. */
const DEFAULTS = Object.freeze({
  volume: 1,
  muted: false,
  favourites: [],
  lastChannelId: null,
  resumeLast: true,
  showInternational: true,
  skipAds: true,
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
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object') Object.assign(this.data, parsed);
    } catch {
      /* primera ejecución o archivo corrupto */
    }
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
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    } catch {
      /* sin permiso de escritura: se sigue funcionando en memoria */
    }
  }
}

module.exports = { Settings, DEFAULTS };
