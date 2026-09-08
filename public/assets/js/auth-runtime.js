// Kleiner Browser-Unterbau nur für Anmeldung und Wiederherstellung.
//
// Diese Seiten brauchen vier Dinge: ihre Sprache, API-Aufrufe, sprachinterne Adressen und einen
// DOM-Kürzel. Das große ui.js bringt zusätzlich sämtliche Panel-Symbole, Dialoge, Minecraft-
// Formatierung, Profilbilder und Zahlenformate mit. Nichts davon steht auf einem Anmeldeformular,
// also wird es dort auch nicht mehr geladen oder geparst.

const documentElement = document.documentElement;
const pageLang = documentElement.lang === 'de' ? 'de' : 'en';
const stringsUrl = new URL(`./i18n.auth.${pageLang}.js`, import.meta.url).pathname;
const { t, LANGS, LANG } = await import(stringsUrl);

const STORE_KEY = 'afk-lang';

function storedLanguage() {
  try {
    const value = localStorage.getItem(STORE_KEY);
    return LANGS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberLanguage(value) {
  try {
    localStorage.setItem(STORE_KEY, value);
  } catch {
    /* Ein gesperrter Speicher darf die Anmeldung nicht verhindern. */
  }
  document.cookie = `lang=${value}; path=/; max-age=${365 * 86400}; samesite=lax`;
}

const stored = storedLanguage();
if (stored && stored !== LANG && /^\/(en|de)(\/|$)/.test(location.pathname)) {
  document.cookie = `lang=${stored}; path=/; max-age=${365 * 86400}; samesite=lax`;
  location.replace(
    `/${stored}${location.pathname.replace(/^\/(en|de)/, '')}${location.search}${location.hash}`
  );
} else if (!stored) {
  rememberLanguage(LANG);
}

export const tr = (key, vars = null) => t(key, vars);
export const url = (path = '') => `/${LANG}${path}`;
export const $ = (selector, root = document) => root.querySelector(selector);

class ApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body
        ? { 'content-type': 'application/json', 'accept-language': LANG }
        : { 'accept-language': LANG },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(tr('common.offline'), 0, 'offline');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error || tr('common.error'), response.status, data.code || null);
  }
  return data;
}
