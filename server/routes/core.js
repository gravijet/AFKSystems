// Anmeldung, eigenes Konto, Minecraft-Konten, Proxys, Tickets und die Metadaten fürs Frontend.

import express from 'express';
import { config } from '../config.js';
import { db, getSetting, audit } from '../db.js';
import * as auth from '../auth.js';
import * as mslogin from '../mslogin.js';
import * as binaries from '../binaries.js';
import * as notify from '../notify.js';
import * as mail from '../mail.js';
import * as oauth from '../oauth.js';
import * as tickets from '../tickets.js';
import { todosFor } from '../todos.js';
import * as attachments from '../attachments.js';
import * as nodes from '../nodes.js';
import * as heads from '../heads.js';
import { features } from '../features.js';
import { actionsFor, eventsFor } from '../macros.js';
import { supervisor } from '../supervisor.js';
import * as billing from '../billing.js';
import * as stripe from '../stripe.js';
import * as vat from '../vat.js';
import * as security from '../security.js';
import * as logincode from '../logincode.js';
import * as totp from '../totp.js';
import * as profile from '../profile.js';
import * as account from '../account.js';
import * as roles from '../roles.js';
import { setLangCookie, t } from '../pages.js';
import { bridge } from '../bridge.js';
import { wrap, requireInt, requireString, bad, notFound, forbidden, token, HttpError, langOf, safeUrl } from '../util.js';

export const router = express.Router();

/** Sprache dieser Anfrage – bestimmt, in welcher Sprache Listen zurückkommen. */

// ---------------------------------------------------------------- Metadaten

/** Nur die sichtbaren Ankündigungen, bereits in der Sprache dieser Anfrage. */
function visibleAnnouncements(lang) {
  return db
    .prepare('SELECT * FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 5')
    .all()
    .map((row) => announcementView(row, lang));
}

router.get(
  '/meta',
  wrap((req, res) => {
    const lang = langOf(req);
    const registrationOpen = Boolean(Number(getSetting('registration_open'))) && config.registrationOpen;
    // Die öffentliche Kopfleiste braucht weder Tarife noch Client-Fähigkeiten oder sämtliche
    // Funktionsbeschreibungen. Diese kleine Antwort wird zudem erst in einer ruhigen Browserphase
    // geholt und vermeidet auf der Startseite den größten JSON-Transfer vollständig.
    if (req.query.scope === 'header') {
      return res.json({
        // Die Kopfleiste fragt nur „angemeldet?“. Die vollständige Kontodarstellung würde hierfür
        // Guthaben, Profil, Mail-Einstellungen und Discord-Zustand unnötig neu berechnen.
        user: req.user ? { id: req.user.id } : null,
        registration_open: registrationOpen,
      });
    }
    // Anmelde-, Registrierungs- und Wiederherstellungsseiten brauchen nur diese vier Werte. Vor
    // allem die Tarif- und Macro-Beschreibungen der vollständigen Panel-Antwort gehören nicht auf
    // den kritischen Weg eines Passwortformulars.
    if (req.query.scope === 'auth') {
      return res.json({
        registration_open: registrationOpen,
        mail_ready: mail.configured(),
        oauth: oauth.state(),
        user: req.user ? auth.publicUser(req.user) : null,
      });
    }
    // Für das erste Bild im Panel reichen die zwei Dinge, die im Rahmen selbst vorkommen. Die
    // vollständige Antwort enthält zusätzlich Tarife, Zusätze, Client-Fähigkeiten, Macro-Felder,
    // Zahlungswege und Mail-Kategorien. Das alles schon für die Übersicht zu berechnen, als JSON
    // zu übertragen und im Browser zu parsen war Arbeit für Bedienelemente, die dort nicht stehen.
    // app.js holt die vollständige Fassung erst vor einer Ansicht, die sie tatsächlich benutzt.
    if (req.query.scope === 'panel') {
      return res.json({
        discord_invite: safeUrl(getSetting('discord_invite')) || '',
        announcements: visibleAnnouncements(lang),
      });
    }
    const caps = binaries.anyCaps();
    res.json({
      brand: config.brand,
      lang,
      registration_open: registrationOpen,
      email_verify: mail.verifyRequired(),
      mail_ready: mail.configured(),
      oauth: oauth.state(),
      // Geprüft, nicht roh: Der Einladungslink kommt aus den Einstellungen und landet im Panel
      // unmaskiert in einem `href` (Seitenleiste, Support, Einstellungen). `javascript:…` braucht
      // dafür kein Anführungszeichen – genau wie auf den öffentlichen Seiten (landing.js) gilt
      // deshalb: was nicht wie eine Adresse aussieht, ist kein Einladungslink.
      discord_invite: safeUrl(getSetting('discord_invite')) || '',
      free_plan: {
        guild_id: billing.freeGuildId(),
        invite: safeUrl(getSetting('discord_invite')) || '',
      },
      maintenance: Boolean(Number(getSetting('maintenance'))),
      maintenance_text: String(getSetting('maintenance_text') || ''),
      // Alle sichtbaren Ankündigungen, neueste zuerst. Bisher kam nur eine mit – gab es zwei,
      // sah niemand die zweite, und im Panel stand nirgends, dass es sie überhaupt gibt.
      announcements: visibleAnnouncements(lang),
      versions: binaries.state.versions,
      default_version: binaries.state.defaultVersion,
      client_version: binaries.state.clientVersion,
      caps,
      builds: Object.fromEntries(
        Object.entries(binaries.state.builds).map(([key, entry]) => [key, entry.present])
      ),
      features: features(caps, lang),
      actions: actionsFor(lang),
      events: eventsFor(lang),
      plans: billing.plans().map((plan) => planView(plan, lang)),
      addons: billing.addons().map((addon) => addonView(addon, lang, caps)),
      free_slots: billing.freeSlots(),
      month_days: billing.MONTH_DAYS,
      packages: billing.packages(),
      mail_categories: mail.categoriesFor(lang),
      low_balance: Number(getSetting('low_balance')),
      signup_bonus: Number(getSetting('signup_bonus')),
      // Wie lange zwischen "löschen" und "gelöscht" liegt. Die Zahl steht im Panel in demselben
      // Satz, in dem der Kunde die Löschung beantragt – sie darf deshalb nicht dort noch einmal
      // hingeschrieben werden, sondern kommt von der Stelle, die sie auch anwendet.
      delete_grace_days: account.GRACE_DAYS,
      // Die Zeitzone dieses Servers. Sie gilt für jeden, der keine eigene eingetragen hat – und
      // steht deshalb im Panel dabei: „nicht gesetzt“ ist keine Auskunft darüber, was dann gilt.
      // Raten kann der Browser das nicht; er kennt nur seine eigene.
      server_timezone: profile.timezoneOf(null),
      support_hours: String(getSetting('support_hours') || ''),
      support_email: String(getSetting('support_email') || ''),
      payment: {
        stripe: stripe.configured(),
        transfer: Boolean(config.bankTransfer.iban),
        paypal: Boolean(config.bankTransfer.paypal),
        voucher: true,
      },
      vat: vat.view(lang),
      user: req.user ? auth.publicUser(req.user) : null,
    });
  })
);

