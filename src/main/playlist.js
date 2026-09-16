'use strict';

/**
 * Lectura y normalización de listas M3U/EXTINF.
 *
 * Módulo puro, sin dependencias de Electron, para poder verificarlo con
 * `node --test`. Convierte el texto de una lista de canales en una colección
 * de canales con sus fuentes de vídeo ordenadas por preferencia.
 */

/** Parámetros dinámicos del tipo `[IP]` / `[LMT]`: no son reproducibles sin sustitución. */
const PLACEHOLDER_RE = /\[[A-Z_]+\]/;

/** Marcas de restricción geográfica que la lista añade al final del nombre. */
const GEO_RE = /\s+GEO(?:\s+[A-Z]{2,3})?$/;

/**
 * Separa la línea `#EXTINF` en atributos y título.
 * El título es lo que sigue a la primera coma que no está entre comillas, de
 * modo que un nombre con comas se conserva entero.
 * @param {string} line
 * @returns {{attrs: Record<string,string>, title: string}|null}
 */
function splitExtinf(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const body = line.slice(colon + 1);

  let inQuotes = false;
  let separator = -1;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) {
      separator = i;
      break;
    }
  }
  if (separator === -1) return null;

  const attrs = {};
  const attrRe = /([A-Za-z0-9_.-]+)="([^"]*)"/g;
  const rawAttrs = body.slice(0, separator);
  let match = attrRe.exec(rawAttrs);
  while (match !== null) {
    attrs[match[1].toLowerCase()] = match[2];
    match = attrRe.exec(rawAttrs);
  }

  return { attrs, title: body.slice(separator + 1).trim() };
}

/**
 * Convierte el texto completo de una lista M3U en entradas individuales.
 * @param {string} text
 * @returns {Array<{url: string, id: string, name: string, logo: string, group: string, geo: boolean}>}
 */
function parseM3U(text) {
  const entries = [];
  let pending = null;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      pending = splitExtinf(line);
      continue;
    }
    if (line.startsWith('#')) {
      if (line.startsWith('#EXTGRP:') && pending) {
        pending.attrs['group-title'] = line.slice('#EXTGRP:'.length).trim();
      }
      continue;
    }
    if (!pending) continue;

    const rawTitle = pending.title;
    const geo = GEO_RE.test(rawTitle);
    const name = rawTitle.replace(GEO_RE, '').trim() || rawTitle;

    entries.push({
      url: line,
      id: pending.attrs['tvg-id'] || '',
      name,
      logo: pending.attrs['tvg-logo'] || '',
      group: pending.attrs['group-title'] || 'Otros',
      geo,
    });
    pending = null;
  }

  return entries;
}

/**
 * Clave estable de agrupación: el `tvg-id` cuando existe y, si no, el nombre.
 * @param {{id: string, name: string}} entry
 * @returns {string}
 */
function channelKey(entry) {
  if (entry.id) return entry.id.toLowerCase();
  return `name:${entry.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Agrupa las entradas en canales con múltiples fuentes de respaldo.
 *
 * Se descartan las fuentes con parámetros dinámicos (no reproducibles) y se
 * colocan primero las que no tienen restricción geográfica, de modo que el
 * reproductor siempre empiece por la opción con más probabilidad de éxito.
 *
 * @param {ReturnType<typeof parseM3U>} entries
 * @returns {Array<object>}
 */
function groupChannels(entries) {
  const byKey = new Map();

  for (const entry of entries) {
    if (!entry.url || PLACEHOLDER_RE.test(entry.url)) continue;

    const key = channelKey(entry);
    let channel = byKey.get(key);
    if (!channel) {
      channel = {
        id: key,
        name: entry.name,
        logo: entry.logo,
        group: entry.group,
        kind: 'hls',
        sources: [],
      };
      byKey.set(key, channel);
    }

    if (!channel.logo && entry.logo) channel.logo = entry.logo;
    if (channel.sources.some((source) => source.url === entry.url)) continue;
    channel.sources.push({ url: entry.url, geo: Boolean(entry.geo) });
  }

  for (const channel of byKey.values()) {
    channel.sources.sort((a, b) => Number(a.geo) - Number(b.geo));
  }

  return [...byKey.values()].filter((channel) => channel.sources.length > 0);
}

module.exports = { PLACEHOLDER_RE, GEO_RE, splitExtinf, parseM3U, channelKey, groupChannels };
