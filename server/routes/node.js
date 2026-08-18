// Was ein Standort vom Panel braucht: die Client-Dateien.
//
// Der Standort holt sie sich selbst – über dieselbe Adresse, über die er auch seine Leitung
// aufbaut, mit demselben Token. Damit gibt es auf dem anderen Rechner keinen GitHub-Zugang,
// keinen zweiten Token und keine Frage, welche Fassung dort eigentlich liegt: es ist immer die,
// die das Panel gerade benutzt.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from '../config.js';
import { db } from '../db.js';
import { BUILDS } from '../binaries.js';
import { wrap, notFound } from '../util.js';

export const router = express.Router();

/** Nur die Linux-Bauformen: ein Standort führt Prozesse aus, er verteilt keine Downloads. */
const RUNNABLE = new Set(Object.values(BUILDS).map((build) => build.file));

/** Fingerabdruck je Datei, gemerkt bis sich Größe oder Zeitstempel ändern. */
const digests = new Map();

function digest(name) {
  const file = path.join(paths.bin, name);
  const stat = fs.statSync(file);
  const key = `${stat.size}:${stat.mtimeMs}`;
  const known = digests.get(name);
  if (known?.key === key) return known.sha256;
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  digests.set(name, { key, sha256 });
  return sha256;
}

/**
 * Der Standort schickt sein Token im Authorization-Kopf. Ein anderes Merkmal gibt es nicht: er
 * hat keine Sitzung, kein Cookie und keinen Browser, und genau dafür ist das Token da.
 */
export function nodeByToken(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length < 20) return null;
  return db.prepare('SELECT * FROM nodes WHERE token = ? AND active = 1').get(token) || null;
}

router.use((req, res, next) => {
  const node = nodeByToken(req);
  if (!node) return res.status(401).json({ error: 'Unbekannter Standort.' });
  req.node = node;
  db.prepare('UPDATE nodes SET last_seen = ? WHERE id = ?').run(Date.now(), node.id);
  next();
});

/** Welche Client-Dateien es gibt und wie sie aussehen sollen. */
router.get(
  '/manifest',
  wrap((req, res) => {
    const files = [];
    for (const name of RUNNABLE) {
      const file = path.join(paths.bin, name);
      if (!fs.existsSync(file)) continue;
      files.push({ name, size: fs.statSync(file).size, sha256: digest(name) });
    }
    res.json({ node: { id: req.node.id, name: req.node.name }, files });
  })
);

/** Eine Client-Datei. Der Standort lädt nur, was in seinem Verzeichnis fehlt oder abweicht. */
router.get(
  '/binaries/:name',
  wrap((req, res) => {
    const name = String(req.params.name || '');
    if (!RUNNABLE.has(name)) throw notFound('Diese Datei gehört nicht zum Client.');
    const file = path.join(paths.bin, name);
    if (!fs.existsSync(file)) throw notFound('Diese Datei liegt hier nicht.');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  })
);
