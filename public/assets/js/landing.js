// Die öffentlichen Seiten kommen fertig vom Server. Dieser kleine Einstieg enthält nur Verhalten,
// das HTML und CSS allein nicht leisten: mobiles Menü, lokale Sprache/Aussehen und der Sitzungs-
// status in der Kopfleiste. Er importiert absichtlich kein Panel-Modul.

const $ = (selector, root = document) => root.querySelector(selector);
const pageLang = document.documentElement.lang === 'de' ? 'de' : 'en';

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ein gesperrter lokaler Speicher darf keine Bedienung der Seite verhindern.
    }
  },
};

// Ein alter Sprachwunsch gilt weiterhin, wenn jemand eine sprachneutrale Verknüpfung öffnet. Beim
// bewussten Klick auf den Umschalter wird der Wert schon vor der Navigation geändert.
const storedLang = storage.get('afk-lang');
if (storedLang && storedLang !== pageLang && /^\/(en|de)(\/|$)/.test(location.pathname)) {
  document.cookie = `lang=${storedLang}; path=/; max-age=${365 * 86400}; samesite=lax`;
  location.replace(
    `/${storedLang}${location.pathname.replace(/^\/(en|de)/, '')}${location.search}${location.hash}`
  );
} else if (!storedLang) {
  storage.set('afk-lang', pageLang);
}

$('.language-switch')?.addEventListener('click', (event) => {
  const link = event.currentTarget;
  const next = link.dataset.language;
  if (next !== 'de' && next !== 'en') return;
  storage.set('afk-lang', next);
  document.cookie = `lang=${next}; path=/; max-age=${365 * 86400}; samesite=lax`;
  const target = new URL(link.href);
  target.search = location.search;
  target.hash = location.hash;
  link.href = target.href;
});

const menuButton = $('.site-menu-toggle');
const menu = $('#site-menu');
const header = $('.site-head');

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

function applyTheme(value) {
  const theme = value || storage.get('afk-theme') || 'system';
  storage.set('afk-theme', theme);
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('#themes button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  });
}

$('#themes')?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-theme]');
  if (button) applyTheme(button.dataset.theme);
});
applyTheme();

// Loginstatus ist keine Voraussetzung für den ersten sichtbaren Inhalt. In einer ruhigen Phase
// genügt die kleine Header-Antwort; spätestens nach 800 ms beginnt sie auch unter Dauerlast.
const auth = $('#head-auth');
async function updateAuth() {
  if (!auth) return;
  try {
    const response = await fetch('/api/meta?scope=header', {
      headers: { 'accept-language': pageLang },
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const meta = await response.json();
    if (meta.user) {
      const link = document.createElement('a');
      link.className = 'btn btn-primary btn-sm';
      link.href = auth.dataset.dashboardHref;
      link.textContent = auth.dataset.dashboardLabel;
      auth.replaceChildren(link);
    } else if (!meta.registration_open) {
      auth.querySelector('.btn-primary')?.remove();
    }
  } catch {
    // Die statischen Anmeldeknöpfe bleiben eine vollständig brauchbare Rückfallebene.
  }
}

if ('requestIdleCallback' in window) requestIdleCallback(updateAuth, { timeout: 800 });
else setTimeout(updateAuth, 1);
