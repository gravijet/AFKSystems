// Die ausgelieferte Produktionskopie bekommt kompakte CSS-/JS-Dateien. Das ist kein DRM – jeder
// Browser muss Frontend-Code laden können –, reduziert aber triviales Kopieren und spart Traffic.
// Im Repository bleiben die wartbaren Quelldateien unverändert; deploy/install.sh ruft dieses
// Script erst nach dem Kopieren nach /opt/afksystems auf.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

const targets = filesUnder(root).filter((file) => /\.(?:js|css)$/.test(file));
for (const file of targets) {
  const loader = file.endsWith('.css') ? 'css' : 'js';
  const source = fs.readFileSync(file, 'utf8');
  const result = await transform(source, {
    loader,
    format: loader === 'js' ? 'esm' : undefined,
    minify: true,
    legalComments: 'none',
    target: loader === 'js' ? 'es2022' : undefined,
  });
  fs.writeFileSync(file, result.code, 'utf8');
}

console.log(`Geschützte Produktionsassets: ${targets.length} Dateien minimiert.`);
