// Bezahlen mit Tebex.
//
// Tebex ist der Zahlungsabwickler ("merchant of record") für Minecraft-Server: Karte, PayPal,
// Sofort, Giropay, Apple/Google Pay laufen dort zusammen, und die Umsatzsteuer erledigt Tebex.
// Für dieses Panel heißt das: Wir schicken einen Kunden mit einem Warenkorb dorthin und erfahren
// über einen Webhook, dass bezahlt wurde. Geld fassen wir nie an.
//
// **Zwei Wege**, weil Tebex zwei anbietet – welcher gilt, entscheidet die Einstellung:
//
//   checkout  Checkout-API (checkout.tebex.io). Der Warenkorb wird hier zusammengestellt, Preis
//             und Name kommen aus den Aufladepaketen dieses Panels. Braucht Projekt-ID und
//             privaten Schlüssel – und eine Freischaltung durch Tebex.
//   headless  Headless-API (headless.tebex.io). Die Pakete liegen fertig im Tebex-Webstore; hier
//             steht je Aufladepaket nur noch dessen Paket-ID. Braucht nur den öffentlichen
//             Store-Token und geht ohne Freischaltung.
//
// Beide enden an derselben Stelle: dem Webhook. Er ist die einzige Stelle, an der Guthaben
// entsteht – eine Rückkehr des Browsers auf die "Danke"-Seite ist kein Zahlungsnachweis.
//
// Die Einrichtung Schritt für Schritt steht in docs/tebex.md.

import crypto from 'node:crypto';
import { getSetting } from './db.js';
import { config } from './config.js';
import { bad } from './util.js';

const CHECKOUT_API = 'https://checkout.tebex.io/api';
const HEADLESS_API = 'https://headless.tebex.io/api/accounts';

const text = (key) => String(getSetting(key) || '').trim();

/** `checkout` oder `headless` – was der Betreiber eingestellt hat. */
export const mode = () => (text('tebex_mode') === 'headless' ? 'headless' : 'checkout');

/**
 * Ist Bezahlen mit Tebex möglich?
 *
 * Nicht "ist ein Schlüssel gesetzt", sondern "reicht das, was dasteht, für eine Zahlung": im
 * Checkout-Weg Projekt-ID **und** privater Schlüssel, im Headless-Weg der Store-Token. Ohne das
 * bietet das Panel die Zahlart gar nicht erst an, statt einen Knopf zu zeigen, der ins Leere läuft.
 */
export function configured() {
  if (!Number(getSetting('tebex_enabled'))) return false;
  return mode() === 'headless'
    ? Boolean(text('tebex_store_token'))
    : Boolean(text('tebex_project_id') && text('tebex_private_key'));
}

/** Kann der Webhook geprüft werden? Ohne Geheimnis nimmt er nichts an – siehe verify(). */
export const webhookReady = () => Boolean(text('tebex_webhook_secret'));

/** Der Zustand für den Admin-Bereich. Nie mit Schlüsseln – nur mit "gesetzt" oder "fehlt". */
export function status() {
  return {
    enabled: Boolean(Number(getSetting('tebex_enabled'))),
    mode: mode(),
    ready: configured(),
    webhook_ready: webhookReady(),
    webhook_url: `${config.publicUrl}/api/tebex/webhook`,
    store: text('tebex_store_url') || null,
  };
}

async function call(url, { method = 'POST', headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    // Tebex antwortet mal mit `title`/`detail` (RFC 7807), mal mit `message`. Was auch immer da
    // steht, gehört in den Fehler – "Tebex 422" allein hilft beim Einrichten niemandem.
    const message =
      data?.detail || data?.title || data?.message || data?.error || raw.slice(0, 200) || response.status;
    throw bad(`Tebex: ${message}`, { en: `Tebex: ${message}` });
  }
  return data;
}

const basicAuth = () =>
  `Basic ${Buffer.from(`${text('tebex_project_id')}:${text('tebex_private_key')}`).toString('base64')}`;

/**
 * Einen Bezahlvorgang anlegen und die Adresse zurückgeben, auf die der Kunde geschickt wird.
 *
 * `topup` ist die schon angelegte, offene Aufladung. Ihre ID reist als `custom` mit und kommt im
 * Webhook zurück – daran erkennen wir später, welches Konto welche Credits bekommt.
 */
