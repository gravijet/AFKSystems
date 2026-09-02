// Der Beleg über eine Aufladung.
//
// **Warum es ihn gibt.** Bis hierher war der einzige Nachweis über eine Zahlung eine E-Mail. Wer
// sie gelöscht hat, wer sie nie bekommen hat (SMTP nicht eingerichtet), oder wer sie seiner
// Buchhaltung geben muss, stand ohne da – und die Bestätigung von Stripe ist kein Beleg des
// Verkäufers, denn Verkäufer ist der Betreiber und nicht Stripe.
//
// **Warum als HTML und nicht als PDF.** Ein PDF hieße eine Bibliothek, eingebettete Schriften und
// ein Bauschritt – für ein Dokument, das aus zwei Anschriften, einer Zeile und einer Summe
// besteht. Der Browser jedes Kunden kann aus dieser Seite ein PDF machen ("Drucken → Als PDF
// sichern"), und zwar mit *seinen* Schriften und *seiner* Papiergröße. Die Seite ist deshalb für
// beides gebaut: für den Bildschirm im Aussehen des Panels und für Papier in Schwarz auf Weiß.
//
// **Warum die Daten aus dem Abzug kommen und nicht aus dem Konto.** Ein Beleg darf sich nie wieder
// ändern. Beim Verbuchen wird festgehalten, an wen geleistet wurde und welcher Steuerhinweis galt
// (`billed_to`, `vat_note` in `topups`); hier wird nur noch gelesen. Ein Umzug ändert damit den
// Beleg des Vorjahres nicht.

import { db, getSetting } from './db.js';
import { assetVersion, config } from './config.js';
import * as vat from './vat.js';
import { addressLines } from '../public/assets/js/countries.js';
import { escapeHtml } from '../public/assets/js/discord.js';
import { formatDay, formatEuro } from './util.js';
import { billingName } from './profile.js';

/** Wie das Geld auf dem Beleg steht – in der Sprache des Belegs, immer mit zwei Nachkommastellen. */
const money = (cent, lang) => formatEuro(cent, lang);

const day = (at, lang) => formatDay(at, lang);

/** Wie die Zahlart auf dem Beleg heißt. Der Schlüssel in der Datenbank ist keine Auskunft. */
const METHODS = {
  stripe: { de: 'Onlinezahlung (Stripe)', en: 'Online payment (Stripe)' },
  transfer: { de: 'Überweisung', en: 'Bank transfer' },
  paypal: { de: 'PayPal', en: 'PayPal' },
  voucher: { de: 'Gutschein', en: 'Voucher' },
  admin: { de: 'Gutschrift durch den Betreiber', en: 'Credited by the operator' },
  manual: { de: 'Von Hand gebucht', en: 'Booked by hand' },
};

const methodName = (provider, lang) =>
  METHODS[provider]?.[lang] || METHODS[provider]?.en || String(provider || '–');

/**
 * Die Belege eines Kontos – für die Liste im Guthaben-Bereich.
 *
 * Nur bezahlte und erstattete: Eine offene Aufladung ist eine Absicht und kein Beleg. Eine
 * erstattete steht mit dabei, denn sie ist ein Vorgang, den es gab, und ihr Beleg gehört zu
 * einer Buchhaltung genauso wie der ursprüngliche.
 */
export const listFor = (userId, limit = 100) =>
  db
    .prepare(
      `SELECT id, receipt_no, provider, amount_cent, credits, status, created_at, paid_at
         FROM topups
        WHERE user_id = ? AND receipt_no IS NOT NULL
        ORDER BY id DESC LIMIT ?`
    )
    .all(userId, Math.min(500, Math.max(1, limit)));

/** Eine einzelne Aufladung, wenn sie diesem Konto gehört (oder `any` für die Verwaltung). */
export const byId = (id, userId = null) =>
  userId === null
    ? db.prepare('SELECT * FROM topups WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM topups WHERE id = ? AND user_id = ?').get(id, userId);

/** Der Abzug der Rechnungsdaten. Fehlt er (alte Aufladung), bleibt der Kontoname übrig. */
function billedTo(topup, user) {
  try {
    const parsed = JSON.parse(topup.billed_to || 'null');
    if (parsed && typeof parsed === 'object') {
      return {
        ...parsed,
        // Ältere Abzüge kannten nur die Anmeldekennung. Sie bleibt gespeichert, wird aber nicht
        // mehr auf dem Beleg ausgegeben; vorhandener bürgerlicher/Firmenname bleibt eingefroren.
        account_name:
          parsed.account_name || parsed.company || parsed.full_name || `Konto #${Number(user?.id) || '–'}`,
      };
    }
  } catch {
    /* kaputtes JSON ist kein Grund, den Beleg nicht auszustellen */
  }
  return { account_name: billingName(user), email: user?.email || '' };
}

