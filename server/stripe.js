// Bezahlen mit Stripe.
//
// Stripe ist ein **Zahlungsdienstleister**, kein Verkäufer im eigenen Namen: Verkäufer ist und
// bleibt der Betreiber dieses Panels. Das ist der entscheidende Unterschied zu einem Marktplatz –
// Preis, Rechnung und Umsatzsteuer gehören hierher und nicht zu Stripe. Was auf Beleg und Kasse
// zur Steuer steht, sagt deshalb `vat.js` und nicht diese Datei.
//
// Der Weg ist **Stripe Checkout**: eine von Stripe gehostete Bezahlseite. Karte, PayPal, Apple/
// Google Pay, Klarna, EPS und was der Betreiber sonst in seinem Stripe-Dashboard freischaltet,
// laufen darüber. AFKSystems sieht nie Kartendaten und braucht dafür keine eigene Bezahlmaske.
//
// **Kein SDK.** Stripe spricht HTTP mit formularkodierten Feldern; das sind hier vierzig Zeilen
// statt eines Pakets mit Abhängigkeitsbaum. Bewusst ohne festgenagelte API-Version: Es gilt die
// Version, die am Stripe-Konto eingestellt ist. Alle hier benutzten Felder (`line_items`, `mode`,
// `success_url`, `metadata`, `amount_total`, `payment_status`) gibt es seit Jahren unverändert.
//
// **Guthaben entsteht ausschließlich im Webhook** (siehe routes/billing.js). Die Rückkehr des
// Browsers auf die „Danke“-Seite ist kein Zahlungsnachweis und bucht nichts.
//
// Die Einrichtung Schritt für Schritt steht in docs/stripe.md.

import crypto from 'node:crypto';
import { getSetting } from './db.js';
import { config } from './config.js';
import * as vat from './vat.js';
import { bad } from './util.js';

const API = 'https://api.stripe.com/v1';

/** Wie alt eine Webhook-Unterschrift höchstens sein darf. Stripes eigene Vorgabe. */
export const TOLERANCE_SECONDS = 300;

const text = (key) => String(getSetting(key) || '').trim();

const secretKey = () => text('stripe_secret_key');

/**
 * Ist Bezahlen mit Stripe möglich?
 *
 * Nicht „steht irgendwo ein Schlüssel“, sondern „reicht das für eine Zahlung“: eingeschaltet
 * **und** geheimer Schlüssel hinterlegt. Sonst bietet das Panel die Zahlart gar nicht erst an,
 * statt einen Knopf zu zeigen, der ins Leere läuft.
 */
export const configured = () => Boolean(Number(getSetting('stripe_enabled')) && secretKey());

/**
 * Liegt überhaupt ein Schlüssel vor – auch wenn die Zahlart gerade aus ist?
 *
 * Der Unterschied zählt genau einmal: beim Aufräumen. Wer Stripe abschaltet, hat damit keine
 * Bezahlseite geschlossen, die noch offen bei Stripe steht. Solange der Schlüssel da ist, lässt
 * sie sich schließen – und das soll dann auch versucht werden.
 */
export const keyed = () => Boolean(secretKey());

/** Kann der Webhook geprüft werden? Ohne Geheimnis nimmt er nichts an – siehe verify(). */
export const webhookReady = () => Boolean(text('stripe_webhook_secret'));

/**
 * Arbeitet dieses Konto mit echtem Geld?
 *
 * `sk_live_…` heißt ja, `sk_test_…` heißt nein. Die Unterscheidung ist kein Beiwerk: Sie ist die
 * einzige Handhabe gegen den Fall, dass jemand den Endpunkt aus dem Testmodus stehen lässt und
 * kostenlose Testzahlungen echtes Guthaben erzeugen (siehe `livemodeMatches`).
 */
export const live = () => secretKey().startsWith('sk_live_');

/** Der Zustand für den Admin-Bereich. Nie mit Schlüsseln – nur mit „gesetzt“ oder „fehlt“. */
export function status() {
  return {
    enabled: Boolean(Number(getSetting('stripe_enabled'))),
    ready: configured(),
    live: configured() ? live() : null,
    webhook_ready: webhookReady(),
    webhook_url: `${config.publicUrl}/api/stripe/webhook`,
    vat: vat.mode(),
  };
}

// ---------------------------------------------------------------- HTTP

