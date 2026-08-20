// Diagramme. SVG, von Hand, ohne Bibliothek.
//
// Warum keine Bibliothek: Das Panel lädt seine Module ohne Bauschritt direkt im Browser. Eine
// Diagrammbibliothek wäre das mit Abstand größte Stück Fremdcode im ganzen Projekt – für vier
// Formen, die zusammen keine dreihundert Zeilen brauchen. Und sie brächte ihre eigenen Farben mit,
// die dann neben den unseren stünden.
//
// Vier Formen, und jede beantwortet eine andere Frage:
//
//   * `line`    – wie hat sich eine Zahl über die Zeit entwickelt (eine Reihe, Fläche darunter)
//   * `bars`    – wie groß ist etwas je Zeitabschnitt (eine Reihe, senkrechte Balken)
//   * `hbars`   – wie groß ist etwas je Sache mit Namen (waagerecht, weil Namen waagerecht sind)
//   * `stacked` – woraus setzt sich ein Ganzes zusammen (ein Balken, mehrere Abschnitte)
//
// Was hier **nicht** steht: Tortendiagramme (Winkel lassen sich nicht vergleichen), zwei
// Werteachsen in einem Bild (die Kreuzung der beiden Kurven bedeutet dann nichts) und Farben, die
// aus einer Reihenfolge entstehen statt aus einer Sache.
//
// ## Farben
//
// Die Reihenfolge unten steht fest und wird nie durchgezählt: Reihe 3 hat immer dieselbe Farbe,
// auch wenn Reihe 1 gerade weggefiltert ist. Sie ist gegen die drei häufigen Farbfehlsichtigkeiten
// geprüft (Protanopie, Deuteranopie, Tritanopie) – der engste Nachbarabstand liegt bei ΔE 9,1 hell
// und 8,4 dunkel, über der Schwelle von 8. Zwei der hellen Töne kommen auf dem weißen Grund nicht
// auf 3:1 Kontrast; deshalb trägt **jedes** Diagramm mit mehr als einer Reihe eine beschriftete
// Legende, und die Farbe ist nie das einzige Unterscheidungsmerkmal.
//
// Die Zustandsfarben (--ok, --warn, --bad) bleiben Zuständen vorbehalten und tauchen hier nicht
// als "Reihe 4" auf.

import { escapeHtml } from './ui.js';

/** Die feste Reihenfolge der Reihenfarben. Hell und dunkel sind derselbe Farbton, anders gestuft. */
export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];

const NS = 'http://www.w3.org/2000/svg';

/** Eine Zahl, die in ein SVG-Attribut darf. */
const num = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);

