// Proxys: anlegen und verwalten. Der Client benutzt sie noch nicht – das steht auch so da.

import { api, icon, escapeHtml, datetime, $, $$, ok, fail, confirmDialog, formDialog } from '../ui.js';
import { appbar, draw } from '../app.js';

export async function render(root) {
  const data = await api('/proxies');

  root.innerHTML = `
    ${appbar('Proxys', `<button class="btn btn-primary btn-sm" id="add">${icon('plus')} Proxy hinzufügen</button>`,
      'Eigene IP-Adressen für deine Konten')}

    <div class="note warn" style="margin-bottom:1.5rem">${icon('alert')}
      <div><strong>Noch ohne Wirkung.</strong> ${escapeHtml(data.hint)}
      Was du hier anlegst, bleibt gespeichert und lässt sich Konten zuordnen – es greift, sobald der
      Client Proxys spricht.</div></div>

    ${
      data.proxies.length
        ? `<section class="panel"><div class="table-wrap"><table class="table">
            <thead><tr><th>Bezeichnung</th><th>Art</th><th>Adresse</th><th>Benutzer</th><th>Angelegt</th><th></th></tr></thead>
            <tbody>${data.proxies
              .map(
                (proxy) => `<tr>
                  <td class="strong">${escapeHtml(proxy.label)}</td>
                  <td><span class="pill">${escapeHtml(proxy.kind)}</span></td>
                  <td class="mono small">${escapeHtml(proxy.host)}:${proxy.port}</td>
                  <td class="small muted">${escapeHtml(proxy.username || '–')}</td>
                  <td class="small muted">${datetime(proxy.created_at)}</td>
                  <td style="text-align:right">
                    <button class="btn btn-ghost btn-sm btn-danger" data-del="${proxy.id}">${icon('trash')}</button></td>
                </tr>`
              )
              .join('')}</tbody></table></div></section>`
        : `<div class="empty"><h3>Noch kein Proxy</h3>
            <p>Ein Proxy ist eine zweite IP-Adresse. Manche Server lassen nur wenige Konten pro IP zu –
              dafür wären sie da.</p>
            <button class="btn btn-primary" id="add-2">${icon('plus')} Proxy hinzufügen</button></div>`
    }`;

  const add = async () => {
    const form = await formDialog(
      'Proxy hinzufügen',
      [
        { key: 'label', label: 'Bezeichnung', placeholder: 'z. B. Frankfurt 1', value: '' },
        {
          key: 'kind',
          label: 'Art',
          type: 'select',
          value: 'socks5',
          options: ['socks5', 'socks4', 'http'],
        },
        { key: 'address', label: 'Adresse', placeholder: '1.2.3.4:1080', value: '' },
        { key: 'username', label: 'Benutzer (optional)', value: '' },
        { key: 'password', label: 'Passwort (optional)', type: 'password', value: '' },
      ],
      { submit: 'Hinzufügen' }
    );
    if (!form) return;
    try {
      await api('/proxies', { method: 'POST', body: form });
      ok('Proxy gespeichert.');
      draw();
    } catch (error) {
      fail(error);
    }
  };

  $('#add')?.addEventListener('click', add);
  $('#add-2')?.addEventListener('click', add);
  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog('Diesen Proxy löschen?', { confirm: 'Löschen' }))) return;
      await api(`/proxies/${button.dataset.del}`, { method: 'DELETE' });
      draw();
    })
  );
}
