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
  api, icon, escapeHtml, datetime, since, tr, $, $$, ok, fail, toast, formDialog, debounce,
} from '../ui.js';
import { state, appbar, refresh, draw, go } from '../app.js';

const STATUS_PILL = { open: 'primary', waiting: 'missing', answered: '', closed: '' };

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
  const categories = data.categories || state.meta?.ticket_categories || [];
  const invite = state.meta?.discord_invite || '';

  root.innerHTML = `
    ${appbar(
      tr('tk.title'),
      `<button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('tk.new'))}</button>`,
      tr('tk.sub')
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
        ? `<a class="ticket-discord" href="${escapeHtml(invite)}" target="_blank" rel="noopener">
            <span class="ticket-discord-icon">${icon('discord')}</span>
            <span class="grow">
              <span class="strong">${escapeHtml(tr('tk.discordTitle'))}</span>
              <span class="small muted">${escapeHtml(tr('tk.discordText'))}</span>
            </span>
            <span class="btn btn-sm">${escapeHtml(tr('discord.join'))}</span>
          </a>`
        : ''
    }

    <section class="panel">
      <div class="body" style="padding:0">
        ${
          data.tickets.length
            ? `<ul class="ticket-list">${data.tickets.map((ticket) => row(ticket, categories)).join('')}</ul>`
            : `<div class="empty" style="box-shadow:none;background:transparent">
                <h3>${escapeHtml(tr('tk.none'))}</h3>
                <p>${escapeHtml(tr('tk.sub'))}</p>
                <button class="btn btn-primary" id="new-2">${icon('plus')} ${escapeHtml(tr('tk.new'))}</button>
              </div>`
        }
      </div>
    </section>`;

  $$('[data-open]').forEach((node) =>
    node.addEventListener('click', () => go(`/tickets/${node.dataset.open}`))
  );
  for (const id of ['#new', '#new-2']) $(id)?.addEventListener('click', () => create(categories));

  const wanted = params.get('new');
  if (wanted) create(categories, wanted);

  // Kommt eine Antwort herein, ist die Liste sofort veraltet.
  state.onLive = debounce((event) => {
    if (event.type === 'ticket' && state.route.name === 'tickets' && !state.route.id) draw();
  }, 500);
}

function row(ticket, categories) {
  return `<li class="ticket-row ${ticket.unread_user ? 'is-unread' : ''}" data-open="${ticket.id}">
    <span class="ticket-dot ${ticket.status}"></span>
    <div class="grow" style="min-width:0">
      <div class="row" style="gap:.5rem">
        <span class="strong truncate">${escapeHtml(ticket.subject)}</span>
        <span class="small muted mono">#${ticket.id}</span>
        ${ticket.discord ? `<span class="pill" title="${escapeHtml(tr('tk.inDiscord'))}">${icon('discord')}</span>` : ''}
        ${ticket.shared ? `<span class="pill">${icon('users')}</span>` : ''}
      </div>
      <div class="small muted truncate">
        ${escapeHtml(categories.find((entry) => entry.key === ticket.category)?.label || ticket.category)}
      </div>
    </div>
    <div class="row" style="gap:.4rem">
      <span class="pill ${STATUS_PILL[ticket.status] || ''}">${escapeHtml(tr(`tk.status.${ticket.status}`))}</span>
      <span class="small muted mono nowrap">${since(ticket.updated_at)}</span>
    </div>
  </li>`;
}

// ---------------------------------------------------------------- Anlegen

