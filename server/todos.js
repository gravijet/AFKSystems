// Was ein Kunde gerade zu tun hat.
//
// Die Übersicht hatte drei fest eingebaute Hinweiskästen: kein Guthaben, stillgelegter Platz,
// Konto ohne Anmeldung. Das waren die drei, die jemandem eingefallen sind – die Antwort auf ein
// beantwortetes Ticket, die offene Überweisung, der Serverplatz ohne Minecraft-Konto standen
// nirgends, und wer nicht von selbst nachsah, erfuhr es nie.
//
// Hier steht die vollständige Liste, und sie steht an **einer** Stelle. Das ist der eigentliche
// Punkt dieser Datei: Ob etwas zu tun ist, entscheidet die Datenbank und nicht das Frontend, und
// jede Oberfläche, die die Liste holt, hat damit dieselbe Antwort.
//
// Drei Regeln für einen Eintrag:
//
//   1. **Es muss etwas zu tun sein.** "Dein Guthaben ist in Ordnung" ist kein To-Do, sondern
//      Rauschen. Was nicht dasteht, ist erledigt.
//   2. **Es muss klar sein, was.** Jeder Eintrag hat genau ein Ziel im Panel und die Beschriftung
//      des Knopfes, der dorthin führt.
//   3. **Es muss die Person betreffen, die zusieht.** Nichts hier zählt Team-Warteschlangen oder
//      fremde Konten – dafür gibt es den Admin-Bereich.
//
// `kind` sagt, wie dringend es ist: `bad` heißt "es steht gerade etwas still", `warn` heißt "es
// wird bald stehen", `info` heißt "nimm es zur Kenntnis". Das Panel sortiert danach.

import { db, getSetting } from './db.js';
import * as billing from './billing.js';
import * as mail from './mail.js';
import { formatEuro } from './util.js';

const RANK = { bad: 0, warn: 1, info: 2 };

/** Eine Zahl mit Tausenderpunkt – dieselbe Schreibweise wie sonst im Panel. */
const number = (value, lang) => Number(value || 0).toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE');

/** Ein Datum ohne Uhrzeit. Auf den Tag genau reicht für alles, was hier steht. */
const day = (timestamp, lang) =>
  new Date(timestamp).toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

/**
 * Die offenen Aufgaben eines Kontos.
 *
 * `lang` entscheidet nur über den Wortlaut – **was** offen ist, hängt an nichts anderem als den
 * Daten. Die Reihenfolge ist Dringlichkeit zuerst, danach die Reihenfolge hier unten: Geld und
 * stillstehende Plätze vor Support, Support vor Kleinkram.
 */
