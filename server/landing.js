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
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  wallet:
    '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  gamepad:
    '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  discord:
    '<path d="M18.9 5.6A16.6 16.6 0 0 0 14.8 4.4l-.2.4a12.5 12.5 0 0 1 3.7 1.9 15.7 15.7 0 0 0-12.6 0 12.5 12.5 0 0 1 3.7-1.9l-.2-.4A16.6 16.6 0 0 0 5.1 5.6C2.5 9.5 1.8 13.3 2.1 17a16.7 16.7 0 0 0 5.1 2.6l.9-1.3a10.9 10.9 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.4 0l.4.3a10.9 10.9 0 0 1-1.7.8l.9 1.3a16.7 16.7 0 0 0 5.1-2.6c.4-4.3-.7-8.1-3-11.4Z"/><ellipse cx="9" cy="13" rx="1.4" ry="1.7"/><ellipse cx="15" cy="13" rx="1.4" ry="1.7"/>',
};

const ICON_SVG = (paths) =>
  `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${paths}</svg>`;

const iconVars = () =>
  Object.fromEntries(
    Object.entries(ICONS).map(([name, paths]) => [`icon.${name}`, ICON_SVG(paths)])
  );

/** Ein Symbol je Gruppe – es sortiert die Seite fürs Auge, bevor jemand den ersten Titel liest. */
const GROUP_ICONS = {
  connection: 'server',
  chat: 'message',
  automation: 'zap',
  game: 'gamepad',
  accounts: 'users',
  panel: 'monitor',
};

/**
 * Die Funktionsliste, nach Gruppen.
 *
 * Jede Gruppe ist eine Karte mit Symbol und Überschrift, darin die Einträge als Raster. Vorher
 * war es eine Aufzählung unter der anderen – auf einem breiten Bildschirm eine sehr lange Spalte,
 * die keinen Unterschied zwischen "Verbindung" und "Panel" erkennen ließ.
 */
