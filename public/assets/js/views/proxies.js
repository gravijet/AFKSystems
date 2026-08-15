// Proxys: was sie sind, wer sie bekommt, welche dir gehören.
//
// Angelegt und zugeteilt werden sie vom Betreiber – hinter jedem steckt eine echte Adresse.
// Deshalb gibt es hier keinen Selbstbedienungsknopf, sondern den Weg über ein Ticket.

import { api, icon, escapeHtml, datetime, tr, $ } from '../ui.js';
import { state, appbar, go } from '../app.js';

export async function render(root) {
  const data = await api('/proxies');

  root.innerHTML = `
    ${appbar(tr('px.title'), '', tr('px.sub'))}

    <div class="grid two" style="align-items:start">
      <section class="panel">
        <header><h3>${escapeHtml(tr('px.title'))}</h3></header>
        <div class="body stack">
          <p class="small muted">${escapeHtml(tr('px.why'))}</p>
          ${
            data.allowed
              ? `<p class="small muted">${escapeHtml(tr('px.assignHint'))}</p>
                 ${
                   state.me.proxy_allowance
                     ? `<p class="small muted">${escapeHtml(
                         tr('px.allowance', { n: state.me.proxy_allowance })
                       )}</p>`
                     : ''
                 }`
              : `<div class="note warn">${icon('info')}<div>${escapeHtml(tr('px.freeNote'))}</div></div>`
          }
          ${
            data.supported
              ? ''
              : `<div class="note warn">${icon('alert')}<div>${escapeHtml(
                  tr('px.unsupported')
                )}</div></div>`
          }
          <button class="btn btn-primary" id="request">${icon('ticket')} ${escapeHtml(tr('px.request'))}</button>
          <p class="small muted">${escapeHtml(tr('px.requestNote'))}</p>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('px.mine'))}</h3></header>
        <div class="body" style="padding:0">
          ${
            data.proxies.length
              ? `<div class="table-wrap"><table class="table">
                  <thead><tr><th>${escapeHtml(tr('common.name'))}</th><th>${escapeHtml(tr('px.kind'))}</th>
                    <th>${escapeHtml(tr('px.host'))}</th><th></th></tr></thead>
                  <tbody>${data.proxies
                    .map(
                      (proxy) => `<tr>
                        <td>${escapeHtml(proxy.label || `#${proxy.id}`)}</td>
                        <td class="mono small">${escapeHtml(proxy.kind)}</td>
                        <td class="mono small">${escapeHtml(proxy.host)}:${proxy.port}</td>
                        <td class="small muted mono">${datetime(proxy.created_at)}</td>
                      </tr>`
                    )
                    .join('')}</tbody>
                </table></div>`
              : `<p class="small muted" style="padding:1.25rem">${escapeHtml(tr('px.none'))}</p>`
          }
        </div>
      </section>
    </div>`;

  $('#request').addEventListener('click', () => {
    // Direkt in das Ticket-Formular mit vorgewählter Kategorie.
    go('/tickets?new=proxy');
  });
}
