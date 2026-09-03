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
import { config } from './config.js';
import * as billing from './billing.js';
import * as mail from './mail.js';
import * as binaries from './binaries.js';
import * as nodes from './nodes.js';
import { formatCredits, formatDay, formatEuro, safeUrl } from './util.js';

const RANK = { bad: 0, warn: 1, info: 2 };

// Zahl und Datum kommen aus util.js: Diese Liste wird bei **jedem** `/me` neu gebaut, und das
// Panel holt `/me` bei jedem Zustandswechsel. Ein `toLocaleString` je Eintrag baute dafür jedes
// Mal einen frischen `Intl`-Formatierer – siehe die Erklärung bei `intl` in util.js.

/** Eine Zahl mit Tausenderpunkt – dieselbe Schreibweise wie sonst im Panel. */
const number = (value, lang) => formatCredits(value, lang);

/** Ein Datum ohne Uhrzeit. Auf den Tag genau reicht für alles, was hier steht. */
const day = (timestamp, lang) => formatDay(timestamp, lang);

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
        title: en ? `"${name}" is locked` : `„${name}“ ist gesperrt`,
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
        title: en ? `"${name}" is suspended` : `„${name}“ ist stillgelegt`,
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
            : `Der Gratis-Serverplatz („${name}“) läuft nur, solange ein verknüpftes Discord-Konto Mitglied auf unserem Server ist.`,
          href: '#/settings',
          label: en ? 'Link now' : 'Jetzt verknüpfen',
        });
      } else if (access.reason === 'discord-join') {
        // Beitreten geht nur dort, wo der Server ist – deshalb der Einladungslink, wenn einer
        // hinterlegt ist. Ohne ihn bleibt der Weg über die Einstellungen.
        // Geprüft: Der Wert kommt aus den Einstellungen und wird gleich zum `href` eines Knopfes.
        const invite = safeUrl(getSetting('discord_invite')) || '';
        add({
          key: 'free-discord-join',
          kind: 'bad',
          title: en ? 'Join the AFKSystems Discord' : 'Dem AFKSystems-Discord beitreten',
          text: en
            ? `Your Discord account is linked but not a member. Without it the free slot ("${name}") stays off.`
            : `Dein Discord-Konto ist verknüpft, aber kein Mitglied. Ohne das bleibt der Gratis-Platz („${name}“) aus.`,
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
        title: en ? `"${name}" will not renew` : `„${name}“ wird nicht verlängert`,
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
          : `„${name}“ wird in ${daysLeft} Tag(en) verlängert`,
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
    // Auch stillgelegte Plätze fallen heraus: Dort steht oben schon "die Bots sind aus", und
    // "ordne ein Konto zu, dann kann der Bot starten" wäre daneben schlicht falsch – er kann nicht.
    if (profile.members || profile.locked || profile.suspended) continue;
    add({
      key: `profile-empty-${profile.id}`,
      kind: 'info',
      title: en ? `"${profile.name}" has no account yet` : `„${profile.name}“ hat noch kein Konto`,
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
    const recommendedLow = Number(getSetting('low_balance')) || 0;
    const low =
      Number.isInteger(user.low_balance_warning) && user.low_balance_warning >= 0
        ? user.low_balance_warning
        : recommendedLow;
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

  // Eine offene Überweisung wartet auf den Kunden – bei Stripe wartet sie auf niemanden, dort
  // führt der Weg über die Bezahlseite, und läuft die ab, räumt der Webhook die Aufladung weg.
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
        : `Nimm „${topup.reference}“ als Verwendungszweck, sonst lässt sie sich nicht zuordnen. Gutgeschrieben wird, sobald sie da ist.`,
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
      title: en ? `Support answered: "${ticket.subject}"` : `Antwort im Support: „${ticket.subject}“`,
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
        title: en ? `Account "${account.name}" is suspended` : `Konto „${account.name}“ ist stillgelegt`,
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
      title: en ? `Reconnect "${account.name}"` : `„${account.name}“ neu verbinden`,
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

/**
 * Was das **Team** gerade zu tun hat.
 *
 * Dieselben drei Regeln wie oben, nur für die andere Seite des Schreibtisches: Es muss etwas zu tun
 * sein, es muss klar sein was, und es muss den Betrieb betreffen. „Alles läuft“ steht deshalb auch
 * hier nirgends – was nicht dasteht, ist in Ordnung.
 *
 * Der Unterschied zur Kundenliste: Diese hier zählt Warteschlangen (offene Tickets, unbestätigte
 * Zahlungen) und Zustände der Anlage (ein Standort ohne Verbindung, ein fehlender Client, eine
 * Post, die nicht rausgeht). Sie hängt an keinem einzelnen Konto und ist für jeden Administrator
 * dieselbe.
 */
export function staffTodos(lang = 'en') {
  const en = lang === 'en';
  const out = [];
  const add = (entry) => out.push(entry);
  const now = Date.now();

  // ------------------------------------------------------------ Support
  //
  // Gezählt wird der Zustand, nicht der Ungelesen-Punkt: Ein Ticket, das jemand aufgemacht und
  // wieder zugeklappt hat, ohne zu antworten, verschwand vorher aus dieser Liste, obwohl die
  // Antwort weiter ausstand. Beantwortete und geschlossene Tickets stehen hier gar nicht erst.
  const waiting = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'").get().n;
  if (waiting) {
    const urgent = db
      .prepare(
        "SELECT COUNT(*) AS n FROM tickets WHERE status = 'open' AND priority IN ('high','urgent')"
      )
      .get().n;
    add({
      key: 'staff-tickets',
      kind: urgent ? 'bad' : 'warn',
      title: en
        ? `${waiting} ticket(s) waiting for an answer`
        : `${waiting} Ticket(s) warten auf eine Antwort`,
      text: urgent
        ? en
          ? `${urgent} of them are marked high or urgent.`
          : `${urgent} davon stehen auf hoch oder dringend.`
        : en
          ? 'They are with us: the customer wrote last.'
          : 'Sie liegen bei uns: zuletzt hat der Kunde geschrieben.',
      href: '#/admin/tickets',
      label: en ? 'Open tickets' : 'Tickets öffnen',
    });
  }

  // Ein Ticket, das seit Tagen offensteht, ist etwas anderes als eines von heute Morgen.
  const stale = db
    .prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open' AND updated_at < ?")
    .get(now - 3 * 86_400_000).n;
  if (stale) {
    add({
      key: 'staff-tickets-stale',
      kind: 'bad',
      title: en ? `${stale} ticket(s) older than three days` : `${stale} Ticket(s) älter als drei Tage`,
      text: en
        ? 'They are still waiting for a first reply.'
        : 'Sie warten immer noch auf die erste Antwort.',
      href: '#/admin/tickets?status=open',
      label: en ? 'Look at them' : 'Ansehen',
    });
  }

  // ------------------------------------------------------------ Geld
  //
  // Eine Überweisung, die eingegangen ist, sieht das Panel nicht – sie muss ein Mensch bestätigen.
  // Bis dahin wartet der Kunde auf Guthaben, das er längst bezahlt hat.
  const open = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount_cent), 0) AS cent FROM topups WHERE status = 'open' AND provider IN ('transfer','paypal')"
    )
    .get();
  if (open.n) {
    add({
      key: 'staff-topups',
      kind: 'warn',
      title: en
        ? `${open.n} payment(s) waiting to be confirmed`
        : `${open.n} Zahlung(en) warten auf die Bestätigung`,
      text: en
        ? `${formatEuro(open.cent, 'en')} all told. Until somebody confirms them, the customers have no credits.`
        : `${formatEuro(open.cent, 'de')} insgesamt. Bis das jemand bestätigt, haben die Kunden kein Guthaben.`,
      href: '#/admin/topups',
      label: en ? 'Confirm' : 'Bestätigen',
    });
  }

  const disputed = db
    .prepare("SELECT COUNT(*) AS n FROM topups WHERE status = 'refunded' AND paid_at > ?")
    .get(now - 30 * 86_400_000).n;
  if (disputed) {
    add({
      key: 'staff-refunds',
      kind: 'info',
      title: en ? `${disputed} refund(s) in the last 30 days` : `${disputed} Rückerstattung(en) in 30 Tagen`,
      text: en
        ? 'Worth a look if that is more than usual.'
        : 'Einen Blick wert, wenn das mehr ist als sonst.',
      href: '#/admin/topups',
      label: en ? 'Top-ups' : 'Aufladungen',
    });
  }

  // ------------------------------------------------------------ Kunden
  const blocked = db.prepare('SELECT COUNT(*) AS n FROM users WHERE blocked = 1').get().n;
  if (blocked) {
    add({
      key: 'staff-blocked',
      kind: 'info',
      title: en ? `${blocked} account(s) are blocked` : `${blocked} Konto/Konten sind gesperrt`,
      text: en
        ? 'A blocked account cannot log in. Check whether the reason still holds.'
        : 'Ein gesperrtes Konto kommt nicht mehr herein. Prüfen, ob der Grund noch gilt.',
      href: '#/admin/users?filter=blocked',
      label: en ? 'Accounts' : 'Konten',
    });
  }

  const lockedSlots = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE locked = 1').get().n;
  if (lockedSlots) {
    add({
      key: 'staff-locked',
      kind: 'warn',
      title: en ? `${lockedSlots} server slot(s) are locked` : `${lockedSlots} Serverplatz/-plätze sind gesperrt`,
      text: en
        ? 'Their bots are off and the customer cannot change anything.'
        : 'Ihre Bots sind aus, und der Kunde kann nichts mehr ändern.',
      href: '#/admin/servers',
      label: en ? 'Server slots' : 'Serverplätze',
    });
  }

  // ------------------------------------------------------------ Anlage
  if (binaries.state.error) {
    add({
      key: 'staff-client',
      kind: 'bad',
      title: en ? 'The client files have a problem' : 'Mit den Client-Dateien stimmt etwas nicht',
      text: binaries.state.error,
      href: '#/admin/client',
      label: en ? 'Sync the client' : 'Client abgleichen',
    });
  }

  for (const node of nodes.list({ includeInactive: false })) {
    if (node.kind !== 'agent' || nodes.reachable(node)) continue;
    add({
      key: `staff-node-${node.id}`,
      kind: 'bad',
      title: en ? `Location "${node.name}" is not answering` : `Standort „${node.name}“ meldet sich nicht`,
      text: en
        ? 'Bots that belong there are not running. They come back on their own once it does.'
        : 'Die Bots, die dorthin gehören, laufen nicht. Sie kommen von selbst zurück, sobald er wieder da ist.',
      href: '#/admin/nodes',
      label: en ? 'Locations' : 'Standorte',
    });
  }

  if (!mail.configured()) {
    add({
      key: 'staff-mail',
      kind: 'warn',
      title: en ? 'No mail server set up' : 'Es ist kein Mailserver eingerichtet',
      text: en
        ? 'Without it there is no password reset and no confirmation link.'
        : 'Ohne ihn gibt es kein Zurücksetzen des Passworts und keinen Bestätigungslink.',
      href: '#/admin/settings',
      label: en ? 'Settings' : 'Einstellungen',
    });
  } else {
    const failed = db
      .prepare("SELECT COUNT(*) AS n FROM mails WHERE status = 'failed' AND created_at > ?")
      .get(now - 86_400_000).n;
    if (failed) {
      add({
        key: 'staff-mail-failed',
        kind: 'warn',
        title: en ? `${failed} email(s) did not go out` : `${failed} E-Mail(s) gingen nicht raus`,
        text: en
          ? 'In the last 24 hours. The exact reason is with the message.'
          : 'In den letzten 24 Stunden. Der genaue Grund steht an der Nachricht.',
        href: '#/admin/mails',
        label: en ? 'Mail log' : 'Postausgang',
      });
    }
  }

  if (Number(getSetting('maintenance'))) {
    add({
      key: 'staff-maintenance',
      kind: 'warn',
      title: en ? 'Maintenance mode is on' : 'Der Wartungsmodus ist an',
      text: en
        ? 'Everyone but administrators sees a notice instead of the site.'
        : 'Alle außer Administratoren sehen einen Hinweis statt der Website.',
      href: '#/admin/settings',
      label: en ? 'Switch it off' : 'Ausschalten',
    });
  }

  // Der Gratis-Tarif hängt an einer Discord-Server-ID. Fehlt sie, startet kein Gratis-Platz mehr –
  // und der Grund steht an keiner Stelle, an der jemand von selbst nachsieht.
  if (!billing.freeGuildId() && db.prepare('SELECT 1 FROM plans WHERE free_slot = 1 AND active = 1').get()) {
    add({
      key: 'staff-free-guild',
      kind: 'bad',
      title: en ? 'The free plan has no Discord server' : 'Dem Gratis-Tarif fehlt der Discord-Server',
      text: en
        ? 'Without a guild ID no free server slot can start – membership cannot be checked.'
        : 'Ohne Server-ID startet kein Gratis-Serverplatz – die Mitgliedschaft lässt sich nicht prüfen.',
      href: '#/admin/settings',
      label: en ? 'Settings' : 'Einstellungen',
    });
  }

  // Ein selbst geschriebener Rechtstext, der noch den alten Zahlungsanbieter nennt, ist keine
  // Formsache: In der Datenschutzerklärung steht dann ein Empfänger, an den nichts mehr geht, und
  // der wirkliche fehlt. Überschrieben wird hier trotzdem nichts – wer seinen Text selbst
  // geschrieben hat, soll ihn auch selbst ändern. Die Systemvorgabe ist längst umgestellt und
  // fällt deshalb nicht in diese Prüfung.
  const staleLegal = ['legal_privacy', 'legal_privacy_en', 'legal_terms', 'legal_terms_en'].filter(
    (key) => /tebex/i.test(String(getSetting(key) || ''))
  );
  if (staleLegal.length) {
    add({
      key: 'staff-legal-provider',
      kind: 'warn',
      title: en
        ? 'The legal texts still name the old payment provider'
        : 'Die Rechtstexte nennen noch den alten Zahlungsanbieter',
      text: en
        ? 'Payments run through Stripe, and AFKSystems is the seller now. Privacy notice and terms have to say so.'
        : 'Bezahlt wird über Stripe, und Verkäufer ist jetzt AFKSystems selbst. Datenschutz und Bedingungen müssen das sagen.',
      href: '#/admin/settings?group=legal',
      label: en ? 'Legal texts' : 'Rechtstexte',
    });
  }

  if (!safeUrl(getSetting('discord_invite'))) {
    add({
      key: 'staff-invite',
      kind: 'info',
      title: en ? 'No Discord invite link stored' : 'Es ist kein Discord-Einladungslink hinterlegt',
      text: en
        ? `Customers who need to join ${config.brand}'s Discord for the free slot have nowhere to click.`
        : `Kunden, die für den Gratis-Platz in den ${config.brand}-Discord müssen, haben nichts zum Anklicken.`,
      href: '#/admin/settings',
      label: en ? 'Settings' : 'Einstellungen',
    });
  }

  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}
