#!/usr/bin/env node
'use strict';

/**
 * Genera `resources/canales.m3u`: la copia de la lista de canales que se
 * incluye en la aplicación para que la primera ejecución sin conexión siga
 * mostrando contenido.
 */

const fs = require('node:fs');
const path = require('node:path');

const PLAYLIST_URL = 'https://www.tdtchannels.com/lists/tv.m3u8';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const target = path.join(__dirname, '..', 'resources', 'canales.m3u');

async function main() {
  const response = await fetch(PLAYLIST_URL, {
    headers: { 'User-Agent': UA, Accept: 'text/plain,application/vnd.apple.mpegurl,*/*' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const text = await response.text();
  if (!text.includes('#EXTM3U') || !text.includes('#EXTINF')) {
    throw new Error('la respuesta no parece una lista de canales');
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const header = [
    '## Copia de la lista pública de canales del proyecto TDTChannels (https://www.tdtchannels.com).',
    `## Generada el ${new Date().toISOString()} con: npm run snapshot`,
    '## Licencia del proyecto original: Apache-2.0.',
  ].join('\n');
  fs.writeFileSync(target, `${header}\n${text}`, 'utf8');

  const channels = (text.match(/^#EXTINF/gm) || []).length;
  console.log(`Copia guardada en ${path.relative(process.cwd(), target)} (${channels} entradas)`);
}

main().catch((error) => {
  console.error(`No se ha podido generar la copia: ${error.message}`);
  process.exit(1);
});