export function planView(plan, lang = 'en') {
  return {
    id: plan.id,
    slug: plan.slug,
    name: lang === 'de' ? plan.name_de : plan.name_en,
    blurb: lang === 'de' ? plan.blurb_de : plan.blurb_en,
    // Der Wortlaut der Merkmalsliste, wenn der Betreiber einen hinterlegt hat – eine Zeile je
    // Punkt. Sonst leer, und das Panel baut die Liste wie bisher aus den Zahlen.
    features: String((lang === 'de' ? plan.features_de : plan.features_en) || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    price_credits: plan.price_credits,
    price_euro: (plan.price_credits / 100).toFixed(2),
    free_slot: Boolean(plan.free_slot),
    max_accounts: plan.max_accounts,
    premium: Boolean(plan.premium),
    movement: Boolean(plan.movement),
    proxy: Boolean(plan.proxy),
    offline_accounts: Boolean(plan.offline_accounts),
    fakehost: Boolean(plan.fakehost),
    chat_limit: plan.chat_limit,
    chat_limit_editable: Boolean(plan.chat_limit_editable),
    priority_support: Boolean(plan.priority_support),
    board: Boolean(plan.board),
    menus: Boolean(plan.menus),
    pov: Boolean(plan.pov),
    max_macros: plan.max_macros,
    addons: Boolean(plan.addons),
    highlight: Boolean(plan.highlight),
    active: Boolean(plan.active),
  };
}

/** Ein Zusatz, wie ihn das Panel zeigt. `caps` sagt, ob der Client das überhaupt kann. */
export function addonView(addon, lang = 'en', caps = {}) {
  return {
    id: addon.id,
    key: addon.key,
    name: lang === 'de' ? addon.name_de : addon.name_en,
    text: lang === 'de' ? addon.text_de : addon.text_en,
    price_credits: addon.price_credits,
    price_euro: (addon.price_credits / 100).toFixed(2),
    kind: addon.kind,
    flag: addon.flag,
    amount: addon.amount,
    max_qty: addon.max_qty,
    // Ohne die passende Fähigkeit im Client wäre es ein Knopf, der nichts einlöst.
    available: Boolean(addon.available) && (!addon.need_cap || Boolean(caps[addon.need_cap])),
    announced: !addon.available,
  };
}

export function announcementView(row, lang = 'en') {
  return {
    id: row.id,
    title: lang === 'de' ? row.title_de : row.title_en,
    body: lang === 'de' ? row.body_de : row.body_en,
    kind: row.kind,
    link: row.link || '',
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------- Anmeldung

router.post(
  '/auth/register',
  wrap((req, res) => {
    if (!Number(getSetting('registration_open')) || !config.registrationOpen) {
      throw bad('Die Registrierung ist gerade geschlossen.', { en: 'Registration is closed at the moment.' });
    }
    const user = auth.register({ ...(req.body || {}), language: langOf(req) });
    const pending = mail.verifyRequired() && !user.email_verified;
    // Der Browser, in dem ein Konto entsteht, ist ihm bekannt – alles andere wäre grotesk: Ein
    // Anmeldecode für ein Konto, das in diesem Fenster gerade angelegt wurde.
    if (!pending) signIn(res, user, req, 'register');
    setLangCookie(res, user.language);
    res.json({ user: auth.publicUser(user), verify_pending: pending });
  })
);

/**
 * Eine geglückte Anmeldung abschließen – von wo auch immer sie kam.
 *
 * Fünf Anmeldewege enden hier: Passwort, Anmeldecode, Discord, Google und der Bestätigungslink
 * aus der Registrierungsmail. Jeder von ihnen muss dasselbe tun – Sitzung anlegen, den Browser als
 * bekannt merken, es aufschreiben –, und jeder von ihnen hat es vorher einzeln getan. Eine
 * vergessene Zeile in einem der fünf wäre nicht aufgefallen: Der Weg funktioniert ja, er merkt
 * sich nur das Gerät nicht, und der Kunde bekommt fortan bei jeder Anmeldung einen Code.
 *
 * `how` ist der Eintrag im Protokoll. `null` heißt "der Aufrufer hat schon geschrieben" – nach
 * einem Passwortwechsel steht die Zeile dort bereits, und dieselbe Sache zweimal im Protokoll
 * macht es nicht genauer, sondern länger.
 */
function signIn(res, user, req, how = 'login') {
  logincode.remember(user, req, res);
  auth.createSession(res, user, req);
  if (how) audit(user.id, how, null, req.ip);
  return user;
}

router.post(
  '/auth/login',
  wrap(async (req, res) => {
    const identifier = String(req.body?.login || '').trim();
    // Zuerst nachsehen, ob hier gerade jemand Passwörter durchprobiert. Die Prüfung steht **vor**
    // auth.login, denn eine Passwortprüfung ist absichtlich teuer – wer gebremst wird, soll diese
    // Rechenzeit gar nicht erst bekommen.
    const wait = security.tooMany(req.ip, identifier);
    if (wait) {
      security.record({ ip: req.ip, identifier, ok: false, reason: 'throttled' });
      throw new HttpError(
        429,
        'Zu viele Fehlversuche. Bitte in einer Viertelstunde noch einmal versuchen.',
        { en: 'Too many failed attempts. Please try again in fifteen minutes.' }
      );
    }
    let user;
    try {
      user = auth.login(req.body || {});
    } catch (error) {
      // Ein Fehlversuch wird aufgeschrieben, bevor er weitergereicht wird: Sonst stünde im
      // Protokoll nur, was geklappt hat – und das ist genau die Hälfte, die niemanden warnt.
      security.record({
        ip: req.ip,
        identifier,
        ok: false,
        reason: error?.status === 403 ? 'blocked' : 'wrong',
      });
      throw error;
    }
    security.record({ ip: req.ip, identifier, ok: true });

    // **Der zweite Schritt aus der App.** Er geht dem Anmeldecode vor, und zwar immer: Wer eine
    // Authenticator-App eingerichtet hat, hat einen Faktor, der nicht am Postfach hängt. Beides
    // nacheinander abzufragen brächte keine Sicherheit dazu – der schwächere Schritt liegt schon
    // im stärkeren –, es wären nur zwei Formulare statt einem.
    //
    // Und anders als der Anmeldecode fragt er **bei jeder Anmeldung**, nicht nur bei unbekannten
    // Browsern. Ein Konto, das an bekannten Geräten nur nach dem Passwort fragt, hat einen Faktor.
    if (totp.enabled(user)) {
      const challenge = logincode.startPending(user, req, 'totp');
      return res.json({
        challenge: challenge.token,
        kind: 'totp',
        expires_at: challenge.expires_at,
        tries: logincode.MAX_TRIES,
      });
    }

    // **Der zweite Schritt, wenn dieser Browser neu ist.** Das Passwort stimmt – mehr sagt diese
    // Antwort nicht, und mehr bekommt der Aufrufer auch nicht: keine Sitzung, kein Cookie, kein
    // Konto. Zurück geht nur eine Wartemarke und die halb verdeckte Adresse, an die der Code ging.
    //
    // Kann die Nachricht nicht hinaus, schlägt die Anmeldung geschlossen fehl. Ein ausdrücklich
    // aktivierter zweiter Schritt darf bei einer Störung nicht still auf reines Passwort
    // zurückfallen; `logincode.start` entfernt die unbrauchbare Marke und liefert eine 503.
    if (logincode.required(user, req)) {
      const challenge = await logincode.start(user, req);
      // Die Nachricht über das neue Gerät bleibt hier aus. Der Code **ist** sie: Sie ginge an
      // dieselbe Adresse, im selben Moment, über denselben Vorgang – zwei Nachrichten über eine
      // Anmeldung, die noch gar nicht stattgefunden hat.
      return res.json({
        challenge: challenge.token,
        kind: 'mail',
        expires_at: challenge.expires_at,
        email_hint: challenge.hint,
        tries: logincode.MAX_TRIES,
      });
    }

    // Vor `signIn`: danach wäre dieses Gerät bekannt (siehe auth.noticeNewDevice).
    auth.noticeNewDevice(user, req);
    signIn(res, user, req);
    res.json({
      user: auth.publicUser(user),
      verify_pending: mail.verifyRequired() && !user.email_verified,
    });
  })
);

/**
 * Den Anmeldecode einlösen. Zweiter und letzter Schritt der Anmeldung.
 *
 * Die Bremse aus security.js gilt hier genauso wie beim Passwort, und zwar über die Adresse: Die
 * Marke selbst zählt ihre fünf Versuche mit und verfällt danach, aber wer beliebig viele Marken
 * beschaffen kann (er kennt ja das Passwort), hätte sonst beliebig viele Fünferpakete. Der
 * Verbrauch steht deshalb im selben Protokoll wie die Passwortversuche.
 */
router.post(
  '/auth/login/code',
  wrap((req, res) => {
    // Die Adresse **vor** allem anderen holen: Ein geglückter Versuch nimmt die Marke mit, ein
    // fünfter Fehlversuch auch – danach gäbe es nichts mehr, woran sich Bremse und Protokolleintrag
    // festmachen ließen. Und mit ihr gilt hier dieselbe Bremse wie beim Passwort, in beiden
    // Richtungen: je Adresse **und** je Konto.
    const identifier = logincode.identifierFor(req.body?.challenge);
    if (security.tooMany(req.ip, identifier)) {
      security.record({ ip: req.ip, identifier, ok: false, reason: 'throttled' });
      throw new HttpError(429, 'Zu viele Fehlversuche. Bitte in einer Viertelstunde noch einmal versuchen.', {
        en: 'Too many failed attempts. Please try again in fifteen minutes.',
      });
    }
    let user;
    try {
      user = logincode.redeem(req.body?.challenge, req.body?.code);
    } catch (error) {
      security.record({ ip: req.ip, identifier, ok: false, reason: 'code' });
      throw error;
    }
    security.record({ ip: req.ip, identifier, ok: true, reason: 'code' });
    // Erst jetzt gilt die Anmeldung – und erst jetzt wird dieser Browser bekannt. Ab dem nächsten
    // Mal geht es hier ohne Code weiter, bis ihn jemand in den Einstellungen wieder vergisst.
    signIn(res, user, req, 'login-code');
    res.json({
      user: auth.publicUser(user),
      verify_pending: mail.verifyRequired() && !user.email_verified,
    });
  })
);

/**
 * Den zweiten Faktor einlösen – sechs Ziffern aus der App oder ein Wiederherstellungscode.
 *
 * Derselbe Aufbau wie beim Anmeldecode, und aus denselben Gründen: Die Marke allein ist keine
 * Anmeldung, sie zählt ihre fünf Versuche mit, und der Verbrauch steht im selben Protokoll wie
 * die Passwortversuche. Wer beliebig viele Marken beschaffen kann (er kennt ja das Passwort),
 * hätte sonst beliebig viele Fünferpakete.
 *
 * Ein **Wiederherstellungscode** wird hier genauso eingelöst wie ein Code aus der App. Er ist der
 * Weg für ein verlorenes Telefon, und ein Weg, der nur mit Hilfe eines Administrators funktioniert,
 * macht den Administrator zum zweiten Faktor.
 */
router.post(
  '/auth/login/totp',
  wrap((req, res) => {
    // Beim Anmelden mit Passwort steht die Marke im Rumpf. Kommt der Kunde von Discord oder
    // Google zurück, gab es dort keinen Rumpf – dann liegt sie in einem kurzlebigen Cookie.
    // **Nicht in der Adresse:** Die steht im Verlauf, im Referrer und in jedem Proxy-Protokoll.
    const marker = String(req.body?.challenge || '') || auth.readCookie(req, LOGIN_COOKIE) || '';
    const identifier = logincode.identifierFor(marker, 'totp');
    if (security.tooMany(req.ip, identifier)) {
      security.record({ ip: req.ip, identifier, ok: false, reason: 'throttled' });
      throw new HttpError(429, 'Zu viele Fehlversuche. Bitte in einer Viertelstunde noch einmal versuchen.', {
        en: 'Too many failed attempts. Please try again in fifteen minutes.',
      });
    }

    const expired = () =>
      new HttpError(410, 'Diese Anmeldung gilt nicht mehr. Bitte noch einmal anfangen.', {
        en: 'This sign-in is no longer valid. Please start again.',
        code: 'login-code-expired',
      });

    const user = logincode.pendingUser(marker, 'totp');
    if (!user) throw expired();
    // Zwischen dem Passwort und dem Code liegen Minuten. In dieser Zeit kann ein Konto gesperrt
    // worden sein – dann ist der richtige Code die richtige Antwort auf eine Frage, die niemand
    // mehr stellt.
    if (user.blocked) {
      throw new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' });
    }

    // Der Zähler steht **vor** der Prüfung: Wer abbricht, weil ihm das Ergebnis nicht gefällt,
    // hat seinen Versuch trotzdem verbraucht.
    const left = logincode.countTry(marker, 'totp');
    if (left === null) throw expired();

    const result = totp.verify(user, req.body?.code, req.ip);
    if (!result) {
      security.record({ ip: req.ip, identifier, ok: false, reason: 'totp' });
      if (left <= 0) {
        logincode.finishPending(marker, 'totp');
        res.clearCookie(LOGIN_COOKIE, { path: '/api/auth' });
        throw expired();
      }
      throw bad(`Dieser Code stimmt nicht. Noch ${left} Versuch(e).`, {
        en: `That code is wrong. ${left} attempt(s) left.`,
        code: 'totp-wrong',
      });
    }

    logincode.finishPending(marker, 'totp');
    res.clearCookie(LOGIN_COOKIE, { path: '/api/auth' });
    security.record({ ip: req.ip, identifier, ok: true, reason: 'totp' });
    signIn(res, user, req, result.kind === 'recovery' ? 'login-totp-recovery' : 'login-totp');
    res.json({
      user: auth.publicUser(user),
      verify_pending: mail.verifyRequired() && !user.email_verified,
      // Wer einen Wiederherstellungscode verbraucht hat, soll erfahren, wie viele noch da sind –
      // sonst merkt er es erst, wenn keiner mehr übrig ist.
      recovery_used: result.kind === 'recovery',
      recovery_left: result.kind === 'recovery' ? result.left : null,
    });
  })
);

/** Noch einmal schicken – dieselbe Marke, ein frischer Code, dieselbe Frist. */
router.post(
  '/auth/login/code/resend',
  wrap(async (req, res) => {
    const result = await logincode.resend(req.body?.challenge);
    res.json({ ok: true, expires_at: result.expires_at, email_hint: result.hint });
  })
);

router.post(
  '/auth/logout',
  wrap((req, res) => {
    auth.destroySession(req, res);
    res.json({ ok: true });
  })
);

router.post(
  '/auth/verify',
  wrap((req, res) => {
    const user = auth.verifyEmail(req.body?.token);
    if (!user) throw bad('Dieser Link gilt nicht mehr.', { en: 'This link is no longer valid.', code: 'verify-invalid' });

    // **Auch dieser Weg ist eine Anmeldung.** Er ist damit dieselbe Tür wie das Anmeldeformular
    // (siehe die Sperrprüfung in `verifyEmail`) – und wer einen zweiten Faktor eingeschaltet hat,
    // hat gesagt, dass durch diese Tür niemand ohne das Gerät kommt. Ein Bestätigungslink, der
    // daran vorbeiführte, wäre der Weg vorbei, den ein Postfachzugang eröffnet, und genau den
    // soll die Zwei-Faktor-Anmeldung schließen. Die Adresse ist trotzdem bestätigt: Das ist die
    // Auskunft dieses Links, und die hängt nicht am zweiten Faktor.
    if (totp.enabled(user)) {
      const challenge = logincode.startPending(user, req, 'totp');
      res.cookie(LOGIN_COOKIE, challenge.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.publicUrl.startsWith('https'),
        maxAge: logincode.CODE_MS,
        path: '/api/auth',
      });
      return res.json({ verified: true, totp: true, lang: user.language || langOf(req) });
    }

    // Wer diesen Link öffnet, hat das Postfach – also genau das, wonach der Anmeldecode fragt.
    // Ein Code obendrauf wäre dieselbe Frage ein zweites Mal.
    signIn(res, user, req, 'login-verify');
    res.json({ user: auth.publicUser(user) });
  })
);

router.post(
  '/auth/verify/resend',
  wrap(async (req, res) => {
    if (!req.user) throw new HttpError(401, 'Bitte anmelden.', { en: 'Please log in.' });
    const result = await auth.resendVerification(req.user);
    if (result && result.ok === false) {
      throw bad(`E-Mail ließ sich nicht verschicken: ${result.error}`, {
        en: `The email could not be sent: ${result.error}`,
      });
    }
    res.json({ ok: true });
  })
);

router.post(
  '/auth/forgot',
  wrap(async (req, res) => {
    if (!mail.configured()) {
      throw bad('Das Zurücksetzen per E-Mail ist hier nicht eingerichtet.', {
        en: 'Password reset by email is not set up on this server.',
      });
    }
    await auth.requestReset(req.body?.email);
    res.json({ ok: true });
  })
);

router.post(
  '/auth/reset',
  wrap((req, res) => {
    auth.applyReset(req.body?.token, req.body?.password, req.body?.password2, req.body?.code);
    res.json({ ok: true });
  })
);

/**
 * Zurück aus "Als Nutzer ansehen". Die geliehene Sitzung wird gelöscht und das Cookie wieder auf
 * die eigene Admin-Sitzung gesetzt – deshalb steht das hier und nicht im Admin-Bereich: wer sich
 * gerade als Nutzer ansieht, ist in diesem Moment kein Admin.
 */
router.post(
  '/auth/return',
  wrap((req, res) => {
    if (!auth.returnToImpersonator(req, res)) {
      throw bad('Diese Sitzung wurde nicht von einem Administrator geöffnet.', {
        en: 'This session was not opened by an administrator.',
      });
    }
    res.json({ ok: true });
  })
);

// ------------------------------------------------ Discord und Google
//
// Drei Wege, ein Ablauf: `link` verknüpft ein fremdes Konto mit dem hiesigen, `login` meldet an
// (und legt beim ersten Mal ein Konto an), `verify` schreibt die Werte für Discords Linked Roles.

const PROVIDER = /^(discord|google)$/;

/** Das Merkmal, das Start und Rückweg einer Anmeldung an denselben Browser bindet. */
const OAUTH_COOKIE = 'afk_oauth';

/**
 * Die halbfertige Anmeldung, wenn nach Discord oder Google noch der zweite Faktor fehlt.
 *
 * Beim Anmelden mit Passwort reist die Wartemarke im Rumpf der Antwort. Von einem Anbieter kommt
 * der Kunde aber über eine Weiterleitung zurück, und da gibt es keinen Rumpf. Die Marke in die
 * Adresse zu hängen wäre der naheliegende Weg und der falsche: Adressen stehen im Verlauf des
 * Browsers, im Referrer der nächsten Anfrage und in jedem Protokoll dazwischen.
 *
 * Das Cookie ist **kein Zugang**. Es sagt „das Passwort bzw. der Anbieter war in Ordnung“ und
 * nichts weiter; ohne den Code aus der App öffnet es gar nichts, es gilt fünfzehn Minuten, und
 * eingelöst wird es genau einmal.
 */
const LOGIN_COOKIE = 'afk_login';

router.get(
  '/auth/:provider/start',
  wrap((req, res) => {
    if (!PROVIDER.test(req.params.provider)) throw notFound('Unbekannter Anbieter.', { en: 'Unknown provider.' });
    const mode = ['login', 'verify'].includes(req.query.mode) ? req.query.mode : 'link';
    if (mode !== 'login' && !req.user) {
      throw new HttpError(401, 'Bitte anmelden.', { en: 'Please log in.' });
    }
    // Ein Merkmal dieses Browsers reist im Cookie mit und muss beim Rückweg wieder da sein.
    // Sonst könnte jemand seine eigene, fertige Anmeldung einem anderen unterschieben.
    const binding = token(24);
    res.cookie(OAUTH_COOKIE, binding, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.publicUrl.startsWith('https'),
      maxAge: 10 * 60_000,
      path: '/api/auth',
    });
    res.redirect(
      oauth.startUrl(req.params.provider, {
        mode,
        userId: req.user?.id,
        lang: langOf(req),
        binding,
        ref: mode === 'login' ? String(req.query.ref || '').slice(0, 16) : null,
      })
    );
  })
);

router.get(
  '/auth/:provider/callback',
  wrap(async (req, res) => {
    const lang = langOf(req);
    const key = req.params.provider;
    if (!PROVIDER.test(key)) return res.redirect(`/${lang}`);
    const binding = auth.readCookie(req, OAUTH_COOKIE);
    res.clearCookie(OAUTH_COOKIE, { path: '/api/auth' });
    try {
      const result = await oauth.callback({ code: req.query.code, state: req.query.state, binding });
      if (result.action === 'login' || result.action === 'created') {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId);

        // **Die Zwei-Faktor-Anmeldung gilt auch hier.** Wer sie eingeschaltet hat, hat gesagt:
        // In dieses Konto kommt nur, wer das Gerät hat. Ein übernommenes Discord-Konto wäre sonst
        // der Weg daran vorbei – und zwar ausgerechnet der bequemste, denn er braucht nicht
        // einmal das Passwort. Der Anbieter hat festgestellt, *wer* da sitzt; der zweite Faktor
        // beantwortet eine andere Frage.
        if (totp.enabled(user)) {
          const challenge = logincode.startPending(user, req, 'totp');
          res.cookie(LOGIN_COOKIE, challenge.token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.publicUrl.startsWith('https'),
            maxAge: logincode.CODE_MS,
            path: '/api/auth',
          });
          return res.redirect(`/${user.language || lang}/login?step=totp`);
        }

        // Kein Anmeldecode: Discord und Google haben soeben selbst festgestellt, wer da sitzt –
        // und das mit ihren eigenen zweiten Faktoren. Eine weitere Frage über einen dritten Kanal
        // brächte keine Sicherheit dazu, sie brächte nur einen Schritt dazu. Gemerkt wird der
        // Browser trotzdem: Wer sich hier heute über Discord anmeldet, soll morgen mit seinem
        // Passwort nicht wie ein Fremder behandelt werden.
        auth.noticeNewDevice(user, req);
        signIn(res, user, req, `login-${key}`);
        setLangCookie(res, user.language);
        return res.redirect(
          `/${user.language}/app${result.action === 'created' ? '#/settings?welcome=1' : ''}`
        );
      }
      res.redirect(`/${result.lang || lang}/app#/settings?link=${key}`);
    } catch (error) {
      res.redirect(`/${lang}/app#/settings?error=${encodeURIComponent(error.message)}`);
    }
  })
);

