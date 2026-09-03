// Persönliche Aktivitätszentrale.
//
// Was hier steht, kommt aus denselben echten Ereignissen wie die Discord-Benachrichtigungen. Es
// ist damit weder ein Protokoll für Administratoren noch eine erfundene „Insights“-Liste, sondern
// das verlässliche Postfach des Kontos – mit gelesenem Zustand auf allen Geräten.

import {
  api,
  icon,
  escapeHtml,
  datetime,
  safeLink,
  tr,
  locale,
  $,
  $$,
  fail,
  ok,
  confirmDialog,
} from '../ui.js';
import { state, appbar, drawSide } from '../app.js';

/** Die Überschrift über einem Tag – einmal gebaut, für jede Zeile derselbe. */
const DAY_HEADING = new Intl.DateTimeFormat(locale, {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const EVENT_ICONS = {
  ticket: 'ticket',
  billing: 'wallet',
  bot: 'bot',
  account: 'user',
  plan: 'server',
  info: 'bell',
};

export async function render(root) {
  const data = await api('/me/notifications?limit=40');
  let list = data.notifications || [];
  let hasMore = Boolean(data.has_more);
  let query = '';
  let event = 'all';
  let unreadOnly = false;
  let loading = false;

  state.stats.notifications_unread = data.unread || 0;
  drawSide();

  root.innerHTML = `
    ${appbar(
      tr('act.title'),
      `<button class="btn btn-sm" id="read-all" ${data.unread ? '' : 'disabled'}>${icon('check')} ${escapeHtml(
        tr('act.markAll')
      )}</button>
       <button class="btn btn-ghost btn-sm" id="clear-read" ${list.some((item) => item.read_at) ? '' : 'disabled'}>
         ${icon('trash')} ${escapeHtml(tr('act.clearRead'))}</button>`,
      tr('act.sub')
    )}

    <section class="activity-shell">
      <div class="activity-tools">
        <label class="activity-search">
          ${icon('search')}
          <input id="activity-search" type="search" autocomplete="off"
            placeholder="${escapeHtml(tr('act.search'))}" aria-label="${escapeHtml(tr('act.search'))}">
        </label>
        <label class="field activity-filter">
          <span class="visually-hidden">${escapeHtml(tr('act.filter'))}</span>
          <select id="activity-event" aria-label="${escapeHtml(tr('act.filter'))}">
            <option value="all">${escapeHtml(tr('act.all'))}</option>
            ${['ticket', 'billing', 'plan', 'bot', 'account']
              .map((key) => `<option value="${key}">${escapeHtml(tr(`set.hook.${key}`))}</option>`)
              .join('')}
          </select>
        </label>
        <label class="check activity-unread">
          <input id="activity-unread" type="checkbox">
          <span>${escapeHtml(tr('act.unreadOnly'))}</span>
        </label>
        <span class="small muted activity-count" id="activity-count"></span>
      </div>
      <div class="activity-list" id="activity-list" aria-live="polite"></div>
      <div class="activity-more" id="activity-more"></div>
    </section>`;

  function filtered() {
    return list.filter((item) => {
      if (event !== 'all' && item.event !== event) return false;
      if (unreadOnly && item.read_at) return false;
      if (query && !`${item.title} ${item.body}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }

  function paint() {
    const visible = filtered();
    $('#activity-count').textContent = tr('act.count', { n: visible.length, total: list.length });
    if (!visible.length) {
      $('#activity-list').innerHTML = `<div class="empty activity-empty">
        <span class="empty-icon">${icon(query || unreadOnly || event !== 'all' ? 'search' : 'bell')}</span>
        <h3>${escapeHtml(tr(query || unreadOnly || event !== 'all' ? 'act.emptyFilter' : 'act.empty'))}</h3>
        <p>${escapeHtml(tr(query || unreadOnly || event !== 'all' ? 'act.emptyFilterText' : 'act.emptyText'))}</p>
      </div>`;
      paintMore();
      return;
    }

    const days = new Map();
    for (const item of visible) {
      // Ein Formatierer für die ganze Liste, nicht einer je Eintrag – siehe die Erklärung bei den
      // Formaten in ui.js.
      const day = DAY_HEADING.format(new Date(item.created_at));
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(item);
    }
    $('#activity-list').innerHTML = [...days]
      .map(
        ([day, entries]) => `<section class="activity-day">
          <h2>${escapeHtml(day)}</h2>
          <div class="activity-day-list">${entries.map(activityItem).join('')}</div>
        </section>`
      )
      .join('');
    paintMore();
  }

  function paintMore() {
    const box = $('#activity-more');
    if (!box) return;
    box.innerHTML = hasMore
      ? `<button class="btn" id="activity-load" ${loading ? 'disabled' : ''}>${
          loading ? icon('refresh') : icon('arrow')
        } ${escapeHtml(tr(loading ? 'act.loadingOlder' : 'act.loadOlder'))}</button>`
      : list.length
        ? `<span class="small muted">${escapeHtml(tr('act.allLoaded'))}</span>`
        : '';
    $('#activity-load')?.addEventListener('click', () => loadMore());
  }

  function activityItem(item) {
    const href = item.href ? safeLink(item.href) : '';
    const eventLabel = ['ticket', 'billing', 'plan', 'bot', 'account'].includes(item.event)
      ? tr(`set.hook.${item.event}`)
      : tr('act.title');
    const content = `
      <span class="activity-mark ${escapeHtml(item.tone)}">${icon(EVENT_ICONS[item.event] || 'bell')}</span>
      <span class="activity-copy">
        <span class="activity-title">${escapeHtml(item.title)}</span>
        ${item.body ? `<span class="activity-body">${escapeHtml(item.body)}</span>` : ''}
        <span class="activity-meta">${escapeHtml(datetime(item.created_at))} · ${escapeHtml(eventLabel)}</span>
      </span>
      ${item.read_at ? '' : `<span class="activity-new">${escapeHtml(tr('act.new'))}</span>`}
      ${href ? `<span class="activity-arrow">${icon('arrow')}</span>` : ''}`;
    return `<article class="activity-item ${item.read_at ? '' : 'is-unread'}">
      ${
        href
          ? `<a class="activity-main" href="${escapeHtml(href)}" data-read="${item.id}">${content}</a>`
          : `<button class="activity-main" type="button" data-read="${item.id}">${content}</button>`
      }
      <button class="activity-again" type="button" data-unread="${item.id}"
        ${item.read_at ? '' : 'hidden'} title="${escapeHtml(tr('act.markUnread'))}"
        aria-label="${escapeHtml(tr('act.markUnread'))}">${icon('mail')}</button>
    </article>`;
  }

  /** Ältere Meldungen nachladen. Der Cursor ist die letzte sichtbare ID, kein wackeliger Offset. */
  async function loadMore({ reset = false } = {}) {
    if (loading) return;
    loading = true;
    if (reset) {
      list = [];
      hasMore = false;
      $('#activity-list').innerHTML = `<div class="activity-loading">${icon('refresh')} ${escapeHtml(
        tr('common.loading')
      )}</div>`;
    }
    paintMore();
    try {
      const before = reset || !list.length ? '' : `&before=${list.at(-1).id}`;
      const kind = event === 'all' ? '' : `&event=${encodeURIComponent(event)}`;
      const page = await api(`/me/notifications?limit=40${kind}${before}`);
      const known = new Set(list.map((item) => item.id));
      list.push(...(page.notifications || []).filter((item) => !known.has(item.id)));
      hasMore = Boolean(page.has_more);
      state.stats.notifications_unread = page.unread || 0;
      drawSide();
    } catch (error) {
      fail(error);
      hasMore = true;
    } finally {
      loading = false;
      paint();
    }
  }

  async function read(ids) {
    const wanted = list.filter((item) => ids.includes(item.id) && !item.read_at);
    if (!wanted.length) return;
    const now = Date.now();
    for (const item of wanted) item.read_at = now;
    state.stats.notifications_unread = Math.max(0, (state.stats.notifications_unread || 0) - wanted.length);
    drawSide();
    paint();
    try {
      const answer = await api('/me/notifications', { method: 'PATCH', body: { ids } });
      state.stats.notifications_unread = answer.unread || 0;
      drawSide();
    } catch (error) {
      for (const item of wanted) item.read_at = null;
      state.stats.notifications_unread += wanted.length;
      drawSide();
      paint();
      fail(error);
    }
  }

  async function markUnread(id) {
    const item = list.find((entry) => entry.id === id);
    if (!item?.read_at) return;
    const previous = item.read_at;
    item.read_at = null;
    state.stats.notifications_unread = (state.stats.notifications_unread || 0) + 1;
    drawSide();
    paint();
    try {
      const answer = await api('/me/notifications', {
        method: 'PATCH',
        body: { ids: [id], unread: true },
      });
      state.stats.notifications_unread = answer.unread || 0;
      drawSide();
      ok(tr('act.markedUnread'));
    } catch (error) {
      item.read_at = previous;
      state.stats.notifications_unread = Math.max(0, (state.stats.notifications_unread || 0) - 1);
      drawSide();
      paint();
      fail(error);
    }
  }

  $('#activity-search').addEventListener('input', (e) => {
    query = String(e.target.value || '').trim().toLowerCase();
    paint();
  });
  $('#activity-event').addEventListener('change', async (e) => {
    event = e.target.value;
    await loadMore({ reset: true });
  });
  $('#activity-unread').addEventListener('change', (e) => {
    unreadOnly = e.target.checked;
    paint();
  });

  $('#activity-list').addEventListener('click', (e) => {
    const unread = e.target.closest('[data-unread]');
    if (unread) {
      e.preventDefault();
      markUnread(Number(unread.dataset.unread));
      return;
    }
    const item = e.target.closest('[data-read]');
    if (item) read([Number(item.dataset.read)]);
  });

  $('#read-all').addEventListener('click', async () => {
    const unread = list.filter((item) => !item.read_at);
    const previous = state.stats.notifications_unread || 0;
    const now = Date.now();
    for (const item of unread) item.read_at = now;
    state.stats.notifications_unread = 0;
    drawSide();
    paint();
    try {
      await api('/me/notifications', { method: 'PATCH' });
      $('#read-all').disabled = true;
      ok(tr('act.marked'));
    } catch (error) {
      for (const item of unread) item.read_at = null;
      state.stats.notifications_unread = previous;
      drawSide();
      paint();
      fail(error);
    }
  });

  $('#clear-read').addEventListener('click', async () => {
    if (!(await confirmDialog(tr('act.clearAsk'), { confirm: tr('act.clearRead') }))) return;
    try {
      await api('/me/notifications', { method: 'DELETE' });
      list = list.filter((item) => !item.read_at);
      $('#clear-read').disabled = true;
      paint();
      ok(tr('act.cleared'));
    } catch (error) {
      fail(error);
    }
  });

  paint();
}
