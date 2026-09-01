// Persönliche Arbeitsweise dieses Browsers.
//
// Sprache und E-Mail-Wünsche gehören ans Konto und liegen auf dem Server. Dichte, Bewegung,
// Favoriten und die gewünschte Startseite sind dagegen eine Eigenschaft des Geräts: auf dem
// kleinen Notebook darf das Panel kompakt sein, auf dem Telefon bequem. Deshalb stehen diese
// Werte bewusst im lokalen Speicher – aber je Nutzer getrennt, falls mehrere dasselbe Gerät
// verwenden.

/**
 * Womit jemand anfängt, der noch nichts eingestellt hat.
 *
 * **Kompakt ist die Vorgabe.** Das Panel ist eine Arbeitsfläche und keine Broschüre: Wer hier ist,
 * hat mehrere Serverplätze, eine Kontenliste, einen Chatverlauf und eine Übersicht offen und will
 * davon so viel wie möglich gleichzeitig sehen. „Bequem“ bleibt einen Klick entfernt.
 */
const DEFAULTS = Object.freeze({
  density: 'compact',
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

/**
 * Die Fassung dieses Speicherformats. Steht als `v` im gespeicherten Satz.
 *
 * 2 ist die erste, die nur noch Abweichungen speichert (siehe `thin`) – und die einmalige
 * Bereinigung darunter hängt daran.
 */
const VERSION = 2;

/**
 * Der eine Umzug von Fassung 1 auf 2: ein `density: 'comfortable'` fällt weg.
 *
 * In Fassung 1 schrieb jeder Speichervorgang den **ganzen** Satz weg, also auch die Werte, die
 * niemand gewählt hatte. Wer je einen Serverplatz mit dem Stern markiert hat, trug seitdem die
 * damalige Vorgabe „bequem“ mit sich – und hätte die neue Vorgabe „kompakt“ nie zu sehen bekommen.
 *
 * Herausgenommen wird deshalb genau der eine Wert, der auch nebenbei entstanden sein kann: das
 * alte „bequem“. Ein gespeichertes „kompakt“ bleibt stehen, denn das konnte nur durch einen Klick
 * dorthin kommen. Wer „bequem“ wirklich wollte, stellt es einmal wieder ein – und ab dann bleibt
 * es, weil es jetzt eine Abweichung von der Vorgabe ist und als solche gespeichert wird.
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object' || raw.v >= VERSION) return raw;
  const { density, ...rest } = raw;
  return density === 'comfortable' ? rest : raw;
}

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
    return clean(migrate(JSON.parse(localStorage.getItem(keyOf(userId)) || '{}')));
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Nur das, was von der Vorgabe abweicht – der Rest bleibt ungeschrieben.
 *
 * **Warum das wichtig ist.** Vorher landete bei jedem Schreibvorgang der *ganze* Satz im Speicher,
 * also auch die Werte, die niemand angefasst hatte: Wer einmal einen Serverplatz mit dem Stern
 * markiert hat, trug seitdem `density: 'comfortable'` mit sich herum, ohne das je gewählt zu
 * haben. Eine geänderte Vorgabe hätte diese Leute nie erreicht – sie hatten ja einen Wert.
 *
 * So steht im Speicher nur, wofür sich jemand entschieden hat. Alles andere folgt DEFAULTS, auch
 * dann noch, wenn sich DEFAULTS ändert.
 */
function thin(value) {
  const out = { v: VERSION };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const current = value[key];
    if (Array.isArray(fallback)) {
      if (current.length) out[key] = current;
    } else if (current !== fallback) {
      out[key] = current;
    }
  }
  return out;
}

function write(userId, value) {
  const next = clean(value);
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(thin(next)));
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
