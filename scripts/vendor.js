#!/usr/bin/env node
'use strict';

/**
 * Copia hls.js dentro del código de la aplicación.
 *
 * Se distribuye empaquetado para que la aplicación funcione sin conexión al
 * arrancar y no dependa de ninguna CDN.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
const target = path.join(root, 'src', 'renderer', 'vendor', 'hls.min.js');

if (!fs.existsSync(source)) {
  console.error('No se encuentra hls.js. Ejecuta primero: npm install');
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);

const { version } = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules', 'hls.js', 'package.json'), 'utf8'),
);
fs.writeFileSync(
  path.join(path.dirname(target), 'README.md'),
  `# vendor\n\n\`hls.min.js\` procede del paquete [hls.js](https://github.com/video-dev/hls.js) v${version} (licencia Apache-2.0).\nSe copia con \`npm run vendor\`.\n`,
  'utf8',
);

console.log(`hls.js v${version} copiado en src/renderer/vendor/hls.min.js`);
