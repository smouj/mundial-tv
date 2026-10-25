'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSettingsPatch, publicSettings, validExternalUrl, validOfficialUrl } = require('../src/main/ipc-security');

test('sanitizeSettingsPatch accepts supported preferences and trims duplicate IDs', () => {
  assert.deepEqual(sanitizeSettingsPatch({
    volume: 0.45,
    muted: true,
    favourites: ['la1.tv', 'la1.tv'],
    recentChannels: ['la2.tv'],
  }), {
    volume: 0.45,
    muted: true,
    favourites: ['la1.tv'],
    recentChannels: ['la2.tv'],
  });
});

test('sanitizeSettingsPatch rejects unknown keys and invalid types', () => {
  assert.throws(() => sanitizeSettingsPatch({ remoteToken: 'secret' }), /no permitida/);
  assert.throws(() => sanitizeSettingsPatch({ sourceHealth: { ['a'.repeat(64)]: { successes: 1 } } }), /no permitida/);
  assert.throws(() => sanitizeSettingsPatch({ volume: 1.1 }), /Volumen/);
  assert.throws(() => sanitizeSettingsPatch({ muted: 'yes' }), /booleano/);
  assert.throws(() => sanitizeSettingsPatch({ recentChannels: Array(21).fill('channel') }), /válida/);
});

test('publicSettings never returns app-private storage fields', () => {
  const result = publicSettings({ volume: 1, remoteToken: 'secret', remotePort: 8712, windowBounds: { x: 1 }, userDataPath: 'C:/Users/private' });
  assert.deepEqual(result, { volume: 1 });
});

test('external URLs allow HTTPS and private-network HTTP only', () => {
  assert.equal(validExternalUrl('https://github.com/smouj/mundial-tv'), true);
  assert.equal(validExternalUrl('http://192.168.1.10:8712/?k=abc', { allowLanHttp: true }), true);
  assert.equal(validExternalUrl('http://example.com'), false);
  assert.equal(validExternalUrl('file:///etc/passwd', { allowLanHttp: true }), false);
  assert.equal(validExternalUrl('https://user:pass@example.com'), false);
});

test('official playback permits only the approved streaming domains', () => {
  assert.equal(validOfficialUrl('https://www.mitele.es/directo/cuatro/'), true);
  assert.equal(validOfficialUrl('https://www.atresplayer.com/directos/antena3/'), true);
  assert.equal(validOfficialUrl('https://evil-atresplayer.com/live'), false);
  assert.equal(validOfficialUrl('http://www.mitele.es/live'), false);
});