export async function createCheckout({ user, pack, topup, lang = 'de' }) {
  if (!configured()) {
    throw bad('Bezahlen mit Tebex ist auf diesem Server nicht eingerichtet.', {
      en: 'Paying with Tebex is not set up on this server.',
    });
  }
  const base = `${config.publicUrl}/${lang === 'en' ? 'en' : 'de'}/app`;
  const custom = { topup_id: String(topup.id), user_id: String(user.id) };
  const complete = `${base}#/credits?paid=${topup.id}`;
  const cancel = `${base}#/credits?cancelled=${topup.id}`;

  if (mode() === 'headless') {
    const token = encodeURIComponent(text('tebex_store_token'));
    if (!pack.tebex) {
      throw bad(
        `Für das Paket "${pack.label}" steht keine Tebex-Paket-ID in den Einstellungen.`,
        { en: `No Tebex package id is stored for the "${pack.label}" package.` }
      );
    }
    const basket = await call(`${HEADLESS_API}/${token}/baskets`, {
      body: {
        complete_url: complete,
        cancel_url: cancel,
        complete_auto_redirect: true,
        custom,
      },
    });
    const ident = basket?.data?.ident;
    if (!ident) throw bad('Tebex hat keinen Warenkorb zurückgegeben.', { en: 'Tebex returned no basket.' });
    // Der Pfad hat hier wirklich kein "/baskets" – so steht es in der Beschreibung der API.
    await call(`${HEADLESS_API}/${token}/${encodeURIComponent(ident)}/packages`, {
      body: { package_id: String(pack.tebex), quantity: 1 },
    });
    const filled = await call(`${HEADLESS_API}/${token}/baskets/${encodeURIComponent(ident)}`, {
      method: 'GET',
    });
    const url = filled?.data?.links?.checkout || basket?.data?.links?.checkout;
    if (!url) throw bad('Tebex hat keine Bezahladresse zurückgegeben.', { en: 'Tebex returned no checkout link.' });
    return { url, reference: ident };
  }

  // Checkout-API: Warenkorb, Artikel und Preis in einem Aufruf.
  const [first, ...rest] = String(user.username || 'AFKSystems').split(/\s+/);
  const result = await call(`${CHECKOUT_API}/checkout`, {
    headers: { authorization: basicAuth() },
    body: {
      basket: {
        first_name: first.slice(0, 40) || 'AFKSystems',
        last_name: (rest.join(' ') || 'Kunde').slice(0, 40),
        email: user.email,
        return_url: cancel,
        complete_url: complete,
        complete_auto_redirect: true,
        custom,
      },
      items: [
        {
          type: 'single',
          qty: 1,
          package: {
            // Was auf der Rechnung und im Tebex-Warenkorb steht. Credits, nicht "Serverplatz":
            // bezahlt wird immer Guthaben, nie eine Laufzeit.
            name: `${config.brand} · ${pack.credits} Credits`,
            price: Number((pack.cent / 100).toFixed(2)),
            type: 'single',
            qty: 1,
            custom,
          },
        },
      ],
    },
  });
  const url = result?.links?.checkout;
  if (!url) throw bad('Tebex hat keine Bezahladresse zurückgegeben.', { en: 'Tebex returned no checkout link.' });
  return { url, reference: result.ident || null };
}

/**
 * Die Einrichtung prüfen, ohne dass Geld fließt.
 *
 * Es gibt bei Tebex keinen zweiten, gefahrlosen Server zum Üben: `checkout.tebex.io` ist die
 * einzige Adresse, und ob ein Kauf echt abgerechnet wird, entscheidet der **Testmodus des Stores**
 * im Tebex-Panel, nicht die API. Was sich hier trotzdem beantworten lässt – und was beim
 * Einrichten die eigentliche Frage ist –, ist: *Nimmt Tebex meine Zugangsdaten an und ist die
 * Checkout-API für dieses Projekt überhaupt freigeschaltet?*
 *
 * Dafür wird ein echter Warenkorb über einen Cent angelegt und wieder liegengelassen. Er kostet
 * nichts, läuft von selbst ab, und die Antwort ist eindeutig: entweder kommt eine Bezahladresse
 * zurück oder Tebex sagt, was fehlt. Bezahlt wird dort nichts – die Adresse kommt nur mit zurück,
 * damit der Betreiber den letzten Schritt einmal von Hand gehen kann.
 */
