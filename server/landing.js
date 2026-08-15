// Die beweglichen Teile der Startseite – auf dem Server gebaut, nicht im Browser.
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

// Auf der Startseite werden nur vier Zustände unterschieden. `missing` heißt: die Bauform, die
// das könnte, liegt gerade nicht auf diesem Server – dann wird es auch nicht versprochen.
const STATUS_LABEL = {
  ready: 'features.legend.ready',
  premium: 'features.legend.premium',
  soon: 'features.legend.soon',
  no: 'features.legend.no',
  missing: 'features.legend.missing',
};

function featuresHtml(lang) {
  const caps = binaries.anyCaps();
  const list = features(caps, lang);
  const groups = new Map();
  for (const feature of list) {
    if (!groups.has(feature.group)) groups.set(feature.group, { label: feature.group_label, rows: [] });
    groups.get(feature.group).rows.push(feature);
  }

  const html = [...groups.values()]
    .map(
      (group) => `<section class="spec-group">
        <h3>${escape(group.label)}</h3>
        <ul>
          ${group.rows
            .map(
              (row) => `<li class="spec-row" data-status="${row.status}">
                <div>
                  <span class="spec-name">${escape(row.title)}</span>
                  <p class="spec-text">${escape(row.text)}</p>
                </div>
                <span class="spec-status"><i aria-hidden="true"></i>${escape(
                  t(STATUS_LABEL[row.status], lang)
                )}</span>
              </li>`
            )
            .join('')}
        </ul>
      </section>`
    )
    .join('');

  const used = [...new Set(list.map((row) => row.status))];
  const legend = ['ready', 'premium', 'soon', 'no', 'missing']
    .filter((status) => used.includes(status))
    .map(
      (status) =>
        `<li data-status="${status}"><i aria-hidden="true"></i>${escape(t(STATUS_LABEL[status], lang))}</li>`
    )
    .join('');

  return { featuresHtml: html, legendHtml: legend };
}

function planLines(plan, lang) {
  const lines = [];
  lines.push(
    `${plan.max_accounts} ${t(plan.max_accounts === 1 ? 'pricing.bot' : 'pricing.bots', lang)}`
  );
  lines.push(t(plan.premium ? 'pricing.premiumClient' : 'pricing.slimClient', lang));
  lines.push(`${number(plan.chat_limit, lang)} ${t('pricing.chatHistory', lang)}`);
  if (plan.offline_accounts) lines.push(t('pricing.offlineAccounts', lang));
  if (plan.fakehost) lines.push(t('pricing.fakehost', lang));
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
        <p class="plan-blurb">${escape(blurb || '')}</p>
        <ul class="plan-list">
          ${planLines(plan, lang)
            .map((line) => `<li>${escape(line)}</li>`)
            .join('')}
        </ul>
        ${
          plan.free_slot
            ? ''
            : `<p class="plan-euro">${escape(
                t('pricing.perMonthEuro', lang, { amount: formatEuro(plan.price_credits, lang) })
              )}</p>`
        }
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
  const list = binaries.state.versions || [];
  if (!list.length) return '';
  return list.map((version) => `<li>${escape(version)}</li>`).join('');
}

/** Alles, was landing.html an Platzhaltern kennt. */
export function landingVars(lang) {
  const cheapest = billing.cheapestPaidPlan();
  return {
    ...featuresHtml(lang),
    plansHtml: plansHtml(lang),
    packagesHtml: packagesHtml(lang),
    versionsHtml: versionsHtml(),
    'pricing.fromPrice': cheapest
      ? `${t('pricing.from', lang)} ${number(cheapest.price_credits, lang)} ${t('common.creditsInline', lang)}`
      : t('pricing.onRequest', lang),
    freeSlots: String(billing.freeSlots()),
  };
}

/** Für Impressum, Datenschutz und Nutzungsbedingungen: Text aus den Einstellungen. */
export function legalVars(kind, lang) {
  const raw = String(getSetting(lang === 'en' ? `legal_${kind}_en` : `legal_${kind}`) || '') ||
    String(getSetting(`legal_${kind}`) || '');
  const body = raw.trim()
    ? raw
        .trim()
        .split(/\n{2,}/)
        .map((block) => `<p>${escape(block).replace(/\n/g, '<br />')}</p>`)
        .join('')
    : `<p class="note warn">${escape(t('legal.placeholder', lang))}</p>`;
  return {
    legalTitle: t(`legal.${kind}.title`, lang),
    legalBody: body,
    title: `${t(`legal.${kind}.title`, lang)} – AFKSystems`,
  };
}
