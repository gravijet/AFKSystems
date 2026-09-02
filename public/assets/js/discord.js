// Discord-Nachrichten so anzeigen, wie Discord sie anzeigt.
//
// **Das Problem.** Discord schreibt Erwähnungen als Zahlen. Wer im Ticket-Kanal
// "@Hugo, sieh mal in #support" tippt, verschickt in Wahrheit
// `<@1538202840445485134>, sieh mal in <#1538202844744908814>`. Im Discord-Client steht daran
// wieder ein Name; im Panel stand die Zahl. Dasselbe gilt für Rollen (`<@&…>`), eigene Emoji
// (`<:winke:…>`) und Zeitstempel (`<t:1767225600:F>`) – und für die Auszeichnungen, die jeder
// Discord-Nutzer benutzt, ohne darüber nachzudenken: `**fett**`, `||Spoiler||`, ``` Codeblöcke.
//
// **Die Auflösung kann nur der Bot.** Welcher Name zu welcher Zahl gehört, weiß nur, wer den
// Discord-Server sieht. Er schickt deshalb zu jeder übernommenen Nachricht mit, welche Zahl
// welchen Namen hatte – **zum Zeitpunkt der Nachricht**. Ein Kanal, der später umbenannt wird,
// ändert den Verlauf damit nicht, genau wie in Discord.
//
// **Warum diese Datei von beiden Seiten benutzbar ist.** Sie steht in public/assets/js, wie
// i18n.js und chatlog.js: Der Browser rendert damit den Ticketverlauf, und wer sie serverseitig
// braucht (eine Vorschau, ein Beleg, eine E-Mail), importiert dieselbe Datei. Zwei Fassungen
// desselben Parsers wären zwei Fassungen derselben Sicherheitsfrage.
//
// **Sicherheit.** Aus dieser Datei kommt HTML, und hinein geht Text, den ein Fremder geschrieben
// hat. Es gibt deshalb genau einen Weg, auf dem Text ins Ergebnis gelangt: durch `escapeHtml`.
// Alles andere – Erwähnungen, Links, Codeblöcke – wird vorher aus dem Text herausgenommen und
// als fertiges, selbst gebautes Stück HTML wieder eingesetzt. Die Platzhalter dafür benutzen das
// Nullbyte, und das wird aus der Eingabe als Allererstes entfernt: Damit kann kein geschriebener
// Text je wie ein Platzhalter aussehen.

const MARK = '\u0000';

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Nur Adressen, die wirklich irgendwohin führen. `javascript:` ist keine. */
function safeUrl(raw) {
  const value = String(raw || '').trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^discord:\/\//i.test(value)) return value;
  return '';
}

/**
 * Die Zeitstempel von Discord: `<t:1767225600:F>`.
 *
 * Der Buchstabe sagt, wie ausführlich. `R` ist "vor drei Stunden" – das rechnet Discord im Client
 * aus, und hier ebenso. Alles andere ist ein Datum in der Sprache und Zeitzone dessen, der es
 * liest; genau das ist der Sinn dieser Schreibweise.
 */
