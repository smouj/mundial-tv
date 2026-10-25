'use strict';

/** TDTChannels publica la guía en JSON y XMLTV comprimido. */
const EPG_URL = 'https://www.tdtchannels.com/epg/TV.json';
const EPG_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_HORIZON_MS = 36 * 60 * 60 * 1000;

function first(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function firstField(object, keys) {
  const direct = first(object, keys);
  if (direct !== undefined) return direct;
  if (!object || typeof object !== 'object') return undefined;
  for (const wrapperKey of ['$', 'attributes', '@attributes', 'attrs', '@']) {
    const attributes = object[wrapperKey];
    if (!attributes || typeof attributes !== 'object') continue;
    const value = first(attributes, keys);
    if (value !== undefined) return value;
  }
  for (const key of keys) {
    for (const prefix of ['@_', '@']) {
      if (object[`${prefix}${key}`] !== undefined && object[`${prefix}${key}`] !== null) return object[`${prefix}${key}`];
    }
  }
  return undefined;
}

function textOf(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return textOf(value[0]);
  if (value && typeof value === 'object') {
    return textOf(first(value, ['value', 'text', 'title', 'name', '#text', '_']));
  }
  return '';
}

/** Parses ISO timestamps and XMLTV's `YYYYMMDDHHMMSS +0100` representation. */
function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== 'string') return NaN;
  const raw = value.trim();
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    return raw.length <= 10 ? numeric * 1000 : numeric;
  }
  const xmltv = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])(\d{2})(\d{2})?$/);
  if (xmltv) {
    const [, year, month, day, hour, minute, second = '00', sign, offsetHour, offsetMinute = '00'] = xmltv;
    const local = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
    const offset = (+offsetHour * 60 + +offsetMinute) * (sign === '+' ? 1 : -1);
    return local - offset * 60_000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function channelIdOf(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim().toLowerCase();
  if (value && typeof value === 'object') {
    return textOf(firstField(value, ['id', 'channelId', 'channel_id', 'tvg-id', 'tvgId'])).toLowerCase();
  }
  return '';
}

function normalizeProgramme(raw, inheritedChannelId, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const channelId = (channelIdOf(firstField(raw, ['channelId', 'channel_id', 'channel', 'tvg-id', 'tvgId'])) || inheritedChannelId).toLowerCase();
  const start = parseTime(firstField(raw, ['start', 'startTime', 'start_time', 'begin', 'from', 'dateStart']));
  const stop = parseTime(firstField(raw, ['stop', 'end', 'endTime', 'end_time', 'to', 'dateEnd']));
  const title = textOf(first(raw, ['title', 'name', 'programme', 'program']));
  if (!channelId || !title || !Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return null;
  if (stop < now - 6 * 60 * 60 * 1000 || start > now + DEFAULT_HORIZON_MS) return null;
  return {
    channelId,
    title: title.slice(0, 240),
    description: textOf(first(raw, ['description', 'desc', 'summary'])).slice(0, 1200),
    start,
    stop,
  };
}

/**
 * Accepts XMLTV-style JSON arrays and grouped schedule objects. TDTChannels can
 * evolve optional metadata without requiring an application update.
 */
function normalizeEpg(input, now = Date.now()) {
  if (!input || typeof input !== 'object') throw new TypeError('La guía EPG no contiene datos');
  const programmes = [];
  const visit = (node, inheritedChannelId = '', depth = 0) => {
    if (depth > 12 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, inheritedChannelId, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    const programme = normalizeProgramme(node, inheritedChannelId, now);
    if (programme) {
      programmes.push(programme);
      return;
    }

    const ownChannelId = channelIdOf(firstField(node, ['channelId', 'channel_id', 'tvg-id', 'tvgId', 'id'])) || inheritedChannelId;
    const knownCollections = ['programmes', 'programs', 'programme', 'program', 'events', 'schedule', 'schedules', 'epg', 'data', 'channels', 'entries'];
    for (const key of knownCollections) {
      if (node[key] !== undefined) visit(node[key], ownChannelId, depth + 1);
    }
    // Some EPG JSONs group schedules in a dictionary keyed by the XMLTV id.
    if (!knownCollections.some((key) => node[key] !== undefined)) {
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value) || (value && typeof value === 'object')) visit(value, key, depth + 1);
      }
    }
  };

  visit(input);
  const deduplicated = new Map();
  for (const programme of programmes) {
    const key = `${programme.channelId}\0${programme.start}\0${programme.stop}\0${programme.title}`;
    if (!deduplicated.has(key)) deduplicated.set(key, programme);
  }
  const result = [...deduplicated.values()].sort((a, b) => a.start - b.start || a.channelId.localeCompare(b.channelId));
  if (!result.length) throw new TypeError('La guía EPG no contiene programas reconocibles');
  return result;
}

function scheduleFor(programmes, channelId, now = Date.now()) {
  const id = String(channelId || '').toLowerCase();
  const matching = (programmes || []).filter((programme) => programme.channelId === id);
  const current = matching.find((programme) => programme.start <= now && programme.stop > now) || null;
  const next = matching.find((programme) => programme.start >= (current ? current.stop : now)) || null;
  return { now: current, next };
}

module.exports = { EPG_URL, EPG_TTL_MS, parseTime, normalizeEpg, scheduleFor };
