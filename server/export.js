// Listen zum Mitnehmen: CSV aus den Tabellen, die der Admin-Bereich ohnehin zeigt.
//
// Warum es das gibt: Irgendwann will jemand etwas mit den Zahlen tun, was ein Panel nicht kann –
// die Aufladungen eines Quartals dem Steuerberater schicken, Buchungen gegen den Kontoauszug
// halten, eine Nutzerliste nach eigenen Regeln sortieren. Bisher hieß die Antwort darauf „ich
// gehe an die Datenbank“. Das ist die Antwort, die dieses Panel überall sonst vermeidet, und für
// sie braucht es SSH, sqlite3 und eine ruhige Hand.
//
// **Kein neuer Datenbestand.** Jede Ausfuhr ist eine Abfrage über dieselben Tabellen, die die
// Ansicht daneben zeigt – dieselben Zahlen, nur in einer Datei. Was hier steht, ist deshalb nie
// „von gestern Nacht“.
//
// Zwei Dinge, die eine CSV-Datei aus einem Panel ernst nehmen muss:
//
//   * **Die Zeitangabe.** Millisekunden seit 1970 sind für ein Programm die Wahrheit und für eine
//     Tabellenkalkulation eine große Zahl. Deshalb steht in jeder Zeitspalte ein ISO-Zeitpunkt.
//   * **Die Formel.** Beginnt ein Feld mit =, +, - oder @, hält Excel es für eine Formel und führt
//     sie aus. Ein Nutzername wie `=cmd|…` ist damit ein Angriff auf den, der die Datei öffnet,
//     und nicht auf uns. Solche Felder bekommen ein Hochkomma davor – die Tabelle zeigt den Text,
//     rechnet aber nicht damit.
//
// Getrennt wird mit Komma nach RFC 4180, davor steht die BOM, damit Umlaute in Excel ankommen.

import { db } from './db.js';
import { config } from './config.js';

/** Ein Feld, wie es in einer CSV-Zelle stehen darf. */
function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Ein Zeitpunkt, den ein Mensch und eine Tabellenkalkulation gleichermaßen lesen. */
const time = (value) => (value ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) : '');

/** Credits sind Cent. In einer Geldspalte gehören sie mit Punkt geschrieben – so rechnet Excel. */
const money = (credits) => (credits === null || credits === undefined ? '' : (credits / 100).toFixed(2));

const yes = (value) => (value ? 'yes' : 'no');

/**
 * Was sich ausführen lässt.
 *
 * Jeder Eintrag ist eine Abfrage und eine Spaltenliste – mehr braucht es nicht, und alles, was
 * mehr wäre, gehört in die Ansicht und nicht in eine Datei. Die Reihenfolge der Spalten ist die,
 * in der die Ansicht daneben sie zeigt.
 */