router.delete(
  '/auth/:provider',
  auth.requireUser,
  wrap((req, res) => {
    if (!PROVIDER.test(req.params.provider)) throw notFound('Unbekannter Anbieter.', { en: 'Unknown provider.' });
    // Wer sich über Discord oder Google angemeldet hat, hat hier kein Passwort. Ausgesperrt ist er
    // trotzdem nicht: die E-Mail-Adresse steht am Konto, und "Passwort vergessen" setzt eines.
    oauth.unlink(req.params.provider, req.user.id);
    if (req.params.provider === 'discord') {
      const freeProfiles = db
        .prepare(
          `SELECT p.id FROM profiles p JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = ? AND pl.free_slot = 1`
        )
        .all(req.user.id);
      for (const profile of freeProfiles) {
        supervisor.stopProfile(profile.id, 'Für den Gratis-Tarif muss Discord verknüpft bleiben.', {
          keepWanted: false,
        });
      }
    }
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Eigenes Konto

router.get(
  '/me',
  auth.requireUser,
  wrap((req, res) => {
    const bots = supervisor.list(req.user.id);
    const profiles = db
      .prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?')
      .get(req.user.id).n;
    // Was offen ist, kommt mit derselben Antwort wie alles andere über das Konto: Die Übersicht
    // holt `/me` ohnehin bei jedem Zustandswechsel, und eine zweite Anfrage dafür wäre eine
    // Anfrage mehr für dieselbe Sache.
    const todos = todosFor(req.user, langOf(req));
    res.json({
      user: auth.publicUser(req.user),
      impersonator: req.impersonator || null,
      todos,
      stats: {
        accounts: db.prepare('SELECT COUNT(*) AS n FROM mc_accounts WHERE user_id = ?').get(req.user.id).n,
        profiles,
        bots_running: bots.filter((bot) => bot.state !== 'offline' && bot.state !== 'error').length,
        bots_online: bots.filter((bot) => bot.online).length,
        monthly_cost: billing.monthlyCost(req.user.id),
        free_slots_left: Math.max(0, billing.freeSlots() - billing.usedFreeSlots(req.user.id)),
        tickets_unread: tickets.unreadFor(req.user),
        notifications_unread: notify.unreadFor(req.user.id),
        staff_tickets: req.user.role === 'admin' ? tickets.openForStaff() : 0,
        todos: todos.length,
      },
    });
  })
);

/**
 * Zahlen über die Zeit – für die Diagramme in der Übersicht und im Guthaben-Bereich.
 *
 * Eigener Endpunkt und nicht Teil von `/me`: `/me` wird bei jedem Zustandswechsel eines Bots neu
 * geholt, und dabei jedes Mal den Kontoauszug eines Monats durchzurechnen wäre Arbeit für eine
 * Zahl, die sich in dieser Sekunde nicht geändert hat. Die Übersicht holt das hier einmal beim
 * Zeichnen.
 */
router.get(
  '/me/insights',
  auth.requireUser,
  wrap((req, res) => {
    const userId = req.user.id;
    const running = supervisor.list(userId);
    const byProfile = new Map();
    for (const bot of running) {
      const entry = byProfile.get(bot.profile_id) || { online: 0, running: 0 };
      if (bot.online) entry.online += 1;
      if (bot.state && bot.state !== 'offline') entry.running += 1;
      byProfile.set(bot.profile_id, entry);
    }

    const profiles = db
      .prepare(
        `SELECT p.id, p.name, pl.free_slot,
                pl.price_credits + COALESCE((SELECT SUM(a.price_credits * pa.qty)
                    FROM profile_addons pa JOIN addons a ON a.id = pa.addon_id
                   WHERE pa.profile_id = p.id), 0) AS price_credits,
                COALESCE((SELECT SUM(b.uptime_sec) FROM bots b WHERE b.profile_id = p.id), 0) AS uptime_sec,
                COALESCE((SELECT SUM(b.connections) FROM bots b WHERE b.profile_id = p.id), 0) AS connections
           FROM profiles p JOIN plans pl ON pl.id = p.plan_id
          WHERE p.user_id = ? ORDER BY p.ordinal, p.id`
      )
      .all(userId);

    res.json({
      balance: req.user.credits,
      monthly_cost: billing.monthlyCost(userId),
      balance_days: billing.balanceByDay(userId, 30),
      spend: billing.spendByMonth(userId, 6),
      spend_kinds: billing.spendByKind(userId, 6),
      slots: profiles.map((row) => ({
        id: row.id,
        name: row.name,
        free_slot: Boolean(row.free_slot),
        credits: row.free_slot ? 0 : row.price_credits,
        uptime_sec: row.uptime_sec,
        connections: row.connections,
        online: byProfile.get(row.id)?.online || 0,
      })),
    });
  })
);

// ---------------------------------------------------------------- Aktivitätszentrale

router.get(
  '/me/notifications',
  auth.requireUser,
  wrap((req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 40));
    const event = String(req.query.event || '').trim();
    const before = Number(req.query.before);
    // Eine Zeile mehr holen als ausgeliefert wird: So weiß der Browser, ob der Knopf „Ältere
    // laden“ noch etwas finden kann, ohne eine zweite reine Zählabfrage zu brauchen.
    const rows = notify.notificationsFor(req.user.id, langOf(req), {
      limit: limit + 1,
      event,
      before: Number.isInteger(before) && before > 0 ? before : null,
    });
    res.json({
      notifications: rows.slice(0, limit),
      unread: notify.unreadFor(req.user.id),
      has_more: rows.length > limit,
    });
  })
);

router.patch(
  '/me/notifications',
  auth.requireUser,
  wrap((req, res) => {
    const raw = req.body?.ids;
    if (raw !== undefined && !Array.isArray(raw)) {
      throw bad('Die Auswahl ist ungültig.', { en: 'The selection is invalid.' });
    }
    const ids = Array.isArray(raw)
      ? raw.map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 100)
      : null;
    const changed = req.body?.unread
      ? notify.markUnread(req.user.id, ids || [])
      : notify.markRead(req.user.id, ids);
    res.json({ ok: true, changed, unread: notify.unreadFor(req.user.id) });
  })
);

