// Support.
//
// Ein Ticket ist ein Gespräch, also sieht es auch so aus: Nachrichten laufen live ein, man sieht,
// wenn das Gegenüber schreibt, und der Zustand steht dort, wo man ihn ändert – nicht als
// Auswahlfeld in der Ecke.
//
// **Diese Ansicht gehört dem Kunden.** Sie zeigt seine Tickets und sonst keine – auch einem
// Administrator, denn der ist hier als Kunde unterwegs. Die Liste aller Tickets steht im
// Admin-Bereich unter "Tickets" (views/admin.js) und ist Arbeit, kein Support-Kontakt.
//
// Das Gespräch selbst (`one`) bedient beide Oberflächen, bekommt den Modus aber ausdrücklich von
// der Route. Die Rolle allein reicht nicht: Ein Admin ist unter "Support" selbst Kunde.

import {
  api, icon, escapeHtml, datetime, since, safeLink, tr, $, $$, ok, fail, toast, confirmDialog, formDialog, debounce,
  fileSize, avatar, locale, credits, date,
} from '../ui.js';
import { state, appbar, refresh, draw, go } from '../app.js';
import { renderDiscord } from '../discord.js';

// Drei Zustände, drei Aussagen: bei uns, beim Kunden, erledigt. Ein vierter („wartet“) stand
// früher daneben und bedeutete dasselbe wie „beantwortet“ – siehe server/tickets.js.
const STATUS_PILL = { open: 'primary', answered: '', closed: '' };
const PRIORITY_PILL = { urgent: 'missing', high: 'primary', normal: '', low: '' };
const TEAM_LOGO = new URL('../../img/logo-128.webp', import.meta.url).pathname;

/**
 * Wie groß ein Anhang sein darf.
 *
 * 20 MB als Ausgangswert, damit die Angabe schon dasteht, bevor die erste Antwort da ist – **die
 * Wahrheit sagt aber der Server**. `GET /tickets` schickt seine Grenze mit (`max_upload`), und die
 * gilt ab dann. Vorher stand die Zahl nur hier: Wer sie auf dem Server änderte, bekam entweder
 * einen Hinweis, der zu wenig verspricht, oder – schlimmer – einen Upload, den der Browser
 * durchlässt und der Server danach ablehnt.
 */
export let MAX_UPLOAD = 20 * 1024 * 1024;

const setMaxUpload = (bytes) => {
  const value = Number(bytes);
  if (Number.isFinite(value) && value > 0) MAX_UPLOAD = value;
};

/**
 * Dateien hochladen und ihre Nummern zurückgeben.
 *
 * Eine Datei je Anfrage, der Rumpf ist die Datei selbst: Damit braucht es weder ein Formular noch
 * eine Bibliothek dafür, und der Fortschritt ist "so viele von so vielen" statt eines Balkens, der
 * bei zwanzig Megabyte ohnehin nur zweimal zuckt.
 */
export async function uploadFiles(list, { onProgress } = {}) {
  const ids = [];
  const files = [...(list || [])];
  for (const [index, file] of files.entries()) {
    if (file.size > MAX_UPLOAD) {
      throw new Error(tr('tk.tooBig', { name: file.name, max: fileSize(MAX_UPLOAD) }));
    }
    onProgress?.(index + 1, files.length, file.name);
    const response = await fetch('/api/tickets/files', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        // Der Inhaltstyp kommt bewusst nicht von hier: Der Server sieht sich die Datei selbst an.
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${tr('common.error')} (${response.status})`);
    ids.push(data.file.id);
  }
  return ids;
}

/** Ein Anhang im Verlauf: Bilder als Bild, alles andere als Zeile zum Herunterladen. */
function attachment(file) {
  const href = `/api/tickets/files/${file.id}`;
  if (file.image) {
    return `<a class="chat-image" href="${href}" target="_blank" rel="noopener"
      title="${escapeHtml(file.name)}"><img src="${href}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async"></a>`;
  }
  return `<a class="chat-file" href="${href}?download=1" download="${escapeHtml(file.name)}">
    ${icon('download')}<span class="truncate">${escapeHtml(file.name)}</span>
    <span class="small muted nowrap">${escapeHtml(fileSize(file.size))}</span></a>`;
}

const attachments = (files) =>
  files?.length ? `<div class="chat-files">${files.map(attachment).join('')}</div>` : '';

/**
 * Eine Systemzeile in der Sprache des Lesers.
 *
 * Der Satz steht als fertiger englischer Text in der Datenbank – daran hängt der Discord-Kanal,
 * der ihn genauso spiegelt, und ein Verlauf, dessen Wortlaut sich nachträglich ändert, wäre
 * keiner. Daneben steht seit Migration 034, **was** die Zeile aussagt; daraus baut das Panel den
 * Satz neu. Alte Zeilen haben das nicht und stehen weiter so da, wie sie geschrieben wurden – und
 * ein Schlüssel, den diese Fassung des Panels noch nicht kennt, fällt auf denselben Weg zurück.
 */
function systemLine(message) {
  const key = message.meta?.key;
  if (!key) return message.body;
  const vars = { ...(message.meta.vars || {}) };
  // Die Dringlichkeit steht in den Werten als `normal`/`urgent` – als Wort gehört sie in dieselbe
  // Sprache wie der Satz, in dem sie steht.
  if (key === 'priority') {
    vars.from = tr(`tk.priority.${vars.from}`);
    vars.to = tr(`tk.priority.${vars.to}`);
  }
  const text = tr(`tk.sys.${key}`, vars);
  return text === `tk.sys.${key}` ? message.body : text;
}

/**
 * Wie lange etwas gedauert hat, in Worten.
 *
 * `since()` daneben rechnet immer gegen *jetzt*; hier geht es um eine Spanne zwischen zwei
 * Zeitpunkten, die beide in der Vergangenheit liegen – „nach 12 min beantwortet“.
 */
export function duration(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.round(hours / 24)} d`;
}

/**
 * Der Haken hinter einer Nachricht.
 *
 * Ein Haken heißt zugestellt, zwei heißen gelesen – dieselbe Zeichensprache wie in jedem
 * Nachrichtendienst, und deshalb ohne Erklärung verständlich. Der Text daneben sagt trotzdem in
 * Worten, was gemeint ist: Ein Symbol allein ist für jeden unlesbar, der es nicht sieht.
 */
const receiptMark = (seen) =>
  `<span class="receipt-mark ${seen ? 'is-seen' : ''}" aria-hidden="true">${icon('check')}${
    seen ? icon('check') : ''
  }</span>`;

/**
 * Wann gelesen wurde.
 *
 * Heute genügt die Uhrzeit – bei einer Antwort von vor zehn Minuten ist das Datum daneben
 * Beiwerk. An einem älteren Ticket ist genau umgekehrt „14:32“ ohne Tag wertlos. `clock()` zählt
 * dabei Sekunden mit, weil es für die Live-Ansicht gebaut ist; an einer Lesebestätigung ist die
 * Sekunde Rauschen.
 */
function readTime(at) {
  const then = new Date(at);
  const today = new Date();
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();
  return sameDay
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(then)
    : datetime(at);
}

export async function render(root, route) {
  if (route.id) return one(root, route.id, { staff: false, backHash: '#/tickets' });
  return list(root);
}

/** Detailansicht für den eigenständigen großen Admin-Tab. */
export const renderStaffTicket = (root, id) =>
  one(root, id, { staff: true, backHash: '#/admin/tickets' });

// ---------------------------------------------------------------- Liste

async function list(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const data = await api('/tickets');
  setMaxUpload(data.max_upload);
  const invite = state.meta?.discord_invite || '';
  const supportMail = state.meta?.support_email || '';
  const personalAdmin = state.me?.role === 'admin';
  const title = personalAdmin ? tr('dash.myTickets') : tr('tk.title');
  const subtitle = personalAdmin ? tr('tk.mySub') : tr('tk.sub');

  root.innerHTML = `
    ${appbar(
      title,
      `<button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('tk.new'))}</button>`,
      subtitle
    )}

    ${
      state.meta?.support_hours
        ? `<div class="note" style="margin-bottom:1rem">${icon('clock')}<div>${escapeHtml(
            tr('tk.hours', { hours: state.meta.support_hours })
          )}</div></div>`
        : ''
    }

    <!-- Nicht jede Frage braucht ein Ticket. Wer im Discord schneller eine Antwort bekommt, soll
         wissen, dass es ihn gibt – deshalb steht der Link hier und nicht nur im Fußbereich. -->
    ${
      invite
        ? `<a class="ticket-discord" href="${escapeHtml(safeLink(invite))}" target="_blank" rel="noopener">
            <span class="ticket-discord-icon">${icon('discord')}</span>
            <span class="grow">
              <span class="strong">${escapeHtml(tr('tk.discordTitle'))}</span>
              <span class="small muted">${escapeHtml(tr('tk.discordText'))}</span>
            </span>
            <span class="btn btn-sm">${escapeHtml(tr('discord.join'))}</span>
          </a>`
        : ''
    }

    <!-- Der Weg für alles, was kein Ticket sein kann: eine Frage vor dem Konto, ein Zugang, der
         nicht mehr geht. Ein Ticket bleibt der bessere Weg – es hat einen Verlauf und weiß, wer
         schreibt –, aber wer gerade nicht hineinkommt, soll nicht ohne Adresse dastehen. -->
    ${
      supportMail
        ? `<p class="small muted" style="margin:0 0 1rem">${escapeHtml(tr('tk.mailHint'))}
            <a href="mailto:${escapeHtml(supportMail)}">${escapeHtml(supportMail)}</a></p>`
        : ''
    }

    <section class="panel">
      <div class="body" style="padding:0">
        ${
          data.tickets.length
            ? `<ul class="ticket-list">${data.tickets.map(row).join('')}</ul>`
            : `<div class="empty" style="box-shadow:none;background:transparent">
                <h3>${escapeHtml(tr('tk.none'))}</h3>
                <p>${escapeHtml(subtitle)}</p>
                <button class="btn btn-primary" id="new-2">${icon('plus')} ${escapeHtml(tr('tk.new'))}</button>
              </div>`
        }
      </div>
    </section>`;

  $$('[data-open]').forEach((node) => {
    const open = () => go(`/tickets/${node.dataset.open}`);
    node.addEventListener('click', open);
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });
  for (const id of ['#new', '#new-2']) $(id)?.addEventListener('click', () => create());

  if (params.get('new')) create();

  // Kommt eine Antwort herein, ist die Liste sofort veraltet.
  state.onLive = debounce((event) => {
    if (
      event.type === 'ticket' &&
      event.message.audience?.customer &&
      state.route.name === 'tickets' &&
      !state.route.id
    ) draw();
  }, 500);
}

