// Ein QR-Code als SVG, ohne Abhängigkeit.
//
// **Wofür.** Genau eine Sache: die `otpauth://`-Adresse für die Zwei-Faktor-Anmeldung
// (`server/totp.js`). Eine Authenticator-App will sie abfotografieren; sie abzutippen ist bei
// 32 Zeichen Geheimnis der Weg, auf dem sich jemand vertippt und danach nicht mehr hereinkommt.
//
// **Warum selbst und nicht als Paket.** Der Umfang ist überschaubar und vollständig festgelegt
// (ISO/IEC 18004), und die Alternative wäre eine Abhängigkeit, die genau einmal im Panel
// vorkommt, dafür aber in jeder Sicherheitsmeldung, jedem Update und jedem `npm audit`.
//
// **Was hier absichtlich fehlt.** Alles, was diese eine Adresse nicht braucht:
//
//   * Nur der **Byte-Modus**. Numerisch und alphanumerisch packen dichter, aber eine
//     `otpauth`-Adresse enthält Kleinbuchstaben, Doppelpunkte und Fragezeichen – sie fiele
//     ohnehin in den Byte-Modus.
//   * Nur die **Fehlerkorrekturstufe M** (rund 15 % wiederherstellbar). Das ist die Stufe, die
//     Authenticator-Apps und jeder andere Anbieter für diesen Zweck benutzen.
//   * Nur die **Fassungen 1 bis 10**. Fassung 10 fasst 213 Byte; die längste Adresse, die hier
//     entsteht, hat gut 130. Eine Tabelle für vierzig Fassungen wäre dreißig Zeilen Abschrift,
//     von denen keine je gelesen würde – und jede einzelne eine Gelegenheit für einen Zahlendreher.
//
// Was darüber hinausgeht, wird nicht falsch gezeichnet, sondern abgelehnt.
//
// **Woher die Gewissheit kommt, dass das Bild stimmt.** Ein QR-Code, der falsch ist, sieht aus
// wie einer, der stimmt – man merkt es erst an der Kamera, die nichts findet. Diese Fassung
// wurde deshalb Modul für Modul gegen eine fremde Erzeugung gestellt (das Paket `qrcode`, mit
// erzwungenem Byte-Modus): 815 Eingaben, jede Länge von 1 bis 213 und sechshundert zufällige
// Zeichenketten. 799 davon sind deckungsgleich; die übrigen 16 unterscheiden sich **allein in
// der gewählten Maske**, weil die vierte Strafregel dort aufgerundet wird und hier auf das
// nächste Vielfache von fünf gerundet – so, wie die Norm sie beschreibt. Beide Wahlen ergeben
// einen gültigen Code; welche Maske gilt, steht in der Formatinformation. Vier dieser Bilder
// stehen als feste Vorlage im Test, damit eine spätere Änderung hier nicht unbemerkt bleibt.

// ---------------------------------------------------------------- Galois-Feld GF(256)
//
// Die Fehlerkorrektur ist Reed-Solomon über GF(256) mit dem Polynom 0x11D. Multiplizieren wird
// damit zum Addieren von Logarithmen, und zwei Tabellen mit 256 Einträgen ersetzen jede Schleife.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value;
    LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  // Der zweite Durchgang spart beim Multiplizieren das `% 255`.
  for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Das Generatorpolynom für `count` Fehlerkorrektur-Codewörter: (x−α⁰)(x−α¹)…(x−α^(count−1)). */
function generator(count) {
  let poly = [1];
  for (let index = 0; index < count; index += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let position = 0; position < poly.length; position += 1) {
      next[position] ^= poly[position];
      next[position + 1] ^= mul(poly[position], EXP[index]);
    }
    poly = next;
  }
  return poly;
}

/** Die Fehlerkorrektur-Codewörter eines Blocks: der Rest der Polynomdivision. */
function remainder(data, count) {
  const poly = generator(count);
  const out = new Uint8Array(data.length + count);
  out.set(data);
  for (let index = 0; index < data.length; index += 1) {
    const factor = out[index];
    if (!factor) continue;
    for (let position = 0; position <= count; position += 1) {
      out[index + position] ^= mul(poly[position], factor);
    }
  }
  return out.slice(data.length);
}

