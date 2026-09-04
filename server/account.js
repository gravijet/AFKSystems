// Das eigene Konto mitnehmen – oder loswerden.
//
// Zwei Dinge, die ein Dienst mit Kundendaten können muss und die dieses Panel bisher nicht konnte:
//
//   * **Auskunft.** Eine Datei mit allem, was hier über ein Konto steht. Nicht als Zusammenfassung
//     und nicht als Auswahl dessen, was wir für interessant halten – sondern als das, was in den
//     Tabellen steht, in einer Form, die ein Mensch lesen kann.
//   * **Löschen.** Ohne Ticket, ohne Bitte, ohne Wartezeit auf eine Antwort.
//
// **Warum die Löschung eine Frist hat.** Sofort und unwiderruflich wäre die falsche Voreinstellung:
// ein Klick im Ärger, ein fremder Browser, ein Kind am Rechner – und Serverplätze, Minecraft-
// Konten und Guthaben sind weg. Also: Der Wunsch steht an, die Bots gehen sofort aus (wer löschen
// will, will nicht weiter zahlen), und bis zum Stichtag genügt ein Knopf, um alles zurückzuholen.
// Danach wird wirklich gelöscht, und dann ist es auch wirklich weg.

import fs from 'node:fs';
import path from 'node:path';
import { db, audit } from './db.js';
import { paths } from './config.js';
import { supervisor } from './supervisor.js';
import * as mail from './mail.js';
import * as profile from './profile.js';
import { wrongPassword } from './auth.js';
import { HttpError } from './util.js';

/** Wie lange zwischen "löschen" und "gelöscht" liegt. */
export const GRACE_DAYS = 14;

// ---------------------------------------------------------------- Auskunft

/**
 * Die Bereiche, die ein Kunde getrennt mitnehmen kann.
 *
 * Die Namen sind Teil der Download-Adresse und absichtlich keine Tabellenamen. So bleibt die
 * Auswahl verständlich, auch wenn sich die Ablage darunter einmal ändert, und der Router kann
 * jeden fremden oder doppelt gesendeten Wert zuverlässig ablehnen.
 */
export const EXPORT_PARTS = Object.freeze([
  'profile',
  'minecraft',
  'servers',
  'automation',
  'billing',
  'support',
  'activity',
  'security',
]);

