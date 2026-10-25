'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, DEFAULTS, cleanBounds, cleanIds } = require('../src/main/settings');

test('Settings starts from safe defaults when no file exists', () => {
  const settings = new Settings(path.join(os.tmpdir(), 'mundial-tv-missing', 'settings.json'));
  assert.deepEqual(settings.load().favourites, DEFAULTS.favourites);
  assert.deepEqual(settings.get('recentChannels'), []);
  assert.equal(settings.get('automaticUpdates'), true);
});

test('Settings removes malformed persisted values without losing valid preferences', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mundial-tv-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({
    volume: 3,
    muted: 'false',
    favourites: ['la1.tv', 2, 'la1.tv'],
    recentChannels: 'invalid',
    remoteToken: 'a'.repeat(64),
    remotePort: 90,
    sourceHealth: { 'file:///private': { successes: 10 } },
    remoteAccessKey: 'should-never-reach-the-renderer',
    showInternational: false,
  }));

  const loaded = new Settings(file).load();
  assert.equal(loaded.volume, 1);
  assert.equal(loaded.muted, false);
  assert.deepEqual(loaded.favourites, ['la1.tv']);
  assert.deepEqual(loaded.recentChannels, []);
  assert.equal(loaded.remoteToken, null);
  assert.equal(loaded.remotePort, null);
  assert.deepEqual(loaded.sourceHealth, {});
  assert.equal(loaded.remoteAccessKey, undefined);
  assert.equal(loaded.showInternational, false);
});

test('Settings patches are saved and can be reloaded', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mundial-tv-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  const settings = new Settings(file);
  settings.load();
  settings.patch({ volume: 0.6, recentChannels: ['la1.tv'] });

  const reloaded = new Settings(file);
  assert.equal(reloaded.load().volume, 0.6);
  assert.deepEqual(reloaded.get('recentChannels'), ['la1.tv']);
});

test('cleanIds and cleanBounds cap invalid stored data', () => {
  assert.deepEqual(cleanIds([' a ', '', 3, 'a'], 5), ['a']);
  assert.deepEqual(cleanBounds({ x: -30_000, y: 12, width: 1280.4, height: 820 }), { x: -20_000, y: 12, width: 1280, height: 820 });
  assert.equal(cleanBounds({ width: 0, height: 100 }), null);
});

test('Settings writes a complete replacement file and leaves no temporary file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mundial-tv-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  const settings = new Settings(file);
  settings.load();
  settings.patch({ volume: 0.4 });
  settings.patch({ muted: true });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).volume, 0.4);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).muted, true);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});
