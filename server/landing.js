// Die beweglichen Teile der öffentlichen Seiten – auf dem Server gebaut, nicht im Browser.
//
// Funktionen, Tarife, Pakete und Versionen stehen in der Datenbank bzw. im Client. Würde der
// Browser sie nachladen, stünde die halbe Seite beim ersten Blick leer da und Suchmaschinen sähen
// nichts davon. Also kommt hier fertiges HTML heraus, das pages.js einsetzt.

import { getSetting } from './db.js';
import { formatEuro } from './util.js';
import * as binaries from './binaries.js';
import * as billing from './billing.js';
import { features } from './features.js';
import { t } from '../public/assets/js/i18n.js';

const escape = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const number = (value, lang) => Number(value || 0).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB');

// Die paar Symbole, die auf der Startseite vorkommen. Dieselben Pfade wie im Panel (ui.js) –
// hier noch einmal, weil ui.js für den Browser gedacht ist und der Server nichts davon lädt.
const ICONS = {
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  server:
    '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
};

const iconVars = () =>
  Object.fromEntries(
    Object.entries(ICONS).map(([name, paths]) => [
      `icon.${name}`,
      `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">${paths}</svg>`,
    ])
  );

/** Die Funktionsliste, nach Gruppen. Was ein bezahlter Platz braucht, bekommt ein Etikett. */
function featuresHtml(lang) {
  const list = features(binaries.anyCaps(), lang);
  const groups = new Map();
  for (const feature of list) {
    if (!groups.has(feature.group)) groups.set(feature.group, { label: feature.group_label, rows: [] });
    groups.get(feature.group).rows.push(feature);
  }
  const tag = escape(t('features.premium', lang));

  return [...groups.values()]
    .map(
      (group) => `<section class="spec-group">
        <h3>${escape(group.label)}</h3>
        <ul>
          ${group.rows
            .map(
              (row) => `<li class="spec-row">
                <p class="spec-name">${escape(row.title)}${
                  row.premium ? `<span class="spec-tag">${tag}</span>` : ''
                }</p>
                <p class="spec-text">${escape(row.text)}</p>
              </li>`
            )
            .join('')}
        </ul>
      </section>`
    )
    .join('');
}

function planLines(plan, lang) {
  const lines = [];
  lines.push(
    `${plan.max_accounts} ${t(plan.max_accounts === 1 ? 'pricing.bot' : 'pricing.bots', lang)}`
  );
  lines.push(t(plan.premium ? 'pricing.premiumClient' : 'pricing.slimClient', lang));
  lines.push(`${number(plan.chat_limit, lang)} ${t('pricing.chatHistory', lang)}`);
  if (plan.offline_accounts) lines.push(t('pricing.offlineAccounts', lang));
  if (plan.proxy) lines.push(t('pricing.proxyOnRequest', lang));
  if (plan.priority_support) lines.push(t('pricing.prioritySupport', lang));
  return lines;
}

function plansHtml(lang) {
  return billing
    .plans()
    .map((plan) => {
      const name = lang === 'de' ? plan.name_de : plan.name_en;
      const blurb = lang === 'de' ? plan.blurb_de : plan.blurb_en;
      // Jeder Tarif zeigt eine Zahl – auch der kostenlose. Das hält die Spalten im Takt.
      const price = plan.free_slot
        ? `<b>0</b><span>${escape(t('pricing.freeForever', lang))}</span>`
        : `<b>${number(plan.price_credits, lang)}</b><span>${escape(t('pricing.perServer', lang))}</span>`;
      return `<article class="plan${plan.free_slot ? ' is-free' : ''}">
        <h3>${escape(name)}</h3>
        <p class="plan-price">${price}</p>
        ${
          plan.free_slot
            ? ''
            : `<p class="plan-euro">${escape(
                t('pricing.perMonthEuro', lang, { amount: formatEuro(plan.price_credits, lang) })
              )}</p>`
        }
        <p class="plan-blurb">${escape(blurb || '')}</p>
        <ul class="plan-list">
          ${planLines(plan, lang)
            .map((line) => `<li>${escape(line)}</li>`)
            .join('')}
        </ul>
      </article>`;
    })
    .join('');
}

function packagesHtml(lang) {
  return billing
    .packages()
    .map(
      (pack) => `<div class="pack">
        <span class="pack-euro">${escape(pack.label)}</span>
        <span class="pack-credits">${number(pack.credits, lang)} ${escape(t('common.creditsInline', lang))}</span>
        ${
          pack.bonus > 0
            ? `<span class="pack-bonus">+${number(pack.bonus, lang)} ${escape(t('pricing.topup.bonus', lang))}</span>`
            : '<span class="pack-bonus"></span>'
        }
      </div>`
    )
    .join('');
}

function versionsHtml() {
  return (binaries.state.versions || []).map((version) => `<li>${escape(version)}</li>`).join('');
}

/** "ab 249 Credits" für die Preiszeile, und derselbe Betrag in Euro für die Zahlenleiste. */
function fromPrice(lang) {
  const cheapest = billing.cheapestPaidPlan();
  if (!cheapest) {
    return { 'pricing.fromPrice': t('pricing.onRequest', lang), fromEuro: t('pricing.onRequest', lang) };
  }
  return {
    'pricing.fromPrice': `${t('pricing.from', lang)} ${number(cheapest.price_credits, lang)} ${t(
      'common.creditsInline',
      lang
    )}`,
    fromEuro: formatEuro(cheapest.price_credits, lang),
  };
}

/** Platzhalter der Startseite. */
export function homeVars(lang) {
  return {
    ...iconVars(),
    ...fromPrice(lang),
    freeSlots: String(billing.freeSlots()),
  };
}

/** Platzhalter der Funktionsseite. */
export function featureVars(lang) {
  return { featuresHtml: featuresHtml(lang), versionsHtml: versionsHtml() };
}

/** Platzhalter der Preisseite. */
export function pricingVars(lang) {
  return {
    ...fromPrice(lang),
    plansHtml: plansHtml(lang),
    packagesHtml: packagesHtml(lang),
    freeSlots: String(billing.freeSlots()),
  };
}

/** Für Impressum, Datenschutz und Nutzungsbedingungen: Text aus den Einstellungen. */
export function legalVars(kind, lang) {
  const raw =
    String(getSetting(lang === 'en' ? `legal_${kind}_en` : `legal_${kind}`) || '') ||
    String(getSetting(`legal_${kind}`) || '');
  const body = raw.trim()
    ? raw
        .trim()
        .split(/\n{2,}/)
        .map((block) => `<p>${escape(block).replace(/\n/g, '<br />')}</p>`)
        .join('')
    : `<p class="note warn">${escape(t(`legal.placeholder.${kind}`, lang))}</p>`;
  return {
    legalTitle: t(`legal.${kind}.title`, lang),
    legalBody: body,
    title: `${t(`legal.${kind}.title`, lang)} – AFKSystems`,
  };
}
