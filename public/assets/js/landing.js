// Die öffentlichen Seiten kommen fertig vom Server. Hier bleibt nur, was ohne Browser nicht geht:
// der Schalter fürs Aussehen und der Knopf oben rechts, wenn jemand schon angemeldet ist.

import { api, themeSwitch, applyTheme, tr, url, $ } from './ui.js';

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
