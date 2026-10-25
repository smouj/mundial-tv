'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { responseJsonLimited, responseTextLimited } = require('../src/main/http-utils');

test('responseTextLimited joins streamed chunks within the byte limit', async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('Mundial '));
      controller.enqueue(new TextEncoder().encode('TV'));
      controller.close();
    },
  }));
  assert.equal(await responseTextLimited(response, 16), 'Mundial TV');
});

test('responseJsonLimited parses JSON received in streamed chunks', async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"canales":'));
      controller.enqueue(new TextEncoder().encode('["la1.tv"]}'));
      controller.close();
    },
  }));
  assert.deepEqual(await responseJsonLimited(response, 64), { canales: ['la1.tv'] });
});

test('response size limit rejects both announced and streamed oversized bodies', async () => {
  await assert.rejects(responseTextLimited(new Response('12345', { headers: { 'content-length': '5' } }), 4), /supera el tamaño/);

  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('12345')); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(responseTextLimited(response, 4), /supera el tamaño/);
  assert.equal(cancelled, true);
});

test('response size limit rejects an invalid limit and empty bodies', async () => {
  await assert.rejects(responseTextLimited(new Response(''), 0), /Límite/);
  await assert.rejects(responseTextLimited({ headers: new Headers(), body: null }, 10), /vacía/);
});
