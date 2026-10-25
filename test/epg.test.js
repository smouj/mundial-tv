'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTime, normalizeEpg, scheduleFor } = require('../src/main/epg');

const NOW = Date.parse('2026-10-25T21:30:00Z');

test('parseTime respeta la zona horaria XMLTV', () => {
  assert.equal(parseTime('20261025233000 +0200'), Date.parse('2026-10-25T21:30:00Z'));
});

test('parseTime convierte segundos, milisegundos e ISO', () => {
  assert.equal(parseTime('1792963800'), 1792963800000);
  assert.equal(parseTime('2026-10-25T21:30:00Z'), NOW);
  assert.ok(Number.isNaN(parseTime('no es una fecha')));
});

test('normalizeEpg acepta listas XMLTV JSON y normaliza canales', () => {
  const result = normalizeEpg({ programmes: [
    { channel: 'La1.TV', start: '20261025210000 +0000', stop: '20261025220000 +0000', title: { value: 'La Revuelta' } },
    { channel: 'La1.TV', start: '20261025220000 +0000', stop: '20261025230000 +0000', title: 'Telediario' },
  ] }, NOW);
  assert.equal(result.length, 2);
  assert.equal(result[0].channelId, 'la1.tv');
  assert.equal(result[0].title, 'La Revuelta');
  assert.equal(result[0].start, Date.parse('2026-10-25T21:00:00Z'));
});

test('normalizeEpg admite programas agrupados bajo el identificador del canal', () => {
  const result = normalizeEpg({
    'La1.TV': [
      { start: NOW - 1000, stop: NOW + 1000, title: 'Ahora' },
      { start: NOW + 1000, stop: NOW + 2000, title: 'Después' },
    ],
  }, NOW);
  assert.deepEqual(result.map((item) => item.channelId), ['la1.tv', 'la1.tv']);
});

test('normaliza agrupaciones canal.programmes y deduplica eventos', () => {
  const event = { start: NOW, stop: NOW + 60_000, title: 'Programa' };
  const result = normalizeEpg({ channels: [{ id: 'LA1.TV', programmes: [event, event] }] }, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].channelId, 'la1.tv');
});

test('lee XMLTV JSON con atributos y texto anidados', () => {
  const result = normalizeEpg({ tv: { programme: [
    {
      $: { channel: 'la1.tv', start: '20261025210000 +0000', stop: '20261025220000 +0000' },
      title: [{ _: 'Programa XMLTV' }],
      desc: [{ _: 'Descripción XMLTV' }],
    },
  ] } }, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].channelId, 'la1.tv');
  assert.equal(result[0].title, 'Programa XMLTV');
  assert.equal(result[0].description, 'Descripción XMLTV');
});

test('normalizeEpg descarta datos incompletos y programas fuera de ventana', () => {
  assert.throws(() => normalizeEpg({ programmes: [
    { channel: 'la1.tv', start: NOW, stop: NOW, title: 'Duración inválida' },
    { channel: 'la1.tv', start: NOW + 60_000, stop: NOW + 120_000, title: '' },
    { channel: 'la1.tv', start: NOW + 40 * 60 * 60_000, stop: NOW + 41 * 60 * 60_000, title: 'Lejano' },
  ] }, NOW), /no contiene programas/);
});

test('normalizeEpg rechaza estructuras sin programas reconocibles', () => {
  assert.throws(() => normalizeEpg({ channels: [] }, NOW), /no contiene programas/);
});

test('scheduleFor devuelve el programa actual y el siguiente', () => {
  const programmes = normalizeEpg({ programmes: [
    { channel: 'la1.tv', start: NOW - 30 * 60_000, stop: NOW + 30 * 60_000, title: 'Actual' },
    { channel: 'la1.tv', start: NOW + 30 * 60_000, stop: NOW + 90 * 60_000, title: 'Siguiente' },
  ] }, NOW);
  assert.equal(scheduleFor(programmes, 'LA1.TV', NOW).now.title, 'Actual');
  assert.equal(scheduleFor(programmes, 'la1.tv', NOW).next.title, 'Siguiente');
  assert.deepEqual(scheduleFor(programmes, 'la2.tv', NOW), { now: null, next: null });
});
