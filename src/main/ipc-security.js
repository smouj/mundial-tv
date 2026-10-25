'use strict';

const BOOLEAN_SETTINGS = new Set(['muted', 'resumeLast', 'showInternational', 'skipAds', 'automaticUpdates']);
const ID_SETTINGS = new Set(['lastChannelId']);
const ID_LIST_SETTINGS = new Set(['favourites', 'recentChannels']);
const PUBLIC_SETTINGS = [
  'volume', 'muted', 'favourites', 'recentChannels', 'lastChannelId', 'resumeLast',
  'showInternational', 'skipAds', 'automaticUpdates', 'sourceHealth',
];
const ALLOWED_SETTINGS = new Set([
  'volume', 'muted', 'favourites', 'recentChannels', 'lastChannelId', 'resumeLast',
  'showInternational', 'skipAds', 'automaticUpdates',
]);

function sanitizeSettingsPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Preferencias no válidas');
  const entries = Object.entries(input);
  if (entries.length > ALLOWED_SETTINGS.size) throw new TypeError('Demasiadas preferencias');
  const result = {};
  for (const [key, value] of entries) {
    if (!ALLOWED_SETTINGS.has(key)) throw new TypeError(`Preferencia no permitida: ${key}`);
    if (key === 'volume') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new TypeError('Volumen no válido');
      result.volume = value;
    } else if (BOOLEAN_SETTINGS.has(key)) {
      if (typeof value !== 'boolean') throw new TypeError(`${key} debe ser booleano`);
      result[key] = value;
    } else if (ID_SETTINGS.has(key)) {
      if (value !== null && (typeof value !== 'string' || value.length > 180)) throw new TypeError(`${key} no válido`);
      result[key] = value;
    } else if (ID_LIST_SETTINGS.has(key)) {
      const limit = key === 'recentChannels' ? 20 : 500;
      if (!Array.isArray(value) || value.length > limit || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 180)) {
        throw new TypeError(`${key} no es una lista válida`);
      }
      result[key] = [...new Set(value.map((item) => item.trim()))];
    }
  }
  return result;
}

function publicSettings(settings) {
  const safe = {};
  for (const key of PUBLIC_SETTINGS) {
    if (settings && Object.hasOwn(settings, key)) safe[key] = settings[key];
  }
  return safe;
}

function validExternalUrl(value, { allowLanHttp = false } = {}) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return !url.username && !url.password;
  if (url.protocol !== 'http:' || !allowLanHttp || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function validOfficialUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return ['mitele.es', 'atresplayer.com'].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

module.exports = { sanitizeSettingsPatch, publicSettings, validExternalUrl, validOfficialUrl };
