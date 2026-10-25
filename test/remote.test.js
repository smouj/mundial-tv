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
async function montar(token, options = {}) {
  const comandos = [];
  const remote = new Remote({
    token,
    port: 0,
    getChannels: () => CANALES,
    getState: () => options.state || ESTADO,
    getProgrammes: () => options.programmes || [],
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
      const imagen = Buffer.from(await respuesta.arrayBuffer());
      assert.deepEqual(imagen.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      assert.equal(imagen.readUInt32BE(16), tamano);
      assert.equal(imagen.readUInt32BE(20), tamano);
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

test('la página del mando envía cabeceras de seguridad locales', async (t) => {
  const { remote, base, clave } = await montar();
  t.after(() => remote.stop());
  const response = await fetch(`${base}/?k=${clave}`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy'), /img-src 'self' data: https:/);
});

test('el estado del teléfono incluye favorito y guía actual/siguiente', async (t) => {
  const now = Date.now();
  const programmes = [
    { channelId: 'la1.tv', title: 'Programa actual', start: now - 60_000, stop: now + 60_000 },
    { channelId: 'la1.tv', title: 'Programa siguiente', start: now + 60_000, stop: now + 120_000 },
  ];
  const { remote, base, clave } = await montar(undefined, {
    state: { ...ESTADO, favorites: ['la1.tv'] },
    programmes,
  });
  t.after(() => remote.stop());

  const estado = await (await fetch(`${base}/api/estado?k=${clave}`)).json();
  assert.equal(estado.canales[0].favorito, true);
  assert.equal(estado.canales[0].ahora, 'Programa actual');
  assert.equal(estado.canales[0].despues, 'Programa siguiente');
  assert.ok(estado.canales[0].progreso >= 0 && estado.canales[0].progreso <= 100);
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

test('permite cambiar favoritos desde el móvil', async (t) => {
  const { remote, base, clave, comandos } = await montar();
  t.after(() => remote.stop());
  const response = await fetch(`${base}/api/comando?k=${clave}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'favorito', canalId: 'la1.tv' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(comandos, [{ accion: 'favorito', canalId: 'la1.tv' }]);
});

test('una orden ilegible se rechaza sin romper nada', async (t) => {
  const { remote, base, clave, comandos } = await montar();
  t.after(() => remote.stop());

  const rota = await fetch(`${base}/api/comando?k=${clave}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{no es json',
  });
  assert.equal(rota.status, 400);

  const vacia = await fetch(`${base}/api/comando?k=${clave}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canalId: 'la1.tv' }),
  });
  assert.equal(vacia.status, 400);
  assert.equal(comandos.length, 0);
});

test('rechaza acciones desconocidas, canales ajenos y valores fuera de rango', async (t) => {
  const { remote, base, clave, comandos } = await montar();
  t.after(() => remote.stop());
  const orden = (command) => fetch(`${base}/api/comando?k=${clave}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });

  assert.equal((await orden({ accion: 'ejecutar', comando: 'arbitrario' })).status, 400);
  assert.equal((await orden({ accion: 'canal', canalId: 'no-existe.tv' })).status, 400);
  assert.equal((await orden({ accion: 'volumen', valor: 4 })).status, 400);
  assert.equal((await orden({ accion: 'pausa', extra: 'no permitido' })).status, 400);
  assert.equal(comandos.length, 0);
});

test('no admite peticiones web ajenas ni cuerpos de otro formato', async (t) => {
  const { remote, base, clave } = await montar();
  t.after(() => remote.stop());
  assert.equal((await fetch(`${base}/api/estado?k=${clave}`, { headers: { Origin: 'http://sitio-malicioso.test' } })).status, 403);
  assert.equal((await fetch(`${base}/api/comando?k=${clave}`, { method: 'POST', body: 'accion=pausa' })).status, 415);
});

test('limita la frecuencia de consultas del mando', async (t) => {
  const { remote, base, clave } = await montar();
  t.after(() => remote.stop());
  let status = 200;
  for (let index = 0; index < 151; index += 1) {
    status = (await fetch(`${base}/api/estado?k=${clave}`)).status;
    if (status === 429) break;
  }
  assert.equal(status, 429);
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
