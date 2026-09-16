'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { splitExtinf, parseM3U, groupChannels, channelKey, GEO_RE } = require('../src/main/playlist');

const SAMPLE = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="La1.TV" tvg-logo="https://cdn.test/la1.png" group-title="Generalistas" tvg-name="La 1",La 1',
  'https://cdn.test/la1.m3u8',
  '#EXTINF:-1 tvg-id="La1.TV" tvg-logo="https://cdn.test/la1.png" group-title="Generalistas" tvg-name="La 1",La 1',
  'https://cdn.test/la1-respaldo.m3u8',
  '#EXTINF:-1 tvg-id="La1.TV" group-title="Generalistas",La 1',
  'https://ads.test/playlist.m3u8?ip=[IP]&ua=[UA]',
  '#EXTINF:-1 tvg-id="324.TV" group-title="Informativos",3CatInfo GEO CAT',
  'https://cdn.test/324.m3u8',
  '#EXTINF:-1 group-title="Locales",Canal Local, con coma',
  'https://cdn.test/local.m3u8',
  '#EXTINF:-1 group-title="Locales",Canal Repetido',
  'https://cdn.test/local.m3u8',
  '',
].join('\n');

test('splitExtinf separa atributos y título', () => {
  const result = splitExtinf(
    '#EXTINF:-1 tvg-id="La1.TV" group-title="Generalistas",La 1',
  );
  assert.equal(result.title, 'La 1');
  assert.equal(result.attrs['tvg-id'], 'La1.TV');
  assert.equal(result.attrs['group-title'], 'Generalistas');
});

test('splitExtinf conserva las comas dentro del nombre', () => {
  const result = splitExtinf('#EXTINF:-1 group-title="Locales",Canal Local, con coma');
  assert.equal(result.title, 'Canal Local, con coma');
});

test('splitExtinf ignora las comas dentro de valores entrecomillados', () => {
  const result = splitExtinf('#EXTINF:-1 tvg-name="Uno, dos",Canal');
  assert.equal(result.attrs['tvg-name'], 'Uno, dos');
  assert.equal(result.title, 'Canal');
});

test('parseM3U lee todas las entradas de la lista', () => {
  const entries = parseM3U(SAMPLE);
  assert.equal(entries.length, 6);
  assert.equal(entries[0].name, 'La 1');
  assert.equal(entries[0].logo, 'https://cdn.test/la1.png');
  assert.equal(entries[0].group, 'Generalistas');
});

test('parseM3U marca y limpia las variantes con restricción geográfica', () => {
  const entries = parseM3U(SAMPLE);
  const catalan = entries.find((entry) => entry.id === '324.TV');
  assert.equal(catalan.name, '3CatInfo');
  assert.equal(catalan.geo, true);
  assert.equal(GEO_RE.test('3CatInfo GEO CAT'), true);
  assert.equal(GEO_RE.test('3CatInfo'), false);
});

test('channelKey usa el tvg-id y recae en el nombre', () => {
  assert.equal(channelKey({ id: 'La1.TV', name: 'La 1' }), 'la1.tv');
  assert.equal(channelKey({ id: '', name: '  Canal   Local ' }), 'name:canal local');
});

test('groupChannels agrupa las fuentes del mismo canal', () => {
  const channels = groupChannels(parseM3U(SAMPLE));
  const la1 = channels.find((channel) => channel.id === 'la1.tv');
  assert.equal(la1.name, 'La 1');
  assert.equal(la1.kind, 'hls');
  assert.equal(la1.sources.length, 2);
});

test('groupChannels descarta las fuentes con parámetros dinámicos', () => {
  const channels = groupChannels(parseM3U(SAMPLE));
  const la1 = channels.find((channel) => channel.id === 'la1.tv');
  assert.equal(
    la1.sources.some((source) => source.url.includes('[')),
    false,
  );
});

test('groupChannels pone primero las fuentes sin restricción geográfica', () => {
  const channels = groupChannels(
    parseM3U(
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="X.TV",Canal GEO',
        'https://cdn.test/geolocalizado.m3u8',
        '#EXTINF:-1 tvg-id="X.TV",Canal',
        'https://cdn.test/abierto.m3u8',
      ].join('\n'),
    ),
  );
  assert.equal(channels[0].sources[0].url, 'https://cdn.test/abierto.m3u8');
  assert.equal(channels[0].sources[1].geo, true);
});

test('groupChannels no duplica una misma dirección', () => {
  const channels = groupChannels(parseM3U(SAMPLE));
  const local = channels.find((channel) => channel.name === 'Canal Repetido');
  assert.equal(local.sources.length, 1);
});

test('groupChannels descarta los canales que se quedan sin fuentes', () => {
  const channels = groupChannels(
    parseM3U(['#EXTM3U', '#EXTINF:-1 group-title="X",Solo plantilla', 'https://ads.test/x.m3u8?d=[IP]'].join('\n')),
  );
  assert.equal(channels.length, 0);
});

test('groupChannels agrupa por nombre cuando falta el tvg-id', () => {
  const channels = groupChannels(
    parseM3U(
      [
        '#EXTM3U',
        '#EXTINF:-1 group-title="X",Canal Sin Id',
        'https://cdn.test/a.m3u8',
        '#EXTINF:-1 group-title="X",Canal Sin Id',
        'https://cdn.test/b.m3u8',
      ].join('\n'),
    ),
  );
  assert.equal(channels.length, 1);
  assert.equal(channels[0].sources.length, 2);
});