async function create(categories, category = 'general') {
  // Keine Dringlichkeit zur Auswahl. Wer ein Ticket aufmacht, hält es für dringend – die Frage
  // beantwortet also jeder gleich, und beantwortet wird ohnehin nach Reihenfolge und Tarif.
  // Die Nachricht ist kein Pflichtfeld: der Betreff sagt schon, worum es geht, und ein Ticket,
  // das beim Abschicken verschwindet, weil ein Feld leer war, ist schlimmer als eines ohne Text.
  const answer = await formDialog(
    tr('tk.new'),
    [
      { key: 'subject', label: tr('tk.subject'), required: true },
      {
        key: 'category',
        label: tr('tk.category'),
        type: 'select',
        value: category,
        options: categories.map((entry) => ({ value: entry.key, label: entry.label })),
      },
      { key: 'body', label: `${tr('tk.message')} (${tr('common.optional')})`, type: 'textarea' },
    ],
    { submit: tr('tk.send') }
  );
  if (!answer) return;
  try {
    const result = await api('/tickets', { method: 'POST', body: answer });
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
  const categories = state.meta?.ticket_categories || [];
  let messages = data.messages;
  let participants = data.participants || [];

  root.innerHTML = `
    ${appbar(
      ticket.subject,
      `<a class="btn btn-sm" href="${backHash}">${escapeHtml(tr('common.back'))}</a>`,
      `#${ticket.id} · ${escapeHtml(
        categories.find((entry) => entry.key === ticket.category)?.label || ticket.category
      )} · ${datetime(ticket.created_at)}`
    )}

    <div class="ticket">
      <div class="ticket-main">
        <div class="chat-thread" id="thread"></div>
        <div class="typing" id="typing"></div>

        <div class="reply-box">
          ${
            ticket.status === 'closed'
              ? `<p class="small muted" style="margin:0 0 .6rem">${escapeHtml(tr('tk.closedNote'))}</p>`
              : ''
          }
          <textarea id="reply" rows="3" placeholder="${escapeHtml(tr('tk.reply'))}"></textarea>
          <div class="row spread wrap" style="margin-top:.6rem">
            <span class="small muted">${escapeHtml(tr('tk.writeHint'))}</span>
            <div class="row">
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
              ${
                staff
                  ? ['open', 'waiting', 'answered', 'closed']
                      .map(
                        (entry) => `<button class="status-choice ${entry} ${
                          ticket.status === entry ? 'active' : ''
                        }" data-status="${entry}">${escapeHtml(tr(`tk.status.${entry}`))}</button>`
                      )
                      .join('')
                  : ticket.status === 'closed'
                    ? `<span class="pill missing">${escapeHtml(tr('tk.status.closed'))}</span>`
                    : `<button class="btn btn-danger btn-block" data-status="closed">${escapeHtml(
                        tr('tk.close')
                      )}</button>`
              }
            </div>
            ${
              ticket.status === 'closed'
                ? `<p class="small muted">${escapeHtml(tr('tk.reopenHint'))}</p>`
                : ''
            }
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
                    <label for="category">${escapeHtml(tr('tk.category'))}</label>
                    <select id="category">
                      ${categories
                        .map(
                          (entry) =>
                            `<option value="${entry.key}" ${
                              ticket.category === entry.key ? 'selected' : ''
                            }>${escapeHtml(entry.label)}</option>`
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
      <p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>
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

  const send = async (internal = false) => {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      const result = await api(
        staff ? `/admin/tickets/${id}/reply` : `/tickets/${id}/reply`,
        { method: 'POST', body: { body, internal } }
      );
      messages = result.messages;
      Object.assign(ticket, result.ticket);
      paint();
      markStatus(result.ticket.status);
      await refresh({ profiles: false, accounts: false });
    } catch (error) {
      fail(error);
      input.value = body;
    }
  };

  $('#send').addEventListener('click', () => send(false));
  $('#internal')?.addEventListener('click', () => send(true));

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

  function markStatus(status) {
    $$('[data-status]').forEach((button) =>
      button.classList.toggle('active', button.dataset.status === status)
    );
  }

  $$('[data-status]').forEach((button) =>
    button.addEventListener('click', async () => {
      const wanted = button.dataset.status;
      if (wanted === ticket.status) return;
      try {
        const result = staff
          ? await api(`/admin/tickets/${id}`, { method: 'PATCH', body: { status: wanted } })
          : await api(`/tickets/${id}/status`, { method: 'POST', body: { status: wanted } });
        Object.assign(ticket, result.ticket);
        markStatus(result.ticket.status);
        ok(tr('adm.saved'));
        await refresh({ profiles: false, accounts: false });
      } catch (error) {
        fail(error);
      }
    })
  );

  for (const [id_, field] of [
    ['#priority', 'priority'],
    ['#category', 'category'],
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
  setInterval(paintTyping, 1500);

  state.onLive = async (event) => {
    if (event.type !== 'ticket' || event.message.ticket_id !== Number(id)) return;
    const message = event.message;

    if (event.event === 'typing') {
      if (message.user_id === state.me.id) return;
      typers.set(message.name, Date.now());
      paintTyping();
      return;
    }
    if (event.event === 'status') {
      ticket.status = message.status;
      markStatus(message.status);
      return;
    }
    if (event.event === 'message') {
      // Nachschlag holen statt der Nachricht aus der Meldung zu vertrauen: so stimmen Reihenfolge
      // und Rechte auch dann, wenn zwei Antworten gleichzeitig eintreffen.
      const last = messages.length ? messages[messages.length - 1].id : 0;
      const fresh = await api(`${base}/messages?since=${last}`).catch(() => null);
      if (!fresh) return;
      if (fresh.messages.length) {
        messages = messages.concat(fresh.messages);
        typers.clear();
        paintTyping();
        paint();
      }
      Object.assign(ticket, fresh.ticket);
      markStatus(fresh.ticket.status);
    }
  };
}
