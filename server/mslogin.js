// Microsoft-Anmeldung über den Gerätecode.
//
// Das Panel kennt weder Passwort noch Token: es startet `afk --login`, liest Code und Adresse aus
// der Standardfehlerausgabe des Clients und zeigt beides an. Der Client legt die Anmeldung danach
// selbst unter <nutzerverzeichnis>/afksystems/accounts/<name>.json ab – dasselbe Format, das er
// beim Start wieder einliest.

import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs';
import path from 'node:path';
import { userDir, userPath } from './config.js';
import { db, audit } from './db.js';
import * as binaries from './binaries.js';
import { token, HttpError, codeUrl } from './util.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const TIMEOUT_MS = 15 * 60 * 1000;

/** Laufende Anmeldungen: id -> Zustand. */
const pending = new Map();

/**
 * Wie viele Anmeldungen gleichzeitig laufen dürfen.
 *
 * Jede ist ein eigener Client-Prozess, der bis zu einer Viertelstunde auf einen Menschen wartet.
 * Vorher gab es keine Grenze: Ein angemeldetes Konto konnte den Endpunkt in einer Schleife rufen
 * und die Maschine mit wartenden Prozessen füllen, ohne je einen Code einzugeben und ohne einen
 * Credit auszugeben. Zwei offene Anmeldungen sind mehr, als ein Mensch gleichzeitig abtippt.
 */
const MAX_PENDING_PER_USER = 2;
const MAX_PENDING_TOTAL = 40;

const openFor = (userId) => {
  let count = 0;
  for (const entry of pending.values()) {
    if (entry.userId === userId && (entry.status === 'starting' || entry.status === 'code')) count += 1;
  }
  return count;
};