function featuresHtml(lang) {
  const list = features(binaries.anyCaps(), lang);
  const groups = new Map();
  for (const feature of list) {
    if (!groups.has(feature.group)) {
      groups.set(feature.group, { key: feature.group, label: feature.group_label, rows: [] });
    }
    groups.get(feature.group).rows.push(feature);
  }
  const tag = escape(t('features.premium', lang));
  const ultraTag = escape(t('features.ultra', lang));

  return [...groups.values()]
    .map(
      (group) => `<section class="spec-group">
        <header>
          <span class="spec-icon">${ICON_SVG(ICONS[GROUP_ICONS[group.key]] || ICONS.zap)}</span>
          <h3>${escape(group.label)}</h3>
        </header>
        <ul>
          ${group.rows
            .map(
              (row) => `<li class="spec-row">
                <p class="spec-name">${escape(row.title)}${
                  row.tag === 'ultra'
                    ? `<span class="spec-tag">${ultraTag}</span>`
                    : row.premium
                      ? `<span class="spec-tag">${tag}</span>`
                      : ''
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

/**
 * Was ein Tarif kann, als Liste.
 *
 * Jede Zeile ist etwas, das dieser Tarif hat und der darunter nicht – oder eine Zahl, die sich
 * unterscheidet. Merkmale, die überall gleich sind, stehen auf /features und nicht dreimal
 * nebeneinander in den Preiskästen.
 */
function planLines(plan, lang, addonKeys) {
  const lines = [];
  lines.push(
    `${plan.max_accounts} ${t(plan.max_accounts === 1 ? 'pricing.bot' : 'pricing.bots', lang)}`
  );
  lines.push(t(plan.premium ? 'pricing.premiumClient' : 'pricing.slimClient', lang));
  if (plan.board || plan.menus) lines.push(t('pricing.boardMenus', lang));
  else if (plan.addons && addonKeys.has('board')) {
    lines.push(`${t('pricing.boardMenus', lang)} — ${t('pricing.addonHint', lang)}`);
  }
  lines.push(`${number(plan.chat_limit, lang)} ${t('pricing.chatHistory', lang)}`);
  lines.push(t('pricing.macros', lang, { n: number(plan.max_macros, lang) }));
  if (plan.offline_accounts) lines.push(t('pricing.offlineAccounts', lang));
  if (plan.proxy) lines.push(t('pricing.proxyOnRequest', lang));
  if (plan.priority_support) lines.push(t('pricing.prioritySupport', lang));
  return lines;
}

/**
 * Die Tarifkästen.
 *
 * Der Preis steht in **Euro** – das ist die Zahl, mit der jemand entscheidet. Credits sind die
 * Einheit im Panel und stehen als Nebenzeile darunter; vorher stand es umgekehrt, und wer die
 * Seite zum ersten Mal sah, musste erst nachrechnen, was "249" bedeutet.
 */
function plansHtml(lang) {
  const list = billing.plans();
  const addonKeys = new Set(billing.addons().filter((addon) => addon.available).map((addon) => addon.key));
  // Hervorgehoben wird, was der Betreiber im Admin-Bereich dafür markiert hat.
  return list
    .map((plan) => {
      const name = lang === 'de' ? plan.name_de : plan.name_en;
      const blurb = lang === 'de' ? plan.blurb_de : plan.blurb_en;
      const price = plan.free_slot
        ? `<b>${escape(t('common.free', lang))}</b><span>${escape(t('pricing.freeForever', lang))}</span>`
        : `<b>${escape(formatEuro(plan.price_credits, lang))}</b><span>${escape(
            t('pricing.perServer', lang)
          )}</span>`;
      return `<article class="plan${plan.free_slot ? ' is-free' : ''}${plan.highlight ? ' is-best' : ''}">
        ${plan.highlight ? `<span class="plan-flag">${escape(t('bill.mostPopular', lang))}</span>` : ''}
        <h3>${escape(name)}</h3>
        <p class="plan-price">${price}</p>
        ${
          plan.free_slot
            ? '<p class="plan-euro">&nbsp;</p>'
            : `<p class="plan-euro">${escape(
                t('pricing.perMonthEuro', lang, { amount: number(plan.price_credits, lang) })
              )}</p>`
        }
        <p class="plan-blurb">${escape(blurb || '')}</p>
        <ul class="plan-list">
          ${planLines(plan, lang, addonKeys)
            .map((line) => `<li>${escape(line)}</li>`)
            .join('')}
        </ul>
        <a class="btn ${plan.highlight ? 'btn-primary' : ''}" href="/${lang}/register">${escape(
          t('pricing.choose', lang)
        )}</a>
      </article>`;
    })
    .join('');
}

/** Die Zusätze auf der Preisseite – was sich dazubuchen lässt, ohne den Tarif zu wechseln. */
function addonsHtml(lang) {
  return billing
    .addons()
    .filter((addon) => addon.active)
    .map((addon) => {
      const name = lang === 'de' ? addon.name_de : addon.name_en;
      const text = lang === 'de' ? addon.text_de : addon.text_en;
      return `<article class="pack">
        <span class="pack-euro">${escape(formatEuro(addon.price_credits, lang))}</span>
        <span class="pack-credits">${escape(name)}</span>
        <span class="pack-bonus">${escape(
          addon.available ? t('ad.perMonth', lang) : t('ad.soon', lang)
        )}</span>
        <p class="small muted" style="margin:.4rem 0 0">${escape(text || '')}</p>
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

/** "ab 2,49 €" – überall auf der Website derselbe Betrag, und zwar in Euro. */
function fromPrice(lang) {
  const cheapest = billing.cheapestPaidPlan();
  if (!cheapest) {
    return { 'pricing.fromPrice': t('pricing.onRequest', lang), fromEuro: t('pricing.onRequest', lang) };
  }
  return {
    'pricing.fromPrice': `${t('pricing.from', lang)} ${formatEuro(cheapest.price_credits, lang)}`,
    fromEuro: formatEuro(cheapest.price_credits, lang),
  };
}

/** Der Discord-Link. Ohne Eintrag in den Einstellungen kommt der ganze Abschnitt nicht vor. */
function discordVars(lang) {
  const invite = String(getSetting('discord_invite') || '').trim();
  return {
    discordInvite: invite,
    discordBlock: invite
      ? `<section class="discord-band">
          <div class="page">
            <div class="discord-copy">
              <h2>${escape(t('discord.join', lang))}</h2>
              <p>${escape(t('discord.lead', lang))}</p>
            </div>
            <a class="btn btn-lg btn-primary" href="${escape(invite)}" target="_blank" rel="noopener">
              ${ICON_SVG(ICONS.discord)} ${escape(t('discord.join', lang))}</a>
          </div>
        </section>`
      : '',
    discordNav: invite
      ? `<a class="head-discord" href="${escape(invite)}" target="_blank" rel="noopener"
           title="${escape(t('discord.join', lang))}">${ICON_SVG(ICONS.discord)}<span>Discord</span></a>`
      : '',
    footerDiscord: invite
      ? `<li><a href="${escape(invite)}" target="_blank" rel="noopener">Discord</a></li>`
      : '',
  };
}

/**
 * Die Vorschau auf der Startseite.
 *
 * Kein Bildschirmfoto, sondern dieselben Bausteine wie im Panel – dieselbe Chatfläche, dieselbe
 * Anzeigetafel, dieselben Farben. Ein Foto wäre nach der nächsten Änderung falsch; das hier ist
 * es nie, weil es aus demselben CSS gebaut ist.
 *
 * Die Zeilen sind erfunden und sagen das auch. Was hier steht, ist genau das, was ein Kunde
 * danach sieht – nicht mehr.
 */
function demoHtml(lang) {
  const de = lang === 'de';
  const chat = de
    ? [
        ['20:14:02', 'chat', '§7[§aSurvival§7] §fSteve§7: §fbin gleich zurück'],
        ['20:14:09', 'chat', '§e[+] §fAlex ist beigetreten'],
        ['20:14:31', 'sent', '/afk'],
        ['20:15:00', 'chat', '§7Du bist jetzt im AFK-Modus.'],
        ['20:18:44', 'status', 'Unterserver gewechselt – Bot ist mitgegangen.'],
      ]
    : [
        ['20:14:02', 'chat', '§7[§aSurvival§7] §fSteve§7: §fbrb'],
        ['20:14:09', 'chat', '§e[+] §fAlex joined the game'],
        ['20:14:31', 'sent', '/afk'],
        ['20:15:00', 'chat', '§7You are now AFK.'],
        ['20:18:44', 'status', 'Sub-server changed – the bot followed.'],
      ];

  const board = [
    ['§b§lSURVIVAL', null],
    ['§7Rang: §6VIP', 8],
    ['§7Guthaben: §a12.480', 7],
    ['§7Spielzeit: §f42 h', 6],
    ['§7', 5],
    ['§7Online: §f138', 4],
  ];

  const sentTag = de ? 'Gesendet' : 'Sent';

  return `<div class="demo">
    <div class="demo-bar">
      <span class="dot live" style="color:#00bb7f"></span>
      <span class="demo-name">anticheat-test.com</span>
      <span class="demo-tag">MC 26.1</span>
      <span class="demo-tag">2/5</span>
    </div>
    <div class="demo-body">
      <div class="console">
        ${chat
          .map(
            ([time, kind, text]) => `<div class="line ${kind}">
              <span class="t">${time}</span>
              <span class="msg">${
                kind === 'sent' ? `<span class="tag">${escape(sentTag)}:</span> ` : ''
              }${mcHtml(text)}</span>
            </div>`
          )
          .join('')}
      </div>
      <article class="board">
        <header>${mcHtml(board[0][0])}</header>
        <ol class="board-rows">
          ${board
            .slice(1)
            .map(
              ([text, score]) => `<li><span class="board-text">${mcHtml(text)}</span>
                <span class="board-score">${score}</span></li>`
            )
            .join('')}
        </ol>
      </article>
    </div>
  </div>`;
}

/**
 * Minecraft-Farbcodes zu HTML – für die Vorschau.
 *
 * Im Browser macht das ui.js; hier steht die kurze Fassung, weil der Server nur diese eine Stelle
 * hat und ui.js nichts ist, was Node lädt.
 */
const MC_COLORS = {
  0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa',
  6: '#ffaa00', 7: '#aaaaaa', 8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

function mcHtml(raw) {
  const out = [];
  let color = null;
  let bold = false;
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    const style = [color ? `color:${color}` : '', bold ? 'font-weight:700' : ''].filter(Boolean).join(';');
    out.push(style ? `<span style="${style}">${escape(buffer)}</span>` : escape(buffer));
    buffer = '';
  };
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '§' || i + 1 >= raw.length) {
      buffer += raw[i];
      continue;
    }
    const code = raw[++i].toLowerCase();
    flush();
    if (code === 'l') bold = true;
    else if (code === 'r') {
      color = null;
      bold = false;
    } else if (MC_COLORS[code]) {
      color = MC_COLORS[code];
      bold = false;
    }
  }
  flush();
  return out.join('');
}

/** Der Hinweis zu Server-Regeln und Banns – er steht auf mehreren Seiten, also an einer Stelle. */
const rulesNote = (lang) => `<div class="rules-note">
  ${ICON_SVG(ICONS.alert)}
  <div>
    <strong>${escape(t('rules.title', lang))}</strong>
    <p>${escape(t('rules.text', lang))}</p>
  </div>
</div>`;

/** Platzhalter der Startseite. */
export function homeVars(lang) {
  return {
    ...iconVars(),
    ...fromPrice(lang),
    ...discordVars(lang),
    freeSlots: String(billing.freeSlots()),
    rulesNote: rulesNote(lang),
    demoHtml: demoHtml(lang),
  };
}

/** Platzhalter der Funktionsseite. */
export function featureVars(lang) {
  return {
    ...iconVars(),
    ...discordVars(lang),
    featuresHtml: featuresHtml(lang),
    rulesNote: rulesNote(lang),
  };
}

/** Platzhalter der Preisseite. */
export function pricingVars(lang) {
  return {
    ...fromPrice(lang),
    ...discordVars(lang),
    plansHtml: plansHtml(lang),
    addonsHtml: addonsHtml(lang),
    packagesHtml: packagesHtml(lang),
    freeSlots: String(billing.freeSlots()),
    rulesNote: rulesNote(lang),
  };
}

/** Platzhalter, die jede Seite bekommt (Kopfleiste, Fuß). */
export const commonVars = (lang) => discordVars(lang);

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
