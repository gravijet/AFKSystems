// Bausteine, die sich mehrere Reiter eines Serverplatzes teilen.
//
// Sie standen alle in server.js, solange sie nur dort gebraucht wurden. Mit der Live-Ansicht kam
// ein zweiter Ort dazu, der dieselben Felder zeichnet und dieselben Befehle schickt – und zwei
// Dateien, die sich gegenseitig importieren, sind keine Ordnung, sondern ein Kreis. Deshalb liegen
// die gemeinsamen Teile hier, und beide Seiten holen sie sich von hier.

import { api, escapeHtml, mcText, tr, toast, fail, $$ } from '../ui.js';
import { stripFormatting } from '../chatlog.js';
import { state } from '../app.js';

export function noAccounts(root, profile) {
  root.innerHTML = `<div class="empty"><h3>${escapeHtml(tr('srv.noAccounts'))}</h3>
    <a class="btn btn-primary" href="#/servers/${profile.id}/connect">${escapeHtml(tr('tab.connect'))}</a></div>`;
}

// Spielname bleibt unverändert; Stern und Tags helfen nur bei der persönlichen Auswahl.
export function accountLabel(account) {
  const tags = Array.isArray(account?.tags) ? account.tags.filter((tag) => typeof tag === 'string') : [];
  return `${account?.favorite ? '★ ' : ''}${account?.name || ''}${tags.length ? ` · ${tags.join(', ')}` : ''}`;
}

export function accountPicker(members) {
  return `<div class="row wrap" style="margin-bottom:1rem">
    ${members
      .map(
        (member) => `<label class="check small"><input type="checkbox" data-target="${member.account_id}" checked>
          ${escapeHtml(accountLabel(member))}</label>`
      )
      .join('')}
  </div>`;
}

/** Einen örtlichen Befehl an die ausgewählten Konten schicken. */
export function commandRunner(profile) {
  return async (verb, arg = '') => {
    const accounts = $$('[data-target]:checked').map((box) => Number(box.dataset.target));
    if (!accounts.length) {
      toast(tr('srv.noAccounts'));
      return false;
    }
    try {
      const result = await api(`/profiles/${profile.id}/command`, {
        method: 'POST',
        body: { verb, arg, accounts },
      });
      const failures = result.results.filter((entry) => !entry.ok);
      for (const entry of failures) {
        const member = profile.accounts.find((account) => account.account_id === entry.account_id);
        toast(`${member?.name || entry.account_id}: ${entry.error}`, 'bad');
      }
      return result.results.some((entry) => entry.ok);
    } catch (error) {
      fail(error);
      return false;
    }
  };
}

/** Ist auf diesem Platz gerade wenigstens ein Bot im Spiel? */
export function anyOnline(profile, members) {
  return members.some((member) => state.bots.get(`${profile.id}:${member.account_id}`)?.online);
}

/**
 * Ein Zeichen je Gegenstand – für den Fall, dass es keine Textur gibt.
 *
 * Texturen aus dem Spiel liegen nicht im Repository und dürfen auch nicht mitgeliefert werden. Wo
 * der Betreiber eine Original-Client-JAR hinterlegt hat, holt sich das Panel das echte Bild beim
 * Client (siehe `itemSlot`); wo nicht, bekommt jede große Gruppe ein Zeichen, das man auf einen
 * Blick auseinanderhält, und alles Übrige die ersten zwei Buchstaben seines Namens. Das reicht,
 * um ein Menü wiederzuerkennen – der genaue Name steht ohnehin im Aufklapper.
 */
const ITEM_GLYPHS = [
  [/(sword|blade)/, '🗡'],
  [/(pickaxe|axe|shovel|hoe)/, '⛏'],
  [/(helmet|chestplate|leggings|boots|armor)/, '🛡'],
  [/(bow|arrow|crossbow)/, '🏹'],
  [/potion/, '🧪'],
  [/(apple|bread|carrot|potato|beef|porkchop|chicken|fish|cookie|cake|stew|soup|melon)/, '🍖'],
  [/(diamond|emerald|amethyst)/, '💎'],
  [/(gold|golden)/, '🥇'],
  [/(iron|copper|netherite)/, '⚙'],
  [/(chest|barrel|shulker)/, '📦'],
  [/(book|paper|map)/, '📕'],
  [/(_head|skull|player_head)/, '🙂'],
  [/(torch|lantern|campfire|fire)/, '🔥'],
  [/(water|bucket)/, '🪣'],
  [/(pane|glass)/, '🔲'],
  [/(seeds|sapling|flower|leaves|grass)/, '🌱'],
  [/(coin|nugget|ingot)/, '🪙'],
  [/(door|gate|button|lever)/, '🚪'],
  [/(ender|eye|pearl)/, '🔮'],
  [/(banner|shield)/, '🚩'],
];

export function itemGlyph(item) {
  const id = String(item?.id || '').toLowerCase();
  for (const [pattern, glyph] of ITEM_GLYPHS) {
    if (pattern.test(id)) return glyph;
  }
  const words = (id.split(':').pop() || '').split('_').filter(Boolean);
  if (words.length) return words[0].slice(0, 2).toUpperCase();
  // Ohne Kennung bleibt der sichtbare Name – ohne Farbcodes, sonst stünde "§a" im Feld.
  const plain = stripFormatting(item?.name || '').trim();
  return plain ? plain.slice(0, 2).toUpperCase() : '•';
}

/**
 * Ein Feld – im Menü, im Inventar und in der Schnellleiste dasselbe.
 *
 * Woher das Bild kommt, entscheidet die Kennung des Gegenstands, und zwar an ihrer Art: Der
 * texturierte Viewer des Clients nennt sie als **Zahl** (die Registry-Nummer), und nur mit ihr
 * lässt sich beim Client ein Bild abholen. Der Textweg (`:menu`, `:inv`) nennt sie als
 * `minecraft:diamond_sword` – dort gibt es kein Bild, und dann steht das Zeichen im Feld.
 *
 * Das ist keine Notlösung mit zwei Gesichtern, sondern genau die Auskunft, die vorliegt: Wer die
 * Live-Ansicht gebucht hat und dessen Betreiber die Ressourcen hinterlegt hat, sieht das Spiel;
 * alle anderen sehen, was der Client ihnen sagen kann.
 */
export function itemSlot({ item, index, accountId, profileId, extra = '', tag = 'button' }) {
  const count = Number(item?.count) || 0;
  const numeric = typeof item?.id === 'number' && item.id >= 0;
  const face = item
    ? numeric
      ? `<img class="slot-art" alt="" loading="lazy" decoding="async"
           src="/api/profiles/${profileId}/pov/${accountId}/item.png?id=${item.id}">`
      : `<span class="slot-item">${escapeHtml(itemGlyph(item))}</span>`
    : `<span class="slot-index">${index}</span>`;
  const open = tag === 'button' ? '<button' : '<div';
  const close = tag === 'button' ? '</button>' : '</div>';
  return `${open} class="slot ${item ? 'has-item' : ''}" data-slot="${index}"
    data-account="${accountId}" data-inspect="${item && !numeric ? '1' : '0'}" ${extra}
    aria-label="${escapeHtml(`${tr('srv.slot')} ${index}`)}">
    ${face}
    ${count > 1 ? `<span class="slot-count">${count}</span>` : ''}
    ${
      item
        ? `<span class="slot-tip">
             <span class="slot-tip-name">${mcText(item.name || String(item.id ?? ''))}</span>
             ${(item.lore || []).map((line) => `<span class="slot-tip-lore">${mcText(line)}</span>`).join('')}
           </span>`
        : ''
    }
  ${close}`;
}
