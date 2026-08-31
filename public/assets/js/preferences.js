// Persönliche Arbeitsweise dieses Browsers.
//
// Sprache und E-Mail-Wünsche gehören ans Konto und liegen auf dem Server. Dichte, Bewegung,
// Favoriten und die gewünschte Startseite sind dagegen eine Eigenschaft des Geräts: auf dem
// kleinen Notebook darf das Panel kompakt sein, auf dem Telefon bequem. Deshalb stehen diese
// Werte bewusst im lokalen Speicher – aber je Nutzer getrennt, falls mehrere dasselbe Gerät
// verwenden.

const DEFAULTS = Object.freeze({
  density: 'comfortable',
  motion: 'system',
  start: 'overview',
  favoriteServers: [],
  lastRoute: '#/',
  serverView: 'cards',
});

const allowed = {
  density: ['comfortable', 'compact'],
  motion: ['system', 'reduced'],
  start: ['overview', 'last'],
  serverView: ['cards', 'list'],
};

const keyOf = (userId) => `afk-preferences-${Number(userId) || 'guest'}`;

function clean(raw) {
  const next = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return next;
  for (const [key, values] of Object.entries(allowed)) {
    if (values.includes(raw[key])) next[key] = raw[key];
  }
  if (Array.isArray(raw.favoriteServers)) {
    next.favoriteServers = [...new Set(raw.favoriteServers.map(Number).filter(Number.isInteger))].slice(0, 100);
  }
  if (typeof raw.lastRoute === 'string' && /^#\/(?:[a-z-]+)?(?:\/\d+)?(?:\/[a-z-]+)?$/.test(raw.lastRoute)) {
    next.lastRoute = raw.lastRoute;
  }
  return next;
}

export function preferences(userId) {
  try {
    return clean(JSON.parse(localStorage.getItem(keyOf(userId)) || '{}'));
  } catch {
    return { ...DEFAULTS };
  }
}

function write(userId, value) {
  const next = clean(value);
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(next));
  } catch {
    /* Im privaten Modus gilt die Wahl bis zum nächsten Neuladen über die DOM-Attribute weiter. */
  }
  window.dispatchEvent(new CustomEvent('afk:preferences', { detail: next }));
  return next;
}

export function setPreference(userId, name, value) {
  const current = preferences(userId);
  if (name === 'favoriteServers') current.favoriteServers = value;
  else if (allowed[name]?.includes(value)) current[name] = value;
  const next = write(userId, current);
  applyPreferences(userId);
  return next;
}

export function applyPreferences(userId) {
  const value = preferences(userId);
  document.documentElement.dataset.density = value.density;
  if (value.motion === 'reduced') document.documentElement.dataset.motion = 'reduced';
  else document.documentElement.removeAttribute('data-motion');
  return value;
}

export function isFavoriteServer(userId, profileId) {
  return preferences(userId).favoriteServers.includes(Number(profileId));
}

export function toggleFavoriteServer(userId, profileId) {
  const value = preferences(userId);
  const id = Number(profileId);
  value.favoriteServers = value.favoriteServers.includes(id)
    ? value.favoriteServers.filter((entry) => entry !== id)
    : [id, ...value.favoriteServers];
  return write(userId, value).favoriteServers.includes(id);
}

export function rememberRoute(userId, hash) {
  if (!userId || !hash || hash.startsWith('#/admin')) return;
  const value = preferences(userId);
  if (value.lastRoute === hash) return;
  value.lastRoute = hash;
  write(userId, value);
}

/** Eine gelöschte Server-ID darf beim Start nicht in einer Sackgasse enden. */
export function startHash(userId, profiles = []) {
  const value = preferences(userId);
  if (value.start !== 'last') return '#/';
  const match = /^#\/servers\/(\d+)/.exec(value.lastRoute);
  if (match && !profiles.some((profile) => profile.id === Number(match[1]))) return '#/servers';
  return value.lastRoute || '#/';
}
