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
  api, icon, escapeHtml, datetime, since, safeLink, tr, $, $$, ok, fail, toast, formDialog, debounce, fileSize,
} from '../ui.js';
import { state, appbar, refresh, draw, go } from '../app.js';

// Drei Zustände, drei Aussagen: bei uns, beim Kunden, erledigt. Ein vierter („wartet“) stand
// früher daneben und bedeutete dasselbe wie „beantwortet“ – siehe server/tickets.js.
const STATUS_PILL = { open: 'primary', answered: '', closed: '' };

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
      title="${escapeHtml(file.name)}"><img src="${href}" alt="${escapeHtml(file.name)}" loading="lazy"></a>`;
  }
  return `<a class="chat-file" href="${href}?download=1" download="${escapeHtml(file.name)}">
    ${icon('download')}<span class="truncate">${escapeHtml(file.name)}</span>
    <span class="small muted nowrap">${escapeHtml(fileSize(file.size))}</span></a>`;
}

const attachments = (files) =>
  files?.length ? `<div class="chat-files">${files.map(attachment).join('')}</div>` : '';

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
function row(ticket) {
  // Anklickbar heißt auch: mit der Tastatur erreichbar. Ohne `role`/`tabindex` war die ganze
  // Ticketliste für jeden unbedienbar, der keine Maus benutzt.
  const unread = Boolean(ticket.unread_user);
  const label = `#${ticket.id} ${ticket.subject}${unread ? ` – ${tr('tk.unread')}` : ''}`;
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
      <div class="small muted truncate">
        ${escapeHtml(
          ticket.messages === 1 ? tr('tk.messagesOne') : tr('tk.messages', { n: ticket.messages ?? 0 })
        )}
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
    ],
    { submit: tr('tk.send') }
  );
  if (!answer) return;
  try {
    const files = await uploadFiles(answer.files, {
      onProgress: (index, total) => total > 1 && toast(tr('tk.uploading', { i: index, n: total })),
    });
    const result = await api('/tickets', {
      method: 'POST',
      body: { subject: answer.subject, body: answer.body, files },
    });
    ok(tr('tk.created'));
    await refresh({ profiles: false, accounts: false });
    go(`/tickets/${result.ticket.id}`);
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------- Ein Ticket

async function one(root, id, { staff, backHash }) {
  const base = staff ? `/admin/tickets/${id}` : `/tickets/${id}`;
  const data = await api(base);
  const ticket = data.ticket;
  let messages = data.messages;
  let participants = data.participants || [];

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

  root.innerHTML = `
    ${appbar(
      ticket.subject,
      `<a class="btn btn-sm" href="${backHash}">${escapeHtml(tr('common.back'))}</a>`,
      `#${ticket.id} · ${datetime(ticket.created_at)}`
    )}

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
          <div class="row spread wrap" style="margin-top:.6rem">
            <span class="small muted">${escapeHtml(tr('tk.writeHint'))}</span>
            <div class="row">
              <button class="btn btn-sm" id="attach" title="${escapeHtml(
                tr('tk.filesHint', { max: fileSize(MAX_UPLOAD) })
              )}">${icon('plus')} ${escapeHtml(tr('tk.files'))}</button>
              ${
                staff
                  ? `<button class="btn btn-sm" id="templates" title="${escapeHtml(tr('tmpl.insertHint'))}">
                      ${icon('message')} ${escapeHtml(tr('tmpl.insert'))}</button>
                     <button class="btn btn-sm" id="internal" title="${escapeHtml(tr('tk.internalHint'))}">
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
                            }>${escapeHtml(person.username)}</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                  ${
                    data.user
                      ? `<hr class="rule">
                         <a class="row spread" href="#/admin/users/${data.user.id}">
                           <span class="row">${icon('user')} ${escapeHtml(data.user.username)}</span>${icon('arrow')}</a>
                         <div class="small muted">${escapeHtml(data.user.email)}
                           ${data.paying ? `<span class="pill primary">${escapeHtml(tr('adm.paying'))}</span>` : ''}</div>`
                      : ''
                  }
                </div>
              </section>`
            : ''
        }

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

  const paint = () => {
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    // Ein Ticket darf ohne Text abgeschickt werden – dann steht hier zunächst nur der Betreff,
    // und der Kasten sagt das, statt leer zu bleiben wie ein Fehler.
    thread.innerHTML =
      messages.map(bubble).join('') ||
      `<div class="chat-system"><span>${escapeHtml(tr('tk.onlySubject'))}</span></div>`;
    if (atBottom) thread.scrollTop = thread.scrollHeight;
  };

  function bubble(message) {
    if (message.role === 'system') {
      return `<div class="chat-system"><span>${escapeHtml(message.body)}</span></div>`;
    }
    const mine = message.user_id === (data.me ?? state.me.id);
    const who = message.internal
      ? tr('tk.internal')
      : message.author_name || message.username || (message.role === 'staff' ? tr('tk.staff') : tr('tk.you'));
    return `<article class="chat-msg ${message.role} ${mine ? 'mine' : ''} ${
      message.internal ? 'internal' : ''
    }">
      <header>
        <span class="strong">${escapeHtml(who)}</span>
        ${message.role === 'staff' && !message.internal ? `<span class="pill primary">${escapeHtml(tr('tk.staff'))}</span>` : ''}
        ${message.discord_id ? `<span class="pill">${icon('discord')}</span>` : ''}
        <time>${datetime(message.created_at)}</time>
      </header>
      ${message.body ? `<p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>` : ''}
      ${attachments(message.files)}
    </article>`;
  }

  const paintPeople = () => {
    $('#people').innerHTML =
      participants
        .map(
          (person) => `<div class="row spread">
            <span class="row" style="gap:.5rem;min-width:0">${icon('user')}
              <span class="truncate">${escapeHtml(person.username)}</span>
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

  paint();
  paintPeople();
  thread.scrollTop = thread.scrollHeight;

  // ------------------------------------------------------------ Schreiben

  const input = $('#reply');
  const picker = $('#reply-files');
  const attachBox = $('#attach-list');

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
        { method: 'POST', body: { body, internal, files } }
      );
      messages = result.messages;
      Object.assign(ticket, result.ticket);
      paint();
      paintStatus(result.ticket.status);
      await refresh({ profiles: false, accounts: false });
    } catch (error) {
      fail(error);
      // Nichts geht verloren: Text und Auswahl stehen wieder da, wo sie waren.
      input.value = body;
      pending = chosen;
      paintPending();
    }
  };

  $('#send').addEventListener('click', () => send(false));
  $('#internal')?.addEventListener('click', () => send(true));

  /**
   * Einen Textbaustein einfügen.
   *
   * Eingefügt wird an der Stelle, an der der Zeiger steht, und nicht anstelle des Geschriebenen:
   * Wer schon zwei Sätze getippt hat und dann einen Baustein holt, will beides – sonst wäre der
   * Knopf ein Papierkorb mit Umweg.
   *
   * Die Platzhalter setzt der Browser ein, weil Kunde und Ticket hier ohnehin auf dem Bildschirm
   * stehen. Ein Baustein bleibt damit ein Text und wird nie zu einer Vorlage, die der Server
   * rendern muss.
   */
  $('#templates')?.addEventListener('click', async () => {
    let list = [];
    try {
      list = (await api('/admin/ticket-templates')).templates;
    } catch (error) {
      return fail(error);
    }
    if (!list.length) {
      toast(tr('tmpl.none'), '');
      return;
    }
    const answer = await formDialog(
      tr('tmpl.insert'),
      [
        {
          key: 'id',
          label: tr('adm.templates'),
          type: 'select',
          value: String(list[0].id),
          options: list.map((entry) => ({
            value: String(entry.id),
            label: `${(state.me?.language === 'en' ? entry.title_en : entry.title_de) || entry.title_de}${
              entry.category && entry.category !== 'general' ? ` · ${entry.category}` : ''
            }`,
          })),
        },
      ],
      { submit: tr('tmpl.insert'), note: tr('tmpl.insertHint') }
    );
    if (!answer) return;
    const chosen = list.find((entry) => String(entry.id) === String(answer.id));
    if (!chosen) return;
    const text = (state.me?.language === 'en' ? chosen.body_en : chosen.body_de) || chosen.body_de;
    const filled = text
      .replaceAll('{name}', data.user?.username || '')
      .replaceAll('{ticket}', `#${ticket.id}`)
      .replaceAll('{subject}', ticket.subject || '');
    const at = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, at);
    const after = input.value.slice(input.selectionEnd ?? at);
    input.value = `${before}${before && !before.endsWith('\n') ? '\n' : ''}${filled}${after}`;
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length - after.length;
    api(`/admin/ticket-templates/${chosen.id}/used`, { method: 'POST' }).catch(() => {});
  });

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
    const closed = status === 'closed';
    $('#closed-note').hidden = !closed;
    $('#status-hint').hidden = !closed;
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

  for (const [id_, field] of [
    ['#priority', 'priority'],
    ['#assigned', 'assigned_to'],
  ]) {
    $(id_)?.addEventListener('change', async (event) => {
      const value = field === 'assigned_to' ? Number(event.target.value) || null : event.target.value;
      try {
        await api(`/admin/tickets/${id}`, { method: 'PATCH', body: { [field]: value } });
        ok(tr('adm.saved'));
      } catch (error) {
        fail(error);
      }
    });
  }

  $('#add-person')?.addEventListener('click', async () => {
    const { users } = await api('/admin/users?filter=all');
    const known = new Set(participants.map((person) => person.id));
    const options = users
      .filter((user) => !known.has(user.id))
      .map((user) => ({ value: String(user.id), label: `${user.username} · ${user.email}` }));
    if (!options.length) return toast(tr('common.none'));
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
      Object.assign(ticket, fresh.ticket);
      paintStatus(fresh.ticket.status);
    }
  };
}
