// Zeitpläne: Bots zu festen Zeiten starten und stoppen.
//
// **Warum es das gibt.** Ein AFK-Bot soll oft nicht rund um die Uhr sitzen, sondern zu bestimmten
// Zeiten – nachts, während der Arbeit, an Wochentagen. Das ging bisher nur von Hand, also gar
// nicht: Wer um sechs Uhr starten will, steht nicht um sechs Uhr auf, um auf einen Knopf zu
// drücken. Für viele Server ist das außerdem der Unterschied zwischen "läuft" und "gebannt": Ein
// Konto, das durchgehend online ist, fällt auf; eines, das jeden Abend kommt und geht, nicht.
//
// **Warum keine cron-Zeile.** "0 6 * * 1-5" ist eine Sprache, die man lernen muss, und die genau
// eine falsche Stelle braucht, um etwas völlig anderes zu tun. Hier steht eine Uhrzeit, eine
// Auswahl von Wochentagen und was passieren soll. Alles drei kann man ansehen und verstehen.
//
// **Warum in der Zeitzone des Kunden.** Sechs Uhr heißt sechs Uhr dort, wo der Kunde wohnt, und
// nicht dort, wo zufällig der Server steht. Die Zeitzone steht am Konto (Migration 019); ohne
// Angabe gilt die des Servers, und im Panel steht daneben, welche das ist.

import { db, audit } from './db.js';
import { supervisor } from './supervisor.js';
import * as billing from './billing.js';
import * as notify from './notify.js';
import { timezoneOf } from './profile.js';
import { bad, intl, notFound, requireInt } from './util.js';

export const ACTIONS = ['start', 'stop', 'restart'];

/** Wie viele Zeitpläne ein Serverplatz haben darf. Mehr ist kein Plan mehr, sondern ein Rätsel. */
export const MAX_PER_PROFILE = 20;

/**
 * Wie lange ein verpasster Zeitpunkt noch nachgeholt wird.
 *
 * Der Takt läuft jede Minute, aber der Dienst kann neu gestartet worden sein, die Maschine kann
 * geschlafen haben, ein Standort kann kurz weg gewesen sein. Eine Viertelstunde Nachlauf fängt
 * das ab – und verhindert zugleich, dass ein Server, der einen halben Tag aus war, beim
 * Hochfahren zwölf Stunden alte Zeitpläne der Reihe nach abarbeitet.
 */
const GRACE_MS = 15 * 60_000;

/** 0 = Sonntag, wie `Date#getDay` – und wie die Wochentage im Panel gezählt werden. */
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Uhrzeit und Wochentag eines Zeitpunkts in einer bestimmten Zeitzone.
 *
 * `Intl` statt eigener Rechnerei: Sommerzeit, halbe Stunden (Indien), viertel Stunden (Nepal) und
 * Länder, die ihre Regeln ändern, stehen in der Zeitzonendatenbank des Systems und nicht in
 * diesem Programm. `hourCycle: 'h23'` ist wichtig – ohne das liefert manche Fassung von ICU für
 * Mitternacht die Stunde "24", und dann läge ein Zeitplan um 0:00 Uhr einen Tag daneben.
 */
