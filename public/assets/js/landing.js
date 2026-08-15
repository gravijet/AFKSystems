// Die Startseite kommt fertig vom Server. Hier bleibt nur, was ohne Browser nicht geht:
// der Monat als Fläche, der Aussehen-Schalter und der Knopf oben rechts, wenn schon angemeldet.

import { api, themeSwitch, applyTheme, tr, url, $ } from './ui.js';

// ---------------------------------------------------------------- Aussehen

const themes = $('#themes');
if (themes) {
  themes.innerHTML = themeSwitch();
  applyTheme();
}

// ---------------------------------------------------------------- Der Monat
//
// 30 Spalten (Tage) mal 24 Zeilen (Stunden) = 720 Blöcke. Genau so viele Stunden hat ein
// Serverplatz im Monat, und genau so wird hier gerechnet. Beim Laden füllt sich die Fläche einmal
// von links nach rechts; der letzte Block ist die laufende Stunde.

const DAYS = 30;
const HOURS = 24;

function drawMonth(box) {
  const now = new Date();
  // Wie weit der laufende Monat schon ist – Tag und Stunde, auf die Fläche übertragen.
  const day = Math.min(DAYS, now.getDate());
  const filled = (day - 1) * HOURS + now.getHours() + 1;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const cells = [];
  for (let index = 0; index < DAYS * HOURS; index += 1) {
    const cell = document.createElement('i');
    if (index < filled) {
      // Ohne Bewegungswunsch stehen alle Blöcke sofort da.
      if (still) cell.classList.add(index === filled - 1 ? 'now' : 'on');
      else if (index < filled - 1) cell.style.transitionDelay = `${Math.round(index * 1.1)}ms`;
    }
    cells.push(cell);
  }
  box.replaceChildren(...cells);

  if (still) return;
  requestAnimationFrame(() => {
    for (let index = 0; index < filled - 1; index += 1) cells[index].classList.add('on');
    setTimeout(() => cells[filled - 1]?.classList.add('now'), Math.round((filled - 1) * 1.1));
  });
}

const month = $('#month-grid');
if (month) drawMonth(month);

// ---------------------------------------------------------------- Angemeldet?

const auth = $('#head-auth');
if (auth) {
  api('/meta')
    .then((meta) => {
      if (meta.user) {
        auth.innerHTML = `<a class="btn btn-primary btn-sm" href="${url('/app')}">${tr('nav.dashboard')}</a>`;
      } else if (!meta.registration_open) {
        auth.querySelector('.btn-primary')?.remove();
      }
    })
    .catch(() => {});
}
