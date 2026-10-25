'use strict';

async function responseBufferLimited(response, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new TypeError('Límite de respuesta no válido');
  const contentLength = Number(response && response.headers && response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) throw new RangeError('La respuesta supera el tamaño permitido');
  if (!response || !response.body) throw new Error('La respuesta llegó vacía');

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new RangeError('La respuesta supera el tamaño permitido');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes);
}

async function responseTextLimited(response, maximumBytes) {
  return (await responseBufferLimited(response, maximumBytes)).toString('utf8');
}

async function responseJsonLimited(response, maximumBytes) {
  return JSON.parse(await responseTextLimited(response, maximumBytes));
}

module.exports = { responseBufferLimited, responseTextLimited, responseJsonLimited };
