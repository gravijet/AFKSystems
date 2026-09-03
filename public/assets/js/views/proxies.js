// Proxys: was sie sind, wer sie bekommt, welche dir gehören.
//
// Angelegt und zugeteilt werden sie vom Betreiber – hinter jedem steckt eine echte Adresse.
// Deshalb gibt es hier keinen Selbstbedienungsknopf, sondern den Weg über ein Ticket.

import { api, icon, escapeHtml, datetime, tr, $, $$, copy } from '../ui.js';
import { state, appbar, go } from '../app.js';

export async function render(root) {
  const data = await api('/proxies');
  const allowance = Math.max(0, Number(state.me.proxy_allowance) || 0);
  const available = Math.max(0, allowance - data.proxies.length);
  const proxySlots = state.profiles.filter((profile) => profile.caps?.proxy);

  root.innerHTML = `
    ${appbar(
      tr('px.title'),
      `<button class="btn btn-primary btn-sm" id="request-top">${icon('ticket')} ${escapeHtml(
        tr('px.request')
      )}</button>`,
      tr('px.sub')
    )}

    <div class="grid three proxy-summary">
      <div class="stat"><div class="k">${escapeHtml(tr('px.assigned'))}</div>
        <div class="v">${data.proxies.length}</div><div class="s">${escapeHtml(tr('px.readyToUse'))}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('px.limit'))}</div>
        <div class="v">${allowance || '–'}</div><div class="s">${escapeHtml(
          data.allowed ? tr('px.forAccount') : tr('px.paidOnly')
        )}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('px.available'))}</div>
        <div class="v">${data.allowed ? available : '–'}</div><div class="s">${escapeHtml(
          available ? tr('px.requestMore') : tr(data.proxies.length ? 'px.limitReached' : 'px.noneAssigned')
        )}</div></div>
    </div>

    <div class="grid two">
      <section class="panel">
        <header><h3>${escapeHtml(tr('px.title'))}</h3></header>
        <div class="body stack">
          <p class="small muted">${escapeHtml(tr('px.why'))}</p>
          <div class="note">${icon('info')}<div>${escapeHtml(data.hint)}</div></div>
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
          ${
            proxySlots.length
              ? `<div class="proxy-destinations">
                  <span class="small muted">${escapeHtml(tr('px.configureOn'))}</span>
                  <div class="row wrap">${proxySlots
                    .map(
                      (profile) => `<a class="pill" href="#/servers/${profile.id}/proxies">${icon(
                        'server'
                      )}${escapeHtml(profile.name)}</a>`
                    )
                    .join('')}</div>
                </div>`
              : ''
          }
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
                        <td><span class="row" style="gap:.25rem"><span class="mono small">${escapeHtml(
                          proxy.host
                        )}:${proxy.port}</span>
                          <button class="btn btn-ghost btn-sm" data-copy-proxy="${escapeHtml(
                            `${proxy.host}:${proxy.port}`
                          )}" title="${escapeHtml(tr('common.copy'))}" aria-label="${escapeHtml(
                            tr('common.copy')
                          )}">${icon('copy')}</button></span></td>
                        <td class="small muted mono" title="${escapeHtml(tr('px.added'))}">${datetime(
                          proxy.created_at
                        )}</td>
                      </tr>`
                    )
                    .join('')}</tbody>
                </table></div>`
              : `<p class="small muted" style="padding:1.25rem">${escapeHtml(tr('px.none'))}</p>`
          }
        </div>
      </section>
    </div>`;

  const request = () => {
    // Direkt in das Ticket-Formular mit vorgewählter Kategorie.
    go('/tickets?new=proxy');
  };
  $('#request').addEventListener('click', request);
  $('#request-top').addEventListener('click', request);
  $$('[data-copy-proxy]').forEach((button) =>
    button.addEventListener('click', () => copy(button.dataset.copyProxy))
  );
}