/** Eine hübsche Obergrenze: 0…1 → 1, 0…7 → 8, 0…23 → 25 … */
function ceiling(max) {
  if (!(max > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (max <= magnitude * step) return magnitude * step;
  }
  return magnitude * 10;
}

/**
 * Der Rahmen, den alle Formen teilen: Fläche, Höhe, Gitter, Achsenbeschriftung.
 *
 * `format` macht aus einer Zahl den Text, der an ihr steht – Credits, Euro, Stück. Es steht an
 * **einer** Stelle je Diagramm, damit die Achse links und die Sprechblase beim Zeigen nie
 * unterschiedlich rechnen.
 */
function frame({ height = 160, top = 12, right = 8, bottom = 22, left = 44 } = {}) {
  return { height, top, right, bottom, left, plotHeight: height - top - bottom };
}

/** Vier waagerechte Hilfslinien und ihre Beschriftung. Zurückhaltend: sie sind Hintergrund. */
function grid(box, max, format, width) {
  const lines = [];
  for (let i = 0; i <= 4; i++) {
    const value = (max / 4) * i;
    const y = box.top + box.plotHeight - (box.plotHeight * i) / 4;
    lines.push(
      `<line x1="${box.left}" y1="${num(y)}" x2="${width - box.right}" y2="${num(y)}" class="c-grid"/>`,
      `<text x="${box.left - 6}" y="${num(y + 3.5)}" class="c-axis" text-anchor="end">${escapeHtml(
        format(value)
      )}</text>`
    );
  }
  return lines.join('');
}

const wrap = (width, height, inner, klass = '') =>
  `<svg class="chart ${klass}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
    role="img" xmlns="${NS}">${inner}</svg>`;

/**
 * Eine Zahl über die Zeit: Linie mit gefüllter Fläche darunter.
 *
 * Eine Reihe, deshalb keine Legende – der Titel über dem Diagramm sagt, was gezeigt wird. Beim
 * Zeigen erscheint eine Sprechblase mit dem genauen Wert (siehe `bindHover`).
 */
export function line(points, { format = String, height = 160, color = SERIES[0] } = {}) {
  const width = 320;
  const box = frame({ height });
  if (!points.length) return empty(width, height);
  const max = ceiling(Math.max(...points.map((point) => point.value)));
  const span = width - box.left - box.right;
  const step = points.length > 1 ? span / (points.length - 1) : 0;
  const at = (index) => box.left + (points.length > 1 ? index * step : span / 2);
  const height_ = (value) => box.top + box.plotHeight - (box.plotHeight * value) / max;

  const path = points.map((point, index) => `${index ? 'L' : 'M'}${num(at(index))} ${num(height_(point.value))}`).join(' ');
  const area = `${path} L${num(at(points.length - 1))} ${num(box.top + box.plotHeight)} L${num(
    at(0)
  )} ${num(box.top + box.plotHeight)} Z`;

  // Nicht an jedem Punkt eine Zahl: Der letzte Wert ist der, um den es geht, und der steht als
  // große Zahl über dem Diagramm. Hier bleibt nur der Punkt darauf.
  const last = points[points.length - 1];
  const dots = points
    .map(
      (point, index) =>
        `<circle cx="${num(at(index))}" cy="${num(height_(point.value))}" r="${
          point === last ? 3.5 : 0
        }" class="c-dot" style="--c:${color}"><title>${escapeHtml(
          `${point.label}: ${format(point.value)}`
        )}</title></circle>`
    )
    .join('');

  const labels = tickLabels(points, at, box, height);
  return wrap(
    width,
    height,
    `${grid(box, max, format, width)}
     <path d="${area}" class="c-area" style="--c:${color}"/>
     <path d="${path}" class="c-line" style="--c:${color}"/>
     ${dots}${labels}`
  );
}

/** Senkrechte Balken je Zeitabschnitt. Eine Reihe, dieselbe Farbe für alle. */
export function bars(points, { format = String, height = 160, color = SERIES[0] } = {}) {
  const width = 320;
  const box = frame({ height });
  if (!points.length) return empty(width, height);
  const max = ceiling(Math.max(...points.map((point) => point.value)));
  const span = width - box.left - box.right;
  const slot = span / points.length;
  // Der Grund zwischen zwei Balken ist die Trennung – keine Linie darüber. Bei dreißig Tagen auf
  // 270 Pixeln sind feste 4 Pixel Abstand aber mehr als die halbe Breite: Dann bleiben Striche
  // übrig, die man einzeln nicht mehr treffen kann. Der Abstand wächst deshalb mit dem Platz.
  const barWidth = Math.max(2, Math.min(28, slot - Math.min(4, slot * 0.25)));

  const rects = points
    .map((point, index) => {
      const x = box.left + index * slot + (slot - barWidth) / 2;
      const value = (box.plotHeight * point.value) / max;
      const y = box.top + box.plotHeight - value;
      return `<rect x="${num(x)}" y="${num(y)}" width="${num(barWidth)}" height="${num(
        Math.max(value, point.value > 0 ? 1.5 : 0)
      )}" rx="2" class="c-bar" style="--c:${point.color || color}"><title>${escapeHtml(
        `${point.label}: ${format(point.value)}`
      )}</title></rect>`;
    })
    .join('');

  const labels = tickLabels(points, (index) => box.left + index * slot + slot / 2, box, height);
  return wrap(width, height, `${grid(box, max, format, width)}${rects}${labels}`);
}

/**
 * Waagerechte Balken je Sache mit Namen.
 *
 * Waagerecht, weil Namen waagerecht sind: Gedrehte Beschriftungen unter senkrechten Balken sind
 * der häufigste Grund, warum ein Diagramm unlesbar ist.
 */
export function hbars(rows, { format = String, color = SERIES[0], max: given = null } = {}) {
  if (!rows.length) return '<p class="small muted">–</p>';
  const max = given || Math.max(...rows.map((row) => row.value), 1);
  return `<ul class="hbars">${rows
    .map(
      (row) => `<li>
        <span class="hbar-label truncate" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
        <span class="hbar-track">
          <span class="hbar-fill" style="width:${num((row.value / max) * 100)}%;--c:${row.color || color}"></span>
        </span>
        <span class="hbar-value mono">${escapeHtml(format(row.value))}</span>
      </li>`
    )
    .join('')}</ul>`;
}

/**
 * Woraus sich ein Ganzes zusammensetzt: ein Balken, mehrere Abschnitte, darunter die Legende.
 *
 * Die Legende steht immer da und trägt Namen und Zahl – die Farbe allein müsste sonst reichen, und
 * zwei der hellen Töne kommen auf weißem Grund nicht auf den nötigen Kontrast.
 */
export function stacked(segments, { format = String } = {}) {
  const total = segments.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
  if (!total) return '<p class="small muted">–</p>';
  return `<div class="stack">
    <div class="stack-bar">${segments
      .filter((entry) => entry.value > 0)
      .map(
        (entry, index) =>
          `<span class="stack-part" style="width:${num((entry.value / total) * 100)}%;--c:${
            entry.color || SERIES[index % SERIES.length]
          }" title="${escapeHtml(`${entry.label}: ${format(entry.value)}`)}"></span>`
      )
      .join('')}</div>
    <ul class="legend">${segments
      .map(
        (entry, index) =>
          `<li><span class="swatch" style="--c:${entry.color || SERIES[index % SERIES.length]}"></span>
            ${escapeHtml(entry.label)}
            <span class="mono muted">${escapeHtml(format(entry.value))}</span></li>`
      )
      .join('')}</ul>
  </div>`;
}

/** Eine Legende für Formen, die mehrere Reihen zeigen. */
export const legend = (entries) =>
  `<ul class="legend">${entries
    .map(
      (entry, index) =>
        `<li><span class="swatch" style="--c:${entry.color || SERIES[index % SERIES.length]}"></span>${escapeHtml(
          entry.label
        )}</li>`
    )
    .join('')}</ul>`;

/**
 * Beschriftung der Zeitachse – aber nicht an jedem Punkt.
 *
 * Zwölf Monatsnamen nebeneinander auf 320 Pixeln überlappen sich. Beschriftet wird deshalb jeder
 * n-te Punkt, so dass höchstens sechs Beschriftungen dastehen, und der letzte immer: er ist der,
 * den jeder zuerst sucht.
 */
function tickLabels(points, at, box, height) {
  const every = Math.max(1, Math.ceil(points.length / 6));
  return points
    .map((point, index) => {
      if (index % every !== 0 && index !== points.length - 1) return '';
      const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
      return `<text x="${num(at(index))}" y="${height - 6}" class="c-axis" text-anchor="${anchor}">${escapeHtml(
        point.short || point.label
      )}</text>`;
    })
    .join('');
}

const empty = (width, height) =>
  wrap(width, height, `<text x="${width / 2}" y="${height / 2}" class="c-axis" text-anchor="middle">–</text>`);

/**
 * Eine Kachel: Überschrift, große Zahl, Diagramm, ein Satz darunter.
 *
 * Die große Zahl steht **über** dem Diagramm und nicht darin. Ein Diagramm beantwortet "wie hat es
 * sich entwickelt"; die Frage "wie ist es jetzt" beantwortet eine Zahl, und zwar schneller.
 */
export const card = ({ title, value = '', note = '', chart = '', foot = '' }) => `
  <section class="panel chart-card">
    <header><h3>${escapeHtml(title)}</h3>${
      note ? `<span class="small muted">${escapeHtml(note)}</span>` : ''
    }</header>
    <div class="body">
      ${value !== '' ? `<div class="chart-value">${value}</div>` : ''}
      ${chart}
      ${foot ? `<p class="small muted" style="margin:.6rem 0 0">${foot}</p>` : ''}
    </div>
  </section>`;