/**
 * Eine Zeile der Ticketliste.
 *
 * **Die Benachrichtigung steht am Ticket.** Die Zahl in der Seitenleiste sagt, dass etwas da ist;
 * sie sagt nicht, wo. Wer drei Tickets offen hat, stand damit vor drei gleich aussehenden Zeilen
 * und musste sie der Reihe nach aufmachen. Hier steht jetzt an genau der Zeile, um die es geht,
 * ein Punkt und das Wort „Neu“ – und zwar auch dann, wenn es nur ein einziges Ticket gibt: Die
 * Auskunft „hier ist etwas passiert“ hängt nicht daran, wie viele Zeilen daneben stehen.
 *
 * (Und das `<li>` hatte kein schließendes `>`. Der Punkt für den Zustand wurde deshalb vom Browser
 * als Attribut des Listeneintrags gelesen und nie gezeichnet – seit es ihn gibt.)
 */
/**
 * Die zweite Zeile eines Ticketeintrags: der Anfang der letzten Nachricht.
 *
 * Vorher stand dort „3 Nachrichten“. Das ist eine Zahl über das Ticket und nichts über die Sache –
 * wer drei Tickets offen hat, musste sie trotzdem alle öffnen, um zu wissen, welches gerade
 * wichtig ist. Der erste Satz der letzten Antwort sagt das in derselben Zeile.
 */
function preview(ticket, { mineIsStaff = false } = {}) {
  if (!ticket.last_body) {
    return escapeHtml(
      ticket.messages === 1 ? tr('tk.messagesOne') : tr('tk.messages', { n: ticket.messages ?? 0 })
    );
  }
  const from =
    ticket.last_role === 'staff'
      ? tr('tk.staff')
      : mineIsStaff
        ? ticket.display_name || tr('tk.customer')
        : tr('tk.you');
  return `<span class="muted">${escapeHtml(from)}:</span> ${escapeHtml(
    ticket.last_body.replace(/\s+/g, ' ').trim()
  )}`;
}

function row(ticket) {
  // Anklickbar heißt auch: mit der Tastatur erreichbar. Ohne `role`/`tabindex` war die ganze
  // Ticketliste für jeden unbedienbar, der keine Maus benutzt.
  const unread = Boolean(ticket.unread_user);
  const label = `#${ticket.id} ${ticket.subject}${unread ? ` – ${tr('tk.unread')}` : ''}`;
  // Der Haken steht nur an der eigenen letzten Nachricht: Ob das Team *seine* Antwort gelesen
  // hat, ist keine Frage – sie steht ja da.
  const mine = ticket.last_role === 'user';
  return `<li class="ticket-row ${unread ? 'is-unread' : ''}" data-open="${ticket.id}"
    role="button" tabindex="0" aria-label="${escapeHtml(label)}">
    <span class="ticket-dot ${escapeHtml(ticket.status)}"></span>
    <div class="grow" style="min-width:0">
      <div class="row" style="gap:.5rem">
        <span class="strong truncate">${escapeHtml(ticket.subject)}</span>
        <span class="small muted mono">#${ticket.id}</span>
        ${unread ? `<span class="pill unread">${icon('bell')} ${escapeHtml(tr('tk.unread'))}</span>` : ''}
        ${ticket.discord ? `<span class="pill" title="${escapeHtml(tr('tk.inDiscord'))}">${icon('discord')}</span>` : ''}
        ${ticket.shared ? `<span class="pill">${icon('users')}</span>` : ''}
      </div>
      <div class="small muted truncate ticket-preview">
        ${mine ? receiptMark(Boolean(ticket.seen_at)) : ''}${preview(ticket)}
      </div>
    </div>
    <div class="row" style="gap:.4rem">
      <span class="pill ${STATUS_PILL[ticket.status] || ''}">${escapeHtml(tr(`tk.status.${ticket.status}`))}</span>
      <span class="small muted mono nowrap">${since(ticket.updated_at)}</span>
    </div>
  </li>`;
}

