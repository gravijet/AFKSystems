// Die ausgelieferte Produktionskopie bekommt kompakte CSS-/JS-Dateien. Das ist kein DRM – jeder
// Browser muss Frontend-Code laden können –, reduziert aber triviales Kopieren und spart Traffic.
// Im Repository bleiben die wartbaren Quelldateien unverändert; deploy/install.sh ruft dieses
// Script erst nach dem Kopieren nach /opt/afksystems auf.
//
// Danach wird jede Textdatei einmal gepackt und das Ergebnis danebengelegt (app.css.br,
// app.css.gz). Der Server liefert es unverändert aus, statt bei jeder Anfrage neu zu komprimieren –
// siehe server/assets.js. Beides gehört zusammen: Erst minimieren, dann packen, sonst läge die
// gepackte Fassung des ungekürzten Textes daneben.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { isPacked, pack } from '../server/assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

// Gepackte Fassungen aus einem früheren Lauf zuerst weg: Sie gehören zu dem Text, der damals da
// stand. Bliebe eine davon liegen, lieferte der Server sie weiter aus – und der Browser bekäme
// unter der neuen Adresse den alten Inhalt.
for (const file of filesUnder(root)) {
  if (isPacked(file)) fs.rmSync(file);
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

const { written, saved } = pack(root);

console.log(
  `Geschützte Produktionsassets: ${targets.length} Dateien minimiert, ` +
    `${written} vorgepackte Fassungen (${Math.round(saved / 1024)} kB weniger je Erstbesuch).`
);