/**
 * Verschachtelte Felder in die Form bringen, die Stripe erwartet.
 *
 * Stripe nimmt kein JSON entgegen, sondern `application/x-www-form-urlencoded` mit Klammern:
 * `line_items[0][price_data][unit_amount]=1000`. Diese Funktion macht aus einem gewöhnlichen
 * Objekt genau das. `undefined` und `null` fallen heraus – ein leer mitgeschicktes Feld ist bei
 * Stripe etwas anderes als ein fehlendes.
 */
export function encode(value, prefix = '', out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => encode(entry, `${prefix}[${index}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      encode(entry, prefix ? `${prefix}[${key}]` : key, out);
    }
    return out;
  }
  out.append(prefix, typeof value === 'boolean' ? String(value) : String(value));
  return out;
}

async function call(path, { method = 'POST', body, idempotencyKey } = {}) {
  const key = secretKey();
  if (!key) {
    throw bad('Für Stripe ist kein geheimer Schlüssel hinterlegt.', {
      en: 'No Stripe secret key is stored.',
    });
  }
  const headers = {
    authorization: `Bearer ${key}`,
    'content-type': 'application/x-www-form-urlencoded',
  };
  // Ein zweiter Anlauf nach einem Netzfehler soll nicht zwei Bezahlvorgänge erzeugen. Stripe
  // liefert bei gleichem Schlüssel innerhalb von 24 Stunden dieselbe Antwort zurück.
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : encode(body).toString(),
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    // Stripe schreibt in `error.message` einen Satz im Klartext, oft mit der Lösung darin
    // („No such price“, „Invalid API Key provided“). Der gehört in die Fehlermeldung – „Stripe
    // 400“ allein hilft beim Einrichten niemandem.
    const message = data?.error?.message || raw.slice(0, 200) || `HTTP ${response.status}`;
    throw bad(`Stripe: ${message}`, { en: `Stripe: ${message}` });
  }
  return data;
}

// ---------------------------------------------------------------- Bezahlen

/**
 * Was in der Kasse als Artikel steht.
 *
 * Bezahlt wird immer **Guthaben** und nie eine Laufzeit – das ist im ganzen Panel so und muss
 * auch auf der Bezahlseite und dem Kontoauszug der Bank so stehen.
 */
const itemName = (pack) => `${config.brand} · ${pack.credits} Credits`;

/**
 * Einen Bezahlvorgang anlegen und die Adresse zurückgeben, auf die der Kunde geschickt wird.
 *
 * `topup` ist die schon angelegte, offene Aufladung. Ihre ID reist zweimal mit: am Vorgang selbst
 * (`metadata`) und an der Zahlung darunter (`payment_intent_data[metadata]`). Das zweite ist kein
 * Übereifer – eine Erstattung meldet Stripe später als `charge.refunded`, und diese Meldung kennt
 * nur die Zahlung, nicht die Kasse.
 */
export async function createCheckout({ user, pack, topup, lang = 'de' }) {
  if (!configured()) {
    throw bad('Bezahlen mit Stripe ist auf diesem Server nicht eingerichtet.', {
      en: 'Paying with Stripe is not set up on this server.',
    });
  }
  const base = `${config.publicUrl}/${lang === 'en' ? 'en' : 'de'}/app`;
  const metadata = { topup_id: String(topup.id), user_id: String(user.id) };
  const taxed = !vat.smallBusiness();
  const note = vat.note(lang);

  const session = await call('/checkout/sessions', {
    idempotencyKey: `afk-topup-${topup.id}`,
    body: {
      mode: 'payment',
      locale: lang === 'de' ? 'de' : 'en',
      success_url: `${base}#/credits?paid=${topup.id}`,
      cancel_url: `${base}#/credits?cancelled=${topup.id}`,
      // Die E-Mail ist schon bekannt – Stripe soll sie nicht ein zweites Mal abfragen.
      customer_email: user.email,
      client_reference_id: String(topup.id),
      metadata,
      payment_intent_data: {
        description: itemName(pack),
        metadata,
      },
      // Ohne Umsatzsteuer gibt es nichts zu berechnen; mit Stripe Tax gilt der Preis des Panels
      // als **Bruttopreis**, damit „10 €“ auf der Preisseite auch 10 € auf der Abrechnung sind.
      automatic_tax: { enabled: taxed },
      ...(taxed ? { billing_address_collection: 'required' } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: pack.cent,
            ...(taxed ? { tax_behavior: 'inclusive' } : {}),
            product_data: { name: itemName(pack), description: note },
          },
        },
      ],
      // Derselbe Satz noch einmal über dem Bezahlknopf. Auf einer Kasse ohne Steuerzeile ist die
      // Frage „warum steht hier keine Umsatzsteuer?“ sonst berechtigt und unbeantwortet.
      custom_text: { submit: { message: note.slice(0, 1200) } },
    },
  });
  if (!session?.url) {
    throw bad('Stripe hat keine Bezahladresse zurückgegeben.', {
      en: 'Stripe returned no checkout link.',
    });
  }
  return { url: session.url, reference: session.id || null };
}