// ---------------------------------------------------------------- Anlegen

async function create() {
  // Zwei Felder und ein Knopf für Dateien – mehr wird nicht gefragt. Keine Kategorie (die hat nie
  // etwas entschieden) und keine Dringlichkeit: Wer ein Ticket aufmacht, hält es für dringend, die
  // Frage beantwortet also jeder gleich. Die Nachricht ist kein Pflichtfeld – der Betreff sagt
  // schon, worum es geht, und ein Ticket, das beim Abschicken verschwindet, weil ein Feld leer
  // war, ist schlimmer als eines ohne Text.
  const draftKey = `afk-new-ticket-draft-${state.me?.id || 0}`;
  let diagnosticProfiles = [];
  try {
    diagnosticProfiles = (await api('/tickets/diagnostics')).profiles || [];
  } catch {
    // Support darf nicht daran scheitern, dass die Komfortliste gerade nicht erreichbar ist.
    diagnosticProfiles = [];
  }
  const answer = await formDialog(
    tr('tk.new'),
    [
      { key: 'subject', label: tr('tk.subject'), required: true },
      { key: 'body', label: `${tr('tk.message')} (${tr('common.optional')})`, type: 'textarea' },
      {
        key: 'files',
        label: tr('tk.files'),
        type: 'files',
        hint: tr('tk.filesHint', { max: fileSize(MAX_UPLOAD) }),
      },
      ...(diagnosticProfiles.length
        ? [
            {
              key: 'diagnostic_profile_id',
              label: tr('tk.diagnostic'),
              type: 'select',
              value: '',
              hint: tr('tk.diagnosticHint'),
              options: [
                { value: '', label: tr('tk.diagnosticNone') },
                ...diagnosticProfiles.map((profile) => ({
                  value: String(profile.id),
                  label: `${profile.name} · ${profile.address}`,
                })),
              ],
            },
          ]
        : []),
    ],
    { submit: tr('tk.send'), draftKey }
  );
  if (!answer) return;
  try {
    if (answer.diagnostic_profile_id) {
      const diagnostic = await api(`/tickets/diagnostics?profile_id=${encodeURIComponent(answer.diagnostic_profile_id)}`);
      const accepted = await confirmDialog(diagnostic.diagnostic.preview, {
        title: tr('tk.diagnosticReview'),
        confirm: tr('tk.diagnosticSend'),
        danger: false,
      });
      if (!accepted) return;
    }
    const files = await uploadFiles(answer.files, {
      onProgress: (index, total) => total > 1 && toast(tr('tk.uploading', { i: index, n: total })),
    });
    const result = await api('/tickets', {
      method: 'POST',
      body: {
        subject: answer.subject,
        body: answer.body,
        files,
        diagnostic_profile_id: answer.diagnostic_profile_id ? Number(answer.diagnostic_profile_id) : undefined,
      },
    });
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* Das Ticket ist bereits angelegt; ein gesperrter Gerätespeicher ändert daran nichts. */
    }
    ok(tr('tk.created'));
    await refresh({ profiles: false, accounts: false });
    go(`/tickets/${result.ticket.id}`);
  } catch (error) {
    fail(error);
  }
}

/**
 * Die Uhrzeit beim Kunden.
 *
 * Ein Ticket um drei Uhr nachts beantwortet man anders als eines am Mittag – und ob jemand gerade
 * schläft, entscheidet seine Zeitzone und nicht unsere. Steht keine im Konto, steht hier nichts:
 * eine geratene Uhrzeit wäre schlechter als gar keine.
 */
function localTime(timezone) {
  if (!timezone) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
  } catch {
    return '';
  }
}

/**
 * Der Kunde neben dem Gespräch.
 *
 * Bisher stand hier ein Name und eine E-Mail-Adresse. Das ist genau die Auskunft, die man beim
 * Antworten *nicht* braucht – gebraucht wird, wen man vor sich hat: seit wann er dabei ist, ob er
 * zahlt, wie viele Tickets er schon hatte und wie viele davon gerade offen sind. Wer das nicht
 * sieht, behandelt einen Stammkunden mit drei Serverplätzen wie eine Neuanmeldung von gestern.
 */