export function todosFor(user, lang = 'en') {
  const en = lang === 'en';
  const out = [];
  const add = (entry) => out.push(entry);
  const now = Date.now();

  // ------------------------------------------------------------ Serverplätze
  const profiles = db
    .prepare(
      `SELECT p.*, pl.free_slot, pl.name_de, pl.name_en,
              pl.price_credits + COALESCE((SELECT SUM(a.price_credits * pa.qty)
                  FROM profile_addons pa JOIN addons a ON a.id = pa.addon_id
                 WHERE pa.profile_id = p.id), 0) AS price_credits,
              (SELECT COUNT(*) FROM profile_accounts pa WHERE pa.profile_id = p.id) AS members
         FROM profiles p JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = ? ORDER BY p.ordinal, p.id`
    )
    .all(user.id);

  for (const profile of profiles) {
    const name = profile.name;

    // Gesperrt heißt: Der Kunde kann hier nichts mehr richten, nur noch fragen. Deshalb führt
    // dieser Eintrag zum Support und nicht zum Serverplatz.
    if (profile.locked) {
      add({
        key: `profile-locked-${profile.id}`,
        kind: 'bad',
        title: en ? `"${name}" is locked` : `„${name}" ist gesperrt`,
        text: profile.lock_reason
          ? profile.lock_reason
          : en
            ? 'The bots are stopped. Support can tell you why.'
            : 'Die Bots sind aus. Der Support sagt dir, woran es liegt.',
        href: '#/tickets',
        label: en ? 'Ask support' : 'Support fragen',
      });
      continue;
    }

    if (profile.suspended) {
      const missing = Math.max(0, profile.price_credits - user.credits);
      add({
        key: `profile-suspended-${profile.id}`,
        kind: 'bad',
        title: en ? `"${name}" is suspended` : `„${name}" ist stillgelegt`,
        text: missing
          ? en
            ? `The bots are stopped. Resuming costs ${number(profile.price_credits, lang)} credits – ${number(missing, lang)} short.`
            : `Die Bots sind aus. Fortsetzen kostet ${number(profile.price_credits, lang)} Credits – es fehlen ${number(missing, lang)}.`
          : en
            ? `The bots are stopped. Resuming costs ${number(profile.price_credits, lang)} credits, and you have enough.`
            : `Die Bots sind aus. Fortsetzen kostet ${number(profile.price_credits, lang)} Credits, und die hast du.`,
        href: missing ? '#/credits' : `#/servers/${profile.id}/plan`,
        label: missing ? (en ? 'Top up' : 'Aufladen') : en ? 'Resume' : 'Fortsetzen',
      });
      continue;
    }

    // Der Gratis-Platz hängt an der Discord-Mitgliedschaft. "Konnte gerade nicht bestätigt
    // werden" ist unsere Lücke und keine Aufgabe des Kunden – die steht deshalb nicht hier.
    if (profile.free_slot) {
      const access = billing.freeAccess(profile.user_id, now);
      if (access.reason === 'discord-link') {
        add({
          key: 'free-discord-link',
          kind: 'bad',
          title: en ? 'Link your Discord account' : 'Discord-Konto verknüpfen',
          text: en
            ? `The free server slot ("${name}") only runs while a linked Discord account is a member of our server.`
            : `Der Gratis-Serverplatz („${name}") läuft nur, solange ein verknüpftes Discord-Konto Mitglied auf unserem Server ist.`,
          href: '#/settings',
          label: en ? 'Link now' : 'Jetzt verknüpfen',
        });
      } else if (access.reason === 'discord-join') {
        // Beitreten geht nur dort, wo der Server ist – deshalb der Einladungslink, wenn einer
        // hinterlegt ist. Ohne ihn bleibt der Weg über die Einstellungen.
        const invite = String(getSetting('discord_invite') || '').trim();
        add({
          key: 'free-discord-join',
          kind: 'bad',
          title: en ? 'Join the AFKSystems Discord' : 'Dem AFKSystems-Discord beitreten',
          text: en
            ? `Your Discord account is linked but not a member. Without it the free slot ("${name}") stays off.`
            : `Dein Discord-Konto ist verknüpft, aber kein Mitglied. Ohne das bleibt der Gratis-Platz („${name}") aus.`,
          href: invite || '#/settings',
          external: Boolean(invite),
          label: invite ? (en ? 'Join now' : 'Jetzt beitreten') : en ? 'How it works' : 'So geht es',
        });
      }
      continue;
    }

    if (!profile.paid_until) continue;

    const daysLeft = Math.ceil((profile.paid_until - now) / 86_400_000);
    const warnDays = Math.max(1, Number(getSetting('renew_warn_days')) || 3);

    if (!profile.renew) {
      add({
        key: `profile-renew-off-${profile.id}`,
        kind: daysLeft <= warnDays ? 'warn' : 'info',
        title: en ? `"${name}" will not renew` : `„${name}" wird nicht verlängert`,
        text: en
          ? `Renewal is switched off. The slot ends on ${day(profile.paid_until, lang)} and the bots stop.`
          : `Die Verlängerung ist aus. Der Platz endet am ${day(profile.paid_until, lang)}, danach gehen die Bots aus.`,
        href: `#/servers/${profile.id}/plan`,
        label: en ? 'Switch it back on' : 'Wieder einschalten',
      });
      continue;
    }

    if (daysLeft <= warnDays && user.credits < profile.price_credits) {
      add({
        key: `profile-expiring-${profile.id}`,
        kind: 'warn',
        title: en
          ? `"${name}" renews in ${daysLeft} day(s)`
          : `„${name}" wird in ${daysLeft} Tag(en) verlängert`,
        text: en
          ? `${number(profile.price_credits, lang)} credits are due and ${number(profile.price_credits - user.credits, lang)} are missing. Without them the slot is suspended.`
          : `Fällig sind ${number(profile.price_credits, lang)} Credits, es fehlen ${number(profile.price_credits - user.credits, lang)}. Ohne sie wird der Platz stillgelegt.`,
        href: '#/credits',
        label: en ? 'Top up' : 'Aufladen',
      });
    }
  }

  // Ein Serverplatz ohne Minecraft-Konto ist ein Platz, auf dem nie etwas passieren wird.
  for (const profile of profiles) {
    if (profile.members || profile.locked) continue;
    add({
      key: `profile-empty-${profile.id}`,
      kind: 'info',
      title: en ? `"${profile.name}" has no account yet` : `„${profile.name}" hat noch kein Konto`,
      text: en
        ? 'Add a Minecraft account to the slot, then the bot can start.'
        : 'Ordne dem Platz ein Minecraft-Konto zu, dann kann der Bot starten.',
      href: `#/servers/${profile.id}/connect`,
      label: en ? 'Assign an account' : 'Konto zuordnen',
    });
  }

  // ------------------------------------------------------------ Guthaben
  //
  // Zwei verschiedene Sätze: "gar nichts mehr da, obwohl etwas läuft" und "reicht nicht für den
  // nächsten Monat". Wer schon oben wegen eines fälligen Platzes gewarnt wurde, braucht das nicht
  // zweimal – deshalb nur, wenn dort nichts stand.
  const monthly = billing.monthlyCost(user.id);
  const warnedAboutMoney = out.some((entry) => entry.href === '#/credits');
  if (monthly > 0 && !warnedAboutMoney) {
    const low = Number(getSetting('low_balance')) || 0;
    if (user.credits <= 0) {
      add({
        key: 'credits-empty',
        kind: 'bad',
        title: en ? 'No credits left' : 'Kein Guthaben mehr',
        text: en
          ? `Your slots cost ${number(monthly, lang)} credits a month. The next renewal will fail.`
          : `Deine Plätze kosten ${number(monthly, lang)} Credits im Monat. Die nächste Verlängerung geht so nicht.`,
        href: '#/credits',
        label: en ? 'Top up' : 'Aufladen',
      });
    } else if (user.credits < monthly || user.credits <= low) {
      add({
        key: 'credits-low',
        kind: 'warn',
        title: en ? 'Credits are running low' : 'Das Guthaben wird knapp',
        text: en
          ? `${number(user.credits, lang)} credits left, ${number(monthly, lang)} due each month.`
          : `Noch ${number(user.credits, lang)} Credits, ${number(monthly, lang)} fällig im Monat.`,
        href: '#/credits',
        label: en ? 'Top up' : 'Aufladen',
      });
    }
  }

  // Eine offene Überweisung wartet auf den Kunden – bei Tebex wartet sie auf niemanden, dort
  // führt der Weg über die Bezahlseite und die Aufladung verfällt von selbst.
  for (const topup of db
    .prepare(
      `SELECT * FROM topups
        WHERE user_id = ? AND status = 'open' AND provider IN ('transfer', 'paypal')
        ORDER BY id DESC LIMIT 3`
    )
    .all(user.id)) {
    add({
      key: `topup-open-${topup.id}`,
      kind: 'warn',
      title: en
        ? `Payment of ${formatEuro(topup.amount_cent, 'en')} is still open`
        : `Zahlung über ${formatEuro(topup.amount_cent, 'de')} steht noch aus`,
      text: en
        ? `Use "${topup.reference}" as the reference, otherwise nobody can match it. The credits are added once it arrives.`
        : `Nimm „${topup.reference}" als Verwendungszweck, sonst lässt sie sich nicht zuordnen. Gutgeschrieben wird, sobald sie da ist.`,
      href: '#/credits',
      label: en ? 'Payment details' : 'Zahlungsdaten',
    });
  }

  // ------------------------------------------------------------ Support
  //
  // Genau der Fall aus der Anforderung: Das Team hat geantwortet, und jetzt ist der Kunde dran.
  // `unread_user` setzt tickets.js beim Antworten des Teams und löscht es beim Lesen.
  for (const ticket of db
    .prepare(
      `SELECT t.id, t.subject FROM tickets t
        WHERE t.unread_user = 1 AND t.status != 'closed'
          AND (t.user_id = ? OR EXISTS (SELECT 1 FROM ticket_users tu
                                         WHERE tu.ticket_id = t.id AND tu.user_id = ?))
        ORDER BY t.updated_at DESC LIMIT 5`
    )
    .all(user.id, user.id)) {
    add({
      key: `ticket-${ticket.id}`,
      kind: 'warn',
      title: en ? `Support answered: "${ticket.subject}"` : `Antwort im Support: „${ticket.subject}"`,
      text: en ? 'Read it and reply if anything is still open.' : 'Lies sie und antworte, wenn noch etwas offen ist.',
      href: `#/tickets/${ticket.id}`,
      label: en ? 'Open ticket' : 'Ticket öffnen',
    });
  }

  // ------------------------------------------------------------ Minecraft-Konten
  for (const account of db
    .prepare(
      `SELECT id, name, status, last_error, suspended, suspend_reason FROM mc_accounts
        WHERE user_id = ? AND (status = 'error' OR suspended = 1) ORDER BY name COLLATE NOCASE`
    )
    .all(user.id)) {
    if (account.suspended) {
      add({
        key: `account-suspended-${account.id}`,
        kind: 'bad',
        title: en ? `Account "${account.name}" is suspended` : `Konto „${account.name}" ist stillgelegt`,
        text:
          account.suspend_reason ||
          (en ? 'It cannot start until support clears it.' : 'Es startet nicht, bis der Support es freigibt.'),
        href: '#/tickets',
        label: en ? 'Ask support' : 'Support fragen',
      });
      continue;
    }
    // Der genaue Fehler steht in `last_error` – aber in der Sprache, in der er entstanden ist,
    // und das ist nicht unbedingt die des Kunden. Hier steht deshalb, **was zu tun ist**; warum,
    // sagt die Kontenliste einen Klick weiter, und dort steht der Fehler im Wortlaut.
    add({
      key: `account-broken-${account.id}`,
      kind: 'warn',
      title: en ? `Reconnect "${account.name}"` : `„${account.name}" neu verbinden`,
      text: en
        ? 'The stored Microsoft sign-in no longer works, so this account cannot start.'
        : 'Die gespeicherte Microsoft-Anmeldung geht nicht mehr – so startet dieses Konto nicht.',
      href: '#/accounts',
      label: en ? 'Reconnect' : 'Neu verbinden',
    });
  }

  // ------------------------------------------------------------ Konto
  //
  // Nur, wenn Post überhaupt eingerichtet ist: Ohne SMTP gibt es keinen Bestätigungslink, und ein
  // To-Do, das niemand erledigen kann, ist keines.
  if (!user.email_verified && mail.configured()) {
    add({
      key: 'email-unverified',
      kind: 'warn',
      title: en ? 'Confirm your email address' : 'E-Mail-Adresse bestätigen',
      text: en
        ? 'Without it we cannot reach you – not for a password reset either.'
        : 'Ohne sie erreichen wir dich nicht – auch nicht beim Zurücksetzen des Passworts.',
      // Der Knopf zum erneuten Verschicken steht auf der Bestätigungsseite, nicht im Dashboard –
      // dorthin führt dieser Eintrag deshalb direkt.
      href: `/${en ? 'en' : 'de'}/verify`,
      label: en ? 'Send again' : 'Erneut schicken',
    });
  }

  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}