router.delete(
  '/me/notifications',
  auth.requireUser,
  wrap((req, res) => {
    const changed = notify.removeRead(req.user.id);
    res.json({ ok: true, changed, unread: notify.unreadFor(req.user.id) });
  })
);

router.patch(
  '/me',
  auth.requireUser,
  wrap((req, res) => {
    const body = req.body || {};
    const fields = [];
    const values = [];
    if (body.theme !== undefined) {
      if (!['light', 'dark', 'system'].includes(body.theme)) {
        throw bad('Unbekanntes Aussehen.', { en: 'Unknown appearance.' });
      }
      fields.push('theme = ?');
      values.push(body.theme);
    }
    if (body.low_balance_warning !== undefined) {
      const warning = requireInt(body.low_balance_warning, 'Guthabenwarnung', { min: -1, max: 1_000_000 });
      fields.push('low_balance_warning = ?');
      values.push(warning);
    }
    if (body.discord_webhook !== undefined) {
      const hook = String(body.discord_webhook || '').trim();
      // Die Länge gehört dazu: Ohne sie steht in der Spalte eine Adresse von einem Viertelmegabyte
      // (so viel lässt der Rumpf zu), die bei jeder Benachrichtigung mitgelesen und mitgeschickt
      // wird. Ein echter Discord-Webhook ist keine 200 Zeichen lang.
      if (hook.length > 300) {
        throw bad('Diese Adresse ist zu lang für einen Discord-Webhook.', {
          en: 'That address is too long for a Discord webhook.',
        });
      }
      if (hook && !notify.webhookUrl(hook)) {
        throw bad('Das sieht nicht nach einem Discord-Webhook aus.', {
          en: 'That does not look like a Discord webhook.',
        });
      }
      fields.push('discord_webhook = ?');
      values.push(hook ? notify.webhookUrl(hook) : null);
    }
    if (body.discord_events !== undefined) {
      // Nur bekannte Arten, jede höchstens einmal. Leer heißt "alles" – und weil das die
      // Voreinstellung ist, kommt eine vollständige Liste ebenfalls als leer in die Datenbank:
      // Sonst hinge dort eine Aufzählung, die bei einer neuen Ereignisart stillschweigend zur
      // Abbestellung würde.
      const wanted = String(body.discord_events || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => notify.EVENTS.includes(entry));
      const unique = [...new Set(wanted)];
      fields.push('discord_events = ?');
      values.push(unique.length === notify.EVENTS.length ? '' : unique.join(','));
    }
    if (body.login_code !== undefined) {
      fields.push('login_code = ?');
      values.push(body.login_code ? 1 : 0);
    }
    if (body.language !== undefined) {
      const lang = body.language === 'de' ? 'de' : 'en';
      fields.push('language = ?');
      values.push(lang);
      setLangCookie(res, lang);
    }
    if (body.mail_prefs !== undefined) {
      // Nur bekannte Kategorien, und die festen lassen sich nicht abstellen – sonst stünde in der
      // Datenbank irgendwann ein Wunsch, den es gar nicht gibt.
      const wanted = body.mail_prefs && typeof body.mail_prefs === 'object' ? body.mail_prefs : {};
      const clean = {};
      for (const entry of mail.CATEGORIES) {
        if (entry.locked) continue;
        clean[entry.key] = wanted[entry.key] !== false;
      }
      fields.push('mail_prefs = ?');
      values.push(JSON.stringify(clean));
    }
    // Name, Firma, Anschrift, Umsatzsteuer-Identifikationsnummer, Telefon, Zeitzone. Geprüft und
    // geschrieben wird das in profile.js und nicht hier: Dort steht auch, was davon ins Protokoll
    // gehört (die geänderten **Feldnamen**, nicht die Anschrift selbst).
    const personal = profile.readChanges(body);

    if (body.avatar_source !== undefined) {
      profile.setAvatarSource(req.user.id, body.avatar_source);
    }

    if (!fields.length && !Object.keys(personal).length && body.avatar_source === undefined) {
      throw bad('Nichts zu ändern.', { en: 'Nothing to change.' });
    }
    if (fields.length) {
      values.push(req.user.id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    profile.applyChanges(req.user.id, personal);
    res.json({ user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  })
);

/**
 * Der Benutzername.
 *
 * Eigener Endpunkt und nicht Teil von `PATCH /me`: Er ist das einzige Feld am Konto, das anderen
 * gehört – er steht unter jeder Ticketantwort, in Discord und in den Protokollen. Deshalb hat er
 * eine Sperrfrist, eine eigene Absage und einen eigenen Eintrag im Protokoll, und nichts davon
 * gehört in einen Sammelaufruf, der nebenbei auch die Sprache umstellt.
 */
router.post(
  '/me/username',
  auth.requireUser,
  wrap((req, res) => {
    const user = auth.changeUsername(req.user, req.body?.username);
    // Discord kennt diesen Namen ebenfalls – als Anzeigename am Ticket-Kanal und in den Rollen.
    roles.changed(user.id);
    res.json({ user: auth.publicUser(user) });
  })
);

/** Eine neue E-Mail-Adresse beantragen. Sie gilt erst, wenn sie bestätigt wurde. */
router.post(
  '/me/email',
  auth.requireUser,
  wrap(async (req, res) => {
    const address = await auth.requestEmailChange(req.user, req.body?.email, req.body?.password);
    res.json({ ok: true, pending_email: address });
  })
);

/** Den laufenden Antrag zurückziehen – ein Tippfehler soll kein Grund sein, einen Tag zu warten. */
router.delete(
  '/me/email',
  auth.requireUser,
  wrap((req, res) => {
    auth.cancelEmailChange(req.user.id);
    res.json({ ok: true });
  })
);

/**
 * Den Link aus der Bestätigungsmail einlösen.
 *
 * **Ohne Anmeldung.** Wer die Adresse eines Kontos ändert, öffnet die Bestätigung oft in einem
 * anderen Browser – nämlich in dem, in dem sein Postfach steht. Eine Bestätigung, die eine
 * Sitzung voraussetzt, wäre genau dort nicht einlösbar. Der Schlüssel ist die Marke aus der
 * Nachricht an die neue Adresse; wer sie hat, hat Zugriff auf dieses Postfach, und mehr wird
 * hier nicht behauptet.
 */
router.post(
  '/auth/email/confirm',
  wrap((req, res) => {
    const user = auth.confirmEmailChange(req.body?.token);
    if (!user) {
      throw bad('Dieser Link gilt nicht mehr.', {
        en: 'This link is no longer valid.',
        code: 'verify-invalid',
      });
    }
    res.json({ ok: true, email: user.email });
  })
);

router.get(
  '/me/sessions',
  auth.requireUser,
  wrap((req, res) => res.json({ sessions: auth.sessionsOf(req.user.id, req.sessionToken) }))
);

/** Ein einzelnes Gerät abmelden – das, das man nicht wiedererkennt. */
router.delete(
  '/me/sessions/:ref',
  auth.requireUser,
  wrap((req, res) => {
    const done = auth.endSession(req.user.id, req.params.ref, req.sessionToken);
    if (!done) throw notFound('Diese Sitzung gibt es nicht (mehr).', { en: 'No such session (any more).' });
    res.json({ ok: true, sessions: auth.sessionsOf(req.user.id, req.sessionToken) });
  })
);

/**
 * Die Browser, die dieses Konto ohne Anmeldecode hereinlassen.
 *
 * Steht neben den offenen Sitzungen und ist doch etwas anderes: Eine Sitzung ist ein offenes
 * Fenster und endet mit dem Abmelden; ein bekannter Browser ist ein Vertrauensvorschuss und
 * überlebt es. Wer an einem fremden Rechner angemeldet war, meldet sich zwar ab – der Rechner
 * bliebe aber bekannt und käme mit dem Passwort allein wieder herein. Deshalb lässt sich hier
 * vergessen, was man nicht wiedererkennt.
 */
router.get(
  '/me/devices',
  auth.requireUser,
  wrap((req, res) =>
    res.json({
      devices: logincode.devicesOf(req.user.id, logincode.readDeviceToken(req)),
      login_code: Boolean(req.user.login_code),
      // Ohne Postausgang bleibt der Schalter wirkungslos. Das gehört ins Panel geschrieben und
      // nicht verschwiegen – ein Häkchen, das nichts tut, ist schlimmer als ein fehlendes.
      mail_ready: mail.configured(),
    })
  )
);

router.delete(
  '/me/devices/:ref',
  auth.requireUser,
  wrap((req, res) => {
    if (!logincode.forget(req.user.id, req.params.ref)) {
      throw notFound('Dieses Gerät gibt es nicht (mehr).', { en: 'No such device (any more).' });
    }
    res.json({ ok: true, devices: logincode.devicesOf(req.user.id, logincode.readDeviceToken(req)) });
  })
);

/** Alle auf einmal – der Knopf für den Fall, dass man keinem davon mehr traut. */
router.delete(
  '/me/devices',
  auth.requireUser,
  wrap((req, res) => {
    const gone = logincode.forgetAll(req.user.id);
    // Dieser Browser hier bleibt bekannt: Wer gerade angemeldet davorsitzt, hat sich eben belegt,
    // und ihn mit zu vergessen hieße, dem Kunden für seinen eigenen Rechner einen Code zu
    // schicken – für eine Aufräumaktion, die er selbst ausgelöst hat.
    logincode.remember(req.user, req, res);
    res.json({ ok: true, forgotten: gone, devices: logincode.devicesOf(req.user.id, logincode.readDeviceToken(req)) });
  })
);

/**
 * Eigene API-Token: Zugriff für Skripte statt für einen Browser mit Sitzungs-Cookie.
 *
 * Bewusst schmal gehalten (siehe server/index.js `API_TOKEN_ALLOW`): Ein Token kann den eigenen
 * Bot-Status abfragen und Bots starten/stoppen, sonst nichts. Der rohe Wert steht nur in der
 * Antwort auf das Erstellen – danach nie wieder, genau wie ein Wiederherstellungscode.
 */
router.get(
  '/me/tokens',
  auth.requireUser,
  wrap((req, res) => res.json({ tokens: auth.apiTokensOf(req.user.id) }))
);

router.post(
  '/me/tokens',
  auth.requireUser,
  wrap((req, res) => {
    const label = requireString(req.body?.label, 'Bezeichnung', { max: 60 });
    const created = auth.createApiToken(req.user.id, label);
    res.json({ ...created, tokens: auth.apiTokensOf(req.user.id) });
  })
);

router.delete(
  '/me/tokens/:id',
  auth.requireUser,
  wrap((req, res) => {
    const done = auth.deleteApiToken(req.user.id, requireInt(req.params.id, 'Token'));
    if (!done) throw notFound('Dieses Token gibt es nicht (mehr).', { en: 'No such token (any more).' });
    res.json({ ok: true, tokens: auth.apiTokensOf(req.user.id) });
  })
);

/**
 * Die letzten Anmeldeversuche an **diesem** Konto.
 *
 * Dieselben Zeilen, die die Verwaltung unter „Sicherheit“ sieht – aber nur die eigenen. Wer eine
 * Nachricht über eine Anmeldung von einem fremden Gerät bekommt, hat damit die zweite Hälfte der
 * Auskunft: Was ist seitdem noch versucht worden, und von wo?
 */
router.get(
  '/me/signins',
  auth.requireUser,
  wrap((req, res) => res.json({ attempts: security.attemptsFor(req.user, 25) }))
);

/**
 * Die letzten Nachrichten an dieses Konto.
 *
 * Damit lässt sich prüfen, ob eine E-Mail mit unserem Namen wirklich von uns kam: Wer eine
 * bekommt, die zu Guthaben oder Passwort auffordert, sieht hier nach – steht sie nicht drin,
 * war sie es nicht.
 */
router.get(
  '/me/mails',
  auth.requireUser,
  wrap((req, res) =>
    res.json({ mails: mail.historyFor(req.user.id, 25), categories: mail.categoriesFor(langOf(req)) })
  )
);

router.get(
  '/me/mails/:id',
  auth.requireUser,
  wrap((req, res) => {
    const row = mail.mailById(requireInt(req.params.id, 'Nachricht'), req.user.id);
    if (!row) throw notFound('Diese Nachricht gibt es nicht.', { en: 'No such message.' });
    res.json({ mail: row });
  })
);

router.delete(
  '/me/sessions',
  auth.requireUser,
  wrap((req, res) => {
    // Über den **gespeicherten** Wert, nicht über das Cookie: In der Datenbank steht ein HMAC,
    // und ein Vergleich mit dem rohen Cookie trifft nie – der Knopf hat deshalb bisher auch die
    // eigene Sitzung mitgenommen und den Kunden vor die Anmeldeseite gestellt.
    const gone = auth.endOtherSessions(req.user.id, req.sessionStorageToken);
    res.json({ ok: true, ended: gone, sessions: auth.sessionsOf(req.user.id, req.sessionToken) });
  })
);

// ---------------------------------------------------------------- Zwei-Faktor-Anmeldung
//
// Fünf Endpunkte, und alle fünf verlangen mehr als eine offene Sitzung. Der Grund steht in
// totp.js: Eine Zwei-Faktor-Anmeldung, die sich mit einer geliehenen Sitzung ein- oder
// ausschalten lässt, schützt nichts. Deshalb:
//
//   * **Einrichten beginnen** – Passwort. Was zurückkommt, ist das Geheimnis im Klartext.
//   * **Scharf schalten** – ein Code aus der App. Ohne Probe stünde jemand vor einem Feld, das
//     er nie richtig ausfüllen kann.
//   * **Neue Wiederherstellungscodes** – Passwort und ein gültiger Code.
//   * **Abschalten** – Passwort und ein gültiger Code.
//
// Wer sich über Discord oder Google angemeldet hat, hat hier kein Passwort. Für den tritt der
// gültige Code an dessen Stelle: Er hat das Gerät, und mehr fragt das Panel bei ihm nie ab.

/**
 * Das Passwort noch einmal.
 *
 * Wer sich nur über Discord oder Google anmeldet, hat hier keines – `auth.wrongPassword()` sagt
 * das und nennt den Weg dorthin ("Passwort vergessen"). Dieselbe Antwort wie bei der
 * Adressänderung und der Kontolöschung; eine eigene Auslegung an dieser Stelle wäre eine
 * Sonderregel für die Funktion, die am wenigsten Sonderregeln verträgt.
 */
function confirmPassword(req) {
  if (!auth.checkPassword(req.user, req.body?.password)) throw auth.wrongPassword();
}

/** Das frisch gelesene Konto – nach einer Änderung steht in `req.user` noch der alte Stand. */
const freshUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

/** Und der laufende Code – für alles, was eine eingeschaltete Zwei-Faktor-Anmeldung anrührt. */
function confirmTotp(req) {
  if (!totp.enabled(req.user)) {
    throw bad('Für dieses Konto ist die Zwei-Faktor-Anmeldung nicht eingeschaltet.', {
      en: 'Two-factor sign-in is not switched on for this account.',
    });
  }
  if (!totp.verify(req.user, req.body?.code, req.ip)) {
    throw bad('Dieser Code stimmt nicht.', { en: 'That code is wrong.', code: 'totp-wrong' });
  }
}

router.get(
  '/me/totp',
  auth.requireUser,
  wrap((req, res) => res.json(totp.statusOf(req.user)))
);

router.post(
  '/me/totp/start',
  auth.requireUser,
  wrap((req, res) => {
    if (totp.enabled(req.user)) {
      throw bad('Die Zwei-Faktor-Anmeldung ist schon eingeschaltet.', {
        en: 'Two-factor sign-in is already switched on.',
      });
    }
    confirmPassword(req);
    res.json(totp.begin(req.user, { issuer: config.brand }));
  })
);

router.post(
  '/me/totp/enable',
  auth.requireUser,
  wrap((req, res) => {
    if (totp.enabled(req.user)) {
      throw bad('Die Zwei-Faktor-Anmeldung ist schon eingeschaltet.', {
        en: 'Two-factor sign-in is already switched on.',
      });
    }
    const codes = totp.enable(req.user, req.body?.code, req.ip);
    // Eine Nachricht darüber gehört zur Kategorie "Sicherheit": Wer sie bekommt, ohne es getan zu
    // haben, weiß in derselben Minute, dass jemand anders in seinem Konto sitzt.
    const english = req.user.language === 'en';
    mail
      .sendTo(req.user, 'security', {
        title: english ? 'Two-factor sign-in is on' : 'Die Zwei-Faktor-Anmeldung ist an',
        text: english
          ? 'From now on, signing in to this account needs a code from your authenticator app.'
          : 'Eine Anmeldung an diesem Konto braucht ab sofort einen Code aus deiner Authenticator-App.',
        detail: '',
      })
      .catch(() => {});
    res.json({ ok: true, recovery: codes, status: totp.statusOf(freshUser(req.user.id)) });
  })
);

router.post(
  '/me/totp/recovery',
  auth.requireUser,
  wrap((req, res) => {
    confirmPassword(req);
    confirmTotp(req);
    res.json({ recovery: totp.newRecoveryCodes(req.user.id) });
  })
);

router.delete(
  '/me/totp',
  auth.requireUser,
  wrap((req, res) => {
    confirmPassword(req);
    confirmTotp(req);
    totp.disable(req.user.id, req.ip);
    const english = req.user.language === 'en';
    mail
      .sendTo(req.user, 'security', {
        title: english ? 'Two-factor sign-in is off' : 'Die Zwei-Faktor-Anmeldung ist aus',
        text: english
          ? 'This account is protected by its password alone again. If that was not you, change the password now.'
          : 'Dieses Konto ist wieder allein durch sein Passwort geschützt. Warst du das nicht, ändere sofort dein Passwort.',
        detail: '',
      })
      .catch(() => {});
    res.json({ ok: true, status: totp.statusOf(freshUser(req.user.id)) });
  })
);

/**
 * Wann jedes Konto zuletzt eine Testnachricht ausgelöst hat.
 *
 * Der Aufruf unten benutzt bewusst einen Schlüssel mit Zeitstempel, damit die gewöhnliche Sperre
 * in notify.js ihn *nicht* zurückhält – eine Testnachricht, die stumm verschluckt wird, wäre als
 * Test wertlos. Genau dadurch war der Knopf aber auch völlig ungebremst: eine Schleife darauf
 * schickt beliebig viele Anfragen aus unserem Netz an Discord, bis Discord den Absender sperrt,
 * und das ist dieser Server. Die Sperre steht deshalb hier, mit einer Absage, die das auch sagt.
 */
const lastDiscordTest = new Map();
const DISCORD_TEST_PAUSE_MS = 30_000;

router.post(
  '/me/discord-test',
  auth.requireUser,
  wrap(async (req, res) => {
    if (!req.user.discord_webhook) throw bad('Es ist kein Webhook hinterlegt.', { en: 'No webhook is stored.' });
    const since = Date.now() - (lastDiscordTest.get(req.user.id) || 0);
    if (since < DISCORD_TEST_PAUSE_MS) {
      const wait = Math.ceil((DISCORD_TEST_PAUSE_MS - since) / 1000);
      throw bad(`Gerade erst getestet. Bitte noch ${wait} Sekunden warten.`, {
        en: `Just tested. Please wait another ${wait} seconds.`,
      });
    }
    lastDiscordTest.set(req.user.id, Date.now());
    if (lastDiscordTest.size > 5_000) {
      for (const [id, at] of lastDiscordTest) {
        if (Date.now() - at > DISCORD_TEST_PAUSE_MS) lastDiscordTest.delete(id);
      }
    }
    const sent = await notify.notify(
      req.user.id,
      { de: 'Testnachricht', en: 'Test message' },
      {
        de: 'Wenn du das liest, funktioniert die Benachrichtigung.',
        en: 'If you can read this, notifications are working.',
      },
      { key: `test-${Date.now()}` }
    );
    if (!sent) {
      throw bad('Discord hat die Nachricht nicht angenommen. Stimmt die Adresse noch?', {
        en: 'Discord did not accept the message. Is the address still right?',
      });
    }
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Eigene Daten

/**
 * Alles, was hier über dieses Konto steht – als Datei.
 *
 * Nicht als JSON-Antwort für das Panel, sondern als Download: Der Wert dieser Auskunft liegt
 * darin, sie **zu haben**, und nicht darin, sie einmal auf einem Bildschirm gesehen zu haben.
 * Deshalb ein Dateiname mit Datum und `Content-Disposition: attachment`.
 */
router.get(
  '/me/export',
  auth.requireUser,
  wrap((req, res) => {
    const data = account.exportFor(req.user);
    const day = new Date().toISOString().slice(0, 10);
    audit(req.user.id, 'data-export', null, req.ip);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="afksystems-${req.user.username.replace(/[^a-z0-9_.-]/gi, '_')}-${day}.json"`
    );
    res.send(JSON.stringify(data, null, 2));
  })
);

/** Die Löschung anmelden. Passwort und das ausgeschriebene Wort – beides bewusst. */
router.post(
  '/me/delete',
  auth.requireUser,
  wrap((req, res) => {
    if (req.impersonator) {
      throw forbidden('Nicht, während ein Administrator dieses Konto ansieht.', {
        en: 'Not while an administrator is viewing this account.',
      });
    }
    const verified = auth.checkPassword(req.user, req.body?.password);
    const result = account.requestDeletion(req.user, { verified });
    res.json({ ok: true, deletion: result, grace_days: account.GRACE_DAYS });
  })
);

/** Doch nicht. Ein Klick, kein Passwort – wer sein Konto behalten will, soll nicht kämpfen müssen. */
router.delete(
  '/me/delete',
  auth.requireUser,
  wrap((req, res) => {
    account.cancelDeletion(req.user.id);
    res.json({ ok: true });
  })
);

router.post(
  '/me/password',
  auth.requireUser,
  wrap((req, res) => {
    auth.changePassword(
      req.user,
      req.body?.old_password,
      req.body?.new_password,
      req.body?.new_password2
    );
    // `changePassword` vergisst alle bekannten Browser – auch diesen. Das ist richtig so (siehe
    // dort), aber dieser eine sitzt gerade davor und hat sein Passwort soeben belegt. Er wird
    // deshalb zusammen mit der neuen Sitzung gleich wieder gemerkt; alle anderen bleiben fremd.
    signIn(res, req.user, req, null);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Minecraft-Konten

const accountView = (row) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  uuid: row.uuid,
  status: row.status,
  last_error: row.last_error,
  suspended: Boolean(row.suspended),
  suspend_reason: row.suspend_reason || '',
  connections: row.connections,
  created_at: row.created_at,
  // Kopfbild – über diesen Server, nicht direkt vom Skin-Dienst. Warum, steht in heads.js:
  // Sonst schickte der Browser jedes Kunden bei jedem Seitenaufruf den Namen seines
  // Minecraft-Kontos und seine IP-Adresse zu einem fremden Anbieter.
  head: heads.urlFor(row.uuid || row.name),
});

/**
 * Ein Minecraft-Kopf, über diesen Server statt aus dem Browser des Kunden.
 *
 * **Angemeldet.** Nicht weil ein Kopf geheim wäre – Skins sind öffentlich –, sondern weil diese
 * Adresse sonst ein offener Bildumschlag für jeden wäre, der sie findet. Sichtbar ist sie
 * ohnehin nur dort, wo auch die Kontenliste steht.
 *
 * **Lange haltbar, aber privat.** Der Kopf ändert sich, wenn jemand seinen Skin wechselt; einen
 * Tag im Browser zu bleiben ist der richtige Kompromiss zwischen „sofort da“ und „irgendwann
 * neu“. `private`, weil ein Zwischenspeicher unterwegs nicht mitschreiben soll, welches Konto zu
 * welcher Sitzung gehört.
 */
router.get(
  '/heads/:name.png',
  auth.requireUser,
  wrap(async (req, res) => {
    const result = await heads.headFor(req.params.name);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', result.fresh ? 'private, max-age=86400' : 'private, max-age=300');
    res.setHeader('Content-Length', result.body.length);
    res.end(result.body);
  })
);

router.get(
  '/accounts',
  auth.requireUser,
  wrap((req, res) => {
    mslogin.reconcile(req.user.id);
    const rows = db
      .prepare('SELECT * FROM mc_accounts WHERE user_id = ? ORDER BY name COLLATE NOCASE')
      .all(req.user.id);
    res.json({
      accounts: rows.map(accountView),
      offline_allowed: billing.isPayingUser(req.user.id) && Boolean(binaries.anyCaps().offline),
    });
  })
);

router.post(
  '/accounts/login',
  auth.requireUser,
  wrap((req, res) => {
    if (!binaries.state.ready) {
      throw bad('Der Client ist noch nicht geladen. Bitte kurz warten.', {
        en: 'The client has not been downloaded yet. One moment.',
      });
    }
    res.json(mslogin.begin(req.user));
  })
);

router.get(
  '/accounts/login/:id',
  auth.requireUser,
  wrap((req, res) => res.json(mslogin.status(req.params.id, req.user)))
);

router.delete(
  '/accounts/login/:id',
  auth.requireUser,
  wrap((req, res) => {
    mslogin.cancel(req.params.id, req.user);
    res.json({ ok: true });
  })
);

router.post(
  '/accounts/offline',
  auth.requireUser,
  wrap((req, res) => {
    if (!binaries.anyCaps().offline) {
      throw bad('Der Client kann keine Offline-Konten.', { en: 'This client cannot do offline accounts.' });
    }
    if (!billing.isPayingUser(req.user.id)) {
      throw new HttpError(402, 'Offline-Konten gibt es ab einem bezahlten Serverplatz.', {
        en: 'Offline accounts come with a paid server slot.',
      });
    }
    res.json({ account: accountView(mslogin.addOffline(req.user, req.body?.name)) });
  })
);

router.delete(
  '/accounts/:id',
  auth.requireUser,
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Konto');
    // **Erst prüfen, wem das Konto gehört, dann Bots anhalten.** Vorher lief das Anhalten über
    // jede Zuordnung dieser Kontonummer, und die Besitzprüfung kam erst danach in
    // `removeAccount` – wer eine fremde Nummer eintippte, stoppte damit fremde Bots und löschte
    // gleich noch deren Startwunsch. Die Absage kam erst hinterher, da war der Schaden da.
    const account = db
      .prepare('SELECT id FROM mc_accounts WHERE id = ? AND user_id = ?')
      .get(id, req.user.id);
    if (!account) throw notFound('Dieses Konto gibt es nicht.', { en: 'No such account.' });
    for (const row of db.prepare('SELECT profile_id FROM profile_accounts WHERE account_id = ?').all(id)) {
      supervisor.stop(row.profile_id, id);
    }
    res.json({ account: accountView(mslogin.removeAccount(req.user, id)) });
  })
);

// ---------------------------------------------------------------- Proxys
//
// Proxys legt der Betreiber an und teilt sie zu; ein Nutzer sieht nur seine eigenen. Der Weg
// dorthin führt über ein Ticket, weil hinter jedem Proxy eine echte IP-Adresse steckt.

router.get(
  '/proxies',
  auth.requireUser,
  wrap((req, res) => {
    const paying = billing.isPayingUser(req.user.id);
    const lang = langOf(req);
    const rows = paying
      ? db
          .prepare(
            `SELECT id, label, kind, host, port, username, note, created_at FROM proxies
              WHERE assigned_to = ? ORDER BY id`
          )
          .all(req.user.id)
      : [];
    res.json({
      proxies: rows,
      allowed: paying,
      supported: Boolean(binaries.anyCaps().proxy),
      // Der Wortlaut steht wie jeder andere sichtbare Text in i18n.js und nicht hier: sonst gibt
      // es zwei Orte für dieselbe Sache, und einer davon wird beim nächsten Mal vergessen.
      hint: t(paying ? 'px.hintPaying' : 'px.hintFree', lang),
    });
  })
);

// ---------------------------------------------------------------- Tickets

/**
 * Ein Ticket, wie es der Browser bekommt.
 *
 * Dazugekommen sind die Angaben, die eine Zeile lesbar machen, ohne sie zu öffnen: die letzte
 * Nachricht als Vorschau, ob die andere Seite sie gesehen hat, und die drei Zeitpunkte, aus denen
 * sich Wartezeit und Antwortzeit ergeben. Die Vorschau ist hier auf 200 Zeichen gekürzt – eine
 * Liste braucht den ersten Satz, nicht acht Kilobyte Text je Zeile.
 */
export const ticketView = (row) => ({
  id: row.id,
  subject: row.subject,
  status: row.status,
  priority: row.priority,
  source: row.source,
  messages: row.messages ?? undefined,
  files: row.files ?? undefined,
  shared: Boolean(row.shared),
  extra_users: row.extra_users ?? undefined,
  unread_user: Boolean(row.unread_user),
  unread_staff: Boolean(row.unread_staff),
  discord: Boolean(row.discord_channel_id),
  assigned_to: row.assigned_to ?? null,
  assigned_name: row.assigned_name ?? null,
  assigned_avatar: row.assigned_avatar ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  closed_at: row.closed_at,
  first_reply_at: row.first_reply_at ?? null,
  last_customer_at: row.last_customer_at ?? null,
  last_staff_at: row.last_staff_at ?? null,
  reopened: row.reopened ?? 0,
  last_at: row.last_at ?? null,
  last_role: row.last_role ?? null,
  last_body: row.last_body ? String(row.last_body).slice(0, 200) : '',
  // Wann die andere Seite die letzte Nachricht gesehen hat – oder `null`, solange nicht.
  seen_at: row.seen_at ?? null,
  user_id: row.user_id,
  username: row.username,
  // Nur, wenn die Zeile den Kunden überhaupt kennt. `displayNameOf` fällt sonst auf
  // „Konto #<id>“ zurück – und `id` ist an einer Ticketzeile die Nummer des **Tickets**.
  // Heraus kam damit ein Kundenname, den es nicht gibt, und zwar überall dort, wo die Ansicht
  // gar keinen braucht: in der eigenen Ticketliste des Kunden.
  display_name: row.display_name || (row.email ? profile.displayNameOf(row) : null),
  avatar: row.avatar ?? null,
  email: row.email,
});

/** Wie viel an noch nicht abgeschickten Anhängen je Konto herumliegen darf. */
const PENDING_BYTES_MAX = 100 * 1024 * 1024;

/**
 * Und wie viel insgesamt – abgeschickte Anhänge eingerechnet.
 *
 * Die Grenze oben zählt nur, was **noch an keinem Ticket hängt**. Sobald eine Datei abgeschickt
 * ist, fällt sie aus der Zählung, und damit war der Weg offen: Ticket aufmachen, zwanzig Megabyte
 * anhängen, abschicken, von vorn. Der Platte ist es egal, an welchem Ticket eine Datei hängt.
 */
const TOTAL_BYTES_MAX = 500 * 1024 * 1024;

/**
 * Einen Anhang hochladen.
 *
 * Ohne Ticketnummer: Wer ein neues Ticket schreibt, hängt seinen Screenshot an, bevor es das
 * Ticket gibt. Die Datei gehört bis zum Abschicken nur dem Hochladenden; erst `files.claim()`
 * beim Anlegen oder Antworten verbindet sie mit einem Ticket. Was liegen bleibt, räumt der
 * tägliche Durchlauf weg.
 *
 * Der Rumpf ist die Datei selbst – kein Formular, keine Zusatzbibliothek. Wie sie heißt, steht im
 * Kopf `X-File-Name`; was sie ist, entscheidet ohnehin der Inhalt und nicht der Absender.
 */
router.post(
  '/tickets/files',
  auth.requireUser,
  express.raw({ type: '*/*', limit: attachments.MAX_BYTES }),
  wrap((req, res) => {
    // Zwei Grenzen, weil eine nicht reicht: Fünfzig Anhänge sind eine Menge Dateien, und fünfzig
    // Dateien zu je 20 MB sind ein Gigabyte, das bis zum nächsten Aufräumen liegen bleibt. Gezählt
    // wird deshalb beides – Anzahl **und** Größe dessen, was noch an keinem Ticket hängt.
    const open = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM ticket_files
          WHERE user_id = ? AND ticket_id IS NULL`
      )
      .get(req.user.id);
    const incoming = Buffer.isBuffer(req.body) ? req.body.length : 0;
    if (open.n >= 50 || open.bytes + incoming > PENDING_BYTES_MAX) {
      throw bad('Zu viele offene Anhänge. Bitte erst das Ticket abschicken.', {
        en: 'Too many pending attachments. Please send the ticket first.',
      });
    }
    const stored = db
      .prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM ticket_files WHERE user_id = ?')
      .get(req.user.id).bytes;
    if (stored + incoming > TOTAL_BYTES_MAX) {
      throw bad('Für dieses Konto liegen schon sehr viele Anhänge. Bitte melde dich beim Support.', {
        en: 'This account already stores a lot of attachments. Please contact support.',
      });
    }
    let name = 'anhang';
    try {
      name = decodeURIComponent(String(req.headers['x-file-name'] || '')) || name;
    } catch {
      name = String(req.headers['x-file-name'] || '') || name;
    }
    const file = attachments.store({
      userId: req.user.id,
      name,
      buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    });
    res.json({ file: attachments.view(file) });
  })
);

/**
 * Einen Anhang herunterladen.
 *
 * Wer ihn sehen darf, entscheidet das Ticket: Beteiligte sehen die Anhänge ihres Tickets,
 * Administratoren jedes – interne Notizen samt ihren Dateien allerdings nur die. Eine noch nicht
 * abgeschickte Datei gehört allein dem, der sie hochgeladen hat.
 */
router.get(
  '/tickets/files/:fileId',
  auth.requireUser,
  wrap((req, res) => {
    const file = attachments.byId(requireInt(req.params.fileId, 'Anhang'));
    if (!file) throw notFound('Diesen Anhang gibt es nicht.', { en: 'No such attachment.' });
    const admin = req.user.role === 'admin';
    const allowed = file.ticket_id
      ? (admin || (!file.internal && tickets.isParticipant(file.ticket_id, req.user.id)))
      : file.user_id === req.user.id;
    if (!allowed) throw forbidden();
    const bytes = attachments.read(file);
    if (!bytes) throw notFound('Diese Datei liegt nicht mehr vor.', { en: 'That file is gone.' });
    // Bilder dürfen im Verlauf stehen, alles andere wird heruntergeladen. Der Inhaltstyp kommt
    // aus den Bytes (attachments.sniff) – nie aus dem, was beim Hochladen behauptet wurde.
    const inline = attachments.isInline(file.mime) && req.query.download !== '1';
    res.setHeader('Content-Type', inline ? file.mime : 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(bytes);
  })
);

router.get(
  '/tickets',
  auth.requireUser,
  wrap((req, res) => {
    res.json({
      tickets: tickets.listFor(req.user).map(ticketView),
      priority_allowed: billing.isPayingUser(req.user.id),
      max_upload: attachments.MAX_BYTES,
    });
  })
);

/** Ein bewusst kleiner, vom Server erzeugter Auszug für eine Supportanfrage. */
function ticketDiagnostic(user, rawProfileId, lang) {
  const profileId = requireInt(rawProfileId, 'Server');
  const profile = db
    .prepare('SELECT id, name, host, port, mc_version, suspended, locked FROM profiles WHERE id = ? AND user_id = ?')
    .get(profileId, user.id);
  if (!profile) throw notFound('Diesen Server gibt es nicht.', { en: 'No such server.' });
  const bots = db
    .prepare(
      `SELECT a.name, a.status AS account_status, b.state, b.last_error
         FROM profile_accounts pa JOIN mc_accounts a ON a.id = pa.account_id
    LEFT JOIN bots b ON b.profile_id = pa.profile_id AND b.account_id = pa.account_id
        WHERE pa.profile_id = ? ORDER BY a.name COLLATE NOCASE`
    )
    .all(profile.id)
    .map((row) => ({
      name: row.name,
      account_status: row.account_status,
      state: row.state || 'offline',
      error: String(row.last_error || '').replace(/[\r\n]+/g, ' ').slice(0, 240),
    }));
  const address = profile.port ? `${profile.host}:${profile.port}` : profile.host;
  const heading = lang === 'de' ? 'Diagnosekontext (vom Panel erzeugt)' : 'Diagnostic context (generated by the panel)';
  const state = profile.suspended ? 'suspended' : profile.locked ? 'locked' : 'ready';
  const lines = [
    heading,
    `${lang === 'de' ? 'Serverplatz' : 'Server slot'}: ${profile.name} (${address})`,
    `${lang === 'de' ? 'Minecraft-Version' : 'Minecraft version'}: ${profile.mc_version}`,
    `${lang === 'de' ? 'Platzstatus' : 'Slot status'}: ${state}`,
    `${lang === 'de' ? 'Bots' : 'Bots'}: ${bots.length || '-'}`,
    ...bots.map((bot) => `- ${bot.name}: ${bot.state}; account=${bot.account_status}${bot.error ? `; ${bot.error}` : ''}`),
  ];
  return { profile_id: profile.id, name: profile.name, address, preview: lines.join('\n') };
}

router.get(
  '/tickets/diagnostics',
  auth.requireUser,
  wrap((req, res) => {
    const lang = langOf(req);
    if (req.query.profile_id !== undefined) return res.json({ diagnostic: ticketDiagnostic(req.user, req.query.profile_id, lang) });
    const profiles = db
      .prepare('SELECT id, name, host, port FROM profiles WHERE user_id = ? ORDER BY ordinal, id')
      .all(req.user.id)
      .map((profile) => ({ ...profile, address: profile.port ? `${profile.host}:${profile.port}` : profile.host }));
    res.json({ profiles });
  })
);

router.post(
  '/tickets',
  auth.requireUser,
  wrap((req, res) => {
    const body = req.body || {};
    const diagnostic = body.diagnostic_profile_id ? ticketDiagnostic(req.user, body.diagnostic_profile_id, langOf(req)) : null;
    const ticket = tickets.create(req.user, {
      ...body,
      body: diagnostic ? `${String(body.body || '').trim()}${body.body ? '\n\n' : ''}${diagnostic.preview}` : body.body,
    });
    // Das Team bekommt Bescheid, wo es arbeitet: im Panel (Zahl an der Seitenleiste) und, wenn
    // der Bot läuft, als eigener Kanal in Discord. Eine zusätzliche Webhook-Meldung darüber gab
    // es einmal; sie steht jetzt in server/systemreport.js unter etwas, das wirklich nur dort
    // steht – siehe die Erklärung in server/tickets.js.
    tickets.notifyParticipants(ticket, 'ticket_opened', {}, null);
    bridge.emit('ticket.created', { ticket_id: ticket.id, source: 'panel', user_id: req.user.id });
    res.json({ ticket: ticketView(ticket) });
  })
);

router.get(
  '/tickets/:id',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    // Vor dem Markieren merken, wo man stehen geblieben war – daraus wird der Strich
    // „Neue Nachrichten“ im Verlauf.
    const seenUntil = tickets.markRead(ticket, req.user, { staff: false });
    const messages = tickets.messages(ticket.id, { staff: false, limit: 100, newest: true });
    res.json({
      ticket: ticketView(ticket),
      messages,
      seen_until: seenUntil,
      has_more: messages.length === 100,
      participants: tickets.participants(ticket.id),
      // Auch der Kunde sieht, ob seine Nachricht beim Team angekommen ist. Eine
      // Lesebestätigung, die nur in eine Richtung geht, wäre eine Überwachung und keine Auskunft.
      reads: tickets.reads(ticket.id),
      me: req.user.id,
    });
  })
);

/** Nur die Nachrichten ab einer bestimmten – der Live-Verlauf holt sich damit den Nachschlag. */
router.get(
  '/tickets/:id/messages',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    const since = Number(req.query.since) || 0;
    const before = Number(req.query.before) || 0;
    tickets.markRead(ticket, req.user, { staff: false });
    const messages = tickets.messages(ticket.id, {
      staff: false,
      ...(since ? { after: since, limit: 100 } : before ? { before, limit: 100, newest: true } : { limit: 100, newest: true }),
    });
    res.json({
      ticket: ticketView(ticket),
      messages,
      has_more: messages.length === 100,
      reads: tickets.reads(ticket.id),
    });
  })
);

router.post(
  '/tickets/:id/reply',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    const updated = tickets.reply(ticket, req.user, req.body?.body, {
      staff: false,
      files: req.body?.files,
    });
    // Alle anderen Beteiligten bekommen Post – der Schreiber nicht.
    tickets.notifyParticipants(
      updated,
      'ticket_reply',
      { preview: String(req.body?.body || '').slice(0, 160), author: profile.displayNameOf(req.user) },
      req.user.id
    );
    const after = Number(req.body?.after);
    res.json({
      ticket: ticketView(updated),
      messages: Number.isInteger(after) && after >= 0
        ? tickets.messages(ticket.id, { staff: false, after, limit: 100 })
        : tickets.messages(ticket.id, { staff: false }),
      reads: tickets.reads(ticket.id),
    });
  })
);

/**
 * Zustand ändern. Ein Kunde darf ausschließlich schließen. Eine neue Antwort auf ein bereits
 * geschlossenes Ticket öffnet es weiterhin automatisch, aber es gibt keinen manuellen "Offen"-
 * Schalter mehr.
 */
router.post(
  '/tickets/:id/status',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    const wanted = String(req.body?.status || '');
    if (wanted !== 'closed') {
      throw bad('Diesen Zustand darfst du nicht setzen.', { en: 'You cannot set that status.' });
    }
    // `staff: false` – hier ist auch ein Administrator Kunde (siehe tickets.js).
    const updated = tickets.setStatus(ticket, wanted, req.user.id, { staff: false });
    tickets.notifyParticipants(updated, 'ticket_closed', {}, req.user.id);
    res.json({ ticket: ticketView(updated) });
  })
);

