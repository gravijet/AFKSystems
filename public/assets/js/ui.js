// Gemeinsame Bausteine für Startseite und Dashboard: Symbole, API-Aufrufe, Meldungen, Aussehen.

// ---------------------------------------------------------------- Symbole (Lucide, eingebettet)

const PATHS = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  gamepad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  compass: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
};

export function icon(name, klass = 'icon') {
  return `<svg class="${klass}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

// ---------------------------------------------------------------- Aussehen

export function applyTheme(value) {
  const theme = value || localStorage.getItem('afk-theme') || 'system';
  localStorage.setItem('afk-theme', theme);
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  for (const button of document.querySelectorAll('.themes button')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  }
}

export function themeSwitch() {
  return `<div class="themes" role="group" aria-label="Aussehen">
    <button data-theme="light" title="Hell" aria-pressed="false">${icon('sun')}</button>
    <button data-theme="system" title="Wie das System" aria-pressed="true">${icon('monitor')}</button>
    <button data-theme="dark" title="Dunkel" aria-pressed="false">${icon('moon')}</button>
  </div>`;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.themes button');
  if (button) applyTheme(button.dataset.theme);
});

// ---------------------------------------------------------------- API

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (raw) return response;
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new ApiError(data.error || `Fehler ${response.status}`, response.status);
  return data;
}

// ---------------------------------------------------------------- Meldungen

let toastBox = null;

export function toast(message, kind = '') {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    document.body.append(toastBox);
  }
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.innerHTML = `${icon(kind === 'bad' ? 'alert' : kind === 'ok' ? 'check' : 'info')}<div>${escapeHtml(message)}</div>`;
  toastBox.append(node);
  setTimeout(() => node.remove(), kind === 'bad' ? 7000 : 4000);
}

export const ok = (message) => toast(message, 'ok');
export const fail = (error) => toast(error?.message || String(error), 'bad');

// ---------------------------------------------------------------- Kleinkram

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Guthaben: intern Milli-Credits, angezeigt als Credits. */
export function credits(mcr, digits = 2) {
  return (mcr / 1000).toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 3,
  });
}

export function euro(cent) {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function since(timestamp) {
  if (!timestamp) return '–';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function datetime(timestamp) {
  if (!timestamp) return '–';
  return new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function clock(timestamp) {
  return new Date(timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const STATE_LABEL = {
  online: 'Online',
  auth: 'Anmeldung nötig',
  starting: 'Startet',
  connecting: 'Verbindet',
  reconnecting: 'Neuer Versuch',
  disconnected: 'Getrennt',
  stopping: 'Stoppt',
  offline: 'Offline',
  error: 'Fehler',
};

export function stateBadge(state, detail = '') {
  const label = STATE_LABEL[state] || state;
  const live = state === 'online' ? ' live' : '';
  return `<span class="state ${escapeHtml(state)}" title="${escapeHtml(detail || label)}">
    <span class="dot${live}"></span>${escapeHtml(label)}</span>`;
}

/** Kopf einer Karte mit Titel und optionalen Knöpfen. */
export function panel(title, bodyHtml, actionsHtml = '') {
  return `<section class="panel">
    <header><h3>${escapeHtml(title)}</h3><div class="row">${actionsHtml}</div></header>
    <div class="body">${bodyHtml}</div>
  </section>`;
}

/** Bestätigungsdialog, der ein Versprechen zurückgibt. */
export function confirmDialog(question, { confirm = 'Ja, weiter', danger = true } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <header><h3>Bitte bestätigen</h3></header>
      <div class="body"><p>${escapeHtml(question)}</p></div>
      <footer>
        <button class="btn" value="no">Abbrechen</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${escapeHtml(confirm)}</button>
      </footer>`;
    document.body.append(dialog);
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      dialog.close();
      resolve(button.value === 'yes');
    });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  });
}

/** Formular-Dialog: Felder rein, Werte raus (oder null bei Abbruch). */
export function formDialog(title, fields, { submit = 'Speichern' } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    const body = fields
      .map((field) => {
        const id = `f-${field.key}`;
        const value = escapeHtml(field.value ?? '');
        if (field.type === 'select') {
          const options = field.options
            .map(
              (option) =>
                `<option value="${escapeHtml(option.value ?? option)}" ${
                  (option.value ?? option) === field.value ? 'selected' : ''
                }>${escapeHtml(option.label ?? option)}</option>`
            )
            .join('');
          return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label>
            <select id="${id}" name="${field.key}">${options}</select>
            ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}</div>`;
        }
        if (field.type === 'checkbox') {
          return `<label class="check"><input type="checkbox" name="${field.key}" ${
            field.value ? 'checked' : ''
          }><span>${escapeHtml(field.label)}</span></label>`;
        }
        if (field.type === 'textarea') {
          return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label>
            <textarea id="${id}" name="${field.key}" placeholder="${escapeHtml(field.placeholder || '')}">${value}</textarea>
            ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}</div>`;
        }
        return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label>
          <input id="${id}" name="${field.key}" type="${field.type || 'text'}" value="${value}"
            placeholder="${escapeHtml(field.placeholder || '')}"
            ${field.min !== undefined ? `min="${field.min}"` : ''}
            ${field.max !== undefined ? `max="${field.max}"` : ''}>
          ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}</div>`;
      })
      .join('');

    dialog.innerHTML = `
      <form method="dialog">
        <header><h3>${escapeHtml(title)}</h3></header>
        <div class="body"><div class="stack">${body}</div></div>
        <footer>
          <button class="btn" value="cancel" type="submit">Abbrechen</button>
          <button class="btn btn-primary" value="ok" type="submit">${escapeHtml(submit)}</button>
        </footer>
      </form>`;
    document.body.append(dialog);

    const form = dialog.querySelector('form');
    form.addEventListener('submit', (event) => {
      if (event.submitter?.value !== 'ok') return;
      const data = {};
      for (const field of fields) {
        const input = form.elements[field.key];
        if (!input) continue;
        data[field.key] = field.type === 'checkbox' ? input.checked : input.value;
      }
      dialog.returnValue = JSON.stringify(data);
    });
    dialog.addEventListener('close', () => {
      const value = dialog.returnValue;
      dialog.remove();
      resolve(value && value !== 'cancel' ? JSON.parse(value) : null);
    });
    dialog.showModal();
    dialog.querySelector('input, select, textarea')?.focus();
  });
}

/** Ruft `fn` erst, wenn eine Weile Ruhe war – gegen Neuzeichnen im Sekundentakt. */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    ok('Kopiert.');
  } catch {
    toast('Konnte nicht kopieren – bitte von Hand markieren.');
  }
}

applyTheme();
