'use strict';

const MAX_RECORDS = 4000;

const HEALTH_KEY_RE = /^[a-f0-9]{64}$/;

function cleanRecord(record) {
  const successes = clampInteger(record && record.successes, 0, 1_000_000);
  const failures = clampInteger(record && record.failures, 0, 1_000_000);
  const avgStartMs = Number(record && record.avgStartMs);
  return {
    successes,
    failures,
    avgStartMs: Number.isFinite(avgStartMs) && avgStartMs >= 0 ? Math.min(avgStartMs, 120_000) : null,
    consecutiveFailures: clampInteger(record && record.consecutiveFailures, 0, 1000),
    lastSuccessAt: safeTime(record && record.lastSuccessAt),
    lastFailureAt: safeTime(record && record.lastFailureAt),
  };
}

function clampInteger(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : min;
}

function safeTime(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(number, Date.now() + 60_000) : null;
}

function sanitizeHealthMap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  let count = 0;
  for (const key in input) {
    if (!Object.hasOwn(input, key)) continue;
    if (count >= MAX_RECORDS) break;
    count += 1;
    const record = input[key];
    if (!HEALTH_KEY_RE.test(key)) continue;
    result[key] = cleanRecord(record);
  }
  return result;
}

function sourceScore(record, now = Date.now()) {
  if (!record) return 50;
  const clean = cleanRecord(record);
  const reliability = 100 * (clean.successes + 1) / (clean.successes + clean.failures + 2);
  const speed = clean.avgStartMs === null ? 50 : Math.max(0, 100 - clean.avgStartMs / 60);
  const recentFailure = clean.lastFailureAt && now - clean.lastFailureAt < 10 * 60_000 ? 18 : 0;
  const recentSuccess = clean.lastSuccessAt && now - clean.lastSuccessAt < 24 * 60 * 60_000 ? 5 : 0;
  return Math.round(Math.max(0, Math.min(100, reliability * 0.75 + speed * 0.25 + recentSuccess - recentFailure)));
}

function rankSources(sources, health = {}, now = Date.now()) {
  return (sources || []).map((source, index) => ({ source, index })).sort((a, b) => {
    const scoreA = sourceScore(health[a.source.healthKey], now) - (a.source.geo ? 12 : 0);
    const scoreB = sourceScore(health[b.source.healthKey], now) - (b.source.geo ? 12 : 0);
    return scoreB - scoreA || a.index - b.index;
  }).map(({ source }) => source);
}

function recordSourceResult(input, key, success, startupMs, now = Date.now()) {
  if (!HEALTH_KEY_RE.test(String(key))) return sanitizeHealthMap(input);
  const health = sanitizeHealthMap(input);
  const record = cleanRecord(health[key]);
  if (success) {
    record.successes += 1;
    record.consecutiveFailures = 0;
    record.lastSuccessAt = now;
    if (Number.isFinite(startupMs) && startupMs >= 0) {
      const sample = Math.min(startupMs, 120_000);
      record.avgStartMs = record.avgStartMs === null ? sample : Math.round(record.avgStartMs * 0.7 + sample * 0.3);
    }
  } else {
    record.failures += 1;
    record.consecutiveFailures += 1;
    record.lastFailureAt = now;
  }
  health[key] = record;
  return health;
}

const sourceHealthApi = { MAX_RECORDS, sanitizeHealthMap, sourceScore, rankSources, recordSourceResult };
if (typeof module !== 'undefined' && module.exports) module.exports = sourceHealthApi;
if (typeof window !== 'undefined') window.MundialSourceHealth = sourceHealthApi;