// Alter Name, damit nichts bricht, was ihn noch benutzt.
router.post(
  '/tickets/:id/close',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    const updated = tickets.setStatus(ticket, 'closed', req.user.id, { staff: false });
    tickets.notifyParticipants(updated, 'ticket_closed', {}, req.user.id);
    res.json({ ticket: ticketView(updated) });
  })
);

/**
 * "schreibt gerade …".
 *
 * Es wird nichts gespeichert: die Meldung geht an alle, die dieses Ticket offen haben, und ist
 * nach ein paar Sekunden vorbei. Genau deshalb steht sie hier und nicht in der Datenbank.
 */
router.post(
  '/tickets/:id/typing',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    bridge.emit('ticket.typing', {
      ticket_id: ticket.id,
      user_id: req.user.id,
      name: profile.displayNameOf(req.user),
      staff: false,
    });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Ankündigungen

router.get(
  '/announcements',
  wrap((req, res) => {
    const lang = langOf(req);
    res.json({
      announcements: db
        .prepare('SELECT * FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 20')
        .all()
        .map((row) => announcementView(row, lang)),
    });
  })
);

// ---------------------------------------------------------------- Standorte

router.get(
  '/nodes',
  auth.requireUser,
  wrap((req, res) => res.json({ nodes: nodes.visibleFor(req.user) }))
);