// ---------------------------------------------------------------- Die Tabellen, Stufe M
//
// Je Fassung: wie viele Codewörter insgesamt, wie viele Fehlerkorrektur-Codewörter je Block, und
// wie die Datencodewörter auf Blöcke verteilt werden. Die zweite Gruppe hat immer genau ein
// Datencodewort mehr als die erste – so schreibt es die Norm vor, und so steht es hier.

const VERSIONS = [
  // total  ecc  [Blöcke, Daten je Block]  [Blöcke, Daten je Block]
  { total: 26, ecc: 10, groups: [[1, 16]] }, //  1
  { total: 44, ecc: 16, groups: [[1, 28]] }, //  2
  { total: 70, ecc: 26, groups: [[1, 44]] }, //  3
  { total: 100, ecc: 18, groups: [[2, 32]] }, //  4
  { total: 134, ecc: 24, groups: [[2, 43]] }, //  5
  { total: 172, ecc: 16, groups: [[4, 27]] }, //  6
  { total: 196, ecc: 18, groups: [[4, 31]] }, //  7
  { total: 242, ecc: 22, groups: [[2, 38], [2, 39]] }, //  8
  { total: 292, ecc: 22, groups: [[3, 36], [2, 37]] }, //  9
  { total: 346, ecc: 26, groups: [[4, 43], [1, 44]] }, // 10
];

/** Die Mitten der Ausrichtungsmuster. Fassung 1 hat keine. */
const ALIGNMENT = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/**
 * Wie viele Bits am Ende übrig bleiben.
 *
 * Die Datenmatrix fasst nicht immer ein Vielfaches von acht Modulen. Die Norm nennt die Differenz
 * „remainder bits“; sie bleiben null. Für die Fassungen 1 bis 10 sind es null (1), sieben (2–6)
 * und wieder null (7–10).
 */
const remainderBits = (version) => (version >= 2 && version <= 6 ? 7 : 0);

/** Wie viele Byte in eine Fassung passen: Datencodewörter minus Modus (4 Bit) und Länge. */
function capacity(version) {
  const spec = VERSIONS[version - 1];
  const dataCodewords = spec.groups.reduce((sum, [blocks, size]) => sum + blocks * size, 0);
  const header = 4 + (version >= 10 ? 16 : 8);
  return Math.floor((dataCodewords * 8 - header) / 8);
}

// ---------------------------------------------------------------- BCH-Prüfbits

/** Die Länge einer Zahl in Bits. */
const bits = (value) => {
  let length = 0;
  let rest = value;
  while (rest) {
    length += 1;
    rest >>>= 1;
  }
  return length;
};

/**
 * Die fünfzehn Bit der Formatinformation: zwei Bit Stufe, drei Bit Maske, zehn Bit BCH – und das
 * Ganze gegen 0x5412 verrechnet, damit eine leere Formatinformation kein gültiges Muster ergibt.
 * Stufe M ist `00`.
 */
function formatBits(mask) {
  const data = (0b00 << 3) | mask;
  let rest = data << 10;
  while (bits(rest) >= 11) rest ^= 0x537 << (bits(rest) - 11);
  return ((data << 10) | rest) ^ 0x5412;
}

/** Die achtzehn Bit der Fassungsinformation. Erst ab Fassung 7 steht sie im Bild. */
function versionBits(version) {
  let rest = version << 12;
  while (bits(rest) >= 13) rest ^= 0x1f25 << (bits(rest) - 13);
  return (version << 12) | rest;
}

// ---------------------------------------------------------------- Die Daten