/**
 * Eine noch offene Bezahlseite bei Stripe schließen.
 *
 * Damit lässt sich eine Aufladung im Panel zurückziehen, ohne dass eine Bezahlseite offen bleibt,
 * über die zehn Minuten später doch noch Geld hereinkommt. Stripe lehnt das Schließen ab, sobald
 * bezahlt wurde – genau das ist die gewünschte Antwort, und der Aufrufer bricht dann ab.
 */
export const expireCheckout = (sessionId) =>
  call(`/checkout/sessions/${encodeURIComponent(sessionId)}/expire`);

/**
 * Die Einrichtung prüfen, ohne dass Geld fließt.
 *
 * Zwei Fragen, die beim Einrichten alles entscheiden, und beide lassen sich ohne einen Cent
 * beantworten:
 *
 *   1. **Nimmt Stripe den Schlüssel an, und darf dieses Konto kassieren?** `GET /v1/account` sagt
 *      beides – `charges_enabled` ist falsch, solange die Kontoprüfung bei Stripe läuft.
 *   2. **Kommt eine Bezahlseite zustande?** Dafür wird eine echte Kasse über einen Euro angelegt
 *      und liegengelassen. Sie kostet nichts, läuft nach einer halben Stunde von selbst ab und
 *      hängt an keiner Aufladung – bezahlt wird dort nichts, die Adresse kommt nur mit zurück,
 *      damit der Betreiber die Seite einmal mit eigenen Augen sehen kann.
 */
export async function selfTest({ lang = 'de' } = {}) {
  const en = lang === 'en';
  const out = {
    enabled: Boolean(Number(getSetting('stripe_enabled'))),
    live: null,
    account: null,
    charges_enabled: null,
    webhook_ready: webhookReady(),
    webhook_url: `${config.publicUrl}/api/stripe/webhook`,
    vat: vat.mode(),
    ok: false,
    checkout_url: null,
    message: '',
  };

  if (!secretKey()) {
    out.message = en
      ? 'Missing in the settings: secret key.'
      : 'In den Einstellungen fehlt: Geheimer Schlüssel.';
    return out;
  }
  out.live = live();

  const account = await call('/account', { method: 'GET' });
  out.account = account?.settings?.dashboard?.display_name || account?.id || null;
  out.charges_enabled = Boolean(account?.charges_enabled);

  const session = await call('/checkout/sessions', {
    body: {
      mode: 'payment',
      locale: en ? 'en' : 'de',
      success_url: `${config.publicUrl}/`,
      cancel_url: `${config.publicUrl}/`,
      // Frühestens 30 Minuten in der Zukunft erlaubt Stripe; 35 lassen Luft für ungenaue Uhren.
      expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
      automatic_tax: { enabled: false },
      metadata: { test: '1' },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: 100,
            product_data: { name: `${config.brand} · ${en ? 'Connection test' : 'Verbindungstest'}` },
          },
        },
      ],
    },
  });
  out.checkout_url = session?.url || null;
  out.ok = Boolean(session?.url) && out.charges_enabled;

  if (!out.charges_enabled) {
    out.message = en
      ? 'Stripe accepted the key, but this account may not take payments yet (charges_enabled is false).'
      : 'Stripe nimmt den Schlüssel an, aber dieses Konto darf noch nicht kassieren (charges_enabled ist falsch).';
  } else if (!session?.url) {
    out.message = en
      ? 'Stripe answered, but returned no checkout link.'
      : 'Stripe hat geantwortet, aber keine Bezahladresse geliefert.';
  } else {
    out.message = en
      ? `Stripe accepted the key and returned a checkout link (${out.live ? 'live mode' : 'test mode'}).`
      : `Stripe hat den Schlüssel angenommen und eine Bezahladresse geliefert (${
          out.live ? 'Echtbetrieb' : 'Testmodus'
        }).`;
  }
  return out;
}