const STYLES = {
  t: { hour: '2-digit', minute: '2-digit' },
  T: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  d: { day: '2-digit', month: '2-digit', year: 'numeric' },
  D: { day: 'numeric', month: 'long', year: 'numeric' },
  f: { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  F: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' },
};

/**
 * Die Formatierer, einmal je Sprache und Schreibweise.
 *
 * Ein `Intl`-Objekt zu bauen kostet ein Vielfaches des Formatierens selbst, und ein Ticketverlauf
 * ist eine Liste: Jede Nachricht kann Zeitstempel enthalten, und jeder baute bisher seinen eigenen.
 */
const formatters = new Map();
function formatter(kind, locale, build) {
  const key = `${kind}:${locale}`;
  let found = formatters.get(key);
  if (!found) {
    found = build();
    formatters.set(key, found);
  }
  return found;
}

function timestamp(seconds, style, locale) {
  const at = new Date(Number(seconds) * 1000);
  if (Number.isNaN(at.getTime())) return null;
  if (style === 'R') {
    const diff = at.getTime() - Date.now();
    const units = [
      ['year', 31_536_000_000],
      ['month', 2_592_000_000],
      ['day', 86_400_000],
      ['hour', 3_600_000],
      ['minute', 60_000],
      ['second', 1000],
    ];
    const [unit, size] = units.find(([, ms]) => Math.abs(diff) >= ms) || ['second', 1000];
    return formatter(
      'R',
      locale,
      () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    ).format(Math.round(diff / size), unit);
  }
  const kind = STYLES[style] ? style : 'f';
  return formatter(kind, locale, () => new Intl.DateTimeFormat(locale, STYLES[kind])).format(at);
}

/**
 * Eine Nachricht aus Discord als HTML.
 *
 * `mentions` ist die Auflösung vom Bot: `{ "1538…": { type, name, color } }`. Fehlt sie oder
 * fehlt ein Eintrag darin, bleibt die Erwähnung trotzdem eine Erwähnung – sie heißt dann nur
 * nicht beim Namen. Das ist ehrlicher, als eine zwanzigstellige Zahl im Fließtext stehen zu
 * lassen, und dieselbe Anzeige, die auch Discord wählt, wenn es jemanden nicht mehr findet.
 */
export function renderDiscord(raw, { mentions = {}, locale = 'en', unknown = 'unknown' } = {}) {
  let text = String(raw ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';

  const slots = [];
  // Welche Platzhalter für einen **eigenen Absatz** stehen. Ein Codeblock ist kein Wort in einem
  // Satz; steckte er in dem `<p>`, das `blocks()` um jede Zeile legt, wäre das kein gültiges HTML
  // mehr, und der Browser räumt das auf seine Weise auf – meist so, dass der Rest der Zeile
  // daneben landet.
  const blockSlots = new Set();
  const hold = (html, block = false) => {
    slots.push(html);
    if (block) blockSlots.add(slots.length - 1);
    return `${MARK}${slots.length - 1}${MARK}`;
  };

  // ---- 1. Code. Er kommt zuerst heraus, denn darin gilt nichts von alldem, was danach folgt.
  //
  // Die Umbrüche um den Platzhalter herum sind Absicht: Damit steht ein Codeblock immer allein
  // auf seiner Zeile – auch wenn jemand ihn mitten in einen Satz geschrieben hat. Discord macht
  // es genauso, und `blocks()` erkennt ihn nur dann als eigenen Absatz.
  text = text.replace(/```(?:([a-zA-Z0-9+#._-]{0,20})\n)?([\s\S]*?)```/g, (_match, _lang, body) =>
    `\n${hold(`<pre class="dc-code"><code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`, true)}\n`
  );
  text = text.replace(/`([^`\n]+)`/g, (_match, body) => hold(`<code class="dc-inline">${escapeHtml(body)}</code>`));

  // ---- 2. Was in spitzen Klammern steht: Erwähnungen, Emoji, Zeitstempel.
  const named = (id) => mentions?.[String(id)] || null;

  // Eigene Emoji. Das Bild kommt vom Bildserver von Discord – derselbe Host, von dem auch die
  // Profilbilder kommen, und der einzige, den die Content-Security-Policy dafür zulässt.
  text = text.replace(/<(a?):([\w~]{2,32}):(\d{15,25})>/g, (_match, animated, name, id) =>
    hold(
      `<img class="dc-emoji" src="https://cdn.discordapp.com/emojis/${id}.${
        animated ? 'gif' : 'png'
      }?size=44" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" loading="lazy" decoding="async">`
    )
  );

  text = text.replace(/<t:(-?\d{1,15})(?::([tTdDfFR]))?>/g, (match, seconds, style) => {
    const shown = timestamp(seconds, style, locale);
    return shown ? hold(`<time class="dc-time">${escapeHtml(shown)}</time>`) : match;
  });

  // Ein Slash-Befehl: `</ticket close:123>` – der Name davon ist alles, was zählt.
  text = text.replace(/<\/([\w -]{1,60}):(\d{15,25})>/g, (_match, name) =>
    hold(`<span class="dc-mention">/${escapeHtml(name)}</span>`)
  );

  text = text.replace(/<@!?(\d{15,25})>/g, (_match, id) => {
    const person = named(id);
    return hold(mention('user', person ? person.name : unknown, id, person));
  });
  text = text.replace(/<@&(\d{15,25})>/g, (_match, id) => {
    const role = named(id);
    return hold(mention('role', role ? role.name : unknown, id, role));
  });
  text = text.replace(/<#(\d{15,25})>/g, (_match, id) => {
    const channel = named(id);
    return hold(mention('channel', channel ? channel.name : unknown, id, channel));
  });
  // `@everyone` und `@here` haben keine Zahl – sie stehen so im Text und sehen in Discord
  // trotzdem aus wie eine Erwähnung. Wer sie im Verlauf sieht, soll sehen, dass sie es waren.
  text = text.replace(/(^|[^\w<])@(everyone|here)\b/g, (_match, before, word) =>
    `${before}${hold(`<span class="dc-mention">@${word}</span>`)}`
  );

  // ---- 3. Links. Erst die mit eigenem Text, dann die nackten.
  text = text.replace(/\[([^\]\n]{1,200})\]\(<?(https?:\/\/[^\s)>]+)>?\)/g, (match, label, href) => {
    const target = safeUrl(href);
    if (!target) return match;
    return hold(
      `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    );
  });
  // Nackte Adressen. Discord unterdrückt die Vorschau, wenn sie in spitzen Klammern steht – die
  // Klammern gehören dann nicht in den Text. Satzzeichen am Ende gehören zum Satz und nicht zur
  // Adresse: "Sieh auf https://afksystems.de." endet mit einem Punkt und nicht mit einem Link,
  // der ins Leere führt.
  text = text.replace(/(^|[\s(])<?(https?:\/\/[^\s<>()]+)>?/g, (match, before, href) => {
    const trimmed = href.replace(/[.,;:!?]+$/, '');
    const target = safeUrl(trimmed);
    if (!target) return match;
    const rest = href.slice(trimmed.length);
    return `${before}${hold(
      `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${escapeHtml(target)}</a>`
    )}${rest}`;
  });

  // ---- 4. Ab hier ist alles, was noch Text ist, wirklich Text.
  text = escapeHtml(text);

  // ---- 5. Auszeichnungen. Reihenfolge zählt: das Längere zuerst, sonst frisst `**` das `***`.
  text = text
    // Der Spoiler bleibt in seiner Zeile. Über mehrere Zeilen hinweg stünde sein `<span>` gleich
    // darauf mitten in einer Zeilenaufteilung (`blocks`) – und ein Element, das in einer Zeile
    // aufgeht und in einer anderen zugeht, ist kein HTML mehr.
    .replace(/\|\|([^\n]+?)\|\|/g, '<span class="dc-spoiler" role="button" tabindex="0">$1</span>')
    .replace(/\*\*\*([^\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^\n]+?)__/g, '<u>$1</u>')
    .replace(/~~([^\n]+?)~~/g, '<s>$1</s>')
    .replace(/\*([^\s*][^\n*]*?)\*/g, '<em>$1</em>')
    // Der Unterstrich kursiviert nur zwischen Wortgrenzen. Ohne diese Bedingung würde aus
    // `mein_server_name` ein kursives „server“ – und genau so heißen Serverplätze und Dateien.
    .replace(/(^|[^\w\\])_([^\n_]+)_(?![\w])/g, '$1<em>$2</em>');

  // ---- 6. Zeilen: Zitate, Überschriften, Listen. Discord kennt sie, also kennen wir sie auch.
  const html = blocks(text, (index) => blockSlots.has(index));

  // ---- 7. Und zurück, was vorher herausgenommen wurde.
  return html.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_match, index) => slots[Number(index)] ?? '');
}

