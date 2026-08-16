// Chatzeilen mehrerer Bots zu einem Verlauf zusammenlegen.
//
// Sitzen drei Konten auf demselben Server, hört jedes denselben Chat – und ohne diese Datei stünde
// jede Nachricht des Servers dreimal untereinander. Das ist der Grund, warum es sie gibt.
//
// Sie wird von **beiden Seiten** benutzt: der Server legt damit den Verlauf zusammen, den er
// ausliefert, der Browser das, was live hereinkommt. Deshalb reines ESM ohne Browser-Aufrufe –
// Node kann sie genauso importieren (wie i18n.js).

/** Wie weit zwei gleiche Zeilen auseinanderliegen dürfen und trotzdem dieselbe Nachricht sind. */
const WINDOW_MS = 2500;

/**
 * Zeilen zusammenlegen.
 *
 * Zusammengelegt wird nur echter Chat: Was ein Bot **selbst** gesendet hat (`sent`), was der
 * Client meldet (`status`, `system`, `error`) und was nur einen Bot betrifft, bleibt einzeln –
 * sonst verschwände die Information, welcher Bot gerade nicht mitkommt.
 *
 * Das Ergebnis behält die Reihenfolge und bekommt je Eintrag `accounts`: die Konten, die diese
 * Zeile gehört haben. Eine Zeile, die nicht alle gehört haben, ist damit als solche zu erkennen.
 */
export function mergeLines(list, { windowMs = WINDOW_MS } = {}) {
  const sorted = [...list].sort((a, b) => a.t - b.t);
  const out = [];
  // Zuletzt gesehener Text -> Stelle im Ergebnis. Der Schlüssel enthält den Text, nicht das Konto.
  const seen = new Map();

  for (const entry of sorted) {
    if (entry.type !== 'chat') {
      out.push({ ...entry, accounts: entry.account_id ? [entry.account_id] : [] });
      continue;
    }
    const previous = seen.get(entry.text);
    const merged = previous !== undefined ? out[previous] : null;
    if (merged && entry.t - merged.t <= windowMs) {
      if (entry.account_id && !merged.accounts.includes(entry.account_id)) {
        merged.accounts.push(entry.account_id);
      }
      // Der Zeitstempel bleibt der der ersten Zeile: sie ist die, die wirklich zuerst ankam.
      continue;
    }
    seen.set(entry.text, out.length);
    out.push({ ...entry, accounts: entry.account_id ? [entry.account_id] : [] });
  }
  return out;
}

/**
 * Minecraft-Farbcodes (§) in Abschnitte zerlegen.
 *
 * Zurück kommt eine Liste aus { text, color, bold, italic, underline, strike, obfuscated }. Was
 * daraus wird – HTML im Browser, nichts auf dem Server –, entscheidet der Aufrufer.
 *
 * Unbekannte Codes fallen weg statt als "§?" stehen zu bleiben: Server schicken gern Reste von
 * Hex-Farben mit, und die gehören nicht in eine Anzeige, die aussehen soll wie im Spiel.
 */
const COLORS = {
  0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa',
  4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa',
  8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

const STYLES = { l: 'bold', o: 'italic', n: 'underline', m: 'strike', k: 'obfuscated' };

export function parseFormatting(raw) {
  const text = String(raw ?? '');
  const parts = [];
  let current = { text: '', color: null, bold: false, italic: false, underline: false, strike: false, obfuscated: false };
  const push = () => {
    if (current.text) parts.push({ ...current });
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== '§' || i + 1 >= text.length) {
      current.text += char;
      continue;
    }
    const code = text[i + 1].toLowerCase();
    i += 1;

    // §x§r§r§g§g§b§b – die moderne Schreibweise für eine Hex-Farbe.
    if (code === 'x' && /^(§[0-9a-f]){6}/i.test(text.slice(i + 1))) {
      const hex = text
        .slice(i + 1, i + 13)
        .split('§')
        .join('');
      push();
      // Wie jede Minecraft-Farbe beendet auch eine RGB-Farbe vorherige Auszeichnungen.
      current = {
        text: '',
        color: `#${hex}`,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        obfuscated: false,
      };
      i += 12;
      continue;
    }
    if (code === 'r') {
      push();
      current = { text: '', color: null, bold: false, italic: false, underline: false, strike: false, obfuscated: false };
      continue;
    }
    if (COLORS[code]) {
      push();
      // Eine Farbe setzt in Minecraft auch alle Auszeichnungen zurück.
      current = { text: '', color: COLORS[code], bold: false, italic: false, underline: false, strike: false, obfuscated: false };
      continue;
    }
    if (STYLES[code]) {
      push();
      current = { ...current, text: '', [STYLES[code]]: true };
      continue;
    }
    // Alles andere ist Rest einer Farbe, die dieser Server anders schreibt – weglassen.
  }
  push();
  return parts;
}

/** Nur der Text, ohne Farbcodes – für Suche, Protokolle und alles, was keine Farben zeigt. */
export const stripFormatting = (raw) =>
  parseFormatting(raw)
    .map((part) => part.text)
    .join('');
