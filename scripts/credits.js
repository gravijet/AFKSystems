#!/usr/bin/env node
// Guthaben auf der Kommandozeile.
//
// Gedacht für den Fall, in dem der Weg über das Panel gerade nicht offensteht: niemand ist als
// Administrator angemeldet, das Passwort ist weg, oder es soll etwas in einem Skript passieren.
// Alles, was hier geht, geht auch im Panel unter **Administration → Nutzer** – dies ist derselbe
// Vorgang, nur ohne Browser.
//
// Gebucht wird über `billing.move`, also über genau dieselbe Stelle wie jede andere Buchung: mit
// Zeile im Kontoauszug, mit Eintrag im Protokoll und mit der Sperre gegen einen negativen Stand.
// Ein zweiter Weg am Kontoauszug vorbei wäre kein Werkzeug, sondern ein Loch.
//
//   npm run admin:credits -- --list
//   npm run admin:credits -- --user max --add 500   --note "Entschuldigung für die Störung"
//   npm run admin:credits -- --user 12  --take 250
//   npm run admin:credits -- --user max
//
// `--user` nimmt eine Nummer, einen Benutzernamen oder eine E-Mail-Adresse.

import { db } from '../server/db.js';
import * as billing from '../server/billing.js';
import { formatCredits, formatEuro } from '../server/util.js';

const HILFE = `Guthaben verwalten.

  --list                 Alle Konten mit Guthaben auflisten
  --user <wer>           Nummer, Benutzername oder E-Mail-Adresse
  --add <credits>        gutschreiben   (1 Credit = 1 Cent)
  --take <credits>       abbuchen
  --note "<text>"        Begründung für den Kontoauszug
  --help                 diese Hilfe

Ohne --add/--take wird nur der aktuelle Stand angezeigt.`;

/** Die Argumente einlesen. Bewusst schlicht: --schlüssel wert, sonst nichts. */
function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const part = argv[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const zeile = (user) =>
  `#${String(user.id).padStart(4)}  ${user.username.padEnd(24)} ${formatCredits(user.credits)
    .padStart(10)}  ${formatEuro(user.credits).padStart(12)}  ${user.email}`;

function suche(wer) {
  const text = String(wer).trim();
  const byId = /^\d+$/.test(text)
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(Number(text))
    : null;
  return (
    byId ||
    db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
      .get(text, text.toLowerCase()) ||
    null
  );
}

function main() {
  const options = args(process.argv.slice(2));
  if (options.help || (!options.list && !options.user)) {
    console.log(HILFE);
    return 0;
  }

  if (options.list) {
    const rows = db.prepare('SELECT * FROM users ORDER BY credits DESC, id').all();
    for (const row of rows) console.log(zeile(row));
    const gesamt = rows.reduce((sum, row) => sum + row.credits, 0);
    console.log(
      `\n${rows.length} ${rows.length === 1 ? 'Konto' : 'Konten'}, zusammen ` +
        `${formatCredits(gesamt)} Credits (${formatEuro(gesamt)}).`
    );
    return 0;
  }

  const user = suche(options.user);
  if (!user) {
    console.error(`Kein Konto zu "${options.user}".`);
    return 1;
  }

  const add = options.add !== undefined ? Math.trunc(Number(options.add)) : 0;
  const take = options.take !== undefined ? Math.trunc(Number(options.take)) : 0;
  if ((options.add !== undefined && !Number.isFinite(add)) || (options.take !== undefined && !Number.isFinite(take))) {
    console.error('Der Betrag muss eine ganze Zahl sein (1 Credit = 1 Cent).');
    return 1;
  }
  const delta = add - take;

  if (!delta) {
    console.log(zeile(user));
    return 0;
  }

  try {
    // Dieselbe Buchung wie im Panel: `move` schreibt den Kontoauszug und lässt nichts ins Minus.
    const balance = billing.move(
      user.id,
      delta,
      'admin',
      String(options.note || 'Kommandozeile').slice(0, 200)
    );
    console.log(
      `${user.username}: ${delta > 0 ? '+' : ''}${formatCredits(delta)} → ${formatCredits(balance)} Credits (${formatEuro(
        balance
      )}).`
    );
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

process.exitCode = main();
