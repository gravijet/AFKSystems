// Support-Tickets: Liste, ein Ticket lesen, antworten, schließen.

import { api, icon, escapeHtml, datetime, tr, $, $$, ok, fail, formDialog, confirmDialog } from '../ui.js';
import { state, appbar, refresh, draw, go } from '../app.js';

const STATUS_PILL = {
  open: 'primary',
  waiting: 'missing',
  answered: '',
  closed: '',
};

export async function render(root, route) {
  if (route.id) return one(root, route.id);

  const data = await api('/tickets');
  const wanted = new URLSearchParams(location.hash.split('?')[1] || '').get('new');

  root.innerHTML = `
    ${appbar(
      tr('tk.title'),
      `<button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('tk.new'))}</button>`,
      tr('tk.sub')
    )}

    ${
      state.meta?.support_hours
        ? `<div class="note" style="margin-bottom:1.25rem">${icon('clock')}<div>${escapeHtml(
            tr('tk.hours', { hours: state.meta.support_hours })
          )}</div></div>`
        : ''
    }

    <section class="panel">
      <div class="body" style="padding:0">
        ${
          data.tickets.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th>${escapeHtml(tr('tk.subject'))}</th>
                  <th>${escapeHtml(tr('tk.category'))}</th>
                  <th>${escapeHtml(tr('common.status'))}</th>
                  <th>${escapeHtml(tr('bill.history'))}</th>
                </tr></thead>
                <tbody>${data.tickets
                  .map(
                    (ticket) => `<tr data-open="${ticket.id}" style="cursor:pointer">
                      <td><span class="row" style="gap:.5rem">
                        ${ticket.unread_user ? '<span class="dot live" style="color:var(--primary)"></span>' : ''}
                        ${escapeHtml(ticket.subject)}</span></td>
                      <td class="small muted">${escapeHtml(
                        data.categories.find((entry) => entry.key === ticket.category)?.label || ticket.category
                      )}</td>
                      <td><span class="pill ${STATUS_PILL[ticket.status] || ''}">${escapeHtml(
                        tr(`tk.status.${ticket.status}`)
                      )}</span></td>
                      <td class="small muted mono">${datetime(ticket.updated_at)}</td>
                    </tr>`
                  )
                  .join('')}</tbody>
              </table></div>`
            : `<div class="empty" style="box-shadow:none;background:transparent">
                <h3>${escapeHtml(tr('tk.none'))}</h3>
                <p>${escapeHtml(tr('tk.sub'))}</p>
                <button class="btn btn-primary" id="new-2">${icon('plus')} ${escapeHtml(tr('tk.new'))}</button>
              </div>`
        }
      </div>
    </section>`;

  $$('[data-open]').forEach((row) =>
    row.addEventListener('click', () => go(`/tickets/${row.dataset.open}`))
  );
  for (const id of ['#new', '#new-2']) $(id)?.addEventListener('click', () => create(data));
  if (wanted) create(data, wanted);
}

async function create(data, category = 'general') {
  const answer = await formDialog(
    tr('tk.new'),
    [
      { key: 'subject', label: tr('tk.subject'), required: true },
      {
        key: 'category',
        label: tr('tk.category'),
        type: 'select',
        value: category,
        options: data.categories.map((entry) => ({ value: entry.key, label: entry.label })),
      },
      ...(data.priority_allowed
        ? [
            {
              key: 'priority',
              label: tr('tk.priority'),
              type: 'select',
              value: 'normal',
              // "urgent" vergibt nur das Team – es hier anzubieten hieße, einen Knopf zu zeigen,
              // der beim Speichern still auf "normal" zurückfällt.
              options: ['low', 'normal', 'high'].map((value) => ({
                value,
                label: tr(`tk.priority.${value}`),
              })),
            },
          ]
        : []),
      { key: 'body', label: tr('tk.message'), type: 'textarea', required: true },
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

async function one(root, id) {
  const data = await api(`/tickets/${id}`);
  const ticket = data.ticket;
  const closed = ticket.status === 'closed';

  root.innerHTML = `
    ${appbar(
      ticket.subject,
      `<a class="btn btn-sm" href="#/tickets">${escapeHtml(tr('common.back'))}</a>
       ${
         closed
           ? ''
           : `<button class="btn btn-sm" id="close">${escapeHtml(tr('tk.close'))}</button>`
       }`,
      `${tr(`tk.status.${ticket.status}`)} · ${datetime(ticket.created_at)}`
    )}

    <section class="panel" style="margin-bottom:1.25rem">
      <div class="body stack" style="gap:1rem">
        ${data.messages
          .map(
            (message) => `<article class="msg ${message.role === 'staff' ? 'staff' : ''} ${
              message.internal ? 'internal' : ''
            }">
              <header class="row spread">
                <span class="strong small">${escapeHtml(
                  message.internal
                    ? tr('tk.internal')
                    : message.role === 'staff'
                      ? tr('tk.staff')
                      : message.username || tr('tk.you')
                )}</span>
                <span class="small muted mono">${datetime(message.created_at)}</span>
              </header>
              <p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>
            </article>`
          )
          .join('')}
      </div>
    </section>

    ${
      closed
        ? `<p class="small muted">${escapeHtml(tr('tk.status.closed'))}</p>`
        : `<section class="panel">
            <header><h3>${escapeHtml(tr('tk.reply'))}</h3></header>
            <div class="body stack">
              <div class="field"><textarea id="reply" rows="4"></textarea></div>
              <button class="btn btn-primary" id="send">${escapeHtml(tr('tk.send'))}</button>
            </div>
          </section>`
    }`;

  $('#send')?.addEventListener('click', async () => {
    const body = $('#reply').value.trim();
    if (!body) return;
    try {
      await api(`/tickets/${id}/reply`, { method: 'POST', body: { body } });
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#close')?.addEventListener('click', async () => {
    if (!(await confirmDialog(tr('tk.close')))) return;
    try {
      await api(`/tickets/${id}/close`, { method: 'POST' });
      draw();
    } catch (error) {
      fail(error);
    }
  });
}