function localAt(at, timeZone) {
  // Der Formatierer bleibt stehen: Diese Funktion läuft im Minutentakt für jeden aktiven Zeitplan,
  // und einen `Intl.DateTimeFormat` zu bauen kostet mehr als das Formatieren selbst (util.js).
  const parts = Object.fromEntries(
    intl(
      `schedule:${timeZone}`,
      () =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone,
          hourCycle: 'h23',
          weekday: 'short',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
    )
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  );
  return {
    date: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/**
 * "0,1,2" -> [0,1,2]. Unbekanntes fällt weg; leer heißt: kein Tag, also nie.
 *
 * Die Prüfung auf Ziffern ist der Punkt und nicht Zierrat: `Number('')` ist **0**, und 0 ist ein
 * gültiger Wochentag (Sonntag). Ohne sie wäre eine leere Angabe stillschweigend "sonntags" – ein
 * Zeitplan, den niemand angelegt hat und der trotzdem einmal die Woche Bots stoppt.
 */
export const parseDays = (raw) =>
  [
    ...new Set(
      (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
        .map((entry) => String(entry).trim())
        .filter((entry) => /^\d+$/.test(entry))
        .map(Number)
        .filter((day) => day >= 0 && day <= 6)
    ),
  ].sort((a, b) => a - b);

const view = (row, timeZone = null) => ({
  id: row.id,
  profile_id: row.profile_id,
  account_id: row.account_id,
  action: row.action,
  minutes: row.minutes,
  days: parseDays(row.days),
  active: Boolean(row.active),
  note: row.note || '',
  last_run_at: row.last_run_at,
  last_result: row.last_result,
  next_at: timeZone && row.active ? nextAt(row, timeZone) : null,
});

/**
 * Wann dieser Zeitplan das nächste Mal dran ist – als Zeitpunkt, nicht als Uhrzeit.
 *
 * **Warum das der Server ausrechnet.** Die Uhrzeit gilt in der Zeitzone des Kontos, und die kann
 * eine andere sein als die des Browsers, in dem gerade jemand hinsieht (ein Kunde im Urlaub, ein
 * Administrator, der ein fremdes Konto ansieht). Käme die Rechnung aus dem Browser, stünde dort
 * „heute 18:00“, während der Bot in Wahrheit um 20:00 Ortszeit des Browsers startet.
 *
 * Gesucht wird der nächste der kommenden acht Tage, dessen Wochentag passt und dessen Zeitpunkt
 * noch in der Zukunft liegt. Acht statt sieben, weil "heute, aber schon vorbei" sonst durchfällt,
 * wenn derselbe Wochentag der einzige gewählte ist.
 */
export function nextAt(row, timeZone, now = Date.now()) {
  return occurrencesBetween(row, timeZone, now + 1, now + 8 * 86_400_000)[0] ?? null;
}

/**
 * Lokale Kalendertage in echte Zeitpunkte übersetzen. Ein Tag hat bei einer Zeitumstellung
 * nicht immer 24 Stunden. Wir sammeln deshalb die UTC-Abstände im Suchfenster und prüfen jeden
 * Kandidaten zurück gegen die lokale Uhr: ausgefallene Uhrzeiten entfallen, doppelte bleiben
 * zwei verschiedene Zeitpunkte. Alle Ergebnisse liegen auf vollen Minuten.
 */
function occurrencesBetween(row, timeZone, from, to) {
  const days = parseDays(row.days);
  if (!days.length) return [];
  const dayMs = 86_400_000;
  const offsets = new Set();
  for (let probe = Math.floor(from / dayMs) * dayMs - dayMs; probe <= to + dayMs; probe += dayMs / 2) {
    const local = localAt(probe, timeZone);
    offsets.add(local.date + local.minutes * 60_000 - probe);
  }
  const first = localAt(from, timeZone).date - dayMs;
  const last = localAt(to, timeZone).date + dayMs;
  const result = new Set();
  for (let date = first; date <= last; date += dayMs) {
    for (const offset of offsets) {
      const at = date + row.minutes * 60_000 - offset;
      if (at < from || at > to) continue;
      const local = localAt(at, timeZone);
      if (local.date === date && local.minutes === row.minutes && days.includes(local.weekday)) result.add(at);
    }
  }
  return [...result].sort((a, b) => a - b);
}

export const listFor = (profileId, timeZone = null) =>
  db
    .prepare('SELECT * FROM profile_schedules WHERE profile_id = ? ORDER BY minutes, id')
    .all(profileId)
    .map((row) => view(row, timeZone));

export const byId = (id) => db.prepare('SELECT * FROM profile_schedules WHERE id = ?').get(id);

/** Was von einem Wunsch übrig bleibt: geprüft, in den erlaubten Grenzen, in fester Schreibweise. */
function clean(body, profile) {
  const action = ACTIONS.includes(body?.action) ? body.action : 'start';
  const minutes = requireInt(body?.minutes ?? 0, 'Uhrzeit', { min: 0, max: 1439 });
  const days = parseDays(body?.days);
  if (!days.length) {
    throw bad('Ohne Wochentag gibt es keinen Zeitpunkt.', { en: 'Without a weekday there is no time.' });
  }
  // Ein Konto, das gar nicht auf diesem Serverplatz sitzt, wäre ein Zeitplan ins Leere.
  let accountId = null;
  if (body?.account_id) {
    accountId = requireInt(body.account_id, 'Konto');
    const member = db
      .prepare('SELECT 1 FROM profile_accounts WHERE profile_id = ? AND account_id = ?')
      .get(profile.id, accountId);
    if (!member) throw bad('Dieses Konto sitzt nicht auf diesem Serverplatz.', {
      en: 'That account is not on this server slot.',
    });
  }
  return {
    action,
    minutes,
    days: days.join(','),
    account_id: accountId,
    active: body?.active === undefined ? 1 : body.active ? 1 : 0,
    note: String(body?.note || '').replace(/\s+/g, ' ').trim().slice(0, 120),
  };
}

export function create(profile, body, byUserId, timeZone = null) {
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM profile_schedules WHERE profile_id = ?')
    .get(profile.id).n;
  if (count >= MAX_PER_PROFILE) {
    throw bad(`Mehr als ${MAX_PER_PROFILE} Zeitpläne je Serverplatz gehen nicht.`, {
      en: `More than ${MAX_PER_PROFILE} schedules per server slot is not possible.`,
    });
  }
  const values = clean(body, profile);
  const info = db
    .prepare(
      `INSERT INTO profile_schedules (profile_id, account_id, action, minutes, days, active, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      profile.id,
      values.account_id,
      values.action,
      values.minutes,
      values.days,
      values.active,
      values.note,
      Date.now()
    );
  audit(byUserId, 'schedule-create', { profile: profile.id, action: values.action, minutes: values.minutes });
  return view(byId(info.lastInsertRowid), timeZone);
}

export function update(profile, id, body, byUserId, timeZone = null) {
  const row = byId(id);
  if (!row || row.profile_id !== profile.id) {
    throw notFound('Diesen Zeitplan gibt es nicht.', { en: 'No such schedule.' });
  }
  // Nur der Schalter allein? Dann bleibt der Rest, wie er war – sonst müsste die Oberfläche zum
  // Ein- und Ausschalten jedes Mal den ganzen Eintrag mitschicken.
  if (Object.keys(body || {}).length === 1 && body.active !== undefined) {
    db.prepare('UPDATE profile_schedules SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id);
    return view(byId(id), timeZone);
  }
  const values = clean({ ...view(row), ...body, days: body?.days ?? parseDays(row.days) }, profile);
  db.prepare(
    `UPDATE profile_schedules SET account_id = ?, action = ?, minutes = ?, days = ?, active = ?, note = ?
      WHERE id = ?`
  ).run(values.account_id, values.action, values.minutes, values.days, values.active, values.note, id);
  audit(byUserId, 'schedule-update', { id, profile: profile.id });
  return view(byId(id), timeZone);
}

export function remove(profile, id, byUserId) {
  const row = byId(id);
  if (!row || row.profile_id !== profile.id) {
    throw notFound('Diesen Zeitplan gibt es nicht.', { en: 'No such schedule.' });
  }
  db.prepare('DELETE FROM profile_schedules WHERE id = ?').run(id);
  audit(byUserId, 'schedule-delete', { id, profile: profile.id });
  return true;
}

// ---------------------------------------------------------------- Der Takt

/**
 * Welche Konten dieser Zeitplan meint: eines oder alle des Serverplatzes.
 */
const accountsOf = (schedule) =>
  db.prepare(`SELECT account_id FROM profile_accounts
    WHERE profile_id = ? AND (? IS NULL OR account_id = ?)`).all(
      schedule.profile_id, schedule.account_id, schedule.account_id
    ).map((row) => row.account_id);

/**
 * Ein Zeitplan ausführen.
 *
 * Was dabei herauskommt, steht danach am Zeitplan (`last_result`) – auch der Fehler. Das ist der
 * Unterschied zwischen "der Zeitplan hat nichts getan" und "der Zeitplan konnte nichts tun, weil
 * das Guthaben nicht reichte": Ohne diese Zeile stünde der Kunde vor einem Bot, der morgens nicht
 * da war, und hätte keinen Anhaltspunkt.
 */
function run(schedule) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(schedule.profile_id);
  if (!profile) return 'gone';
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(profile.user_id);
  if (!user) return 'gone';

  const ids = accountsOf(schedule);
  if (!ids.length) return 'no accounts';

  if (schedule.action === 'stop') {
    // `keepWanted: false`: Ein Zeitplan, der stoppt, meint auch "und bleib aus". Sonst holt der
    // Wiederanlauf den Bot eine Minute später zurück, und der Zeitplan sähe aus wie kaputt.
    for (const accountId of ids) supervisor.stop(profile.id, accountId, { keepWanted: false });
    return `stopped ${ids.length}`;
  }

  const plan = billing.featuresOf(profile);
  let started = 0;
  const problems = [];
  for (const accountId of ids) {
    const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
    if (!account) continue;
    try {
      if (schedule.action === 'restart') supervisor.restart(profile.id, accountId);
      else supervisor.start({ profile, account, user, plan });
      started += 1;
    } catch (error) {
      // Der erste Grund genügt. Zwanzig Konten mit derselben Absage ("Guthaben reicht nicht")
      // ergeben zwanzigmal denselben Satz, und der passt nicht in eine Zeile.
      const text = String(error?.message || error).slice(0, 160);
      if (!problems.includes(text)) problems.push(text);
    }
  }
  if (!started && problems.length) {
    // **Der Kunde erfährt davon.** Ein Zeitplan, der schweigend nichts tut, ist schlimmer als
    // gar keiner: Der Bot ist morgens nicht da, und der Grund steht in einem Reiter, in den
    // niemand sieht, solange er glaubt, es laufe. Die Sperrzeit steckt in notify.js.
    notify.scheduleFailed(user.id, profile.name, clockOf(schedule.minutes), problems[0]);
    return problems.join(' · ').slice(0, 200);
  }
  return problems.length ? `started ${started}, ${problems[0]}` : `started ${started}`;
}

/** Minuten seit Mitternacht als Uhrzeit – für die Nachricht an den Kunden. */
const clockOf = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Ein Durchlauf: Was ist fällig?
 *
 * Fällig ist ein Zeitplan, wenn sein letzter Zeitpunkt in der Vergangenheit liegt, noch keine
 * Viertelstunde her ist, auf einen seiner Wochentage fällt und seit diesem Zeitpunkt noch nicht
 * gelaufen ist. Der letzte Punkt ist der wichtige: Er ist es, der aus einem Takt im Minutentakt
 * genau eine Ausführung je Zeitpunkt macht.
 */
export function tick(now = Date.now()) {
  const rows = db
    .prepare(
      `SELECT s.*, u.timezone, u.id AS user_id
         FROM profile_schedules s
         JOIN profiles p ON p.id = s.profile_id
         JOIN users u ON u.id = p.user_id
        WHERE s.active = 1 AND u.blocked = 0 AND u.delete_due_at IS NULL`
    )
    .all();

  let done = 0;
  for (const row of rows) {
    const zone = timezoneOf(row);
    const occurrence = occurrencesBetween(row, zone, now - GRACE_MS, now).at(-1);
    if (occurrence === undefined) continue;
    if (row.last_run_at && row.last_run_at >= occurrence) continue;

    let result;
    try {
      result = run(row);
    } catch (error) {
      result = String(error?.message || error).slice(0, 200);
    }
    db.prepare('UPDATE profile_schedules SET last_run_at = ?, last_result = ? WHERE id = ?').run(
      now,
      result,
      row.id
    );
    done += 1;
  }
  return done;
}