/** Modus, Länge, Nutzlast, Abschluss, Füllung – die Datencodewörter einer Fassung. */
function encodeData(bytes, version) {
  const spec = VERSIONS[version - 1];
  const dataCodewords = spec.groups.reduce((sum, [blocks, size]) => sum + blocks * size, 0);
  const stream = [];
  const push = (value, length) => {
    for (let index = length - 1; index >= 0; index -= 1) stream.push((value >> index) & 1);
  };

  push(0b0100, 4); // Byte-Modus
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) push(byte, 8);

  // Abschluss: bis zu vier Nullbits, aber nur so viele, wie noch hineinpassen.
  const room = dataCodewords * 8 - stream.length;
  push(0, Math.min(4, room));
  while (stream.length % 8) stream.push(0);

  const out = new Uint8Array(dataCodewords);
  for (let index = 0; index < stream.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | stream[index + bit];
    out[index / 8] = byte;
  }
  // Auffüllen mit dem vorgeschriebenen Wechsel aus 0xEC und 0x11.
  for (let index = stream.length / 8; index < dataCodewords; index += 1) {
    out[index] = index % 2 === Math.ceil(stream.length / 8) % 2 ? 0xec : 0x11;
  }
  return out;
}

/**
 * Blöcke bilden, Fehlerkorrektur rechnen, verschränken.
 *
 * Verschränkt heißt: erst das erste Codewort jedes Blocks, dann das zweite, und so weiter. Ein
 * Kratzer über dem Bild trifft damit von jedem Block ein Stück statt einen Block ganz – und
 * fünfzehn Prozent Verlust verteilt sind zu reparieren, fünfzehn Prozent an einer Stelle nicht.
 */
function interleave(data, version) {
  const spec = VERSIONS[version - 1];
  const blocks = [];
  let offset = 0;
  for (const [count, size] of spec.groups) {
    for (let index = 0; index < count; index += 1) {
      const part = data.subarray(offset, offset + size);
      offset += size;
      blocks.push({ data: part, ecc: remainder(part, spec.ecc) });
    }
  }

  const out = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let index = 0; index < longest; index += 1) {
    for (const block of blocks) if (index < block.data.length) out.push(block.data[index]);
  }
  for (let index = 0; index < spec.ecc; index += 1) {
    for (const block of blocks) out.push(block.ecc[index]);
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------- Das Bild

/** Die festen Muster: Sucher, Trenner, Taktlinien, Ausrichtung, das eine dunkle Modul. */
function functionPatterns(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const set = (row, column, value) => {
    if (row >= 0 && row < size && column >= 0 && column < size) modules[row][column] = value;
  };

  // Sucher samt Trennlinie, dreimal.
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const inner = row >= 2 && row <= 4 && column >= 2 && column <= 4;
        const ring = row === 0 || row === 6 || column === 0 || column === 6;
        const outside = row < 0 || row > 6 || column < 0 || column > 6;
        set(top + row, left + column, outside ? 0 : ring || inner ? 1 : 0);
      }
    }
  }

  // Taktlinien.
  for (let index = 8; index < size - 8; index += 1) {
    const value = index % 2 === 0 ? 1 : 0;
    modules[6][index] = value;
    modules[index][6] = value;
  }

  // Ausrichtungsmuster – überall dort, wo kein Sucher steht.
  const centers = ALIGNMENT[version - 1];
  for (const row of centers) {
    for (const column of centers) {
      const nearFinder =
        (row === 6 && column === 6) ||
        (row === 6 && column === size - 7) ||
        (row === size - 7 && column === 6);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const edge = Math.max(Math.abs(dy), Math.abs(dx));
          modules[row + dy][column + dx] = edge === 1 ? 0 : 1;
        }
      }
    }
  }

  // Die Plätze der Formatinformation freihalten, dazu das immer dunkle Modul.
  for (let index = 0; index < 9; index += 1) {
    if (modules[8][index] === -1) modules[8][index] = 0;
    if (modules[index][8] === -1) modules[index][8] = 0;
  }
  for (let index = 0; index < 8; index += 1) {
    if (modules[8][size - 1 - index] === -1) modules[8][size - 1 - index] = 0;
    if (modules[size - 1 - index][8] === -1) modules[size - 1 - index][8] = 0;
  }
  modules[size - 8][8] = 1;

  // Die Fassungsinformation steht erst ab Fassung 7 im Bild, zweimal, um 90° gedreht.
  if (version >= 7) {
    const value = versionBits(version);
    for (let index = 0; index < 18; index += 1) {
      const bit = (value >> index) & 1;
      const row = Math.floor(index / 3);
      const column = index % 3;
      modules[row][size - 11 + column] = bit;
      modules[size - 11 + column][row] = bit;
    }
  }
  return modules;
}