export function begin(user) {
  if (openFor(user.id) >= MAX_PENDING_PER_USER) {
    throw new HttpError(
      429,
      'Es läuft schon eine Anmeldung. Schließe sie ab oder brich sie ab.',
      { en: 'A sign-in is already running. Finish it or cancel it.' }
    );
  }
  if (pending.size >= MAX_PENDING_TOTAL) {
    throw new HttpError(503, 'Gerade laufen zu viele Anmeldungen. Bitte kurz warten.', {
      en: 'Too many sign-ins are running right now. Please wait a moment.',
    });
  }
  const { command } = binaries.anyCommand();
  const home = userDir(user.id);
  const id = token(12);

  const entry = {
    id,
    userId: user.id,
    status: 'starting', // starting | code | done | error
    verification_uri: null,
    user_code: null,
    account: null,
    error: null,
    started: Date.now(),
    lines: [],
  };
  pending.set(id, entry);

  const proc = spawn(command, ['--login'], {
    cwd: home,
    env: { ...process.env, XDG_CONFIG_HOME: home, HOME: home, TERM: 'dumb' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  entry.proc = proc;

  let out = '';
  let err = '';
  // Derselbe Grund wie im Supervisor: Ein Datenstück darf mitten in einem Zeichen enden, und ein
  // Kontoname mit Umlaut soll das überleben.
  const decodeOut = new StringDecoder('utf8');
  const decodeErr = new StringDecoder('utf8');

  proc.stdout.on('data', (chunk) => {
    out += decodeOut.write(chunk);
  });

  proc.stderr.on('data', (chunk) => {
    err += decodeErr.write(chunk);
    const lines = err.split('\n');
    err = lines.pop();
    for (const raw of lines) {
      const line = raw.replace(ANSI, '').trim();
      if (!line) continue;
      entry.lines.push(line);
      const uri = /Öffne im Browser:\s*(\S+)/.exec(line);
      if (uri) entry.verification_uri = uri[1];
      const code = /Gib diesen Code ein:\s*(\S+)/.exec(line);
      if (code) {
        entry.user_code = code[1];
        entry.status = 'code';
      }
      const failed = /^Login fehlgeschlagen:\s*(.*)$/.exec(line);
      if (failed) {
        entry.status = 'error';
        entry.error = failed[1];
      }
    }
  });

  proc.on('error', (error) => {
    entry.status = 'error';
    entry.error = error.message;
  });

  proc.on('exit', (code) => {
    // Auf der Standardausgabe steht bei Erfolg genau eine Zeile: der Kontoname.
    const name = out.replace(ANSI, '').trim().split('\n').pop()?.trim();
    if (code === 0 && name) {
      try {
        entry.account = saveAccount(user.id, name);
        entry.status = 'done';
      } catch (error) {
        entry.status = 'error';
        entry.error = error.message;
      }
    } else if (entry.status !== 'error') {
      entry.status = 'error';
      entry.error = entry.error || `Anmeldung abgebrochen (Code ${code}).`;
    }
    // Ergebnis noch kurz vorhalten, damit das Panel es abholen kann.
    setTimeout(() => pending.delete(id), 60_000).unref();
  });

  setTimeout(() => {
    if (entry.status === 'starting' || entry.status === 'code') {
      entry.status = 'error';
      entry.error = 'Zeit abgelaufen – bitte neu starten.';
      try {
        proc.kill('SIGKILL');
      } catch {
        /* schon beendet */
      }
    }
  }, TIMEOUT_MS).unref();

  return publicState(entry);
}

/** Kontoeintrag anlegen oder auffrischen, nachdem der Client die Datei geschrieben hat. */
function saveAccount(userId, name) {
  const file = path.join(userDir(userId), 'afksystems', 'accounts', `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Der Client hat keine Kontodatei für "${name}" abgelegt.`);

  let uuid = null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    uuid = data?.minecraftProfile?.id || null;
  } catch {
    /* Kontodatei bleibt trotzdem gültig, nur ohne UUID im Panel */
  }

  const existing = db
    .prepare('SELECT * FROM mc_accounts WHERE user_id = ? AND name = ?')
    .get(userId, name);
  if (existing) {
    db.prepare("UPDATE mc_accounts SET status = 'ok', last_error = NULL, uuid = ? WHERE id = ?").run(
      uuid,
      existing.id
    );
    audit(userId, 'account-refresh', { name });
    return db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(existing.id);
  }

  const info = db
    .prepare(
      `INSERT INTO mc_accounts (user_id, name, kind, uuid, status, created_at)
       VALUES (?, ?, 'microsoft', ?, 'ok', ?)`
    )
    .run(userId, name, uuid, Date.now());
  audit(userId, 'account-add', { name });
  return db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(info.lastInsertRowid);
}

export function status(id, user) {
  const entry = pending.get(id);
  if (!entry) throw new HttpError(404, 'Diese Anmeldung ist abgelaufen.', { en: 'That sign-in has expired.' });
  if (entry.userId !== user.id) throw new HttpError(403, 'Keine Berechtigung.', { en: 'Not allowed.' });
  return publicState(entry);
}

export function cancel(id, user) {
  const entry = pending.get(id);
  if (!entry || entry.userId !== user.id) return;
  try {
    entry.proc?.kill('SIGKILL');
  } catch {
    /* schon beendet */
  }
  pending.delete(id);
}

function publicState(entry) {
  return {
    id: entry.id,
    status: entry.status,
    verification_uri: entry.verification_uri,
    verification_uri_complete: codeUrl(entry.verification_uri, entry.user_code),
    user_code: entry.user_code,
    error: entry.error,
    account: entry.account ? { id: entry.account.id, name: entry.account.name } : null,
    waited: Date.now() - entry.started,
  };
}

/**
 * Offline-/Cracked-Konto anlegen. Es gibt dafür keine Anmeldung und keine Datei – der Client
 * rechnet die UUID beim Start selbst aus, genau wie ein Server mit online-mode=false.
 */
export function addOffline(user, rawName) {
  const name = String(rawName || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    throw new HttpError(400, 'Offline-Name: 1–16 Zeichen, nur Buchstaben, Ziffern und _', {
      en: 'Offline name: 1–16 characters, letters, digits and _ only.',
    });
  }
  if (db.prepare('SELECT 1 FROM mc_accounts WHERE user_id = ? AND name = ?').get(user.id, name)) {
    throw new HttpError(409, 'Ein Konto mit diesem Namen gibt es schon.', {
      en: 'You already have an account with that name.',
    });
  }
  const info = db
    .prepare(
      `INSERT INTO mc_accounts (user_id, name, kind, status, created_at)
       VALUES (?, ?, 'offline', 'ok', ?)`
    )
    .run(user.id, name, Date.now());
  audit(user.id, 'account-add-offline', { name });
  return db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(info.lastInsertRowid);
}

/** Konto samt Anmeldedatei entfernen. */
export function removeAccount(user, accountId) {
  const account = db
    .prepare('SELECT * FROM mc_accounts WHERE id = ? AND user_id = ?')
    .get(accountId, user.id);
  if (!account) throw new HttpError(404, 'Konto gibt es nicht.', { en: 'No such account.' });
  const file = path.join(userDir(user.id), 'afksystems', 'accounts', `${account.name}.json`);
  try {
    fs.unlinkSync(file);
  } catch {
    /* Datei war schon weg */
  }
  db.prepare('DELETE FROM mc_accounts WHERE id = ?').run(accountId);
  audit(user.id, 'account-remove', { name: account.name });
  return account;
}

/**
 * Wann zuletzt abgeglichen wurde, und wie das Verzeichnis dabei aussah. Je Konto ein Eintrag mit
 * zwei Zahlen – das wächst mit der Zahl der Kunden und nicht mit der Zahl der Anfragen.
 */
const lastSeen = new Map();

/**
 * Kontodateien und Datenbank abgleichen. Fängt den Fall ab, dass jemand direkt auf dem Server
 * eine Anmeldung abgelegt oder gelöscht hat.
 *
 * **Zuerst die billige Frage.** Das hier hängt an `GET /accounts`, und das Panel holt diese Liste
 * bei jedem Zustandswechsel. Jeder Aufruf legte bisher das Verzeichnis an (`userDir`), las es
 * vollständig aus und fragte die Datenbank – drei Zugriffe auf die Platte für einen Fall, der
 * eintritt, wenn ein Administrator von Hand eine Datei hinlegt oder wegnimmt, also so gut wie nie.
 *
 * Ein Verzeichnis ändert seine Zeitmarke genau dann, wenn ein Eintrag dazukommt oder verschwindet –
 * und genau danach wird hier gesucht. Steht sie noch, wo sie stand, gibt es nichts abzugleichen.
 * Das ist kein Zeitfenster und keine Schätzung: Was der Abgleich finden könnte, hätte die Zeitmarke
 * bewegt.
 */
export function reconcile(userId) {
  const dir = path.join(userPath(userId), 'afksystems', 'accounts');
  let stamp = null;
  try {
    const stats = fs.statSync(dir);
    stamp = `${stats.mtimeMs}:${stats.size}`;
  } catch {
    // Kein Verzeichnis heißt: keine Dateien. Das ist ein Zustand wie jeder andere und muss sich
    // merken lassen, sonst sähe jeder Aufruf für ein Konto ohne Anmeldungen wieder nach.
    stamp = 'fehlt';
  }
  if (lastSeen.get(userId) === stamp) return;

  const files =
    stamp === 'fehlt'
      ? []
      : fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5));
  const rows = db.prepare('SELECT * FROM mc_accounts WHERE user_id = ?').all(userId);

  for (const name of files) {
    if (!rows.some((row) => row.name === name)) saveAccount(userId, name);
  }
  for (const row of rows) {
    if (row.kind === 'microsoft' && !files.includes(row.name)) {
      db.prepare("UPDATE mc_accounts SET status = 'error', last_error = ? WHERE id = ?").run(
        'Anmeldung fehlt – bitte neu verbinden.',
        row.id
      );
    }
  }

  // Erst am Ende merken. Wirft der Abgleich dazwischen, wird beim nächsten Aufruf noch einmal
  // hingesehen, statt einen halb erledigten Stand für erledigt zu halten.
  //
  // `saveAccount` legt oben womöglich selbst etwas ab; die Zeitmarke wird deshalb hier neu gelesen
  // und nicht die von vorhin übernommen.
  try {
    const stats = fs.statSync(dir);
    lastSeen.set(userId, `${stats.mtimeMs}:${stats.size}`);
  } catch {
    lastSeen.set(userId, 'fehlt');
  }
}
