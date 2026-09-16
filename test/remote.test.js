'use strict';

/**
 * Pruebas del mando del móvil: se levanta el servidor de verdad en un puerto
 * libre y se le habla como lo haría el teléfono.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { Remote, localAddress } = require('../src/main/remote');

const CANALES = [
  { id: 'la1.tv', name: 'La 1', group: 'Generalistas', logo: 'https://cdn.test/la1.png' },
  { id: 'web:mediaset:cuatro', name: 'Cuatro', group: 'Mediaset', logo: '' },
  { id: 'rai1.tv', name: 'Rai 1', group: 'Int. Europa', logo: 'https://cdn.test/rai1.png' },
];

const ESTADO = { actual: 'la1.tv', nombre: 'La 1', reproduciendo: true, volumen: 0.5 };

/** Levanta un mando de prueba y devuelve utilidades para hablarle. */
async function montar(token) {
  const comandos = [];
  const remote = new Remote({
    token,
    port: 0,
    getChannels: () => CANALES,
    getState: () => ESTADO,
    onCommand: (command) => comandos.push(command),
  });
  const info = await remote.start();
  const base = `http://127.0.0.1:${info.port}`;
  return { remote, info, base, comandos, clave: remote.token };
}

test('la clave es obligatoria para la página y para el estado', async (t) => {
  const { remote, base } = await montar();
  t.after(() => remote.stop());

  assert.equal((await fetch(`${base}/`)).status, 403);
  assert.equal((await fetch(`${base}/api/estado`)).status, 403);
  assert.equal((await fetch(`${base}/api/estado?k=otra`)).status, 403);
});

test('el controlador de servicio se sirve sin clave', async (t) => {
  const { remote, base } = await montar();
  t.after(() => remote.stop());

  const respuesta = await fetch(`${base}/sw.js`);
  assert.equal(respuesta.status, 200);
  assert.match(respuesta.headers.get('content-type'), /javascript/);
});

test('la página incluye el manifiesto y el icono', async (t) => {
  const { remote, base, clave } = await montar();
  t.after(() => remote.stop());

  const html = await (await fetch(`${base}/?k=${clave}`)).text();
  assert.match(html, /Mando de Mundial TV/);
  assert.match(html, /manifest\.webmanifest\?k=/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /serviceWorker/);
});

test('el manifiesto permite instalarlo en el móvil', async (t) => {
  const { remote, base, clave } = await montar();
  t.after(() => remote.stop());

  const respuesta = await fetch(`${base}/manifest.webmanifest?k=${clave}`);
  assert.equal(respuesta.status, 200);
  const manifiesto = await respuesta.json();
  assert.equal(manifiesto.display, 'standalone');
  assert.equal(manifiesto.start_url, `/?k=${clave}`);
  assert.equal(manifiesto.icons.length, 3);
});

test('los iconos se sirven en PNG', async (t) => {
  const { remote, base, clave } = await montar();
  t.after(() => remote.stop());

  for (const tamano of [192, 512]) {
    const respuesta = await fetch(`${base}/icono-${tamano}.png?k=${clave}`);
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get('content-type'), 'image/png');
    assert.ok((await respuesta.arrayBuffer()).byteLength > 1000);
  }
});

test('el estado llega con los canales y los grupos ordenados', async (t) => {
  const { remote, base, clave } = await montar();
  t.after(() => remote.stop());

  const estado = await (await fetch(`${base}/api/estado?k=${clave}`)).json();
  assert.equal(estado.actual, 'la1.tv');
  assert.equal(estado.canales.length, 3);
  assert.equal(estado.canales[0].nombre, 'La 1');
  assert.equal(estado.canales[0].iniciales, 'L1');
  // Mediaset (canal propio) antes que los géneros nacionales, y el mundo al final.
  assert.deepEqual(estado.grupos, ['Mediaset', 'Generalistas', 'Int. Europa']);
});

test('las órdenes del móvil llegan al proceso principal', async (t) => {
  const { remote, base, clave, comandos } = await montar();
  t.after(() => remote.stop());

  const respuesta = await fetch(`${base}/api/comando?k=${clave}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'canal', canalId: 'web:mediaset:cuatro' }),
  });
  assert.equal(respuesta.status, 200);
  assert.deepEqual(comandos, [{ accion: 'canal', canalId: 'web:mediaset:cuatro' }]);
});

test('una orden ilegible se rechaza sin romper nada', async (t) => {
  const { remote, base, clave, comandos } = await montar();
  t.after(() => remote.stop());

  const rota = await fetch(`${base}/api/comando?k=${clave}`, { method: 'POST', body: '{no es json' });
  assert.equal(rota.status, 400);

  const vacia = await fetch(`${base}/api/comando?k=${clave}`, {
    method: 'POST',
    body: JSON.stringify({ canalId: 'la1.tv' }),
  });
  assert.equal(vacia.status, 400);
  assert.equal(comandos.length, 0);
});

test('la misma clave da siempre la misma dirección', async (t) => {
  const token = 'a'.repeat(32);
  const primero = await montar(token);
  const segundo = await montar(token);
  t.after(() => {
    primero.remote.stop();
    segundo.remote.stop();
  });

  assert.equal(primero.info.url, `http://${localAddress()}:${primero.info.port}/?k=${token}`);
  assert.equal(segundo.remote.token, primero.remote.token);
  // El puerto es el que el sistema ha concedido de verdad, no el pedido (0).
  assert.notEqual(primero.info.port, 0);
});