/** Die Datenbits in den Zickzack legen: von rechts unten, zwei Spalten auf einmal. */
function placeData(modules, codewords, version) {
  const size = modules.length;
  let bitIndex = 0;
  const total = codewords.length * 8 + remainderBits(version);
  const nextBit = () => {
    if (bitIndex >= total) return 0;
    const byte = codewords[bitIndex >> 3] ?? 0;
    const bit = (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex += 1;
    return bit;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // Die senkrechte Taktlinie in Spalte 6 zählt nicht mit. Ab hier rücken alle Paare um eins
    // nach links: … (8,7), (5,4), (3,2), (1,0). Verschoben werden muss dafür `right` selbst –
    // nur die Spaltennummer zu verschieben, ließe das nächste Paar bei 4 statt bei 3 beginnen,
    // und dann steht eine Spalte zweimal in der Reihe und die letzte gar nicht.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (modules[row][column] !== -1) continue;
        modules[row][column] = nextBit();
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (row, column) => (row + column) % 2 === 0,
  (row) => row % 2 === 0,
  (_row, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
  (row, column) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
];

/**
 * Wie unangenehm ein Bild für einen Leser ist.
 *
 * Vier Regeln aus der Norm: lange gleichfarbige Ketten, 2×2-Blöcke, Muster, die einem Sucher
 * ähneln, und ein zu einseitiges Verhältnis von Hell und Dunkel. Die Maske mit der kleinsten
 * Summe gewinnt.
 */
function penalty(modules) {
  const size = modules.length;
  let score = 0;

  // Regel 1: fünf oder mehr gleiche in Folge, waagerecht und senkrecht.
  for (let index = 0; index < size; index += 1) {
    for (const read of [(step) => modules[index][step], (step) => modules[step][index]]) {
      let run = 1;
      for (let step = 1; step < size; step += 1) {
        if (read(step) === read(step - 1)) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Regel 2: jeder gleichfarbige 2×2-Block.
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const value = modules[row][column];
      if (
        value === modules[row][column + 1] &&
        value === modules[row + 1][column] &&
        value === modules[row + 1][column + 1]
      ) {
        score += 3;
      }
    }
  }

  // Regel 3: das Muster 1:1:3:1:1 mit vier hellen Modulen daneben – es sieht aus wie ein Sucher.
  const finder = [1, 0, 1, 1, 1, 0, 1];
  const light = [0, 0, 0, 0];
  const matches = (line, at, pattern) => pattern.every((value, offset) => line[at + offset] === value);
  for (let index = 0; index < size; index += 1) {
    const row = Array.from({ length: size }, (_, step) => modules[index][step]);
    const column = Array.from({ length: size }, (_, step) => modules[step][index]);
    for (const line of [row, column]) {
      for (let at = 0; at + 7 <= size; at += 1) {
        if (!matches(line, at, finder)) continue;
        // Vier helle Module davor und vier dahinter sind **zwei** Fundstellen, nicht eine: Die
        // Norm sucht nach zwei elf Module langen Mustern, und wo beide passen, zählen beide.
        if (at >= 4 && matches(line, at - 4, light)) score += 40;
        if (at + 11 <= size && matches(line, at + 7, light)) score += 40;
      }
    }
  }

  // Regel 4: wie weit das Verhältnis Dunkel/Hell von der Hälfte abweicht.
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) dark += modules[row][column];
  }
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Die Formatinformation an ihre zwei Plätze schreiben.
 *
 * Sie steht zweimal im Bild: einmal als Winkel um den linken oberen Sucher, einmal verteilt auf
 * unten links und oben rechts. Zweimal deshalb, weil ohne sie nichts zu lesen ist – sie sagt,
 * welche Maske gilt. Wäre sie nur einmal da und ausgerechnet dort beschädigt, wäre der ganze
 * Code verloren, auch wenn jedes Datenmodul heil ist.
 *
 * Die Bits laufen vom niedrigsten aufwärts, und der Winkel ist **senkrecht zuerst**: Bit 0 bis 8
 * stehen in Spalte 8 von oben nach unten (Zeile 6 ist Taktlinie und wird übersprungen), Bit 8
 * bis 14 in Zeile 8 von rechts nach links (Spalte 6 ebenso).
 */
function placeFormat(modules, mask) {
  const size = modules.length;
  const value = formatBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const bit = (value >> index) & 1;

    // Winkel am linken oberen Sucher: erst die Spalte, dann die Zeile.
    if (index < 6) modules[index][8] = bit;
    else if (index < 8) modules[index + 1][8] = bit;
    else modules[size - 15 + index][8] = bit;

    if (index < 8) modules[8][size - 1 - index] = bit;
    else if (index === 8) modules[8][7] = bit;
    else modules[8][14 - index] = bit;
  }
  // Das eine Modul, das immer dunkel ist. Es steht nicht in der Formatinformation, wird von ihr
  // aber überschrieben, sobald `size - 15 + index` bei index = 7 auf diese Zeile fällt.
  modules[size - 8][8] = 1;
}

/**
 * Der fertige Code als Matrix aus 0 und 1.
 *
 * Alle acht Masken werden gebaut und bewertet; genommen wird die mit der kleinsten Strafe – bei
 * Gleichstand die mit der kleineren Nummer. Das ist kein Feinschliff, sondern Teil der Norm: Eine
 * ungünstige Maske erzeugt Flächen, die ein Leser für Sucher hält, und macht das Bild unlesbar.
 *
 * `mask` erzwingt eine bestimmte Maske. Dafür gibt es genau einen Grund: Der Test vergleicht
 * damit Maske für Maske gegen eine fremde Erzeugung. Im Betrieb wird der Wert nicht gesetzt.
 */
export function matrix(text, { mask = null } = {}) {
  const bytes = Buffer.from(String(text), 'utf8');
  const version = VERSIONS.findIndex((_, index) => bytes.length <= capacity(index + 1)) + 1;
  if (!version) {
    throw new Error(`QR: ${bytes.length} Byte passen in keine Fassung bis 10 (höchstens ${capacity(10)}).`);
  }

  const codewords = interleave(encodeData(bytes, version), version);
  const base = functionPatterns(version);
  const reserved = base.map((row) => row.map((value) => value !== -1));
  placeData(base, codewords, version);

  const withMask = (number) => {
    const candidate = base.map((row, y) =>
      Array.from(row, (value, x) => (!reserved[y][x] && MASKS[number](y, x) ? value ^ 1 : value))
    );
    placeFormat(candidate, number);
    return candidate;
  };

  if (mask !== null) return withMask(mask);

  let best = null;
  for (let number = 0; number < 8; number += 1) {
    const candidate = withMask(number);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { score, modules: candidate };
  }
  return best.modules;
}

/** Die Strafpunkte eines Bildes. Öffentlich, damit der Test die Maskenwahl nachrechnen kann. */
export const score = (modules) => penalty(modules);

/**
 * Derselbe Code als SVG.
 *
 * Ein einziger Pfad statt eines Rechtecks je Modul: Ein Bild aus 45 × 45 Modulen wären
 * zweitausend Elemente, und die reisen als Text durch die Leitung und danach durch den
 * Layoutbaum des Browsers. `shape-rendering: crispEdges` verhindert, dass der Browser die Kanten
 * weichzeichnet – ein weichgezeichneter QR-Code ist einer, den die Kamera nicht mehr liest.
 *
 * Die vier Module Rand sind vorgeschrieben („quiet zone“). Ohne sie findet ein Leser die Sucher
 * nicht, und der Code ist auf hellem Grund trotzdem unlesbar.
 */
export function svg(text, { quiet = 4, label = '' } = {}) {
  const modules = matrix(text);
  const size = modules.length;
  const span = size + quiet * 2;

  let path = '';
  for (let row = 0; row < size; row += 1) {
    let run = 0;
    for (let column = 0; column <= size; column += 1) {
      const dark = column < size && modules[row][column] === 1;
      if (dark) {
        run += 1;
        continue;
      }
      if (run) path += `M${column - run + quiet} ${row + quiet}h${run}v1h-${run}z`;
      run = 0;
    }
  }

  const title = label ? `<title>${label.replace(/[<>&"]/g, '')}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR">${title}` +
    `<rect width="${span}" height="${span}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/></svg>`
  );
}