/** Ein defekter oder alter Tag-Satz darf einen Export nie unlesbar machen. */
function exportedTags(raw) {
  try {
    const values = JSON.parse(raw || '[]');
    return Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Alles über ein Konto, als einfaches Objekt.
 *
 * Bewusst nah an den Tabellen: Wer diese Datei liest, soll nachvollziehen können, was gespeichert
 * ist, und nicht raten müssen, was hinter einer schönen Überschrift steckt. Zwei Sorten Feld
 * fehlen trotzdem, und zwar aus gutem Grund:
 *
 *   * **Passwort-Hash, Sitzungs-Token, Bestätigungsmarken.** Das sind Schlüssel und keine Daten.
 *     Wer die Datei weitergibt (sie geht per Mail, sie liegt im Download-Ordner), gäbe damit den
 *     Zugang weiter statt der Auskunft.
 *   * **Die Microsoft-Anmeldungen der Minecraft-Konten.** Dasselbe: Sie liegen als Dateien unter
 *     data/users, sind Zugangsdaten zu einem fremden Dienst, und ihr Inhalt gehört Microsoft.
 *     Dass es sie gibt und zu welchem Konto, steht drin.
 */
export function exportFor(user, parts = null) {
  const one = (sql, ...args) => db.prepare(sql).all(...args);
  const id = user.id;
  // Ohne Auswahl bleibt der bisherige vollständige Export erhalten. Der Router lässt bei einer
  // Auswahl ausschließlich EXPORT_PARTS durch; der Filter hier macht die Funktion zusätzlich
  // für direkte Aufrufe unempfindlich gegen unbekannte Werte.
  const wanted = new Set(Array.isArray(parts) ? parts : EXPORT_PARTS);
  const has = (part) => wanted.has(part);
  const included = EXPORT_PARTS.filter(has);
  const data = {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    included,
  };

  if (has('profile')) {
    data.account = {
      id,
      username: user.username,
      email: user.email,
      role: user.role,
      language: user.language,
      theme: user.theme,
      credits: user.credits,
      email_verified: Boolean(user.email_verified),
      login_code: Boolean(user.login_code),
      // **Ob**, nicht **was**. Das Geheimnis der Zwei-Faktor-Anmeldung ist ein Schlüssel und
      // keine Auskunft – so wie der Passwort-Hash und die Sitzungstoken, die hier ebenfalls
      // fehlen. Dass sie eingeschaltet ist, gehört dagegen zum Konto und darf mit.
      two_factor: Boolean(user.totp_enabled_at && user.totp_secret),
      created_at: user.created_at,
      last_seen_at: user.last_seen_at,
      blocked: Boolean(user.blocked),
      delete_due_at: user.delete_due_at || null,
      ...profile.profileOf(user),
      display_name: profile.displayNameOf(user),
      avatar_source: user.avatar_source || 'auto',
      discord: user.discord_id ? { id: user.discord_id, name: user.discord_name } : null,
      google: user.google_id
        ? { id: user.google_id, name: user.google_name, email: user.google_email }
        : null,
      mail_prefs: mail.prefsOf(user),
    };
  }
  if (has('minecraft')) {
    data.minecraft_accounts = one(
      `SELECT id, name, kind, uuid, status, last_error, connections, tags, favorite, created_at
         FROM mc_accounts WHERE user_id = ? ORDER BY id`,
      id
    ).map((row) => ({ ...row, tags: exportedTags(row.tags), favorite: Boolean(row.favorite) }));
  }
  if (has('servers')) {
    data.server_slots = one(
      `SELECT p.id, p.name, p.host, p.port, p.mc_version, p.created_at, p.paid_until, p.suspended,
              pl.slug AS plan, pl.name_en AS plan_name
         FROM profiles p LEFT JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = ? ORDER BY p.id`,
      id
    );
    data.bots = one(
      `SELECT b.profile_id, b.account_id, b.state, b.uptime_sec, b.connections, b.started_at, b.stopped_at
         FROM bots b JOIN profiles p ON p.id = b.profile_id
        WHERE p.user_id = ? ORDER BY b.profile_id, b.account_id`,
      id
    );
  }
  if (has('automation')) {
    data.macros = one(
      `SELECT m.id, m.profile_id, m.name, m.event, m.config, m.actions, m.enabled, m.created_at
         FROM macros m JOIN profiles p ON p.id = m.profile_id
        WHERE p.user_id = ? ORDER BY m.id`,
      id
    );
    data.schedules = one(
      `SELECT s.id, s.profile_id, s.account_id, s.action, s.minutes, s.days, s.active, s.note,
              s.last_run_at, s.last_result, s.created_at
         FROM profile_schedules s JOIN profiles p ON p.id = s.profile_id
        WHERE p.user_id = ? ORDER BY s.id`,
      id
    );
  }
  if (has('billing')) {
    data.ledger = one(
      'SELECT id, delta, balance, kind, note, ref, created_at FROM ledger WHERE user_id = ? ORDER BY id',
      id
    );
    data.topups = one(
      `SELECT id, provider, amount_cent, credits, status, receipt_no, created_at, paid_at
         FROM topups WHERE user_id = ? ORDER BY id`,
      id
    );
  }
  if (has('support')) {
    // Ein geteilter Fall ist ebenfalls eigener Support-Verlauf. Die vorherige Auskunft enthielt
    // bereits dessen Nachrichten, ließ aber ausgerechnet die Überschrift weg.
    data.tickets = one(
      `SELECT t.id, t.subject, t.status, t.priority, t.source, t.created_at, t.updated_at, t.closed_at
         FROM tickets t
        WHERE t.user_id = ? OR EXISTS (
          SELECT 1 FROM ticket_users tu WHERE tu.ticket_id = t.id AND tu.user_id = ?
        )
        ORDER BY t.id`,
      id,
      id
    );
    // Auch die Beiträge – ein Ticket ohne seinen Verlauf ist eine Überschrift. Interne Notizen
    // des Teams bleiben draußen: Sie sind nicht Teil des Gesprächs mit dem Kunden und haben ihn
    // in Panel und Discord nie erreicht.
    data.ticket_messages = one(
      `SELECT m.id, m.ticket_id, m.role, m.author_name, m.body, m.created_at
         FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id
        WHERE (t.user_id = ? OR EXISTS (SELECT 1 FROM ticket_users tu WHERE tu.ticket_id = t.id AND tu.user_id = ?))
          AND m.internal = 0
        ORDER BY m.id`,
      id,
      id
    );
  }
  if (has('activity')) {
    data.mails = one('SELECT id, kind, subject, status, created_at FROM mails WHERE user_id = ? ORDER BY id', id);
    data.notifications = one(
      'SELECT id, event, tone, title_en, body_en, created_at, read_at FROM user_notifications WHERE user_id = ? ORDER BY id',
      id
    );
  }
  if (has('security')) {
    data.sessions = one(
      'SELECT created_at, expires_at, ip, agent FROM sessions WHERE user_id = ? ORDER BY created_at',
      id
    );
    // Die Browser, die ohne Anmeldecode hereinkommen. Ohne den Zufallswert selbst – der ist ein
    // Schlüssel und keine Auskunft, genau wie die Sitzungs-Token eine Zeile darüber.
    data.known_devices = one(
      'SELECT agent, ip, created_at, last_at FROM known_devices WHERE user_id = ? ORDER BY last_at DESC',
      id
    );
    data.audit = one('SELECT id, action, detail, ip, created_at FROM audit WHERE user_id = ? ORDER BY id', id);
  }
  return data;
}

// ---------------------------------------------------------------- Löschen

/** Steht eine Löschung an, und wann? */
export const deletionOf = (user) =>
  user?.delete_due_at ? { requested_at: user.delete_requested_at, due_at: user.delete_due_at } : null;

/**
 * Die Löschung anmelden.
 *
 * Drei Absagen, jede aus einem anderen Grund:
 *
 *   * **Kein Administrator.** Wer andere hereinlässt, kann sich nicht selbst hinauslassen – sonst
 *     löscht sich der letzte Administrator, und danach kommt niemand mehr in die Verwaltung. Wer
 *     das wirklich will, nimmt sich vorher die Rolle oder gibt sie jemandem.
 *   * **Nicht während ein Administrator "als Nutzer ansieht".** Diese Sitzung gehört nicht dem
 *     Kunden; eine Löschung, die daraus entsteht, hat er nie beantragt.
 *   * **Nicht ohne Passwort.** Es ist die einzige Stelle, die einen offenen fremden Browser von
 *     einem Kontoinhaber unterscheidet.
 */
export function requestDeletion(user, { verified = false } = {}) {
  if (user.role === 'admin') {
    throw new HttpError(403, 'Ein Administrator kann sein eigenes Konto hier nicht löschen.', {
      en: 'An administrator cannot delete their own account here.',
    });
  }
  if (!verified) throw wrongPassword();
  if (user.delete_due_at) return { requested_at: user.delete_requested_at, due_at: user.delete_due_at };

  const now = Date.now();
  const due = now + GRACE_DAYS * 86_400_000;
  db.prepare('UPDATE users SET delete_requested_at = ?, delete_due_at = ? WHERE id = ?').run(now, due, user.id);
  audit(user.id, 'account-delete-requested', { due_at: due });

  // Die Bots gehen sofort aus. Wer sein Konto loswerden will, will nicht bis zum Stichtag weiter
  // Verlängerungen bezahlen – und ein laufender Bot auf einem Konto, das gelöscht werden soll,
  // ist eine Rechnung, die niemand mehr sehen will.
  for (const row of db.prepare('SELECT id FROM profiles WHERE user_id = ?').all(user.id)) {
    supervisor.stopProfile(row.id, 'Das Konto wurde zur Löschung angemeldet.', { keepWanted: true });
  }
  // Und eine Nachricht mit dem Termin. Sie ist die einzige Stelle, an der die Frist steht, wenn
  // sich danach niemand mehr anmeldet – und die einzige Warnung, wenn die Löschung nicht vom
  // Kontoinhaber kam.
  mail
    .sendTo(user, 'account_delete', {
      due: new Date(due).toLocaleDateString(user.language === 'de' ? 'de-DE' : 'en-GB'),
      credits: user.credits,
    })
    .catch(() => {});
  return { requested_at: now, due_at: due };
}

/** Doch nicht. Alles steht noch – die Bots startet der Wiederanlauf von selbst wieder. */
export function cancelDeletion(userId) {
  const changed = db
    .prepare('UPDATE users SET delete_requested_at = NULL, delete_due_at = NULL WHERE id = ?')
    .run(userId).changes;
  if (changed) audit(userId, 'account-delete-cancelled');
  return Boolean(changed);
}

/**
 * Die ausgestellten Belege aus dem Konto herausnehmen, bevor es gelöscht wird.
 *
 * `topups` hängt mit `ON DELETE CASCADE` am Konto – für Serverplätze und Tickets ist das richtig,
 * für Zahlungen nicht. Eine ausgestellte Rechnung ist ein Beleg über einen **Umsatz des
 * Betreibers**; die Aufbewahrungsfrist dafür gehört ihm und nicht dem Konto, und genau das steht
 * auch in der Datenschutzerklärung. Außerdem wird die Belegnummer gezählt: Verschwänden die
 * Zeilen, wäre dieselbe Nummer im nächsten Jahr ein zweites Mal vergeben.
 *
 * Übernommen wird nur, was ohnehin auf dem Beleg stand – und nur von Zahlungen, die es wirklich
 * gab. Eine offene oder abgebrochene Aufladung hat keinen Beleg und geht mit dem Konto.
 */
function archiveReceipts(user) {
  const rows = db
    .prepare("SELECT * FROM topups WHERE user_id = ? AND receipt_no IS NOT NULL AND status IN ('paid','refunded')")
    .all(user.id);
  if (!rows.length) return 0;
  const insert = db.prepare(
    `INSERT INTO receipt_archive
       (receipt_no, former_user, username, provider, amount_cent, credits, status,
        billed_to, vat_note, created_at, paid_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(receipt_no) DO NOTHING`
  );
  const now = Date.now();
  db.transaction(() => {
    for (const row of rows) {
      insert.run(
        row.receipt_no,
        user.id,
        user.username,
        row.provider,
        row.amount_cent,
        row.credits,
        row.status,
        row.billed_to,
        row.vat_note,
        row.created_at,
        row.paid_at,
        now
      );
    }
  })();
  return rows.length;
}

/**
 * Jetzt wirklich.
 *
 * Die Datenbank erledigt das meiste selbst: Alles, was an `users(id)` hängt, ist mit
 * `ON DELETE CASCADE` angelegt (siehe db.js). Was sie **nicht** erledigt, sind die Dateien:
 *
 *   * `data/users/<id>` – die Microsoft-Anmeldungen der Minecraft-Konten.
 *   * `data/logs/bot-<serverplatz>-*` – die Protokolle der Bots.
 *
 * Die Anhänge der Tickets bleiben hier absichtlich liegen: Ihre Zeilen verschwinden mit den
 * Tickets, und damit sind die Dateien verwaist – das stündliche Aufräumen (attachments.sweepOrphans)
 * nimmt sie mit. Sie hier einzeln zu löschen wäre derselbe Vorgang ein zweites Mal, an einer
 * Stelle, an der niemand ihn sucht.
 *
 * **Was nicht mitgeht, sind die ausgestellten Belege** – siehe `archiveReceipts` darüber.
 */
export function erase(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return false;

  const profiles = db.prepare('SELECT id FROM profiles WHERE user_id = ?').all(userId);
  for (const row of profiles) {
    supervisor.stopProfile(row.id, 'Das Konto wurde gelöscht.', { keepWanted: false });
  }

  archiveReceipts(user);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  // Erst die Datenbank, dann die Platte. Andersherum bliebe bei einem Fehler ein Konto ohne seine
  // Dateien übrig – ein Bot, der nicht mehr startet, und niemand weiß warum.
  try {
    fs.rmSync(path.join(paths.users, String(userId)), { recursive: true, force: true });
  } catch {
    /* war nie da oder gehört jemand anderem – die Zeilen sind trotzdem weg */
  }
  for (const row of profiles) {
    let names = [];
    try {
      names = fs.readdirSync(paths.logs);
    } catch {
      break;
    }
    for (const name of names) {
      if (!name.startsWith(`bot-${row.id}-`)) continue;
      try {
        fs.unlinkSync(path.join(paths.logs, name));
      } catch {
        /* schon weg */
      }
    }
  }
  audit(null, 'account-erased', { user: userId, username: user.username });
  console.log(`[konto] ${user.username} (#${userId}) wurde gelöscht.`);
  return true;
}

/** Der Takt: Was fällig ist, wird gelöscht. Gibt zurück, wie viele es waren. */
export function runDueDeletions() {
  const due = db
    .prepare('SELECT id FROM users WHERE delete_due_at IS NOT NULL AND delete_due_at <= ?')
    .all(Date.now());
  let done = 0;
  for (const row of due) {
    // Jedes Konto für sich: Ein Fehler an einem darf die übrigen nicht mitnehmen.
    try {
      if (erase(row.id)) done += 1;
    } catch (error) {
      console.error(`[konto] Löschen von #${row.id} ging schief:`, error.message);
    }
  }
  return done;
}