/** Eine Erwähnung, so wie Discord sie zeichnet: eine Fläche, kein blauer Link. */
function mention(kind, name, id, meta) {
  const prefix = kind === 'channel' ? '#' : '@';
  const style =
    kind === 'role' && /^#[0-9a-f]{6}$/i.test(String(meta?.color || ''))
      ? ` style="--dc-role:${meta.color}"`
      : '';
  return `<span class="dc-mention dc-${kind}"${style} title="${escapeHtml(`${prefix}${name} · ${id}`)}">${escapeHtml(
    prefix + name
  )}</span>`;
}

/**
 * Die Zeilenstruktur.
 *
 * Discord kennt Zitate (`> `), dreistufige Überschriften (`# `), Aufzählungen (`- `) und
 * nummerierte Listen. Alles andere ist eine Zeile, und Zeilen bleiben Zeilen – ein Umbruch in
 * einer Nachricht ist gewollt und wird nicht zu einem Leerzeichen zusammengezogen.
 */
function blocks(text, isBlock = () => false) {
  const lines = text.split('\n');
  const out = [];
  let quote = null;
  let list = null;

  const closeList = () => {
    if (!list) return;
    out.push(`<${list.tag} class="dc-list">${list.items.map((item) => `<li>${item}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const closeQuote = () => {
    if (quote === null) return;
    out.push(`<blockquote class="dc-quote">${quote.join('<br>')}</blockquote>`);
    quote = null;
  };

  for (const raw of lines) {
    const quoted = /^&gt;&gt;&gt; ?(.*)$/.exec(raw) || /^&gt; ?(.*)$/.exec(raw);
    if (quoted) {
      closeList();
      quote = quote || [];
      quote.push(quoted[1]);
      continue;
    }
    closeQuote();

    const bullet = /^[-*] +(.*)$/.exec(raw);
    const numbered = /^(\d{1,3})[.)] +(.*)$/.exec(raw);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) closeList();
      list = list || { tag, items: [] };
      list.items.push(bullet ? bullet[1] : numbered[2]);
      continue;
    }
    closeList();

    const heading = /^(#{1,3}) +(.*)$/.exec(raw);
    if (heading) {
      const level = heading[1].length + 2; // "# " ist in Discord die größte – hier h3..h5
      out.push(`<h${level} class="dc-head">${heading[2]}</h${level}>`);
      continue;
    }
    // Ein Codeblock steht für sich – kein `<p>` darum, sonst wäre es ungültiges HTML.
    const alone = /^\u0000(\d+)\u0000$/.exec(raw);
    if (alone && isBlock(Number(alone[1]))) {
      out.push(raw);
      continue;
    }
    out.push(raw === '' ? '' : `<p class="dc-line">${raw}</p>`);
  }
  closeQuote();
  closeList();
  // Leere Zeilen zwischen Absätzen sind in Discord ein Abstand und kein Absatz – sie fallen weg,
  // der Abstand kommt aus dem CSS.
  return out.filter((entry) => entry !== '').join('');
}