// ---------------------------------------------------------------- Webhook

/**
 * Die Unterschrift eines Webhooks prüfen.
 *
 * Stripe schickt sie im Kopf `Stripe-Signature`, als Liste aus Zeitstempel und einem oder mehreren
 * Werten (bei einem Schlüsselwechsel sind es kurzzeitig zwei):
 *
 *   t=1712345678,v1=5257a869e7…,v1=e2f1c8…
 *
 * Unterschrieben wird `"<t>.<roher Rumpf>"` mit HMAC-SHA-256 und dem Endpunkt-Geheimnis
 * (`whsec_…`, im Ganzen, mit Präfix). Der **rohe** Rumpf ist wichtig – aus wieder eingesetztem
 * JSON käme ein anderer Hash heraus, und keine echte Meldung käme je durch. Deshalb steht die
 * Route in index.js vor dem JSON-Parser.
 *
 * Der Zeitstempel gehört mit in die Prüfung: Ohne ihn bliebe eine einmal mitgeschnittene, gültig
 * unterschriebene Meldung für immer wiederverwendbar.
 *
 * Ohne hinterlegtes Geheimnis wird **nichts** angenommen. Eine Aufladung, die sich jeder selbst
 * zurufen kann, wäre keine Zahlung, sondern ein Formular zum Geldverschenken.
 */
export function verify(rawBody, signature, { now = Date.now() } = {}) {
  const secret = text('stripe_webhook_secret');
  if (!secret) return false;

  let timestamp = '';
  const given = [];
  for (const part of String(signature || '').split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') given.push(value);
  }
  if (!timestamp || !given.length) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  const mine = Buffer.from(expected, 'utf8');
  return given.some((value) => {
    const theirs = Buffer.from(value, 'utf8');
    return theirs.length === mine.length && crypto.timingSafeEqual(theirs, mine);
  });
}

/**
 * Passt der Betriebsmodus der Meldung zum hinterlegten Schlüssel?
 *
 * Stripe hat für Test und Echtbetrieb getrennte Schlüssel, getrennte Endpunkte und getrennte
 * Geheimnisse – aber dasselbe Panel dahinter. Wer beim Umschalten auf den Echtbetrieb das
 * Test-Geheimnis stehen lässt, hat einen Endpunkt, der kostenlose Testzahlungen mit echten
 * Credits belohnt. Das ist kein erfundener Fall, sondern die häufigste Panne beim Umstellen.
 */
export const livemodeMatches = (event) => Boolean(event?.livemode) === live();

/**
 * Was in einer Meldung steckt, in der Form, die dieses Panel braucht.
 *
 * Das Objekt darin ist je nach Art eine Kasse (`checkout.session.*`), eine Zahlung
 * (`charge.refunded`) oder ein Streitfall (`charge.dispute.*`) – die Nummer der Aufladung steht
 * bei allen dreien in `metadata`, weil sie beim Anlegen an beide Ebenen gehängt wurde.
 */
export function readEvent(event) {
  const object = event?.data?.object || {};
  const type = String(event?.type || '');
  // Beim Streitfall liegt die Zahlung eine Ebene tiefer: das Objekt ist der Streit, nicht die
  // Zahlung. `payment_intent` trägt in beiden Fällen dieselbe Nummer.
  const metadata = object.metadata || {};
  const amount = type.startsWith('checkout.session') ? object.amount_total : object.amount;
  return {
    type,
    id: String(event?.id || ''),
    session: type.startsWith('checkout.session') ? object.id || null : null,
    paymentIntent:
      typeof object.payment_intent === 'string'
        ? object.payment_intent
        : object.payment_intent?.id || null,
    topupId: Number(metadata.topup_id) || null,
    userId: Number(metadata.user_id) || null,
    email: object.customer_details?.email || object.billing_details?.email || null,
    paymentStatus: object.payment_status || null,
    amountCent: Math.round(Number(amount || 0)),
    amountRefunded: Math.round(Number(object.amount_refunded || 0)),
    currency: String(object.currency || '').toUpperCase(),
    disputeStatus: object.status || null,
  };
}