export async function selfTest({ lang = 'de' } = {}) {
  const out = {
    mode: mode(),
    enabled: Boolean(Number(getSetting('tebex_enabled'))),
    webhook_ready: webhookReady(),
    webhook_url: `${config.publicUrl}/api/tebex/webhook`,
    ok: false,
    checkout_url: null,
    message: '',
  };

  const missing = [];
  if (mode() === 'headless') {
    if (!text('tebex_store_token')) missing.push('Store-Token');
  } else {
    if (!text('tebex_project_id')) missing.push('Projekt-ID');
    if (!text('tebex_private_key')) missing.push('Privater Schlüssel');
  }
  if (missing.length) {
    out.message =
      lang === 'en'
        ? `Missing in the settings: ${missing.join(', ')}.`
        : `In den Einstellungen fehlt: ${missing.join(', ')}.`;
    return out;
  }

  if (mode() === 'headless') {
    // Im Headless-Weg genügt ein leerer Warenkorb: er beweist, dass der Store-Token stimmt.
    const basket = await call(`${HEADLESS_API}/${encodeURIComponent(text('tebex_store_token'))}/baskets`, {
      body: {
        complete_url: `${config.publicUrl}/`,
        cancel_url: `${config.publicUrl}/`,
        custom: { test: '1' },
      },
    });
    out.ok = Boolean(basket?.data?.ident);
    out.checkout_url = basket?.data?.links?.checkout || null;
  } else {
    const result = await call(`${CHECKOUT_API}/checkout`, {
      headers: { authorization: basicAuth() },
      body: {
        basket: {
          first_name: config.brand.slice(0, 40),
          last_name: 'Test',
          email: 'test@example.com',
          return_url: `${config.publicUrl}/`,
          complete_url: `${config.publicUrl}/`,
          custom: { test: '1' },
        },
        items: [
          {
            type: 'single',
            qty: 1,
            package: { name: `${config.brand} · Verbindungstest`, price: 0.01, type: 'single', qty: 1 },
          },
        ],
      },
    });
    out.ok = Boolean(result?.links?.checkout);
    out.checkout_url = result?.links?.checkout || null;
  }

  out.message = out.ok
    ? lang === 'en'
      ? 'Tebex accepted the credentials and returned a checkout link.'
      : 'Tebex hat die Zugangsdaten angenommen und eine Bezahladresse geliefert.'
    : lang === 'en'
      ? 'Tebex answered, but without a checkout link.'
      : 'Tebex hat geantwortet, aber keine Bezahladresse geliefert.';
  return out;
}

// ---------------------------------------------------------------- Webhook

/**
 * Die Unterschrift eines Webhooks prüfen.
 *
 * Tebex bildet sie so: erst den **rohen** Rumpf mit SHA-256 hashen, dann diesen Hash als Text mit
 * dem Webhook-Geheimnis HMAC-SHA-256 signieren. Der rohe Rumpf ist wichtig – aus wieder
 * eingesetztem JSON käme ein anderer Hash heraus, und keine echte Nachricht käme je durch.
 *
 * Ohne hinterlegtes Geheimnis wird **nichts** angenommen. Eine Aufladung, die sich jeder selbst
 * zurufen kann, wäre keine Zahlung, sondern ein Formular zum Geldverschenken.
 */
export function verify(rawBody, signature) {
  const secret = text('tebex_webhook_secret');
  if (!secret) return false;
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const expected = crypto.createHmac('sha256', secret).update(bodyHash).digest('hex');
  const given = Buffer.from(String(signature || ''), 'utf8');
  const mine = Buffer.from(expected, 'utf8');
  return given.length === mine.length && crypto.timingSafeEqual(given, mine);
}

/** Die beiden Adressen, von denen Tebex seine Webhooks schickt. */
export const TEBEX_IPS = ['192.0.2.1', '192.0.2.1'];

/**
 * Was in einer Zahlungsmeldung steckt, in der Form, die dieses Panel braucht.
 *
 * Die eigenen Daten (`custom`) hängen je nach Weg am Warenkorb oder am Artikel – deshalb wird
 * beides angesehen. Der bezahlte Betrag kommt mit, weil er geprüft gehört: die Beschreibung der
 * API sagt ausdrücklich, dass im Webhook der Warenkorb **zum Zeitpunkt der Zahlung** steht, und
 * nicht der, den wir angelegt haben.
 */
export function readPayment(event) {
  const subject = event?.subject || {};
  const product = Array.isArray(subject.products) ? subject.products[0] : null;
  const custom = product?.custom || subject.custom || {};
  const paid = subject.price_paid || subject.price || {};
  return {
    transaction: subject.transaction_id || null,
    topupId: Number(custom.topup_id) || null,
    userId: Number(custom.user_id) || null,
    email: subject.customer?.email || null,
    statusId: Number(subject.status?.id) || null,
    amountCent: Math.round(Number(paid.amount || 0) * 100),
    currency: String(paid.currency || '').toUpperCase(),
  };
}