/**
 * Der Verkäufer.
 *
 * Er steht in den Einstellungen unter „Verkäufer und Belege“. Ist dort nichts eingetragen, steht
 * wenigstens Marke und Adresse des Panels da – ein Beleg ganz ohne Absender wäre keiner, aber
 * einer mit erfundenem Absender wäre schlimmer.
 */
function seller() {
  const lines = String(getSetting('company_address') || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    name: String(getSetting('company_name') || '').trim() || config.brand,
    lines,
    vatId: String(getSetting('company_vat_id') || '').trim(),
    email: String(getSetting('support_email') || '').trim(),
    site: config.publicUrl.replace(/^https?:\/\//, ''),
  };
}

/**
 * Der Beleg als vollständige HTML-Seite.
 *
 * Sie hängt an keinem Stylesheet des Panels: Ein Beleg wird ausgedruckt, weitergeleitet und
 * gespeichert, und dann ist eine Datei, die ohne ihren Server nicht mehr aussieht wie sie selbst,
 * wertlos. Alles Nötige steht deshalb darin. Das Aussehen ist trotzdem dasselbe – dieselben
 * Farben, dieselben Radien, dieselbe Schrift wie im Panel. Nur die Schriftdatei kommt über eine
 * Adresse, und wenn sie fehlt (offline geöffnet), springt eine Systemschrift ein: Das ist der
 * einzige Unterschied, den ein gespeicherter Beleg je zeigt.
 */
export function html(topup, user, fallbackLang = 'de') {
  const to = billedTo(topup, user);
  // **Die Sprache des Belegs steht im Beleg**, nicht in der Anfrage. Sie wurde beim Verbuchen
  // festgehalten (profile.billingSnapshot), und dazu passt der Steuerhinweis, der ebenfalls damals
  // festgehalten wurde. Wer sein Panel später auf Englisch umstellt, ändert damit nicht die
  // Sprache einer Rechnung aus dem Vorjahr – und bekommt vor allem keinen englischen Beleg mit
  // einem deutschen Steuersatz darauf. Nur bei alten Aufladungen ohne Abzug entscheidet die
  // Anfrage.
  const lang = to.lang === 'de' || to.lang === 'en' ? to.lang : fallbackLang;
  const de = lang === 'de';
  const from = seller();
  const address = addressLines(to, lang);
  const note = topup.vat_note || vat.note(lang);
  const refunded = topup.status === 'refunded';
  const t = (dictDe, dictEn) => (de ? dictDe : dictEn);

  return `<!doctype html>
<html lang="${de ? 'de' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${config.brand} · ${topup.receipt_no || `#${topup.id}`}`)}</title>
<style>
  /* Die Schrift des Panels, aber nicht als Bedingung: Sie kommt über eine absolute Adresse und
   * fällt auf die Systemschrift zurück, wenn dieses Dokument später offline geöffnet wird. So
   * sieht der Beleg im Browser aus wie das Panel und bleibt trotzdem eine Datei, die für sich
   * allein funktioniert. */
  @font-face {
    font-family: 'Host Grotesk';
    font-style: normal;
    font-weight: 300 800;
    font-display: swap;
    src: url('${config.publicUrl}/assets/v/${assetVersion}/fonts/host-grotesk-latin.woff2') format('woff2');
  }
  /* Dieselben Marken wie im Panel, hier eingebaut statt verlinkt: siehe Kommentar oben. */
  :root {
    color-scheme: light dark;
    --ink: #171717; --ink-2: #4b5563; --line: rgba(0,0,0,.12);
    --paper: #ffffff; --surface: #f2f5f9; --primary: #206cfe;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#f4f4f5; --ink-2:#b8bcc4; --line:rgba(255,255,255,.14); --paper:#17171a; --surface:#202024; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem; background: var(--surface); color: var(--ink);
    font: 15px/1.6 'Host Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  .sheet {
    max-width: 46rem; margin: 0 auto; padding: 3rem; border-radius: 1rem;
    background: var(--paper); box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 12px 40px -20px rgba(0,0,0,.35);
  }
  header { display: flex; justify-content: space-between; gap: 2rem; align-items: flex-start; }
  h1 { margin: 0; font-size: 1.5rem; letter-spacing: -.02em; }
  .muted { color: var(--ink-2); }
  .small { font-size: .8125rem; }
  .brand { font-weight: 700; font-size: 1.05rem; letter-spacing: -.01em; }
  .meta { text-align: right; font-variant-numeric: tabular-nums; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin: 2.5rem 0; }
  .label { font-size: .6875rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
  address { font-style: normal; margin-top: .4rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { padding: .7rem 0; text-align: left; border-bottom: 1px solid var(--line); }
  th { font-size: .6875rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { border-bottom: 0; padding-top: 1rem; font-size: 1.15rem; font-weight: 700; }
  .note { margin-top: 1.5rem; padding: .9rem 1rem; border-radius: .6rem; background: var(--surface); }
  .stamp {
    display: inline-block; margin-top: 1rem; padding: .2rem .6rem; border-radius: .4rem;
    background: color-mix(in srgb, #e40014 14%, transparent); color: #c4000e; font-weight: 700; font-size: .8125rem;
  }
  footer { margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
  /* Auf Papier: kein Grau, keine Schatten, keine Ränder, die Tinte kosten. */
  @media print {
    body { padding: 0; background: #fff; color: #000; }
    .sheet { max-width: none; padding: 0; border-radius: 0; box-shadow: none; background: #fff; }
    .note { background: #fff; border: 1px solid #ccc; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="sheet">
  <header>
    <div>
      <div class="brand">${escapeHtml(from.name)}</div>
      ${from.lines.map((line) => `<div class="small muted">${escapeHtml(line)}</div>`).join('')}
      ${from.vatId ? `<div class="small muted">${escapeHtml(t('USt-IdNr.', 'VAT ID'))} ${escapeHtml(from.vatId)}</div>` : ''}
    </div>
    <div class="meta">
      <h1>${escapeHtml(t('Beleg', 'Receipt'))}</h1>
      <div class="small muted">${escapeHtml(topup.receipt_no || `#${topup.id}`)}</div>
      <div class="small muted">${escapeHtml(day(topup.paid_at || topup.created_at, lang))}</div>
    </div>
  </header>

  <div class="parties">
    <div>
      <div class="label">${escapeHtml(t('Rechnung an', 'Billed to'))}</div>
      ${
        address.length
          ? `<address>${address.map((line) => escapeHtml(line)).join('<br>')}</address>`
          : `<address>${escapeHtml(to.account_name || '')}</address>`
      }
      ${to.vat_id ? `<div class="small muted">${escapeHtml(t('USt-IdNr.', 'VAT ID'))} ${escapeHtml(to.vat_id)}</div>` : ''}
      ${to.email ? `<div class="small muted">${escapeHtml(to.email)}</div>` : ''}
    </div>
    <div>
      <div class="label">${escapeHtml(t('Zahlung', 'Payment'))}</div>
      <div>${escapeHtml(methodName(topup.provider, lang))}</div>
      <div class="small muted">${escapeHtml(t('Konto', 'Account'))} ${escapeHtml(to.account_name || '')}</div>
      ${
        topup.external_id
          ? `<div class="small muted">${escapeHtml(t('Vorgang', 'Reference'))} ${escapeHtml(topup.external_id)}</div>`
          : ''
      }
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t('Leistung', 'Item'))}</th>
        <th class="num">${escapeHtml(t('Betrag', 'Amount'))}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${escapeHtml(
          t(
            `${topup.credits} Credits Guthaben bei ${from.name}`,
            `${topup.credits} credits of ${from.name} balance`
          )
        )}<br>
          <span class="small muted">${escapeHtml(
            t('1 Credit = 1 Cent, ohne Ablaufdatum', '1 credit = 1 cent, no expiry date')
          )}</span></td>
        <td class="num">${escapeHtml(money(topup.amount_cent, lang))}</td>
      </tr>
      <tr class="total">
        <td>${escapeHtml(t('Gesamtbetrag', 'Total'))}</td>
        <td class="num">${escapeHtml(money(topup.amount_cent, lang))}</td>
      </tr>
    </tbody>
  </table>

  <div class="note small">${escapeHtml(note)}</div>
  ${
    refunded
      ? `<div class="stamp">${escapeHtml(t('Erstattet', 'Refunded'))}</div>`
      : ''
  }

  <footer class="small muted">
    <div>${escapeHtml(from.site)}${from.email ? ` · ${escapeHtml(from.email)}` : ''}</div>
    <div style="margin-top:.35rem">${escapeHtml(
      t(
        'Dieser Beleg wurde maschinell erstellt und ist ohne Unterschrift gültig.',
        'This receipt was produced automatically and is valid without a signature.'
      )
    )}</div>
  </footer>

  <!-- **Kein JavaScript auf dieser Seite.** Ein Knopf "drucken" bräuchte einen Inline-Handler,
       und der ist von der Content-Security-Policy dieses Servers ausgeschlossen – zu Recht: Auf
       einem Dokument, in dem Angaben eines Kunden stehen, will man kein ausführbares Skript
       zulassen müssen. Der Weg zum PDF steht deshalb als Satz da, und im Panel gibt es daneben
       einen richtigen Knopf, der genau das auslöst (views/billing.js). -->
  <p class="no-print small muted" style="margin-top:2rem">${escapeHtml(
    t(
      'Zum Sichern als PDF: Strg + P (auf dem Mac ⌘ + P) und als Ziel „Als PDF sichern“ wählen.',
      'To save as PDF: Ctrl + P (⌘ + P on a Mac) and pick “Save as PDF” as the destination.'
    )
  )}</p>
</div>
</body>
</html>`;
}
