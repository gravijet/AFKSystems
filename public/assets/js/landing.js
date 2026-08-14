// Startseite: alles Bewegliche kommt aus /api/meta, damit auf der Seite nichts steht, was der
// Server nicht wirklich kann – Versionen, Preise, Feature-Zustände.

import { api, icon, themeSwitch, escapeHtml, credits, euro, $ } from './ui.js';

$('#year').textContent = new Date().getFullYear();
$('#util-right').innerHTML = `${themeSwitch()}
  <a class="row small" href="/app/" style="gap:.4rem">${icon('terminal')} Zum Dashboard</a>`;

// ---------------------------------------------------------------- Konsole im Hero

const DEMO = [
  { d: 300, type: 'status', text: 'Verbinde zu hugosmp.net:25565 (MC 26.1) ...' },
  { d: 700, type: 'system', text: 'Verbunden und im Spiel als Steve.' },
  { d: 500, type: 'chat', text: '[Server] Willkommen auf HugoSMP, Steve!' },
  { d: 900, type: 'sent', text: '/afk' },
  { d: 600, type: 'chat', text: '[AFK] Du bist jetzt als AFK markiert.' },
  { d: 1200, type: 'chat', text: '<Alex> jemand da?' },
  { d: 900, type: 'sent', text: 'bin afk, bot läuft :)' },
  { d: 1400, type: 'chat', text: '[Shop] Verkauft: 64x Cobblestone für 128 Münzen' },
  { d: 1100, type: 'status', text: 'Befehl: /sell all' },
  { d: 1300, type: 'chat', text: '[Server] Neustart in 30 Minuten' },
  { d: 900, type: 'status', text: 'Getrennt: Server wird neu gestartet' },
  { d: 700, type: 'status', text: 'Reconnect-Versuch 1 in 5 s ...' },
  { d: 1200, type: 'system', text: 'Verbunden und im Spiel als Steve.' },
];

const consoleBox = $('#demo-console');
let demoIndex = 0;
let demoTimer = null;

function line(entry) {
  const time = new Date().toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const node = document.createElement('div');
  node.className = `line ${entry.type}`;
  node.innerHTML = `<span class="t">${time}</span><span class="msg">${escapeHtml(entry.text)}</span>`;
  consoleBox.append(node);
  while (consoleBox.children.length > 60) consoleBox.firstChild.remove();
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

function tick() {
  const entry = DEMO[demoIndex % DEMO.length];
  line(entry);
  demoIndex += 1;
  demoTimer = setTimeout(tick, entry.d + 400);
}

// Nur laufen lassen, wenn jemand hinsieht – und nie bei "weniger Bewegung".
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduced) {
  DEMO.slice(0, 6).forEach(line);
} else {
  new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !demoTimer) tick();
      else if (!entry.isIntersecting && demoTimer) {
        clearTimeout(demoTimer);
        demoTimer = null;
      }
    }
  }).observe(consoleBox);
}

const input = $('#demo-input');
const send = () => {
  const text = input.value.trim();
  if (!text) return;
  line({ type: 'sent', text });
  input.value = '';
  setTimeout(
    () =>
      line({
        type: 'chat',
        text: text.startsWith('/')
          ? '[Server] Unbekannter Befehl – im echten Panel geht er an deinen Server.'
          : `<Steve> ${text}`,
      }),
    500
  );
};
$('#demo-send').addEventListener('click', send);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') send();
});

// Laufzeit im Kopf der Konsole mitzählen lassen.
let uptime = 51_720;
setInterval(() => {
  uptime += 1;
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  $('#demo-uptime').textContent = `${hours} h ${String(minutes).padStart(2, '0')} min`;
}, 1000);

// ---------------------------------------------------------------- Inhalte vom Server

const ICONS = {
  Verbindung: 'server',
  Chat: 'message',
  Automatik: 'zap',
  Bewegung: 'compass',
  Spiel: 'gamepad',
  Konten: 'user',
  Netzwerk: 'globe',
  Panel: 'terminal',
};

const STEPS = [
  {
    title: 'Konto anlegen',
    text: 'E-Mail, Benutzername, Passwort. Startguthaben ist dabei, damit du sofort ausprobieren kannst.',
  },
  {
    title: 'Minecraft-Konto verbinden',
    text: 'Das Panel zeigt dir einen Microsoft-Code. Einmal bei Microsoft eingeben, fertig – dein Passwort bleibt bei Microsoft.',
  },
  {
    title: 'Serverprofil anlegen',
    text: 'Adresse, Version und was beim Beitritt passieren soll: Befehle, Wartezeiten, Wiederholungen.',
  },
  {
    title: 'Bot starten',
    text: 'Konten auswählen, starten. Ab da läuft er – und du siehst Chat und Zustand live, egal von welchem Gerät.',
  },
];

function featureCard(feature) {
  const badge =
    feature.status === 'ready'
      ? ''
      : feature.status === 'movement'
        ? '<span class="pill primary">Bewegungs-Bauform</span>'
        : '<span class="pill missing">Noch nicht im Client</span>';
  return `<article class="feature">
    <div class="row spread">
      ${icon(ICONS[feature.group] || 'zap')}
      ${badge}
    </div>
    <h3>${escapeHtml(feature.title)}</h3>
    <p>${escapeHtml(feature.text)}</p>
  </article>`;
}

