// Die öffentlichen Seiten kommen fertig vom Server. Hier bleibt nur, was ohne Browser nicht geht:
// der Schalter fürs Aussehen und der Knopf oben rechts, wenn jemand schon angemeldet ist.

import { api, themeSwitch, applyTheme, tr, url, $ } from './ui.js';

const menuButton = $('.site-menu-toggle');
const menu = $('#site-menu');
const header = document.querySelector('.site-head');

function setMenu(open) {
  if (!menuButton || !menu) return;
  menuButton.setAttribute('aria-expanded', String(open));
  menu.classList.toggle('open', open);
  document.body.classList.toggle('site-menu-open', open);
}

menuButton?.addEventListener('click', () => {
  setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
});
menu?.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenu(false);
});
document.addEventListener('click', (event) => {
  if (menu?.classList.contains('open') && !header?.contains(event.target)) setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu?.classList.contains('open')) {
    setMenu(false);
    menuButton?.focus();
  }
});
window.matchMedia('(min-width: 940px)').addEventListener('change', () => setMenu(false));

const themes = $('#themes');
if (themes) {
  themes.innerHTML = themeSwitch();
  applyTheme();
}

const auth = $('#head-auth');
if (auth) {
  api('/meta')
    .then((meta) => {
      if (meta.user) {
        auth.innerHTML = `<a class="btn btn-primary btn-sm" href="${url('/app')}">${tr('nav.dashboard')}</a>`;
      } else if (!meta.registration_open) {
        // Ist die Registrierung zu, führt der Knopf nur auf eine Seite, die das sagt.
        auth.querySelector('.btn-primary')?.remove();
      }
    })
    .catch(() => {});
}