export const DATASETS = {
  users: {
    label: { de: 'Nutzer', en: 'Users' },
    query: () => `
      SELECT u.id, u.username,
             COALESCE(NULLIF(u.full_name, ''), u.discord_name, u.google_name, u.username) AS display_name,
             u.email, u.role, u.credits, u.blocked, u.email_verified,
             u.language, u.discord_id, u.discord_name, u.premium_until, u.created_at, u.last_seen_at,
             (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles,
             (SELECT COUNT(*) FROM mc_accounts a WHERE a.user_id = u.id) AS accounts,
             (SELECT COUNT(*) FROM profiles p JOIN plans pl ON pl.id = p.plan_id
               WHERE p.user_id = u.id AND pl.free_slot = 0 AND p.paid_until > ${Date.now()}) AS paid_profiles
        FROM users u ORDER BY u.id`,
    columns: [
      ['id', (row) => row.id],
      ['username', (row) => row.username],
      ['email', (row) => row.email],
      ['role', (row) => row.role],
      ['credits', (row) => row.credits],
      ['display_name', (row) => row.display_name],
      ['balance_eur', (row) => money(row.credits)],
      ['blocked', (row) => yes(row.blocked)],
      ['email_confirmed', (row) => yes(row.email_verified)],
      ['language', (row) => row.language],
      ['discord_id', (row) => row.discord_id],
      ['discord_name', (row) => row.discord_name],
      ['premium_until', (row) => time(row.premium_until)],
      ['server_slots', (row) => row.profiles],
      ['paid_server_slots', (row) => row.paid_profiles],
      ['accounts', (row) => row.accounts],
      ['created', (row) => time(row.created_at)],
      ['last_seen', (row) => time(row.last_seen_at)],
    ],
  },

  ledger: {
    label: { de: 'Buchungen', en: 'Ledger' },
    query: () => `
      SELECT l.*, u.username, u.email FROM ledger l
        LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id`,
    columns: [
      ['id', (row) => row.id],
      ['time', (row) => time(row.created_at)],
      ['user_id', (row) => row.user_id],
      ['username', (row) => row.username],
      ['kind', (row) => row.kind],
      ['credits', (row) => row.delta_mcr],
      ['amount_eur', (row) => money(row.delta_mcr)],
      ['balance_after', (row) => row.balance_mcr],
      ['balance_after_eur', (row) => money(row.balance_mcr)],
      ['note', (row) => row.note],
      ['reference', (row) => row.ref],
    ],
  },

  topups: {
    label: { de: 'Aufladungen', en: 'Top-ups' },
    query: () => `
      SELECT t.*, u.username, u.email FROM topups t
        LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id`,
    columns: [
      ['id', (row) => row.id],
      ['created', (row) => time(row.created_at)],
      ['paid', (row) => time(row.paid_at)],
      ['user_id', (row) => row.user_id],
      ['username', (row) => row.username],
      ['email', (row) => row.email],
      ['provider', (row) => row.provider],
      ['status', (row) => row.status],
      ['amount_eur', (row) => money(row.amount_cent)],
      ['credits', (row) => row.credits],
      ['reference', (row) => row.reference],
      ['external_id', (row) => row.external_id],
      ['receipt_no', (row) => row.receipt_no],
    ],
  },

  /**
   * Die Belege, deren Konto es nicht mehr gibt.
   *
   * Eine Aufladung geht mit dem Konto (`ON DELETE CASCADE`), ein ausgestellter Beleg nicht: Er
   * ist ein Nachweis über einen Umsatz des Betreibers, und die Aufbewahrungsfrist dafür gehört
   * ihm. Beim Löschen eines Kontos wandern sie deshalb ins Archiv (server/account.js) – und
   * hier stehen sie zum Mitnehmen, sonst wären sie ein Datenbestand, den niemand je zu sehen
   * bekommt.
   */
  receipts: {
    label: { de: 'Belege gelöschter Konten', en: 'Receipts of deleted accounts' },
    query: () => 'SELECT * FROM receipt_archive ORDER BY receipt_no',
    columns: [
      ['receipt_no', (row) => row.receipt_no],
      ['created', (row) => time(row.created_at)],
      ['paid', (row) => time(row.paid_at)],
      ['archived', (row) => time(row.archived_at)],
      ['former_user_id', (row) => row.former_user],
      ['username', (row) => row.username],
      ['provider', (row) => row.provider],
      ['status', (row) => row.status],
      ['amount_eur', (row) => money(row.amount_cent)],
      ['credits', (row) => row.credits],
      ['billed_to', (row) => row.billed_to],
      ['vat_note', (row) => row.vat_note],
    ],
  },

  profiles: {
    label: { de: 'Serverplätze', en: 'Server slots' },
    query: () => `
      SELECT p.*, u.username, pl.name_de AS plan, n.name AS node FROM profiles p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN plans pl ON pl.id = p.plan_id
        LEFT JOIN nodes n ON n.id = p.node_id
       ORDER BY p.id`,
    columns: [
      ['id', (row) => row.id],
      ['name', (row) => row.name],
      ['address', (row) => (row.port ? `${row.host}:${row.port}` : row.host)],
      ['mc_version', (row) => row.mc_version],
      ['user_id', (row) => row.user_id],
      ['username', (row) => row.username],
      ['plan', (row) => row.plan],
      ['paid_until', (row) => time(row.paid_until)],
      ['last_paid_credits', (row) => row.paid_credits],
      ['renews', (row) => yes(row.renew)],
      ['suspended', (row) => yes(row.suspended)],
      ['blocked', (row) => yes(row.locked)],
      ['location', (row) => row.node],
      ['created', (row) => time(row.created_at)],
    ],
  },

  tickets: {
    label: { de: 'Tickets', en: 'Tickets' },
    query: () => `
      SELECT t.*, u.username,
             COALESCE(NULLIF(u.full_name, ''), u.discord_name, u.google_name, u.username) AS display_name,
             COALESCE(NULLIF(a.full_name, ''), a.discord_name, a.google_name, a.username) AS assignee,
             (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages
        FROM tickets t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN users a ON a.id = t.assigned_to
       ORDER BY t.id`,
    columns: [
      ['id', (row) => row.id],
      ['subject', (row) => row.subject],
      ['category', (row) => row.category],
      ['status', (row) => row.status],
      ['priority', (row) => row.priority],
      ['user_id', (row) => row.user_id],
      ['username', (row) => row.username],
      ['display_name', (row) => row.display_name],
      ['assignee', (row) => row.assignee],
      ['source', (row) => row.source],
      ['messages', (row) => row.messages],
      ['created', (row) => time(row.created_at)],
      ['updated', (row) => time(row.updated_at)],
      ['closed', (row) => time(row.closed_at)],
    ],
  },

  audit: {
    label: { de: 'Protokoll', en: 'Log' },
    query: () => `
      SELECT a.*, u.username FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id`,
    columns: [
      ['id', (row) => row.id],
      ['time', (row) => time(row.created_at)],
      ['user_id', (row) => row.user_id],
      ['username', (row) => row.username],
      ['action', (row) => row.action],
      ['detail', (row) => row.detail],
      ['ip', (row) => row.ip],
    ],
  },
};

/**
 * Eine Ausfuhr bauen.
 *
 * Bewusst als eine Zeichenkette und nicht als Strom: Die größte Tabelle dieses Panels ist das
 * Protokoll, und selbst nach Jahren sind das ein paar Megabyte. Ein Strom wäre mehr Technik für
 * einen Fall, den es hier nicht gibt.
 */
export function build(kind) {
  const dataset = DATASETS[kind];
  if (!dataset) return null;
  const rows = db.prepare(dataset.query()).all();
  const head = dataset.columns.map(([name]) => name).join(',');
  const body = rows
    .map((row) => dataset.columns.map(([, read]) => cell(read(row))).join(','))
    .join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    rows: rows.length,
    filename: `${String(config.brand).toLowerCase().replace(/\W+/g, '-')}-${kind}-${stamp}.csv`,
    // Die BOM steht vor allem anderen: ohne sie liest Excel UTF-8 als Windows-1252, und aus
    // "Serverplätze" wird "Serverplätze".
    body: `﻿${head}\r\n${body}${rows.length ? '\r\n' : ''}`,
  };
}