try {
  const meta = await api('/meta');

  // Anmeldeknöpfe anpassen, wenn schon eine Sitzung besteht.
  if (meta.user) {
    $('#nav-actions').innerHTML = `<a class="btn btn-primary btn-sm" href="/app/">Dashboard öffnen</a>`;
  } else if (!meta.registration_open) {
    $('#nav-actions').innerHTML = `<a class="btn btn-sm" href="/login.html">Anmelden</a>`;
  }

  $('#live-count').textContent = meta.client_version
    ? `Client ${meta.client_version} · ${meta.versions.length} Versionen`
    : 'Server läuft';

  if (meta.signup_bonus_mcr > 0) {
    $('#bonus-hint').textContent = `– ${credits(meta.signup_bonus_mcr)} Credits geschenkt`;
  }

  // Funktionen: erst was läuft, dann was Bewegung braucht, dann was fehlt.
  const order = { ready: 0, movement: 1, missing: 2 };
  const features = [...meta.features].sort((a, b) => order[a.status] - order[b.status]);
  $('#feature-grid').innerHTML = features.map(featureCard).join('');
  const missing = features.filter((feature) => feature.status !== 'ready').length;
  $('#feature-legend').textContent = missing
    ? `${features.length - missing} Funktionen laufen sofort. ${missing} sind gekennzeichnet: entweder brauchen sie die Bewegungs-Bauform des Clients, oder der Client kann sie noch nicht – wir schreiben es lieber hin, als es zu versprechen.`
    : 'Alle Funktionen laufen sofort.';

  // Preis
  const monthly = (meta.rate_mcr_hour * 730) / 1000;
  $('#rate-month').textContent = monthly.toFixed(2).replace('.', ',');
  $('#rate-detail').textContent = `Das sind ${meta.rate_mcr_hour} Milli-Credits je Stunde, abgerechnet jede Minute. 1 Credit entspricht ${euro(meta.credit_cent)}.`;
  $('#rate-list').innerHTML = [
    `Ein Bot rund um die Uhr: ${monthly.toFixed(2).replace('.', ',')} Credits im Monat (${euro(Math.round(monthly * meta.credit_cent))})`,
    'Bot gestoppt = 0 Credits. Kein Grundpreis, keine Mindestlaufzeit.',
    'Beliebig viele Serverprofile und Konten – bezahlt wird nur, was gleichzeitig läuft.',
    'Guthaben verfällt nicht und lässt sich jederzeit nachladen.',
  ]
    .map(
      (text) =>
        `<li class="row" style="align-items:flex-start;gap:.6rem">${icon('check')}<span class="muted">${escapeHtml(text)}</span></li>`
    )
    .join('');

  // Pakete
  $('#packages').innerHTML = meta.packages
    .map(
      (pack) => `<div class="row spread" style="padding:.6rem .8rem;border-radius:.75rem;
        box-shadow:inset 0 0 0 1px var(--line);background:var(--surface-2)">
        <div>
          <div class="strong">${credits(pack.credits_mcr, 0)} Credits</div>
          <div class="small muted">${pack.bonus_mcr > 0 ? `inkl. ${credits(pack.bonus_mcr, 0)} Bonus` : 'ohne Bonus'} · reicht für ${Math.round(pack.credits_mcr / meta.rate_mcr_hour / 24)} Bot-Tage</div>
        </div>
        <div class="mono strong">${euro(pack.cent)}</div>
      </div>`
    )
    .join('');

  const ways = [];
  if (meta.payment.stripe) ways.push('Kreditkarte');
  if (meta.payment.transfer) ways.push('Überweisung');
  if (meta.payment.paypal) ways.push('PayPal');
  ways.push('Gutscheincode', 'Aufbuchung durch den Admin');
  $('#pay-methods').textContent = `Möglich: ${ways.join(', ')}.`;

  // Versionen
  $('#versions').innerHTML = meta.versions
    .map(
      (version) =>
        `<span class="pill ${version === meta.default_version ? 'primary' : ''}">${escapeHtml(version)}${
          version === meta.default_version ? ' · Standard' : ''
        }</span>`
    )
    .join('');

  // Schritte
  $('#steps').innerHTML = STEPS.map(
    (step, index) => `<li class="row" style="align-items:flex-start;gap:1.25rem;padding:1.25rem 0;
      box-shadow:inset 0 -1px 0 var(--line-soft)">
      <span class="mono" style="color:var(--primary);font-weight:600;font-size:.875rem;padding-top:.15rem">
        ${String(index + 1).padStart(2, '0')}
      </span>
      <div>
        <h3>${escapeHtml(step.title)}</h3>
        <p class="muted light" style="margin-top:.35rem;max-width:44rem">${escapeHtml(step.text)}</p>
      </div>
    </li>`
  ).join('');
} catch (error) {
  $('#feature-legend').textContent = `Die Serverdaten sind gerade nicht erreichbar (${error.message}).`;
}