function customerPanel(data) {
  const user = data.user;
  const context = data.context || {};
  const time = localTime(context.timezone);
  const line = (label, value) =>
    `<div class="row spread small"><span class="muted">${escapeHtml(label)}</span>
       <span>${value}</span></div>`;
  return `<section class="panel">
    <header><h3>${escapeHtml(tr('tk.customer'))}</h3></header>
    <div class="body stack">
      <a class="row spread" href="#/admin/users/${user.id}">
        <span class="row" style="gap:.5rem;min-width:0">${avatar(user, { size: 26 })}
          <span class="truncate">${escapeHtml(user.display_name || `#${user.id}`)}</span></span>${icon('arrow')}</a>
      <div class="row wrap" style="gap:.35rem">
        ${data.paying ? `<span class="pill primary">${escapeHtml(tr('adm.paying'))}</span>` : ''}
        ${user.blocked ? `<span class="pill missing">${escapeHtml(tr('sec.blockedAccount'))}</span>` : ''}
        ${
          user.email_verified
            ? ''
            : `<span class="pill missing">${escapeHtml(tr('tk.mailUnverified'))}</span>`
        }
        ${user.discord ? `<span class="pill">${icon('discord')} ${escapeHtml(user.discord.name || '')}</span>` : ''}
      </div>
      <div class="small muted truncate">${escapeHtml(user.email || '')}</div>
      <hr class="rule">
      ${line(tr('tk.ctxSince'), `<span class="mono">${date(context.member_since)}</span>`)}
      ${line(tr('tk.ctxCredits'), `<span class="mono">${escapeHtml(credits(context.credits ?? 0))}</span>`)}
      ${line(
        tr('tk.ctxTickets'),
        `<span class="mono">${Number(context.total ?? 0)}</span> <span class="muted small">${escapeHtml(
          tr('tk.ctxOpenOf', { n: Number(context.open ?? 0) })
        )}</span>`
      )}
      ${line(tr('tk.ctxSlots'), `<span class="mono">${Number(context.profiles ?? 0)}</span>`)}
      ${
        context.last_topup
          ? line(tr('tk.ctxLastTopup'), `<span class="mono">${date(context.last_topup)}</span>`)
          : ''
      }
      ${time ? line(tr('tk.ctxLocalTime'), `<span class="mono">${escapeHtml(time)}</span>`) : ''}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- Ein Ticket

async function one(root, id, { staff, backHash }) {
  const base = staff ? `/admin/tickets/${id}` : `/tickets/${id}`;
  const [data, templateData] = await Promise.all([
    api(base),
    staff ? api('/admin/ticket-templates') : Promise.resolve({ templates: [] }),
  ]);
  const ticket = data.ticket;
  const templates = templateData.templates || [];
  // Die Sprache des Empfängers entscheidet, nicht die Sprache des Administrators. So geht auch
  // aus einem englisch eingestellten Admin-Panel eine deutsche Antwort an einen deutschen Kunden.
  const customerLanguage = data.user?.language === 'en' ? 'en' : 'de';
  let messages = data.messages;
  let participants = data.participants || [];
  /** Wer wie weit gelesen hat – siehe server/tickets.js. */
  let reads = data.reads || [];
  const me = data.me ?? state.me.id;
  // Wo man beim letzten Mal aufgehört hat. Das Öffnen hat den Stand gerade überschrieben; diese
  // Zahl ist die einzige Erinnerung daran und wird deshalb nur einmal beim Laden gesetzt.
  const seenUntil = Number(data.seen_until) || 0;
  // Große Verläufe starten mit der jüngsten, lesbaren Seite. Ältere Nachrichten bleiben mit
  // einem Klick erreichbar, statt beim Öffnen eines Tickets tausend DOM-Knoten, Avatare und
  // Anhänge zu bauen. Das ist vor allem auf Mobilgeräten spürbar.
  let hasOlder = Boolean(data.has_more);
  let loadingOlder = false;

  const statusControls = () =>
    staff
      ? ['open', 'answered', 'closed']
          .map(
            (entry) => `<button class="status-choice ${entry} ${
              ticket.status === entry ? 'active' : ''
            }" data-status="${entry}">${escapeHtml(tr(`tk.status.${entry}`))}</button>`
          )
          .join('')
      : ticket.status === 'closed'
        ? `<span class="pill missing">${escapeHtml(tr('tk.status.closed'))}</span>`
        : `<button class="btn btn-danger btn-block" data-status="closed">${escapeHtml(tr('tk.close'))}</button>`;

  /**
   * Die Kopfzeile eines Ticketvorgangs: alles, was man wissen muss, bevor man liest.
   *
   * Das stand vorher verteilt in der Seitenleiste, im Auswahlfeld und gar nicht. Wer ein Ticket
   * öffnet, entscheidet in den ersten zwei Sekunden, ob er es jetzt bearbeitet – dafür braucht er
   * Zustand, Dringlichkeit, Zuständigkeit und Wartezeit nebeneinander und nicht untereinander.
   */
  const fact = (label, value, klass = '') =>
    `<div class="fact ${klass}"><span class="fact-label">${escapeHtml(label)}</span>
       <span class="fact-value">${value}</span></div>`;

  const waitedFor = () =>
    ticket.first_reply_at
      ? duration(ticket.first_reply_at - ticket.created_at)
      : `<span class="warn-text">${escapeHtml(tr('tk.noReplyYet'))}</span>`;

  /**
   * Ein Ticketstatus ist nur ein Wort, bis klar ist, wer daraus welchen nächsten Schritt ableitet.
   * Die Antwort wird aus dem tatsächlichen Status und der letzten Nachricht gebaut – keine
   * erfundene SLA und kein Countdown, den niemand zugesagt hat.
   */
  const nextWork = () => {
    if (ticket.status === 'closed') {
      return {
        who: tr('tk.workflow.done'),
        text: tr(`tk.workflow.closed.${staff ? 'staff' : 'customer'}`),
        at: ticket.closed_at || ticket.updated_at,
      };
    }
    if (ticket.status === 'answered') {
      return {
        who: staff ? tr('tk.customer') : tr('tk.you'),
        text: tr(`tk.workflow.answered.${staff ? 'staff' : 'customer'}`),
        at: ticket.last_staff_at || ticket.updated_at,
      };
    }
    return {
      who: staff ? ticket.assigned_name || tr('tk.workflow.unassigned') : tr('tk.staff'),
      text: tr(`tk.workflow.open.${staff ? 'staff' : 'customer'}`),
      at: ticket.last_customer_at || ticket.created_at,
    };
  };

  const workflow = () => {
    const next = nextWork();
    const stateIcon = ticket.status === 'closed' ? 'check' : ticket.status === 'open' ? 'message' : 'clock';
    return `<section class="ticket-workflow ${ticket.status}" aria-live="polite">
      <span class="ticket-workflow-icon">${icon(stateIcon)}</span>
      <div class="grow" style="min-width:0">
        <div class="row wrap" style="gap:.45rem">
          <span class="pill ${STATUS_PILL[ticket.status] || ''}">${escapeHtml(tr(`tk.status.${ticket.status}`))}</span>
          <strong>${escapeHtml(tr('tk.nextExpected'))}</strong>
        </div>
        <p>${escapeHtml(next.text)}</p>
        <div class="small muted">${escapeHtml(tr('tk.workflowResponsible', { who: next.who }))}${
          next.at ? ` · ${escapeHtml(tr('tk.workflowSince', { when: since(next.at) }))}` : ''
        }</div>
      </div>
    </section>`;
  };

  const factsStrip = () => `
    <div class="ticket-facts" id="facts">
      ${fact(
        tr('tk.setStatus'),
        `<span class="pill ${STATUS_PILL[ticket.status] || ''}">${escapeHtml(
          tr(`tk.status.${ticket.status}`)
        )}</span>`
      )}
      ${
        staff
          ? fact(
              tr('tk.priorityShort'),
              `<span class="pill ${PRIORITY_PILL[ticket.priority] || ''}">${escapeHtml(
                tr(`tk.priority.${ticket.priority}`)
              )}</span>`
            )
          : ''
      }
      ${
        staff
          ? fact(
              tr('tk.assign'),
              ticket.assigned_to
                ? `<span class="row" style="gap:.35rem">${avatar(
                    { display_name: ticket.assigned_name, avatar: ticket.assigned_avatar },
                    { size: 18 }
                  )}${escapeHtml(ticket.assigned_name || '')}</span>`
                : `<span class="muted">${escapeHtml(tr('tk.unassigned'))}</span>`
            )
          : ''
      }
      ${fact(tr('tk.firstReply'), waitedFor())}
      ${fact(
        ticket.status === 'closed' ? tr('tk.closedAt') : tr('tk.lastActivity'),
        `<span class="mono">${since(ticket.status === 'closed' ? ticket.closed_at : ticket.updated_at)}</span>`
      )}
      ${fact(tr('tk.nextExpected'), `<span class="truncate">${escapeHtml(nextWork().text)}</span>`)}
      ${
        Number(ticket.reopened) > 0
          ? fact(tr('tk.reopenedTimes'), `<span class="mono">${Number(ticket.reopened)}×</span>`)
          : ''
      }
    </div>`;

  root.innerHTML = `
    ${appbar(
      ticket.subject,
      `<a class="btn btn-sm" href="${backHash}">${escapeHtml(tr('common.back'))}</a>`,
      `#${ticket.id} · ${datetime(ticket.created_at)}${
        staff && data.user ? ` · ${data.user.display_name || ''}` : ''
      }`
    )}

    ${factsStrip()}

    <div class="ticket">
      <div class="ticket-main">
        <div class="chat-thread" id="thread"></div>
        <div class="typing" id="typing"></div>

        <div class="reply-box">
          <p class="small muted" id="closed-note" style="margin:0 0 .6rem" ${
            ticket.status === 'closed' ? '' : 'hidden'
          }>${escapeHtml(tr('tk.closedNote'))}</p>
          <textarea id="reply" rows="3" placeholder="${escapeHtml(tr('tk.reply'))}"></textarea>
          <!-- Der Dateiwähler ist versteckt und wird vom Knopf daneben bedient: ein nacktes
               <input type="file"> sieht in jedem Browser anders aus und in keinem gut. -->
          <input id="reply-files" type="file" multiple hidden>
          <div class="attach-list" id="attach-list" hidden></div>
          ${
            staff && templates.length
              ? `<div class="row wrap" id="quick-replies" style="margin-top:.6rem">
                  ${templates
                    .map(
                      (entry) => `<button class="btn btn-sm btn-ghost" data-quick-reply="${entry.id}"
                        title="${escapeHtml(
                          (customerLanguage === 'en' ? entry.body_en : entry.body_de) || entry.body_de
                        )}">${icon('message')} ${escapeHtml(
                          (customerLanguage === 'en' ? entry.title_en : entry.title_de) || entry.title_de
                        )}</button>`
                    )
                    .join('')}
                </div>`
              : ''
          }
          <div class="row spread wrap" style="margin-top:.6rem">
            <span class="small muted reply-compose-meta">
              <span>${escapeHtml(tr('tk.writeHint'))}</span>
              <span id="reply-draft"></span>
            </span>
            <div class="row">
              <button class="btn btn-sm" id="attach" title="${escapeHtml(
                tr('tk.filesHint', { max: fileSize(MAX_UPLOAD) })
              )}">${icon('plus')} ${escapeHtml(tr('tk.files'))}</button>
              ${
                staff
                  ? `<button class="btn btn-sm" id="internal" title="${escapeHtml(tr('tk.internalHint'))}">
                      ${icon('shield')} ${escapeHtml(tr('tk.internalNote'))}</button>`
                  : ''
              }
              <button class="btn btn-primary" id="send">${icon('send')} ${escapeHtml(tr('tk.send'))}</button>
            </div>
          </div>
        </div>
      </div>

      <aside class="ticket-side">
        <section class="panel">
          <header><h3>${escapeHtml(tr('tk.setStatus'))}</h3></header>
          <div class="body stack">
            <div class="status-picker" id="status">
              ${statusControls()}
            </div>
            <!-- Was die drei Wörter heißen, steht dort, wo man sie anklickt: „offen“ und
                 „beantwortet“ sagen von sich aus nicht, wer am Zug ist. -->
            ${staff ? `<p class="small muted">${escapeHtml(tr('tk.statusHint'))}</p>` : ''}
            <p class="small muted" id="status-hint" ${ticket.status === 'closed' ? '' : 'hidden'}>${escapeHtml(
              tr('tk.reopenHint')
            )}</p>
          </div>
        </section>

        ${
          staff
            ? `<section class="panel">
                <header><h3>${escapeHtml(tr('adm.detail'))}</h3></header>
                <div class="body stack">
                  <!-- Der häufigste Griff im Support ist "das nehme ich": ein Knopf statt eines
                       Auswahlfelds, in dem man sich erst selbst suchen muss. -->
                  <button class="btn btn-sm btn-block" id="take" ${
                    ticket.assigned_to === me ? 'disabled' : ''
                  }>${icon('user')} ${escapeHtml(
                    ticket.assigned_to === me ? tr('tk.assignedToYou') : tr('tk.takeIt')
                  )}</button>
                  <div class="field">
                    <label for="priority">${escapeHtml(tr('tk.priorityShort'))}</label>
                    <select id="priority">
                      ${['low', 'normal', 'high', 'urgent']
                        .map(
                          (entry) =>
                            `<option value="${entry}" ${ticket.priority === entry ? 'selected' : ''}>${escapeHtml(
                              tr(`tk.priority.${entry}`)
                            )}</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                  <div class="field">
                    <label for="assigned">${escapeHtml(tr('tk.assign'))}</label>
                    <select id="assigned">
                      <option value="">${escapeHtml(tr('tk.unassigned'))}</option>
                      ${(data.staff || [])
                        .map(
                          (person) =>
                            `<option value="${person.id}" ${
                              ticket.assigned_to === person.id ? 'selected' : ''
                            }>${escapeHtml(person.display_name || `#${person.id}`)}</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                </div>
              </section>

              <!-- Wer wie weit gelesen hat. Die Frage, die im Support am häufigsten gestellt
                   wird, hat damit zum ersten Mal eine Antwort im Panel. -->
              <section class="panel">
                <header><h3>${escapeHtml(tr('tk.readTitle'))}</h3></header>
                <div class="body stack" id="read-list"></div>
              </section>`
            : ''
        }

        ${staff && data.user ? customerPanel(data) : ''}

        <section class="panel">
          <header><h3>${escapeHtml(tr('tk.people'))}</h3>
            ${
              staff
                ? `<button class="btn btn-ghost btn-sm" id="add-person"
                    title="${escapeHtml(tr('tk.addPerson'))}">${icon('plus')}</button>`
                : ''
            }
          </header>
          <div class="body stack" id="people"></div>
        </section>

        ${
          ticket.discord
            ? `<div class="note" style="margin:0">${icon('discord')}
                <div class="small">${escapeHtml(tr('tk.inDiscord'))}</div></div>`
            : ''
        }
      </aside>
    </div>`;

  // ------------------------------------------------------------ Zeichnen

  const thread = $('#thread');

  /**
   * Der Strich „Neue Nachrichten“.
   *
   * Ein Ticket mit vierzig Beiträgen öffnet sich unten – aber „unten“ sagt nicht, wo man beim
   * letzten Mal aufgehört hat. Der Strich steht vor der ersten Nachricht, die man noch nicht
   * gesehen hatte, und zwar an derselben Stelle, solange die Seite offen ist: Er ist die
   * Erinnerung an einen Stand, den das Öffnen gerade überschrieben hat, und darf deshalb nicht
   * beim ersten Neuzeichnen verschwinden.
   */
  const firstUnseen = seenUntil
    ? messages.find(
        // Systemzeilen zählen nicht: „Dringlichkeit geändert“ ist keine Nachricht, die man
        // verpasst hat, und ein Strich davor verspräche mehr, als dahinter steht.
        (entry) => entry.id > seenUntil && entry.role !== 'system' && entry.user_id !== me
      )?.id || 0
    : 0;

  const paint = () => {
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    // Ein Ticket darf ohne Text abgeschickt werden – dann steht hier zunächst nur der Betreff,
    // und der Kasten sagt das, statt leer zu bleiben wie ein Fehler.
    thread.innerHTML =
      `${workflow()}${hasOlder ? `<button class="btn btn-sm ticket-load-history" id="load-older" ${
        loadingOlder ? 'disabled' : ''
      }>${escapeHtml(loadingOlder ? tr('common.loading') : tr('tk.loadOlder'))}</button>` : ''}` +
      (messages
        .map(
          (message) =>
            (message.id === firstUnseen
              ? `<div class="chat-divider"><span>${escapeHtml(tr('tk.newSince'))}</span></div>`
              : '') + bubble(message)
        )
        .join('') ||
      `<div class="chat-system"><span>${escapeHtml(tr('tk.onlySubject'))}</span></div>`) +
      receipt();
    if (atBottom) thread.scrollTop = thread.scrollHeight;
  };

  /**
   * „Gelesen“ unter der letzten eigenen Nachricht.
   *
   * Sie steht dort und nicht an jeder einzelnen: Wer eine Antwort gelesen hat, hat alles davor
   * gelesen – ein Haken an jeder Blase wäre dieselbe Auskunft vierzigmal.
   *
   * Für den Kunden bleibt das Team eine Seite und keine Namensliste; das Panel nennt eine
   * Teamantwort überall „Support“, und eine Lesebestätigung darf daraus nicht plötzlich einen
   * Dienstplan machen. Umgekehrt braucht das Team die Namen: Bei einem Ticket mit zwei Beteiligten
   * ist „einer hat gelesen“ etwas anderes als „beide haben gelesen“.
   */
  function receipt() {
    // Nur, solange **wir** zuletzt geschrieben haben. Hat die andere Seite seither geantwortet,
    // ist die Frage „hat sie es gesehen?“ beantwortet – die Antwort steht darüber. Ein Haken
    // darunter bezöge sich auf eine Nachricht weiter oben und läse sich, als gehöre er zur
    // letzten: Genau das stand im Kundenverlauf unter einer Support-Antwort.
    const last = [...messages].reverse().find((entry) => entry.role !== 'system' && !entry.internal);
    if (!last || last.role !== (staff ? 'staff' : 'user')) return '';
    const otherSide = reads.filter((entry) => entry.staff === !staff && entry.user_id !== me);
    const seen = otherSide.filter((entry) => entry.last_message_id >= last.id);

    if (!staff) {
      const at = seen.length ? Math.max(...seen.map((entry) => entry.read_at)) : 0;
      return `<div class="chat-receipt">${receiptMark(Boolean(at))}${escapeHtml(
        at ? tr('tk.seenBySupport', { time: readTime(at) }) : tr('tk.delivered')
      )}</div>`;
    }

    const seenNames = seen.map((entry) => `${entry.display_name} · ${readTime(entry.read_at)}`);
    const openNames = participants
      .filter((person) => person.id !== me && !seen.some((entry) => entry.user_id === person.id))
      .map((person) => person.display_name || `#${person.id}`);
    return `<div class="chat-receipt">${receiptMark(seenNames.length > 0)}<span>${escapeHtml(
      seenNames.length ? tr('tk.seenBy', { who: seenNames.join(', ') }) : tr('tk.notSeenYet')
    )}${
      seenNames.length && openNames.length
        ? ` · ${escapeHtml(tr('tk.stillOpenFor', { who: openNames.join(', ') }))}`
        : ''
    }</span></div>`;
  }

  /**
   * Eine Nachricht im Verlauf.
   *
   * **Der Text geht durch `renderDiscord`.** Ein Ticket ist dasselbe Gespräch im Panel und im
   * Discord-Kanal; wer dort `**dringend**` schreibt, sieht dort fettes „dringend“, und hier soll
   * dasselbe stehen. Vor allem aber lösen sich damit die Erwähnungen auf: `<@1538…>` wird zu
   * „@Hugo“ und `<#1538…>` zu „#support“, statt als zwanzigstellige Zahl mitten im Satz zu
   * stehen. Welche Zahl welchen Namen hatte, hängt an der Nachricht (`message.mentions`) und
   * kommt vom Bot – siehe server/tickets.js.
   *
   * Ohne Auflösung bleibt eine Erwähnung eine Erwähnung, sie heißt dann nur „unbekannt“. Genau
   * das tut Discord auch, wenn es jemanden nicht mehr findet.
   */
  function bubble(message) {
    if (message.role === 'system') {
      return `<div class="chat-system ${
        message.internal ? 'is-internal' : ''
      }"><span>${escapeHtml(systemLine(message))}</span></div>`;
    }
    const mine = message.user_id === (data.me ?? state.me.id);
    // Eine Team-Antwort ist eine Antwort des Teams, nicht die Visitenkarte der Person, die gerade
    // Dienst hat. Das gilt für alle Kundenansichten – auch wenn der Verlauf aus Discord kam.
    const who = message.internal
      ? tr('tk.internal')
      : message.role === 'staff'
        ? tr('tk.staff')
        : message.author_name || message.display_name || tr('tk.you');
    // In der Kundenansicht antwortet AFKSystems als Team: kein persönliches Profilbild. Die
    // Rollenmarke entfällt ganz, weil „Team“ neben „Team“ keine zusätzliche Auskunft wäre.
    const customerTeam = !staff && message.role === 'staff' && !message.internal;
    const picture = customerTeam ? TEAM_LOGO : message.avatar;
    return `<article class="chat-msg ${message.role} ${mine ? 'mine' : ''} ${
      message.internal ? 'internal' : ''
    }">
      <header>
        ${avatar({ display_name: who, avatar: picture }, { size: 22 })}
        <span class="strong">${escapeHtml(who)}</span>
        ${message.discord_id ? `<span class="pill">${icon('discord')}</span>` : ''}
        <time>${datetime(message.created_at)}</time>
      </header>
      ${
        message.body
          ? `<div class="dc">${renderDiscord(message.body, {
              mentions: message.mentions,
              locale,
              unknown: tr('tk.unknownMention'),
            })}</div>`
          : ''
      }
      ${attachments(message.files)}
    </article>`;
  }

  const paintPeople = () => {
    $('#people').innerHTML =
      participants
        .map(
          (person) => `<div class="row spread">
            <span class="row" style="gap:.5rem;min-width:0">${avatar(person, { size: 24 })}
              <span class="truncate">${escapeHtml(person.display_name || `#${person.id}`)}</span>
              ${person.owner ? `<span class="pill">${escapeHtml(tr('tk.author'))}</span>` : ''}</span>
            ${
              staff && !person.owner
                ? `<button class="btn btn-ghost btn-sm btn-danger" data-drop="${person.id}"
                    title="${escapeHtml(tr('tk.removePerson'))}">${icon('x')}</button>`
                : ''
            }
          </div>`
        )
        .join('') || `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`;

    $$('[data-drop]').forEach((button) =>
      button.addEventListener('click', async () => {
        try {
          const result = await api(`/admin/tickets/${id}/users/${button.dataset.drop}`, { method: 'DELETE' });
          participants = result.participants;
          paintPeople();
        } catch (error) {
          fail(error);
        }
      })
    );
  };

  /**
   * Die Leseliste in der Seitenleiste des Teams.
   *
   * Sie zeigt **alle** Beteiligten, auch die ohne Marke – gerade die sind die Antwort auf die
   * Frage. Eine Liste, in der nur steht, wer gelesen hat, sieht bei niemandem genauso aus wie bei
   * einem Ticket, an dem gar niemand hängt.
   */
  const paintReads = () => {
    const box = $('#read-list');
    if (!box) return;
    const newest = messages.filter((entry) => !entry.internal).at(-1)?.id || 0;
    box.innerHTML =
      participants
        .map((person) => {
          const mark = reads.find((entry) => !entry.staff && entry.user_id === person.id);
          const current = mark && mark.last_message_id >= newest;
          return `<div class="row spread" style="gap:.5rem">
            <span class="row" style="gap:.5rem;min-width:0">${avatar(person, { size: 22 })}
              <span class="truncate">${escapeHtml(person.display_name || `#${person.id}`)}</span></span>
            <span class="small nowrap ${current ? 'ok-text' : 'muted'}">${
              mark
                ? `${receiptMark(current)}<span class="mono">${escapeHtml(readTime(mark.read_at))}</span>`
                : escapeHtml(tr('tk.neverOpened'))
            }</span>
          </div>`;
        })
        .join('') || `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`;
  };

  paint();
  paintPeople();
  paintReads();
  thread.scrollTop = thread.scrollHeight;

  thread.addEventListener('click', async (event) => {
    if (!event.target.closest('#load-older') || loadingOlder || !messages.length) return;
    loadingOlder = true;
    const previousTop = thread.scrollTop;
    const previousHeight = thread.scrollHeight;
    paint();
    try {
      const first = messages[0].id;
      const page = await api(`${base}/messages?before=${first}`);
      const known = new Set(messages.map((entry) => entry.id));
      const older = page.messages.filter((entry) => !known.has(entry.id));
      messages = older.concat(messages);
      hasOlder = Boolean(page.has_more);
      Object.assign(ticket, page.ticket);
      paintStatus(ticket.status);
      paint();
      // Beim Einfügen oberhalb des Sichtfensters bleibt derselbe Satz unter dem Auge stehen.
      thread.scrollTop = thread.scrollHeight - previousHeight + previousTop;
    } catch (error) {
      fail(error);
    } finally {
      loadingOlder = false;
      paint();
    }
  });

  // ------------------------------------------------------------ Schreiben

  const input = $('#reply');
  const picker = $('#reply-files');
  const attachBox = $('#attach-list');
  const draftStatus = $('#reply-draft');
  // Der Entwurf gehört zum Gerät, zum Ticket und zur jeweiligen Rolle. So erscheint eine interne
  // Teamnotiz niemals versehentlich im Antwortfeld des Kunden – und ein zweites Konto am selben
  // Browser übernimmt ebenfalls nichts. localStorage ist Komfort, deshalb darf er auch fehlen.
  const draftKey = `afk-ticket-draft-${staff ? 'staff' : 'customer'}-${state.me?.id || 0}-${ticket.id}`;

  const setStoredDraft = (value) => {
    try {
      if (value) localStorage.setItem(draftKey, value);
      else localStorage.removeItem(draftKey);
    } catch {
      /* Privater Modus oder voller Speicher: Das Ticket bleibt trotzdem vollständig bedienbar. */
    }
  };
  try {
    // Eine manipulierte Ablage darf das Feld nicht mit Megabytes füllen.
    input.value = String(localStorage.getItem(draftKey) || '').slice(0, 20_000);
  } catch {
    input.value = '';
  }
  const paintDraft = () => {
    // Ein Emoji ist für den Menschen ein Zeichen, auch wenn JavaScript dafür zwei Codeeinheiten
    // zählt. Die Anzeige soll den Text beschreiben und nicht seine interne UTF-16-Darstellung.
    const length = [...input.value].length;
    draftStatus.textContent = length ? tr('tk.draftSaved', { n: length }) : '';
  };
  const persistDraft = debounce(() => setStoredDraft(input.value), 180);
  input.addEventListener('input', () => {
    paintDraft();
    persistDraft();
  });
  input.addEventListener('blur', () => setStoredDraft(input.value));
  paintDraft();

  /** Was gerade angehängt werden soll – erst beim Abschicken hochgeladen. */
  let pending = [];

  const paintPending = () => {
    attachBox.hidden = !pending.length;
    attachBox.innerHTML = pending
      .map(
        (file, index) => `<span class="attach-chip">${icon('paperclip')}
          <span class="truncate">${escapeHtml(file.name)}</span>
          <span class="small muted nowrap">${escapeHtml(fileSize(file.size))}</span>
          <button type="button" data-drop-file="${index}"
            aria-label="${escapeHtml(tr('common.remove'))}">${icon('x')}</button></span>`
      )
      .join('');
    for (const button of $$('[data-drop-file]', attachBox)) {
      button.addEventListener('click', () => {
        pending.splice(Number(button.dataset.dropFile), 1);
        paintPending();
      });
    }
  };

  const addFiles = (list) => {
    for (const file of list) {
      if (file.size > MAX_UPLOAD) {
        toast(tr('tk.tooBig', { name: file.name, max: fileSize(MAX_UPLOAD) }), 'bad');
        continue;
      }
      if (pending.length >= 10) {
        toast(tr('tk.tooMany'), 'bad');
        break;
      }
      pending.push(file);
    }
    paintPending();
  };

  $('#attach').addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    addFiles([...picker.files]);
    picker.value = '';
  });

  // Ein Screenshot ist in der Zwischenablage, nicht auf der Platte: Einfügen soll ihn anhängen.
  input.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });

  // Und wer die Datei lieber herüberzieht, zieht sie auf das Antwortfeld.
  const box = input.closest('.reply-box');
  for (const type of ['dragover', 'dragenter']) {
    box.addEventListener(type, (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      box.classList.add('is-drop');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    box.addEventListener(type, () => box.classList.remove('is-drop'));
  }
  box.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });

  const send = async (internal = false) => {
    const body = input.value.trim();
    const chosen = pending;
    if (!body && !chosen.length) return;
    input.value = '';
    pending = [];
    paintPending();
    try {
      const files = await uploadFiles(chosen, {
        onProgress: (index, total) => total > 1 && toast(tr('tk.uploading', { i: index, n: total })),
      });
      const result = await api(
        staff ? `/admin/tickets/${id}/reply` : `/tickets/${id}/reply`,
        // Der Server liefert nur den Nachschlag seit der letzten sichtbaren Nachricht. So bleibt
        // das Abschicken auch bei einem sehr langen Ticket konstant schnell.
        { method: 'POST', body: { body, internal, files, after: messages.at(-1)?.id || 0 } }
      );
      mergeMessages(result.messages);
      Object.assign(ticket, result.ticket);
      if (result.reads) reads = result.reads;
      setStoredDraft('');
      paintDraft();
      paint();
      paintReads();
      paintStatus(result.ticket.status);
      await refresh({ profiles: false, accounts: false });
    } catch (error) {
      fail(error);
      // Nichts geht verloren: Text und Auswahl stehen wieder da, wo sie waren.
      input.value = body;
      pending = chosen;
      setStoredDraft(input.value);
      paintDraft();
      paintPending();
    }
  };

  $('#send').addEventListener('click', () => send(false));
  $('#internal')?.addEventListener('click', () => send(true));

  // Schnellantworten sind genau das: Die richtige Kundensprache wird automatisch gewählt und ein
  // Klick verschickt die Antwort. Ein bereits beantwortetes oder geschlossenes Ticket wird vom
  // normalen Antwortweg wieder geöffnet; die Bausteine bleiben deshalb in jedem Zustand sichtbar.
  $$('[data-quick-reply]').forEach((button) =>
    button.addEventListener('click', async () => {
      const chosen = templates.find((entry) => entry.id === Number(button.dataset.quickReply));
      if (!chosen || button.disabled) return;
      const text = (customerLanguage === 'en' ? chosen.body_en : chosen.body_de) || chosen.body_de;
      const body = text
        .replaceAll('{name}', data.user?.display_name || '')
        .replaceAll('{ticket}', `#${ticket.id}`)
        .replaceAll('{subject}', ticket.subject || '');
      button.disabled = true;
      try {
        const result = await api(`/admin/tickets/${id}/reply`, {
          method: 'POST',
          body: { body, internal: false, files: [], after: messages.at(-1)?.id || 0 },
        });
        mergeMessages(result.messages);
        Object.assign(ticket, result.ticket);
        if (result.reads) reads = result.reads;
        paint();
        paintReads();
        paintStatus(result.ticket.status);
        await Promise.allSettled([
          api(`/admin/ticket-templates/${chosen.id}/used`, { method: 'POST' }),
          refresh({ profiles: false, accounts: false }),
        ]);
        ok(tr('tmpl.sent'));
      } catch (error) {
        fail(error);
      } finally {
        button.disabled = false;
      }
    })
  );

  // Enter schickt ab, Shift+Enter macht eine neue Zeile – wie in jedem Chat.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(false);
    }
  });

  // "schreibt gerade …": höchstens alle zwei Sekunden eine Meldung, sonst wäre es ein Tastendruck-
  // Protokoll statt eines Hinweises.
  let lastTyping = 0;
  input.addEventListener('input', () => {
    const now = Date.now();
    if (now - lastTyping < 2000) return;
    lastTyping = now;
    api(staff ? `/admin/tickets/${id}/typing` : `/tickets/${id}/typing`, { method: 'POST' }).catch(() => {});
  });

  // ------------------------------------------------------------ Zustand und Beteiligte

  function paintStatus(status) {
    ticket.status = status;
    $('#status').innerHTML = statusControls();
    // Die Kopfzeile hängt an denselben Werten wie die Seitenleiste. Zeichnet man nur eines von
    // beidem neu, stehen zwei Wahrheiten übereinander – und die falsche ist die größere.
    $('#facts').outerHTML = factsStrip();
    const closed = status === 'closed';
    $('#closed-note').hidden = !closed;
    $('#status-hint').hidden = !closed;
    const take = $('#take');
    if (take) {
      take.disabled = ticket.assigned_to === me;
      take.innerHTML = `${icon('user')} ${escapeHtml(
        ticket.assigned_to === me ? tr('tk.assignedToYou') : tr('tk.takeIt')
      )}`;
    }
  }

  $('#status').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-status]');
    if (!button) return;
    const wanted = button.dataset.status;
    if (wanted === ticket.status) return;
    try {
      const result = staff
        ? await api(`/admin/tickets/${id}`, { method: 'PATCH', body: { status: wanted } })
        : await api(`/tickets/${id}/status`, { method: 'POST', body: { status: wanted } });
      Object.assign(ticket, result.ticket);
      paintStatus(result.ticket.status);
      ok(tr('adm.saved'));
      await refresh({ profiles: false, accounts: false });
    } catch (error) {
      fail(error);
    }
  });

  /** Dringlichkeit oder Zuständigkeit ändern – und die Kopfzeile mitziehen. */
  const patch = async (body) => {
    try {
      const result = await api(`/admin/tickets/${id}`, { method: 'PATCH', body });
      Object.assign(ticket, result.ticket);
      paintStatus(result.ticket.status);
      ok(tr('adm.saved'));
    } catch (error) {
      fail(error);
    }
  };

  for (const [id_, field] of [
    ['#priority', 'priority'],
    ['#assigned', 'assigned_to'],
  ]) {
    $(id_)?.addEventListener('change', async (event) => {
      const value = field === 'assigned_to' ? Number(event.target.value) || null : event.target.value;
      await patch({ [field]: value });
    });
  }

  $('#take')?.addEventListener('click', async () => {
    await patch({ assigned_to: me });
    const select = $('#assigned');
    if (select) select.value = String(me);
  });

  $('#add-person')?.addEventListener('click', async () => {
    const { users } = await api('/admin/users?filter=all');
    const known = new Set(participants.map((person) => person.id));
    const options = users
      .filter((user) => !known.has(user.id))
      .map((user) => ({
        value: String(user.id),
        label: `${user.display_name || `#${user.id}`} · ${user.email}`,
      }));
    if (!options.length) return toast(tr('tk.addNoneLeft'));
    const answer = await formDialog(
      tr('tk.addPerson'),
      [{ key: 'user_id', label: tr('adm.users'), type: 'select', value: options[0].value, options }],
      { submit: tr('tk.addPerson') }
    );
    if (!answer) return;
    try {
      const result = await api(`/admin/tickets/${id}/users`, {
        method: 'POST',
        body: { user_id: Number(answer.user_id) },
      });
      participants = result.participants;
      paintPeople();
      ok(tr('adm.saved'));
    } catch (error) {
      fail(error);
    }
  });

  // ------------------------------------------------------------ Live

  const typingBox = $('#typing');
  const typers = new Map();

  const paintTyping = () => {
    const now = Date.now();
    for (const [key, at] of typers) if (now - at > 4000) typers.delete(key);
    const names = [...typers.keys()];
    typingBox.innerHTML = names.length
      ? `<span class="dots"><i></i><i></i><i></i></span>${escapeHtml(
          names.length === 1 ? tr('tk.typing', { name: names[0] }) : tr('tk.typingMany')
        )}`
      : '';
  };

  const mergeMessages = (incoming) => {
    // Live-Ereignisse können schneller eintreffen als der Nachlade-Request. Statt einen zweiten
    // Verlauf blind anzuhängen, ist die Datenbank-ID die eindeutige Wahrheit.
    const known = new Set(messages.map((entry) => entry.id));
    const fresh = incoming.filter((entry) => !known.has(entry.id));
    if (!fresh.length) return false;
    messages = messages.concat(fresh).sort((left, right) => left.id - right.id);
    return true;
  };

  state.onLive = async (event) => {
    if (event.type !== 'ticket' || event.message.ticket_id !== Number(id)) return;
    const message = event.message;
    if (staff ? !message.audience?.staff : !message.audience?.customer) return;

    if (event.event === 'typing') {
      if (message.user_id === state.me.id) return;
      typers.set(message.name, Date.now());
      paintTyping();
      setTimeout(paintTyping, 4_100);
      return;
    }
    if (event.event === 'status') {
      ticket.status = message.status;
      paintStatus(message.status);
      return;
    }
    // Die andere Seite hat gelesen. Das ist die kleinste aller Meldungen – eine Zahl je Person –
    // und kommt deshalb ohne Nachladen aus: Sie wird an Ort und Stelle eingesetzt.
    if (event.event === 'read') {
      if (message.user_id === me && message.staff === staff) return;
      const known = reads.find(
        (entry) => entry.user_id === message.user_id && entry.staff === Boolean(message.staff)
      );
      if (known) {
        if (message.last_message_id <= known.last_message_id) return;
        known.last_message_id = message.last_message_id;
        known.read_at = message.read_at;
      } else {
        reads = reads.concat({
          user_id: message.user_id,
          staff: Boolean(message.staff),
          last_message_id: message.last_message_id,
          read_at: message.read_at,
          display_name: message.name || `#${message.user_id}`,
          avatar: null,
        });
      }
      paint();
      paintReads();
      return;
    }
    if (event.event === 'message') {
      // Nachschlag holen statt der Nachricht aus der Meldung zu vertrauen: so stimmen Reihenfolge
      // und Rechte auch dann, wenn zwei Antworten gleichzeitig eintreffen.
      const last = messages.length ? messages[messages.length - 1].id : 0;
      const fresh = await api(`${base}/messages?since=${last}`).catch(() => null);
      if (!fresh) return;
      if (mergeMessages(fresh.messages)) {
        typers.clear();
        paintTyping();
        paint();
      }
      if (fresh.reads) {
        reads = fresh.reads;
        paintReads();
      }
      Object.assign(ticket, fresh.ticket);
      paintStatus(fresh.ticket.status);
    }
  };
}
