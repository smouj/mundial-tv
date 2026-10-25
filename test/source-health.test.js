'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeHealthMap, sourceScore, rankSources, recordSourceResult } = require('../src/main/source-health');

const NOW = Date.now();

test('sourceScore favors known reliability and startup speed', () => {
  const slow = { successes: 2, failures: 6, avgStartMs: 8000, lastFailureAt: null };
  const fast = { successes: 8, failures: 1, avgStartMs: 500, lastSuccessAt: NOW };
  assert.ok(sourceScore(fast, NOW) > sourceScore(slow, NOW));
});

test('rankSources leaves unknown sources in their original order and preserves geography preference', () => {
  const sources = [
    { url: 'https://geo.example/a.m3u8', geo: true },
    { url: 'https://open.example/a.m3u8', geo: false },
    { url: 'https://open.example/b.m3u8', geo: false },
  ];
  assert.deepEqual(rankSources(sources), [sources[1], sources[2], sources[0]]);
});

test('rankSources promotes a repeatedly successful source without persisting its URL', () => {
  const sources = [
    { url: 'https://a.test/live.m3u8', healthKey: 'a'.repeat(64) },
    { url: 'https://b.test/live.m3u8', healthKey: 'b'.repeat(64) },
  ];
  const health = {
    [sources[0].healthKey]: { successes: 1, failures: 4, avgStartMs: 3500 },
    [sources[1].healthKey]: { successes: 20, failures: 0, avgStartMs: 450 },
  };
  assert.equal(rankSources(sources, health)[0], sources[1]);
});

test('recordSourceResult updates a local EWMA and resets the failure streak', () => {
  const key = 'c'.repeat(64);
  const before = { [key]: { successes: 1, failures: 2, consecutiveFailures: 2, avgStartMs: 1000 } };
  const after = recordSourceResult(before, key, true, 500, NOW);
  assert.equal(after[key].successes, 2);
  assert.equal(after[key].consecutiveFailures, 0);
  assert.equal(after[key].avgStartMs, 850);
  assert.equal(after[key].lastSuccessAt, NOW);
});

test('sanitizeHealthMap accepts only source fingerprints and bounded metrics', () => {
  const cleaned = sanitizeHealthMap({
    'file:///C:/private': { successes: 9 },
    'https://stream.example/live.m3u8': { successes: 9 },
    ['d'.repeat(64)]: { successes: '4', failures: -10, avgStartMs: 999999999 },
  });
  assert.equal(Object.keys(cleaned).length, 1);
  assert.deepEqual(cleaned['d'.repeat(64)], {
    successes: 4, failures: 0, avgStartMs: 120000, consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null,
  });
});

test('recordSourceResult ignores malformed fingerprints', () => {
  assert.deepEqual(recordSourceResult({}, 'not-a-fingerprint', true, 100), {});
});

test('recent source failures lower the ranking temporarily', () => {
  const source = { url: 'https://a.test/live.m3u8' };
  const oldScore = sourceScore({ successes: 4, failures: 1, avgStartMs: 1000, lastSuccessAt: NOW }, NOW);
  const failedScore = sourceScore({ successes: 4, failures: 1, avgStartMs: 1000, lastSuccessAt: NOW, lastFailureAt: NOW }, NOW);
  assert.ok(oldScore > failedScore);
});
