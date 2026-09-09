// Minecraft-Konten: verbinden (Microsoft-Gerätecode), auffrischen, entfernen.

import { api, icon, escapeHtml, datetime, tr, $, $$, ok, fail, confirmDialog, formDialog } from '../ui.js';
import { state, appbar, refresh, draw } from '../app.js';

export async function render(root) {
  const data = await api('/accounts');
  state.accounts = data.accounts;
  await refresh({ accounts: false, me: false });
  let query = '';
  let filter = 'all';
  let order = 'name';

  const usedOn = (account) =>
    state.profiles.filter((profile) =>
      profile.accounts.some((member) => member.account_id === account.id)
    );
  const onlineOn = (account) =>
    usedOn(account).filter((profile) =>
      profile.accounts.some((member) => member.account_id === account.id && member.online)
    );
  // `online` heißt wirklich im Spiel. Für die Bedienung ist aber auch ein gerade gestarteter
  // Client belegt: Er darf nicht parallel auf einem zweiten Platz loslaufen. Deshalb hält die
  // Kontenübersicht beide Zustände getrennt und verschweigt den Startvorgang nicht.
  const activeOn = (account) =>
    usedOn(account).filter((profile) =>
      profile.accounts.some((member) => member.account_id === account.id && member.state !== 'offline')
    );
  const needsAttention = (account) => account.suspended || account.status === 'error';
  const ready = state.accounts.filter((account) => !needsAttention(account)).length;
  const attention = state.accounts.length - ready;
  const unused = state.accounts.filter((account) => !usedOn(account).length).length;
  const activeAccounts = state.accounts.filter((account) => activeOn(account).length);
  const accountTags = [...new Set(state.accounts.flatMap((account) => account.tags || []))].sort((a, b) =>
    a.localeCompare(b)
  );

  root.innerHTML = `
    ${appbar(
      tr('acc.title'),
      `${
        data.offline_allowed
          ? `<button class="btn btn-sm" id="add-offline">${icon('plus')} ${escapeHtml(tr('acc.addOffline'))}</button>`
          : ''
      }
       <button class="btn btn-primary btn-sm" id="add">${icon('plus')} ${escapeHtml(tr('acc.add'))}</button>`,
      tr('acc.sub')
    )}

    <div class="note" style="margin-bottom:1rem">${icon('shield')}
      <div>${escapeHtml(tr('faq.2.a'))}</div></div>

    <div class="note warn" style="margin-bottom:1.5rem">${icon('alert')}
      <div><strong>${escapeHtml(tr('rules.title'))}</strong><br>${escapeHtml(tr('rules.text'))}</div></div>

    ${
      state.accounts.length
        ? `<div class="grid four account-summary" role="group" aria-label="${escapeHtml(tr('acc.summary'))}">
            ${summaryTile('all', state.accounts.length, 'acc.total', 'users')}
            ${summaryTile('ready', ready, 'acc.ready', 'check')}
            ${summaryTile('attention', attention, 'acc.needsAttention', 'alert')}
            ${summaryTile('unused', unused, 'acc.unused', 'server')}
            ${summaryTile('running', activeAccounts.length, 'acc.activeNow', 'play')}
          </div>
          <div class="account-tools">
            <label class="account-search">${icon('search')}
              <input id="account-search" type="search" autocomplete="off"
                placeholder="${escapeHtml(tr('acc.search'))}" aria-label="${escapeHtml(tr('acc.search'))}">
            </label>
            <select id="account-filter" class="mini" aria-label="${escapeHtml(tr('common.status'))}">
              <option value="all">${escapeHtml(tr('acc.filter.all'))}</option>
              <option value="ready">${escapeHtml(tr('acc.filter.ready'))}</option>
              <option value="attention">${escapeHtml(tr('acc.filter.attention'))}</option>
              <option value="unused">${escapeHtml(tr('acc.filter.unused'))}</option>
              <option value="offline">${escapeHtml(tr('acc.filter.offline'))}</option>
              <option value="running">${escapeHtml(tr('acc.filter.running'))}</option>
              <option value="favorite">${escapeHtml(tr('acc.filter.favorite'))}</option>
              ${
                accountTags.length
                  ? `<optgroup label="${escapeHtml(tr('acc.filter.tags'))}">${accountTags
                      .map(
                        (tag) =>
                          `<option value="tag:${escapeHtml(encodeURIComponent(tag))}">${escapeHtml(tag)}</option>`
                      )
                      .join('')}</optgroup>`
                  : ''
              }
            </select>
            <select id="account-sort" class="mini" aria-label="${escapeHtml(tr('common.order'))}">
              <option value="name">${escapeHtml(tr('acc.sort.name'))}</option>
              <option value="usage">${escapeHtml(tr('acc.sort.usage'))}</option>
              <option value="newest">${escapeHtml(tr('acc.sort.newest'))}</option>
            </select>
            <span class="small muted account-count" id="account-count"></span>
          </div>
          <div class="grid two account-grid" id="account-grid"></div>`
        : `<div class="empty">
            <h3>${escapeHtml(tr('acc.none.title'))}</h3>
            <p>${escapeHtml(tr('acc.none.text'))}</p>
            <button class="btn btn-primary" id="add-2">${icon('plus')} ${escapeHtml(tr('acc.add'))}</button>
          </div>`
    }`;

  function summaryTile(value, number, key, symbol) {
    return `<button type="button" class="stat account-stat" data-account-filter="${value}"
      aria-pressed="${filter === value}">
      <span class="account-stat-icon">${icon(symbol)}</span>
      <span class="v">${number}</span>
      <span class="k">${escapeHtml(tr(key))}</span>
    </button>`;
  }

  function visibleAccounts() {
    const tagFilter = accountTags.find((tag) => `tag:${encodeURIComponent(tag)}` === filter);
    return state.accounts
      .filter((account) => {
        const use = usedOn(account);
        if (filter === 'ready' && needsAttention(account)) return false;
        if (filter === 'attention' && !needsAttention(account)) return false;
        if (filter === 'unused' && use.length) return false;
        if (filter === 'offline' && account.kind !== 'offline') return false;
        if (filter === 'running' && !activeOn(account).length) return false;
        if (filter === 'favorite' && !account.favorite) return false;
        if (tagFilter && !(account.tags || []).includes(tagFilter)) return false;
        return !query || `${account.name} ${(account.tags || []).join(' ')} ${use.map((profile) => profile.name).join(' ')}`.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        if (order === 'usage') return usedOn(b).length - usedOn(a).length || a.name.localeCompare(b.name);
        if (order === 'newest') return b.created_at - a.created_at;
        return a.name.localeCompare(b.name);
      });
  }

  function accountCard(account) {
    const used = usedOn(account);
    const active = activeOn(account);
    const broken = account.status === 'error';
    const suspended = account.suspended;
    return `<article class="card account-card ${needsAttention(account) ? 'needs-attention' : ''} ${
      active.length ? 'is-active' : ''
    }">
      <div class="account-card-head">
        <img class="head lg" src="${escapeHtml(account.head)}" alt="" loading="lazy" decoding="async">
        <div class="grow" style="min-width:0">
          <h2 class="account-name truncate">${escapeHtml(account.name)}</h2>
          <span class="small muted">${escapeHtml(
            tr(account.kind === 'offline' ? 'acc.kind.offline' : 'acc.kind.microsoft')
          )}</span>
          ${
            account.tags?.length
              ? `<div class="account-tags">${account.tags
                  .map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`)
                  .join('')}</div>`
              : ''
          }
        </div>
        ${
          suspended
            ? `<span class="pill missing">${escapeHtml(tr('acc.suspended'))}</span>`
            : broken
              ? `<span class="pill missing">${escapeHtml(tr('acc.error'))}</span>`
              : `<span class="pill primary">${escapeHtml(tr('acc.ok'))}</span>`
        }
      </div>

      ${
        suspended || broken
          ? `<div class="account-problem ${broken ? 'bad' : 'warn'}">${icon('alert')}<span>${escapeHtml(
              suspended ? account.suspend_reason || tr('acc.suspendedHint') : account.last_error || tr('acc.errorHint')
            )}</span></div>`
          : ''
      }

      <div class="account-assignments">
        <span class="small muted">${escapeHtml(tr('acc.assignedServers', { n: used.length }))}</span>
        <div class="account-server-list">
          ${
            used.length
              ? used
                  .map(
                    (profile) => `<a class="pill" href="#/servers/${profile.id}/connect">
                      <span class="dot ${profile.online ? 'live' : ''}"></span>${escapeHtml(profile.name)}</a>`
                  )
                  .join('')
              : `<a class="account-unused" href="#/servers">${escapeHtml(tr('acc.assignNow'))} ${icon('arrow')}</a>`
          }
        </div>
        ${
          used.length
            ? active.length
              ? `<span class="small account-running ${onlineOn(account).length ? 'live' : ''}">${icon('play')} ${escapeHtml(
                  onlineOn(account).length ? tr('acc.onlineOn', { n: onlineOn(account).length }) : tr('acc.activeOn', { n: active.length })
                )}</span>`
              : ''
            : ''
        }
      </div>

      <dl class="account-facts">
        <div><dt>${escapeHtml(tr('acc.connectedSince'))}</dt><dd>${datetime(account.created_at)}</dd></div>
      </dl>

      <div class="row wrap account-actions">
        <button class="btn btn-sm" data-account-favorite="${account.id}" aria-pressed="${account.favorite}"
          title="${escapeHtml(tr(account.favorite ? 'acc.favoriteRemove' : 'acc.favoriteAdd'))}">
          ${icon('star')} ${escapeHtml(tr(account.favorite ? 'acc.favoriteRemove' : 'acc.favoriteAdd'))}</button>
        <button class="btn btn-sm" data-account-organize="${account.id}">${icon('bookmark')} ${escapeHtml(
          tr('acc.organize')
        )}</button>
        ${
          account.kind === 'offline'
            ? ''
            : `<button class="btn btn-sm ${broken ? 'btn-primary' : ''}" data-relogin="${account.id}" ${
                suspended ? 'disabled' : ''
              }>${icon('refresh')} ${escapeHtml(tr('acc.renew'))}</button>`
        }
        <button class="btn btn-sm btn-danger" data-remove="${account.id}">${icon('trash')} ${escapeHtml(
          tr('acc.remove')
        )}</button>
      </div>
    </article>`;
  }

  function paint() {
    const grid = $('#account-grid');
    if (!grid) return;
    const accounts = visibleAccounts();
    grid.innerHTML = accounts.length
      ? accounts.map(accountCard).join('')
      : `<div class="empty account-no-results">
          <span class="empty-icon">${icon('search')}</span>
          <h3>${escapeHtml(tr('acc.noMatches'))}</h3>
          <p>${escapeHtml(tr('acc.noMatchesText'))}</p>
          <button class="btn" id="account-reset">${escapeHtml(tr('acc.resetFilters'))}</button>
        </div>`;
    $('#account-count').textContent = tr('act.count', { n: accounts.length, total: state.accounts.length });
    $$('[data-account-filter]').forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.accountFilter === filter))
    );
    $('#account-reset')?.addEventListener('click', () => {
      query = '';
      filter = 'all';
      $('#account-search').value = '';
      $('#account-filter').value = 'all';
      paint();
    });
  }

  for (const id of ['#add', '#add-2']) $(id)?.addEventListener('click', startLogin);
  $('#account-search')?.addEventListener('input', (event) => {
    query = String(event.target.value || '').trim().toLowerCase();
    paint();
  });
  $('#account-filter')?.addEventListener('change', (event) => {
    filter = event.target.value;
    paint();
  });
  $('#account-sort')?.addEventListener('change', (event) => {
    order = event.target.value;
    paint();
  });
  $$('[data-account-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      filter = button.dataset.accountFilter;
      $('#account-filter').value = filter;
      paint();
    })
  );

  $('#add-offline')?.addEventListener('click', async () => {
    const answer = await formDialog(
      tr('acc.addOffline'),
      [{ key: 'name', label: tr('acc.offlineName'), hint: tr('acc.offlineHint'), required: true }],
      { submit: tr('common.create') }
    );
    if (!answer) return;
    try {
      await api('/accounts/offline', { method: 'POST', body: { name: answer.name } });
      ok(tr('srv.saved'));
      await refresh();
      draw();
    } catch (error) {
      fail(error);
    }
  });

  const reloginFor = (id) => {
    const account = state.accounts.find((entry) => entry.id === Number(id));
    if (account?.kind === 'microsoft' && !account.suspended) startLogin({ account });
  };
  $('#account-grid')?.addEventListener('click', async (event) => {
    const relogin = event.target.closest('[data-relogin]');
    if (relogin) return reloginFor(relogin.dataset.relogin);
    const favorite = event.target.closest('[data-account-favorite]');
    if (favorite) {
      const account = state.accounts.find((entry) => entry.id === Number(favorite.dataset.accountFavorite));
      if (!account) return;
      try {
        const result = await api(`/accounts/${account.id}`, {
          method: 'PATCH',
          body: { favorite: !account.favorite },
        });
        state.accounts = state.accounts.map((entry) => (entry.id === account.id ? result.account : entry));
        paint();
      } catch (error) {
        fail(error);
      }
      return;
    }
    const organize = event.target.closest('[data-account-organize]');
    if (organize) {
      const account = state.accounts.find((entry) => entry.id === Number(organize.dataset.accountOrganize));
      if (!account) return;
      const answer = await formDialog(
        tr('acc.organizeTitle', { name: account.name }),
        [{ key: 'tags', label: tr('acc.tags'), value: (account.tags || []).join(', '), hint: tr('acc.tagsHint') }],
        { submit: tr('common.save') }
      );
      if (!answer) return;
      try {
        const result = await api(`/accounts/${account.id}`, { method: 'PATCH', body: { tags: answer.tags } });
        state.accounts = state.accounts.map((entry) => (entry.id === account.id ? result.account : entry));
        draw();
      } catch (error) {
        fail(error);
      }
      return;
    }
    const button = event.target.closest('[data-remove]');
    if (button) {
      const account = state.accounts.find((entry) => entry.id === Number(button.dataset.remove));
      if (!account) return;
      const assignments = usedOn(account);
      const question = [
        tr('acc.removeAsk', { name: account.name }),
        assignments.length
          ? tr('acc.removeImpact', { servers: assignments.length, online: onlineOn(account).length })
          : tr('acc.removeUnused'),
      ].join('\n\n');
      const sure = await confirmDialog(question, {
        confirm: tr('acc.remove'),
      });
      if (!sure) return;
      try {
        await api(`/accounts/${account.id}`, { method: 'DELETE' });
        ok(tr('srv.saved'));
        await refresh();
        draw();
      } catch (error) {
        fail(error);
      }
    }
  });
  paint();
}

/**
 * Der Gerätecode-Ablauf: Panel startet `afk --login`, zeigt Code und Adresse, fragt im Sekundentakt
 * nach dem Ergebnis. Der Link enthält den Code bereits – abtippen muss ihn niemand mehr.
 */
async function startLogin({ account = null } = {}) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <header><h3>${escapeHtml(account ? tr('acc.ms.renewTitle', { name: account.name }) : tr('acc.ms.title'))}</h3></header>
    <div class="body" id="login-body">
      <p class="muted">${escapeHtml(tr('common.loading'))}</p>
    </div>
    <footer><button class="btn" id="login-close">${escapeHtml(tr('common.cancel'))}</button></footer>`;
  document.body.append(dialog);
  dialog.showModal();

  let session = null;
  let timer = null;
  let done = false;

  const stop = () => {
    clearInterval(timer);
    if (session && !done) api(`/accounts/login/${session.id}`, { method: 'DELETE' }).catch(() => {});
  };
  dialog.addEventListener('close', () => {
    stop();
    dialog.remove();
  });
  $('#login-close', dialog).addEventListener('click', () => dialog.close());

  try {
    session = await api('/accounts/login', { method: 'POST' });
  } catch (error) {
    $('#login-body', dialog).innerHTML = `<p style="color:var(--bad-text)">${escapeHtml(error.message)}</p>`;
    return;
  }

  const paint = (data) => {
    const body = $('#login-body', dialog);
    if (data.status === 'code') {
      // Microsoft nimmt den Code als Parameter in der Adresse entgegen: ein Klick, und er steht
      // drüben schon im Feld. Deshalb gibt es hier keinen Code zum Abschreiben – er wäre nur eine
      // Zeile, die niemand braucht und die aussieht, als müsste man etwas tun.
      const link = data.verification_uri_complete || data.verification_uri;
      body.innerHTML = `
        <div class="stack center" style="gap:1.25rem;padding:.5rem 0">
          ${
            account
              ? `<p class="muted small" style="text-align:center;margin:0">${escapeHtml(
                  tr('acc.ms.renewHint', { name: account.name })
                )}</p>`
              : ''
          }
          <a class="btn btn-primary btn-block btn-lg" href="${escapeHtml(link)}" target="_blank" rel="noopener">
            ${escapeHtml(tr('acc.ms.open'))} ${icon('external')}</a>
          <p class="muted small" style="text-align:center;margin:0">${escapeHtml(tr('acc.ms.step'))}</p>
          <p class="small muted row" style="gap:.5rem">${icon('clock')} ${escapeHtml(tr('acc.ms.waiting'))}</p>
        </div>`;
      return;
    }
    if (data.status === 'done') {
      done = true;
      body.innerHTML = `<div class="stack center" style="gap:1rem;padding:1rem 0">
        <div style="color:var(--ok-text)">${icon('check')}</div>
        <h3>${escapeHtml(tr('acc.ms.done', { name: data.account.name }))}</h3></div>`;
      $('#login-close', dialog).textContent = tr('common.close');
      $('#login-close', dialog).classList.add('btn-primary');
      return;
    }
    if (data.status === 'error') {
      body.innerHTML = `<div class="note bad">${icon('alert')}<div>${escapeHtml(
        data.error || tr('common.error')
      )}</div></div>`;
      return;
    }
    body.innerHTML = `<p class="muted row" style="gap:.5rem">${icon('clock')} ${escapeHtml(
      tr('common.loading')
    )}</p>`;
  };

  paint(session);
  timer = setInterval(async () => {
    try {
      const data = await api(`/accounts/login/${session.id}`);
      paint(data);
      if (data.status === 'done') {
        clearInterval(timer);
        ok(tr('acc.ms.done', { name: data.account.name }));
        await refresh();
        if (state.route.name === 'accounts') draw();
      }
      if (data.status === 'error') clearInterval(timer);
    } catch (error) {
      clearInterval(timer);
      $('#login-body', dialog).innerHTML = `<div class="note bad">${icon('alert')}<div>${escapeHtml(
        error.message
      )}</div></div>`;
    }
  }, 2000);
}
