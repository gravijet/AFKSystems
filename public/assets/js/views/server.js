// Serverplätze: Liste, Anlegen – und die Registerkarten eines Platzes.
//
// Welche Reiter es gibt, entscheidet nicht diese Datei, sondern der Client: `profile.caps` sagt,
// was die Bauform hinter dem Tarif wirklich kann. Was sie nicht kann, wird gar nicht erst
// angeboten – ein Knopf, der nichts tut, ist schlimmer als kein Knopf.

import {
  api, icon, escapeHtml, since, clock, credits, euro, date, stateBadge, mcText, safeLink, tr, $, $$,
  ok, fail, toast, confirmDialog, formDialog, debounce,
} from '../ui.js';
import { mergeLines, stripFormatting } from '../chatlog.js';
import { state, appbar, refresh, draw, profileById, tabsFor, linesOf } from '../app.js';
import { noAccounts, accountPicker, commandRunner, anyOnline, itemSlot } from './parts.js';
import { tabPov, tabInventory } from './live.js';

export async function render(root, route) {
  if (route.name === 'servers') return renderList(root);
  return renderProfile(root, route);
}

// ---------------------------------------------------------------- Liste

async function renderList(root) {
  root.innerHTML = `
    ${appbar(
      tr('dash.servers'),
      `<button class="btn btn-primary btn-sm" id="add">${icon('plus')} ${escapeHtml(tr('dash.newServer'))}</button>`,
      tr('pricing.title')
    )}
    ${
      state.profiles.length
        ? `<div class="grid two">${state.profiles.map(card).join('')}</div>`
        : `<div class="empty"><h3>${escapeHtml(tr('ov.noServer.title'))}</h3>
            <p>${escapeHtml(tr('ov.noServer.text'))}</p>
            <button class="btn btn-primary" id="add-2">${icon('plus')} ${escapeHtml(tr('dash.newServer'))}</button></div>`
    }`;

  $('#add')?.addEventListener('click', newProfile);
  $('#add-2')?.addEventListener('click', newProfile);
}

function card(profile) {
  const unavailable = profile.locked || profile.suspended || (profile.plan.free_slot && profile.free_access?.ok === false);
  return `<a class="card" href="#/servers/${profile.id}/connect" style="display:block">
    <div class="row spread">
      <div class="row">
        <span class="dot ${profile.online ? 'live' : ''}"
          style="color:${profile.online ? 'var(--ok)' : 'var(--text-2)'}"></span>
        <div>
          <div class="strong">${escapeHtml(profile.name)}</div>
          <div class="small muted mono">${escapeHtml(profile.address)}</div>
        </div>
      </div>
      <span class="pill ${profile.plan.free_slot ? '' : 'primary'}">${escapeHtml(profile.plan.name)}</span>
    </div>
    <div class="row spread" style="margin-top:1rem">
      <span class="small muted">${profile.online}/${profile.total} · MC ${escapeHtml(profile.mc_version)}</span>
      ${
        unavailable
          ? `<span class="pill missing">${escapeHtml(tr('srv.unavailable'))}</span>`
          : `<span class="small" style="color:var(--primary-text)">${escapeHtml(tr('common.open'))} ${icon('arrow')}</span>`
      }
    </div>
  </a>`;
}

export async function newProfile() {
  const plans = state.meta.plans || [];
  const freeLeft = state.stats?.free_slots_left ?? 0;
  const options = plans
    .filter((plan) => !plan.free_slot || freeLeft > 0)
    .map((plan) => ({
      value: String(plan.id),
      label: plan.free_slot
        ? `${plan.name} – ${tr('common.free')}`
        : `${plan.name} – ${plan.price_credits} ${tr('common.credits')} / ${state.meta.month_days} ${tr('common.days')}`,
    }));

  const data = await formDialog(
    tr('srv.new'),
    [
      { key: 'name', label: tr('srv.name'), placeholder: 'SMP', required: true },
      {
        key: 'address',
        label: tr('srv.address'),
        placeholder: 'example.invalid',
        hint: tr('srv.addressHint'),
        required: true,
      },
      {
        key: 'mc_version',
        label: tr('srv.version'),
        type: 'select',
        value: state.meta.default_version,
        options: state.meta.versions,
      },
      { key: 'plan_id', label: tr('srv.plan'), type: 'select', value: options[0]?.value, options },
    ],
    {
      submit: tr('common.create'),
      note: freeLeft > 0 ? tr('srv.planFreeLeft', { n: freeLeft }) : tr('srv.planNoFree'),
    }
  );
  if (!data) return;

  // Wer den Gratis-Tarif nimmt und nicht im Discord ist, legt sich sonst einen Serverplatz an,
  // der vom ersten Augenblick an stillsteht – und sucht den Fehler dann beim Bot. Deshalb steht
  // die Bedingung **vorher** da, mit dem Einladungslink daneben und der Wahl, es trotzdem zu tun.
  const chosen = plans.find((plan) => String(plan.id) === String(data.plan_id));
  if (chosen?.free_slot && !(await confirmDiscord())) return;

  try {
    const result = await api('/profiles', {
      method: 'POST',
      body: { ...data, plan_id: Number(data.plan_id) },
    });
    await refresh();
    ok(tr('srv.created'));
    location.hash = `#/servers/${result.profile.id}/connect`;
    draw();
  } catch (error) {
    fail(error);
  }
}

/**
 * Der Kasten im Serverplatz: warum er stillsteht und was dagegen hilft.
 *
 * Drei Fälle, drei Sätze. „Nicht verknüpft“ führt in die Einstellungen, „nicht beigetreten“ auf
 * den Discord, und „ließ sich gerade nicht bestätigen“ führt nirgendwohin – das ist unsere Lücke,
 * und einen Knopf dafür gibt es nicht.
 */
function joinBox(profile) {
  if (!profile.plan.free_slot || profile.free_access?.ok !== false) return '';
  const reason = profile.free_access.reason;
  const invite = state.meta?.discord_invite || '';
  if (reason === 'discord-check' || reason === 'not-configured') {
    return `<div class="note warn" style="margin-bottom:1.25rem">${icon('clock')}
      <div>${escapeHtml(tr('join.checking'))}</div></div>`;
  }
  const linkOnly = reason === 'discord-link';
  const action =
    linkOnly || !invite
      ? `<a class="btn btn-discord" href="#/settings">${escapeHtml(tr('join.linkAction'))}</a>`
      : `<a class="btn btn-discord" href="${escapeHtml(safeLink(invite))}" target="_blank" rel="noopener">
          ${icon('discord')} ${escapeHtml(tr('discord.join'))}</a>`;
  return `<div class="joinbox" style="margin-bottom:1.25rem">
    ${icon('discord')}
    <div class="grow">
      <h4>${escapeHtml(tr(linkOnly ? 'join.linkTitle' : 'join.joinTitle'))}</h4>
      <p>${escapeHtml(tr('join.boxFree', { brand: state.meta?.brand || 'AFKSystems' }))}</p>
      ${action}
    </div>
  </div>`;
}

/**
 * Der Zwischenschritt für den Gratis-Tarif: Bist du schon im Discord?
 *
 * Gibt `true` zurück, wenn es weitergehen darf – entweder weil die Mitgliedschaft steht oder weil
 * der Kunde ausdrücklich sagt "trotzdem anlegen". Die Wahl bleibt seine: Der Platz ist ja nicht
 * kaputt, er wartet nur, und ein Panel, das ihn deswegen gar nicht erst anlegt, wäre bevormundend.
 */
async function confirmDiscord() {
  const access = state.me?.free_access;
  if (!access || access.ok) return true;
  // "Konnte gerade nicht bestätigt werden" ist unsere Lücke, nicht seine – da hält niemanden auf.
  if (access.reason !== 'discord-link' && access.reason !== 'discord-join') return true;

  const invite = state.meta?.discord_invite || '';
  const linkOnly = access.reason === 'discord-link';
  return confirmDialog(
    `${tr('join.dialogText')}\n\n${
      linkOnly ? tr('join.linkText') : ''
    }`.trim(),
    {
      title: tr('join.dialogTitle'),
      danger: false,
      confirm: tr('join.anyway'),
      // Der eigentliche Weg steht als Link im Dialog – ein Knopf, der einen neuen Tab aufmacht,
      // schließt sonst den Dialog und damit den halb ausgefüllten Serverplatz gleich mit.
      extra:
        linkOnly || !invite
          ? { href: '#/settings', label: tr('join.linkAction') }
          : { href: invite, label: tr('discord.join'), external: true },
    }
  );
}

// ---------------------------------------------------------------- Ein Serverplatz

async function renderProfile(root, route) {
  let profile = profileById(route.id);
  if (!profile) {
    await refresh({ accounts: false });
    profile = profileById(route.id);
  }
  if (!profile) {
    root.innerHTML = `<div class="empty"><h3>${escapeHtml(tr('error.404.title'))}</h3>
      <a class="btn" href="#/servers">${escapeHtml(tr('common.back'))}</a></div>`;
    return;
  }

  const tabs = tabsFor(profile);
  const current = tabs.some((tab) => tab.key === route.tab) ? route.tab : 'connect';

  root.innerHTML = `
    ${appbar(
      profile.name,
      `<span class="pill">MC ${escapeHtml(profile.mc_version)}</span>
       <span class="pill ${profile.plan.free_slot ? '' : 'primary'}">${escapeHtml(profile.plan.name)}</span>
       ${profile.node ? `<span class="pill">${icon('pin')}${escapeHtml(profile.node.name)}</span>` : ''}
       <span class="pill">${profile.online}/${profile.features?.max_accounts ?? profile.total}</span>`,
      `<span class="mono">${escapeHtml(profile.address)}</span>`
    )}
    ${
      profile.locked
        ? `<div class="note bad" style="margin-bottom:1.25rem">${icon('lock')}
            <div><strong>${escapeHtml(tr('adm.locked'))}</strong>
            ${profile.lock_reason ? `— ${escapeHtml(profile.lock_reason)}` : ''}
            <br><a href="#/tickets?new=general">${escapeHtml(tr('ov.openTicket'))}</a></div></div>`
        : ''
    }
    ${
      profile.suspended
        ? `<div class="note warn" style="margin-bottom:1.25rem">${icon('alert')}
            <div>${escapeHtml(tr('srv.suspended'))}
            <a href="#/servers/${profile.id}/plan" style="color:var(--primary-text)">${escapeHtml(
              tr('srv.resume')
            )}</a></div></div>`
        : ''
    }
    <!-- Der Gratis-Platz und Discord. Als eigener Kasten in Discord-Farbe und mit dem
         Einladungslink als Knopf: Vorher stand hier ein gelber Warnstreifen mit einem Link in die
         Einstellungen – wer beitreten musste, fand dort trotzdem keinen Server, sondern nur die
         Verknüpfung. Der Weg dorthin gehört an die Stelle, an der das Problem steht. -->
    ${joinBox(profile)}
    <nav class="tabs">${tabs
      .map(
        (tab) =>
          `<a class="${current === tab.key ? 'active' : ''}" href="#/servers/${profile.id}/${tab.key}">${escapeHtml(
            tr(tab.label)
          )}</a>`
      )
      .join('')}</nav>
    <div id="tab-body"></div>`;

  const views = {
    connect: tabConnect,
    // Alter Reiter: Chat steckt jetzt in "Verbinden". Lesezeichen landen dort, statt ins Leere.
    chat: tabConnect,
    movement: tabMovement,
    board: tabBoard,
    menu: tabMenu,
    inventory: tabInventory,
    pov: tabPov,
    macros: tabMacros,
    proxies: tabProxies,
    plan: tabPlan,
    addons: tabAddons,
    settings: tabSettings,
  };
  await (views[current] || tabConnect)($('#tab-body'), profile);
}

// ---------------------------------------------------------------- Verbinden und Chat
//
// Ein Reiter, nicht zwei. Wer einen Bot startet, will sehen, was er sagt – vorher hieß das:
// starten, Reiter wechseln, mitlesen, zurückwechseln, stoppen.

async function tabConnect(root, profile) {
  const members = profile.accounts;
  const free = state.accounts.filter(
    (account) => !members.some((member) => member.account_id === account.id)
  );

  root.innerHTML = `
    <div id="auth-hint"></div>

    <div class="row wrap" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="start" ${profile.active ? '' : 'disabled'}>${icon('play')} ${escapeHtml(
        tr('srv.startAll')
      )}</button>
      <button class="btn btn-sm" id="stop">${icon('stop')} ${escapeHtml(tr('srv.stopAll'))}</button>
      <button class="btn btn-sm" id="restart" title="${escapeHtml(tr('common.retry'))}">${icon('refresh')}</button>
      <div class="grow"></div>
      <button class="btn btn-sm" id="attach" ${free.length && profile.active ? '' : 'disabled'}>${icon('plus')} ${escapeHtml(
        tr('srv.addAccounts')
      )}</button>
    </div>

    <div class="split">
      <section class="panel" id="bots-panel">
        <header>
          <h3>${escapeHtml(tr('ov.col.account'))}</h3>
          <span class="small muted">${profile.online}/${profile.features?.max_accounts ?? members.length}</span>
        </header>
        <div class="body" style="padding:0" id="bots"></div>
      </section>

      <section class="panel console-panel">
        <header>
          <h3>${escapeHtml(tr('tab.chat'))}</h3>
          <div class="row">
            <label class="check small" title="${escapeHtml(tr('ch.autoscrollHint'))}">
              <input type="checkbox" id="autoscroll" checked> ${escapeHtml(tr('ch.autoscroll'))}</label>
            <a class="btn btn-ghost btn-sm" id="export" download
               href="/api/profiles/${profile.id}/chat.txt"
               title="${escapeHtml(tr('ch.export'))}"
               aria-label="${escapeHtml(tr('ch.export'))}">${icon('download')}</a>
            <button class="btn btn-ghost btn-sm" id="clear" title="${escapeHtml(tr('ch.clear'))}">${icon('trash')}</button>
          </div>
        </header>
        <div class="body" style="padding:0;display:flex;flex-direction:column;min-height:0">
          <!-- Suchen und Filtern gehören über den Verlauf und nicht in ein Menü: Ein Chatfenster,
               in dem man nichts wiederfindet, ist ein Protokoll, das man einmal liest. -->
          <div class="row wrap chat-tools">
            <span class="chat-find">
              ${icon('search')}
              <input type="search" id="find" autocomplete="off"
                placeholder="${escapeHtml(tr('ch.find'))}" aria-label="${escapeHtml(tr('ch.find'))}">
            </span>
            <label class="check small" title="${escapeHtml(tr('ch.allHint'))}">
              <input type="checkbox" id="show-all"> ${escapeHtml(tr('ch.all'))}</label>
            <span class="grow"></span>
            <span class="small muted" id="chat-count"></span>
          </div>
          ${
            members.length > 1
              ? `<div class="row wrap recv-row">
                  ${members
                    .map(
                      (member) => `<label class="check small">
                        <input type="checkbox" data-recv="${member.account_id}" checked>
                        ${escapeHtml(member.name)}</label>`
                    )
                    .join('')}
                </div>`
              : ''
          }
          <div class="console grow" id="chat" data-empty="${escapeHtml(tr('srv.chatEmpty'))}"></div>
          <div class="row send-row">
            <input type="text" id="msg" placeholder="${escapeHtml(tr('srv.chatPlaceholder'))}"
              autocomplete="off" aria-label="${escapeHtml(tr('tab.chat'))}">
            ${
              members.length > 1
                ? `<select id="sender" class="mini" style="min-width:8rem">
                    <option value="">${escapeHtml(tr('srv.chatAll'))}</option>
                    ${members
                      .map((member) => `<option value="${member.account_id}">${escapeHtml(member.name)}</option>`)
                      .join('')}
                  </select>`
                : ''
            }
            <button class="btn btn-primary" id="send">${icon('send')}</button>
          </div>
        </div>
      </section>
    </div>

    ${spamPanel()}`;

  // ------------------------------------------------------------ Konten

  const paintBots = () => {
    const box = $('#bots');
    if (!members.length) {
      box.innerHTML = `<div class="empty" style="box-shadow:none;background:transparent;padding:2rem 1rem">
        <h3>${escapeHtml(tr('srv.noAccounts'))}</h3>
        ${
          state.accounts.length
            ? `<button class="btn btn-primary" id="attach-2">${icon('plus')} ${escapeHtml(tr('srv.addAccounts'))}</button>`
            : `<a class="btn btn-primary" href="#/accounts">${icon('users')} ${escapeHtml(tr('ov.connectAccount'))}</a>`
        }</div>`;
      $('#attach-2')?.addEventListener('click', attach);
      return;
    }
    box.innerHTML = `<ul class="botlist">${members.map(botRow).join('')}</ul>`;

    $$('[data-toggle]', box).forEach((button) =>
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.toggle);
        const bot = state.bots.get(`${profile.id}:${accountId}`);
        button.disabled = true;
        try {
          const running = bot?.state && bot.state !== 'offline';
          const result = await api(`/profiles/${profile.id}/${running ? 'stop' : 'start'}`, {
            method: 'POST',
            body: { accounts: [accountId] },
          });
          const failed = (result.results || []).find((entry) => !entry.ok);
          if (failed) throw new Error(failed.error);
        } catch (error) {
          fail(error);
        } finally {
          button.disabled = false;
        }
      })
    );

    $$('[data-detach]', box).forEach((button) =>
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.detach);
        const member = members.find((entry) => entry.account_id === accountId);
        if (!(await confirmDialog(`${member.name} — ${tr('srv.remove')}?`, { confirm: tr('common.delete') })))
          return;
        await api(`/profiles/${profile.id}/accounts/${accountId}`, { method: 'DELETE' });
        await refresh({ accounts: false });
        draw();
      })
    );
  };

  function botRow(member) {
    const bot = state.bots.get(`${profile.id}:${member.account_id}`) || member;
    const running = bot.state && bot.state !== 'offline';
    return `<li class="botrow ${running ? 'is-on' : ''}">
      <img class="head" src="${escapeHtml(member.head)}" alt="" loading="lazy">
      <div class="grow" style="min-width:0">
        <div class="row" style="gap:.4rem">
          <span class="strong truncate">${escapeHtml(member.name)}</span>
          ${
            member.suspended
              ? `<span class="pill missing">${escapeHtml(tr('acc.suspended'))}</span>`
              : member.account_status === 'error'
              ? `<span class="pill missing">${escapeHtml(tr('acc.error'))}</span>`
              : ''
          }
        </div>
        <div class="small muted truncate">
          ${stateBadge(bot.state || 'offline', bot.detail || bot.last_error || '')}
          ${running && bot.since ? `<span class="mono">· ${since(bot.since)}</span>` : ''}
        </div>
      </div>
      <div class="row" style="gap:.25rem">
        <button class="btn btn-sm ${running ? '' : 'btn-primary'}" data-toggle="${member.account_id}"
          ${running || (profile.active && !member.suspended) ? '' : 'disabled'}>${escapeHtml(
            running ? tr('ov.stop') : tr('ov.start')
          )}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-detach="${member.account_id}"
          title="${escapeHtml(tr('srv.remove'))}">${icon('x')}</button>
      </div>
    </li>`;
  }

  /** Wartet ein Bot auf eine neue Microsoft-Anmeldung, gehört der Link nach ganz oben. */
  const paintAuth = () => {
    const waiting = members
      .map((member) => state.bots.get(`${profile.id}:${member.account_id}`))
      .filter((bot) => bot && bot.state === 'auth' && bot.auth?.code);
    $('#auth-hint').innerHTML = waiting
      .map(
        (bot) => `<div class="note warn" style="margin-bottom:1rem">${icon('key')}
          <div class="grow"><strong>${escapeHtml(bot.account)}</strong> — ${escapeHtml(tr('acc.ms.step'))}</div>
          <a class="btn btn-sm btn-primary"
             href="${escapeHtml(bot.auth.uri_complete || bot.auth.uri || 'https://www.microsoft.com/link')}"
             target="_blank" rel="noopener">${escapeHtml(tr('acc.ms.open'))}</a></div>`
      )
      .join('');
  };

  // ------------------------------------------------------------ Chat

  const box = $('#chat');
  const autoscroll = $('#autoscroll');
  const receiverKey = `afk-chat-recv-${profile.id}`;
  // Der lokale Speicher darf fehlen (privater Modus) und darf Unsinn enthalten (eine ältere
  // Fassung, ein halb geschriebener Wert). Beides warf hier ungefangen – und mit der Ausnahme war
  // der ganze Reiter weg: kein Chat, keine Bots, keine Knöpfe.
  let receivers = [];
  try {
    const stored = JSON.parse(localStorage.getItem(receiverKey) || '[]');
    if (Array.isArray(stored)) receivers = stored.map(Number).filter(Number.isInteger);
  } catch {
    receivers = [];
  }
  // Und nur, was es auf diesem Platz wirklich gibt: ein abgezogenes Konto stand sonst für immer
  // in der Auswahl und filterte den Chat gegen eine Nummer, die niemandem mehr gehört.
  receivers = receivers.filter((id) => members.some((member) => member.account_id === id));
  if (!receivers.length) receivers = members.map((member) => member.account_id);

  const nameOf = (id) => members.find((member) => member.account_id === id)?.name || '?';

  /** Der Suchbegriff, kleingeschrieben. Leer heißt: nicht gesucht, alles steht da. */
  let needle = '';

  const paintChat = () => {
    const raw = [];
    for (const member of members) {
      if (!receivers.includes(member.account_id)) continue;
      for (const entry of linesOf(`${profile.id}:${member.account_id}`)) {
        raw.push({ ...entry, account_id: member.account_id });
      }
    }
    // Drei Bots hören denselben Chat – ohne Zusammenlegen stünde jede Zeile dreimal da.
    //
    // Was hier steht, ist der Chat des Servers und was der Bot selbst hineingeschrieben hat –
    // sonst nichts. Zustandsmeldungen des Clients ("Gehe 3.0 Blöcke vorwärts") und örtliche
    // Befehle stehen nicht drin: sie sind kein Chat, und dazwischen war der Chat nicht zu lesen.
    //
    // "Alles zeigen" nimmt sie dazu. Das ist keine zweite Ansicht, sondern die Antwort auf die
    // eine Frage, für die der Chat allein nicht reicht: warum der Bot plötzlich weg war.
    const everything = $('#show-all')?.checked;
    let lines = mergeLines(raw).filter(
      (entry) =>
        entry.type === 'chat' ||
        (entry.type === 'sent' && !String(entry.text || '').startsWith(':')) ||
        (everything && entry.type !== 'sent')
    );
    const total = lines.length;
    if (needle) {
      lines = lines.filter((entry) => stripFormatting(entry.text || '').toLowerCase().includes(needle));
    }
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;

    box.innerHTML = lines.slice(-500).map(chatLine).join('');
    const counter = $('#chat-count');
    if (counter) {
      counter.textContent = needle ? tr('ch.hits', { n: lines.length, total }) : '';
    }
    // Beim Suchen nicht nach unten springen: Wer nach oben gescrollt hat, um einen Treffer zu
    // lesen, will nicht bei jedem getippten Buchstaben ans Ende geworfen werden.
    if (!needle && (autoscroll.checked || atBottom)) box.scrollTop = box.scrollHeight;
  };

  function chatLine(entry) {
    const many = members.length > 1;
    // Wer nicht alles gehört hat, ist die Ausnahme – und die gehört dazugeschrieben.
    const heardBy =
      entry.type === 'chat' && many && entry.accounts.length && entry.accounts.length < receivers.length
        ? `<span class="who">${escapeHtml(
            entry.accounts.length === 1 ? nameOf(entry.accounts[0]) : tr('ch.heardBy', { n: entry.accounts.length })
          )}</span>`
        : '';
    // Was der Bot selbst geschrieben hat, steht auch so da – sonst sieht es aus wie eine Antwort.
    const prefix =
      entry.type === 'sent'
        ? `<span class="tag">${escapeHtml(tr('ch.sent'))}${
            many && entry.account_id ? ` · ${escapeHtml(nameOf(entry.account_id))}` : ''
          }:</span> `
        : '';
    return `<div class="line ${entry.type}"><span class="t">${clock(entry.t)}</span>${heardBy}<span class="msg">${prefix}${mcText(
      entry.text
    )}</span></div>`;
  }

  // Verlauf vom Server holen – der Zwischenspeicher im Browser ist nach einem Neuladen leer.
  try {
    const data = await api(`/profiles/${profile.id}/chat`);
    for (const line of data.lines) {
      const key = `${profile.id}:${line.account_id}`;
      const list = state.lines.get(key) || [];
      if (!list.some((entry) => entry.t === line.t && entry.text === line.text)) {
        list.push({ t: line.t, type: line.type, text: line.text });
      }
      state.lines.set(key, list);
    }
    for (const [key, list] of state.lines) {
      list.sort((a, b) => a.t - b.t);
      state.lines.set(key, list);
    }
  } catch {
    /* Verlauf ist nur Beiwerk */
  }

  paintAuth();
  paintBots();
  paintChat();

  $$('[data-recv]').forEach((node) =>
    node.addEventListener('change', () => {
      receivers = $$('[data-recv]:checked').map((entry) => Number(entry.dataset.recv));
      try {
        localStorage.setItem(receiverKey, JSON.stringify(receivers));
      } catch {
        /* privater Modus: die Wahl gilt für diese Sitzung, gemerkt wird sie nicht */
      }
      paintChat();
    })
  );
  $('#clear').addEventListener('click', () => {
    for (const member of members) state.lines.set(`${profile.id}:${member.account_id}`, []);
    paintChat();
  });
  $('#find').addEventListener(
    'input',
    debounce((event) => {
      needle = String(event.target.value || '').trim().toLowerCase();
      paintChat();
    }, 150)
  );
  $('#show-all').addEventListener('change', () => {
    // Der Download folgt der Wahl: Wer alles sieht, will auch alles in der Datei.
    $('#export').href = `/api/profiles/${profile.id}/chat.txt${$('#show-all').checked ? '?all=1' : ''}`;
    paintChat();
  });

  const send = async () => {
    const input = $('#msg');
    const text = input.value.trim();
    if (!text) return;
    const sender = $('#sender')?.value || '';
    const accounts = sender ? [Number(sender)] : receivers;
    input.value = '';
    try {
      const result = await api(`/profiles/${profile.id}/chat`, { method: 'POST', body: { text, accounts } });
      const failures = result.results.filter((entry) => !entry.ok);
      if (failures.length === result.results.length) toast(failures[0].error, 'bad');
    } catch (error) {
      fail(error);
      input.value = text;
    }
  };
  $('#send').addEventListener('click', send);
  $('#msg').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });

  // ------------------------------------------------------------ Knöpfe und Spam

  $('#start').addEventListener('click', () => act('start'));
  $('#stop').addEventListener('click', () => act('stop'));
  $('#restart').addEventListener('click', () => act('restart'));
  $('#attach').addEventListener('click', attach);

  async function act(what) {
    const accounts = members.map((member) => member.account_id);
    if (!accounts.length) return toast(tr('srv.noAccounts'));
    try {
      const result = await api(`/profiles/${profile.id}/${what}`, { method: 'POST', body: { accounts } });
      for (const failure of (result.results || []).filter((entry) => !entry.ok)) {
        toast(`${nameOf(failure.account_id)}: ${failure.error}`, 'bad');
      }
      if (!(result.results || []).some((entry) => !entry.ok)) {
        ok(what === 'stop' ? tr('ov.stoppedAll') : tr('ov.started'));
      }
    } catch (error) {
      fail(error);
    }
  }

  async function attach() {
    if (!free.length) return toast(tr('common.none'));
    const data = await formDialog(
      tr('srv.addAccounts'),
      [
        {
          key: 'account_id',
          label: tr('ov.col.account'),
          type: 'select',
          value: free[0].id,
          options: free.map((account) => ({ value: account.id, label: account.name })),
        },
      ],
      { submit: tr('common.create') }
    );
    if (!data) return;
    try {
      await api(`/profiles/${profile.id}/accounts`, {
        method: 'POST',
        body: { account_id: Number(data.account_id) },
      });
      await refresh({ accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  }

  await bindSpam(profile, members);

  // ------------------------------------------------------------ Live

  const refreshBots = debounce(async () => {
    if (state.route.name !== 'server' || state.route.id !== profile.id) return;
    await refresh({ accounts: false });
    const fresh = profileById(profile.id);
    if (!fresh) return;
    profile.accounts = fresh.accounts;
    profile.online = fresh.online;
    members.length = 0;
    members.push(...fresh.accounts);
    paintBots();
    paintAuth();
  }, 400);

  state.onLive = (event) => {
    if (event.type === 'line' && event.key.startsWith(`${profile.id}:`)) paintChat();
    if (event.type === 'state' && event.key.startsWith(`${profile.id}:`)) {
      paintAuth();
      refreshBots();
    }
  };
}

/** Der Kasten mit den wiederholten Nachrichten – er hängt am Chat, nicht am Serverplatz. */
const spamPanel = () => `
  <section class="panel" style="margin-top:1.25rem">
    <header><h3>${escapeHtml(tr('srv.spam'))}</h3>
      <button class="btn btn-sm btn-primary" id="add-spam">${icon('plus')}</button></header>
    <div class="body" style="padding:0" id="spam-body"></div>
  </section>`;

async function bindSpam(profile, members) {
  const { spam } = await api(`/profiles/${profile.id}/spam`);
  const body = $('#spam-body');
  body.innerHTML = spam.length
    ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>${escapeHtml(tr('tk.message'))}</th><th></th>
          <th>${escapeHtml(tr('ov.col.account'))}</th><th></th><th></th></tr></thead>
        <tbody>${spam.map(spamRow).join('')}</tbody></table></div>`
    : `<p class="muted small" style="padding:1.25rem">${escapeHtml(tr('common.none'))}
       — <span class="mono">/afk</span> · 300 s</p>`;

  function spamRow(entry) {
    const names = entry.accounts.length
      ? entry.accounts.map((id) => members.find((m) => m.account_id === id)?.name || id).join(', ')
      : tr('common.all');
    return `<tr>
      <td class="mono">${escapeHtml(entry.message)}</td>
      <td class="mono small">${entry.interval_sec} s</td>
      <td class="small muted">${escapeHtml(names)}</td>
      <td><span class="switch" role="switch" tabindex="0" aria-checked="${entry.enabled}"
        data-spam-toggle="${entry.id}"></span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" data-spam-test="${entry.id}">${escapeHtml(tr('srv.chatSend'))}</button>
        <button class="btn btn-sm" data-spam-edit="${entry.id}">${escapeHtml(tr('common.edit'))}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-spam-del="${entry.id}">${icon('trash')}</button>
      </td>
    </tr>`;
  }

  $('#add-spam').addEventListener('click', () => editSpam(profile, members, null));
  $$('[data-spam-edit]').forEach((button) =>
    button.addEventListener('click', () =>
      editSpam(profile, members, spam.find((entry) => entry.id === Number(button.dataset.spamEdit)))
    )
  );
  $$('[data-spam-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/profiles/${profile.id}/spam/${button.dataset.spamDel}`, { method: 'DELETE' });
      draw();
    })
  );
  $$('[data-spam-test]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/profiles/${profile.id}/spam/${button.dataset.spamTest}/test`, { method: 'POST' });
        ok(tr('srv.saved'));
      } catch (error) {
        fail(error);
      }
    })
  );
  bindSwitches('[data-spam-toggle]', (id, enabled) =>
    api(`/profiles/${profile.id}/spam/${id}`, { method: 'PATCH', body: { enabled } })
  );
}

async function editSpam(profile, members, entry) {
  const data = await formDialog(
    tr('srv.spam'),
    [
      { key: 'message', label: tr('tk.message'), value: entry?.message || '/afk', required: true },
      {
        key: 'interval_sec',
        label: tr('srv.intervalSec'),
        type: 'number',
        min: 5,
        max: 86400,
        value: entry?.interval_sec ?? 300,
      },
      {
        key: 'accounts',
        label: tr('ov.col.account'),
        type: 'select',
        value: entry?.accounts?.length === 1 ? String(entry.accounts[0]) : '',
        options: [
          { value: '', label: tr('common.all') },
          ...members.map((member) => ({ value: String(member.account_id), label: member.name })),
        ],
      },
    ],
    { submit: tr('common.save') }
  );
  if (!data) return;
  const body = {
    message: data.message,
    interval_sec: Number(data.interval_sec),
    accounts: data.accounts ? [Number(data.accounts)] : [],
  };
  try {
    if (entry) await api(`/profiles/${profile.id}/spam/${entry.id}`, { method: 'PATCH', body });
    else await api(`/profiles/${profile.id}/spam`, { method: 'POST', body });
    ok(tr('srv.saved'));
    draw();
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------- Bewegung
//
// Sechs Kästen mit vierundzwanzig Knöpfen standen hier, und man musste raten, welcher was tut.
// Vier davon hießen "Status" und schickten eine Abfrage, deren Antwort in einem anderen Reiter
// landete – gedrückt hat sie deshalb niemand zweimal.
//
// Jetzt sind es drei Abschnitte, und sie stehen in der Reihenfolge, in der man sie braucht:
//
//   1. **Gehen** – hin und her, ein paar Blöcke. Das ist es, wofür neunzig Prozent hierherkommen.
//      Daneben steht die Position, damit man sieht, ob etwas passiert ist.
//   2. **Blickrichtung** – wohin der Bot schaut. Vier Himmelsrichtungen und die Neigung; wer es
//      genau braucht, tippt Gierwinkel und Neigung ein.
//   3. **Heimatposition** – der Platz, zu dem der Bot nach jedem Beitritt zurückläuft, samt der
//      Strecke dorthin. Beides gehört zusammen und stand vorher in zwei Kästen.
//
// Was der Tarif nicht hergibt, steht gar nicht erst da (Haltung und Anti-AFK brauchen Premium).
// Und jede Abfrage antwortet **hier**, nicht im Chatverlauf.

async function tabMovement(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  /** Ein Knopf des Steuerkreuzes: Pfeil groß, Wort klein darunter. */
  const pad = (dir, arrow, label) =>
    `<button class="btn padkey" data-go="${dir}" title="${escapeHtml(label)}">
      <span class="padkey-arrow">${arrow}</span>
      <span class="padkey-label">${escapeHtml(label)}</span>
    </button>`;

  root.innerHTML = `
    ${accountPicker(members)}

    <!-- free-height: Die beiden Kästen sind verschieden hoch, und das ist in Ordnung. Ohne diese
         Klasse zog das Raster den kürzeren auf die Höhe des längeren, und unter der Blickrichtung
         stand ein Loch von zweihundert Pixeln. -->
    <div class="grid two free-height">
      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.walk'))}</h3>
          <span class="small muted">${escapeHtml(tr('srv.walkHint'))}</span></header>
        <div class="body stack">
          <div class="padgrid">
            <span></span>
            ${pad('vor', '↑', tr('srv.dir.forward'))}
            <span></span>
            ${pad('links', '←', tr('srv.dir.left'))}
            <button class="btn btn-danger padkey" data-verb="stop" title="${escapeHtml(tr('srv.stopWalk'))}">
              <span class="padkey-arrow">■</span>
              <span class="padkey-label">${escapeHtml(tr('srv.stopWalk'))}</span>
            </button>
            ${pad('rechts', '→', tr('srv.dir.right'))}
            <span></span>
            ${pad('zurück', '↓', tr('srv.dir.back'))}
            <span></span>
          </div>

          <div class="row wrap" style="align-items:flex-end">
            <div class="field" style="max-width:9rem">
              <label for="blocks">${escapeHtml(tr('srv.blocks'))}</label>
              <input id="blocks" type="number" min="1" max="64" value="3">
            </div>
            <button class="btn btn-sm" data-verb="jump">${escapeHtml(tr('srv.jump'))}</button>
            <button class="btn btn-sm" data-verb="pos">${icon('pin')} ${escapeHtml(tr('srv.pos'))}</button>
          </div>

          <div id="position-results" class="stack"></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.look'))}</h3>
          <span class="small muted">${escapeHtml(tr('srv.lookHint'))}</span></header>
        <div class="body stack">
          <div class="row wrap">
            <button class="btn btn-sm" data-look="nord">${escapeHtml(tr('srv.compass.n'))}</button>
            <button class="btn btn-sm" data-look="ost">${escapeHtml(tr('srv.compass.e'))}</button>
            <button class="btn btn-sm" data-look="sued">${escapeHtml(tr('srv.compass.s'))}</button>
            <button class="btn btn-sm" data-look="west">${escapeHtml(tr('srv.compass.w'))}</button>
            <button class="btn btn-sm" data-look="um">↺ ${escapeHtml(tr('srv.turnAround'))}</button>
          </div>
          <div class="row wrap">
            <button class="btn btn-sm" data-look="hoch">↑ ${escapeHtml(tr('srv.lookUp'))}</button>
            <button class="btn btn-sm" data-look="gerade">— ${escapeHtml(tr('srv.lookLevel'))}</button>
            <button class="btn btn-sm" data-look="runter">↓ ${escapeHtml(tr('srv.lookDown'))}</button>
          </div>
          <details class="fold">
            <summary>${escapeHtml(tr('srv.lookExact'))}</summary>
            <div class="row" style="margin-top:.6rem;align-items:flex-end">
              <div class="field"><label for="yaw">${escapeHtml(tr('srv.yaw'))}</label>
                <input id="yaw" type="number" min="-180" max="180" value="0"></div>
              <div class="field"><label for="pitch">${escapeHtml(tr('srv.pitch'))}</label>
                <input id="pitch" type="number" min="-90" max="90" value="0"></div>
              <button class="btn" id="look-exact">${escapeHtml(tr('srv.turnTo'))}</button>
            </div>
          </details>
        </div>
      </section>
    </div>

    <!-- Heimatposition und Route sind eine Sache: ein Ort, zu dem der Bot zurückläuft, und der
         Weg dorthin. Vorher standen sie in zwei Kästen nebeneinander, und aus keinem der beiden
         ging hervor, dass der eine ohne den anderen nichts tut. -->
    <section class="panel" style="margin-top:1.5rem">
      <header><h3>${escapeHtml(tr('srv.home'))}</h3>
        <button class="btn btn-sm" data-home="">${icon('eye')} ${escapeHtml(tr('srv.show'))}</button>
      </header>
      <div class="body stack">
        <p class="small muted" style="margin:0">${escapeHtml(tr('srv.homeHint'))}</p>
        <div class="row wrap">
          <button class="btn btn-sm btn-primary" data-home="set">${icon('pin')} ${escapeHtml(
            tr('srv.homeSet')
          )}</button>
          <button class="btn btn-sm" data-home="go">${escapeHtml(tr('srv.homeGo'))}</button>
          <button class="btn btn-sm btn-danger" data-home="clear">${escapeHtml(tr('srv.homeClear'))}</button>
        </div>
        <div class="row spread">
          <span>
            <span class="strong">${escapeHtml(tr('srv.homeAuto'))}</span>
            <span class="small muted" style="display:block">${escapeHtml(tr('srv.homeAutoHint'))}</span>
          </span>
          <span class="switch" role="switch" tabindex="0" aria-checked="false"
            aria-label="${escapeHtml(tr('srv.homeAuto'))}" data-runtime="home"></span>
        </div>

        <hr class="rule">

        <p class="small muted" style="margin:0">${escapeHtml(tr('srv.routeHint'))}</p>
        <div class="row wrap">
          <button class="btn btn-sm" data-route="rec">${escapeHtml(tr('srv.recStart'))}</button>
          <button class="btn btn-sm" data-route="stop">${escapeHtml(tr('srv.recStop'))}</button>
          <button class="btn btn-sm btn-danger" data-route="clear">${escapeHtml(tr('srv.routeClear'))}</button>
          <button class="btn btn-sm" data-route="">${icon('eye')} ${escapeHtml(tr('srv.show'))}</button>
        </div>

        <div id="movement-answer"></div>
      </div>
    </section>

    ${
      profile.caps.sneak || profile.caps.antiafk
        ? `<div class="grid two free-height" style="margin-top:1.5rem">
            ${
              profile.caps.sneak
                ? `<section class="panel">
                    <header><h3>${escapeHtml(tr('srv.body'))}</h3></header>
                    <div class="body stack">
                      <div class="row spread">
                        <span class="strong">${escapeHtml(tr('srv.sneak'))}</span>
                        <span class="switch" role="switch" tabindex="0" aria-checked="${Boolean(profile.sneak)}"
                          aria-label="${escapeHtml(tr('srv.sneak'))}" data-runtime="sneak"></span>
                      </div>
                      <div class="row spread">
                        <span class="strong">${escapeHtml(tr('srv.sprint'))}</span>
                        <span class="switch" role="switch" tabindex="0" aria-checked="false"
                          aria-label="${escapeHtml(tr('srv.sprint'))}" data-runtime="sprint"></span>
                      </div>
                      <div class="row wrap" style="align-items:flex-end">
                        <button class="btn btn-sm" data-cmd="swing|">${escapeHtml(tr('srv.swing'))}</button>
                        <button class="btn btn-sm" data-cmd="use|">${escapeHtml(tr('srv.use'))}</button>
                        <div class="field" style="max-width:7rem"><label for="slot">${escapeHtml(
                          tr('srv.slot')
                        )}</label>
                          <input id="slot" type="number" min="1" max="9" value="1"></div>
                        <button class="btn btn-sm" id="hand">${escapeHtml(tr('srv.hand'))}</button>
                      </div>
                    </div>
                  </section>`
                : ''
            }
            ${
              profile.caps.antiafk
                ? `<section class="panel">
                    <header><h3>${escapeHtml(tr('srv.antiafk'))}</h3></header>
                    <div class="body stack">
                      <p class="small muted" style="margin:0">${escapeHtml(tr('srv.antiafkHint'))}</p>
                      <div class="row spread" style="align-items:flex-end">
                        <div class="field" style="max-width:11rem">
                          <label for="runtime-antiafk">${escapeHtml(tr('srv.intervalSec'))}</label>
                          <input id="runtime-antiafk" type="number" min="15" max="3600"
                            value="${Math.max(15, profile.antiafk_sec || 60)}">
                        </div>
                        <span class="switch" role="switch" tabindex="0" aria-checked="${profile.antiafk_sec > 0}"
                          aria-label="${escapeHtml(tr('srv.antiafk'))}" data-runtime="antiafk"></span>
                      </div>
                    </div>
                  </section>`
                : ''
            }
          </div>`
        : ''
    }`;

  const run = commandRunner(profile);

  /** Die Position, wie der Bot sie zuletzt gemeldet hat – je ausgewähltem Konto eine Karte. */
  const paintPositions = () => {
    const cards = members
      .map(({ account_id: id, name }) => ({
        name,
        view: state.bots.get(`${profile.id}:${id}`)?.views?.position,
      }))
      .filter(({ view }) => view)
      .map(({ name, view }) =>
        view.empty
          ? `<div class="small muted">${escapeHtml(name)}: ${escapeHtml(view.text || tr('srv.positionMissing'))}</div>`
          : `<div class="note"><div><strong>${escapeHtml(name)}</strong><br>
              <span class="mono">X ${view.x.toFixed(2)} · Y ${view.y.toFixed(2)} · Z ${view.z.toFixed(2)}</span><br>
              <span class="small muted">${escapeHtml(
                tr('srv.positionLook', { yaw: view.yaw.toFixed(1), pitch: view.pitch.toFixed(1) })
              )}</span>
            </div></div>`
      );
    const target = $('#position-results');
    if (target) target.innerHTML = cards.join('');
  };

  /**
   * Die Antwort auf "Zeigen" – die Übersicht, die der Client selbst schreibt.
   *
   * Sie wird **nicht** zerlegt: Der Client schreibt sie für Menschen, und hier liest sie ein
   * Mensch. Vorher fiel sie als Statusmeldung in den Chatverlauf, also in einen anderen Reiter –
   * für jeden, der hier auf den Knopf drückte, sah es aus, als täte er nichts.
   */
  const paintAnswer = () => {
    const blocks = members
      .map(({ account_id: id, name }) => ({
        name,
        view: state.bots.get(`${profile.id}:${id}`)?.views?.movement,
      }))
      .filter(({ view }) => view && !view.empty)
      .map(
        ({ name, view }) => `<div class="answer">
          <span class="small muted">${escapeHtml(name)}</span>
          <pre>${escapeHtml(view.lines.join('\n'))}</pre>
        </div>`
      );
    const target = $('#movement-answer');
    if (target) target.innerHTML = blocks.join('');
  };

  $$('[data-go]').forEach((button) =>
    button.addEventListener('click', () => run('go', `${button.dataset.go} ${$('#blocks').value || 1}`))
  );
  $$('[data-verb]').forEach((button) => button.addEventListener('click', () => run(button.dataset.verb)));
  $$('[data-look]').forEach((button) => button.addEventListener('click', () => run('look', button.dataset.look)));
  $('#look-exact')?.addEventListener('click', () => run('look', `${$('#yaw').value} ${$('#pitch').value}`));
  $$('[data-home]').forEach((button) => button.addEventListener('click', () => run('home', button.dataset.home)));
  $$('[data-route]').forEach((button) => button.addEventListener('click', () => run('route', button.dataset.route)));
  $$('[data-cmd]').forEach((button) =>
    button.addEventListener('click', () => {
      const [verb, arg] = button.dataset.cmd.split('|');
      run(verb, arg);
    })
  );
  bindSwitches('[data-runtime]', async (verb, enabled) => {
    const arg =
      verb === 'antiafk' && enabled
        ? String(Math.max(15, Number($('#runtime-antiafk')?.value) || 60))
        : enabled
          ? 'on'
          : 'off';
    const success = await run(verb, arg);
    if (!success) throw new Error(tr('srv.commandFailed'));
  });
  $('#hand')?.addEventListener('click', () => run('hand', $('#slot').value));

  paintPositions();
  paintAnswer();
  state.onLive = (event) => {
    if (event.type !== 'view' || !String(event.key || '').startsWith(`${profile.id}:`)) return;
    if (event.kind === 'position') paintPositions();
    if (event.kind === 'movement') paintAnswer();
  };
}

// ---------------------------------------------------------------- Anzeigetafel
//
// Die Seitenleiste eines Servers ist kein Chat und gehört auch nicht in eine Chatfläche: dreizehn
// Zeilen mit Punktzahlen hintereinander sind dort nicht zu lesen. Hier steht sie so, wie sie im
// Spiel aussieht – der Titel oben in der Mitte, die Zeilen darunter in ihren Farben, die Punktzahl
// rechts in Rot.

async function tabBoard(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  root.innerHTML = `
    ${accountPicker(members)}
    <div class="row wrap" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="get-board">${icon('refresh')} ${escapeHtml(tr('vw.board'))}</button>
      <span class="small muted" style="align-self:center">${escapeHtml(tr('vw.hint'))}</span>
    </div>
    <div class="views" id="views"></div>`;

  const run = commandRunner(profile);
  $('#get-board').addEventListener('click', () => run('board'));

  const paint = () => {
    const boards = [];
    for (const member of members) {
      const bot = state.bots.get(`${profile.id}:${member.account_id}`);
      if (!bot?.views?.board) continue;
      boards.push(boardCard(member, bot.views.board));
    }
    $('#views').innerHTML =
      boards.join('') ||
      `<div class="empty" style="grid-column:1/-1"><h3>${escapeHtml(tr('vw.empty'))}</h3>
        <p>${escapeHtml(tr('vw.hint'))}</p></div>`;
  };

  // Beim Öffnen einmal von selbst abrufen – wer den Reiter anklickt, will die Tafel sehen.
  //
  // Aber nur, wenn überhaupt ein Bot im Spiel ist: Sonst antwortete der Server mit "der Bot läuft
  // gerade nicht", und das Erste, was jemand beim Öffnen des Reiters sah, war eine rote
  // Fehlermeldung für etwas, das er gar nicht angestoßen hat.
  paint();
  if (anyOnline(profile, members)) run('board');

  state.onLive = (event) => {
    if (event.type === 'view' && event.key.startsWith(`${profile.id}:`)) paint();
  };
}

/** Eine Anzeigetafel, wie Minecraft sie zeichnet: Titel oben, Zeile links, Punktzahl rechts. */
function boardCard(member, view) {
  if (view.empty) {
    return `<article class="board is-empty">
      <header>${escapeHtml(member.name)}</header>
      <p class="board-note">${escapeHtml(tr('vw.empty'))}</p>
    </article>`;
  }
  return `<article class="board">
    <header title="${escapeHtml(member.name)}">${mcText(view.title)}</header>
    <ol class="board-rows">
      ${view.rows
        .map(
          (row) => `<li><span class="board-text">${mcText(row.text)}</span>
            ${
              row.number === '' || row.hidden
                ? ''
                : `<span class="board-score">${row.number != null ? mcText(row.number) : row.score ?? ''}</span>`
            }</li>`
        )
        .join('')}
    </ol>
    <footer>${escapeHtml(member.name)}</footer>
  </article>`;
}

// ---------------------------------------------------------------- Menüs

async function tabMenu(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  root.innerHTML = `
    ${accountPicker(members)}
    <div class="row wrap" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="get-menu">${icon('refresh')} ${escapeHtml(tr('common.status'))}</button>
      <button class="btn btn-sm btn-danger" id="close-menu">${escapeHtml(tr('srv.menuClose'))}</button>
      <span class="small muted" style="align-self:center">${escapeHtml(tr('vw.menuBlind'))}</span>
    </div>
    <div class="views" id="views"></div>`;

  const run = commandRunner(profile);
  const inspected = new Set();
  $('#get-menu').addEventListener('click', () => {
    run('menu');
    pullLive();
  });
  $('#close-menu').addEventListener('click', () => run('close'));

  /**
   * Wo der texturierte Viewer läuft, kommt das Menü von dort.
   *
   * Es ist dieselbe Sache in besser: Der Viewer meldet jedes Feld mit Nummer, Anzahl, Name und
   * Beschreibungstext – und mit einer Kennung, zu der es ein Bild gibt. Der Weg über `:menu`
   * bleibt daneben stehen und gilt für alle anderen; er liefert dieselben Felder, nur ohne Bild.
   */
  const live = new Map();
  let timer = null;

  async function pullLive() {
    clearTimeout(timer);
    if (state.route.tab !== 'menu' || state.route.id !== profile.id) return;
    let any = false;
    for (const member of members) {
      const bot = state.bots.get(`${profile.id}:${member.account_id}`);
      if (!bot?.online || !bot?.pov?.web) continue;
      any = true;
      try {
        const response = await api(`/profiles/${profile.id}/pov/${member.account_id}/state.json`, {
          raw: true,
        });
        if (response.ok) live.set(member.account_id, (await response.json()).menu || null);
      } catch {
        /* der Bot ist gerade gegangen – dann bleibt der letzte Stand stehen */
      }
    }
    if (!any) return;
    paint();
    timer = setTimeout(pullLive, 1500);
  }

  const paint = () => {
    const cards = [];
    for (const member of members) {
      const bot = state.bots.get(`${profile.id}:${member.account_id}`);
      if (!bot) continue;
      const fresh = live.get(member.account_id);
      const view = fresh
        ? fresh.open
          ? {
              empty: false,
              title: fresh.title,
              slots: fresh.slots,
              // Der Viewer schickt eine Liste, der Textweg ein Verzeichnis nach Feldnummer. Hier
              // wird daraus dasselbe, damit die Karte darunter nur eine Form kennen muss.
              items: Object.fromEntries((fresh.items || []).map((item, index) => [index, item]).filter(([, item]) => item)),
            }
          : { empty: true }
        : bot.views?.menu || (bot.menu ? { empty: false, ...bot.menu } : null);
      if (view) cards.push(menuCard(member, view));
    }
    $('#views').innerHTML =
      cards.join('') ||
      `<div class="empty" style="grid-column:1/-1"><h3>${escapeHtml(tr('vw.emptyMenu'))}</h3></div>`;
    bindSlots();
  };

  function menuCard(member, view) {
    if (view.empty) {
      return `<article class="board is-empty">
        <header>${escapeHtml(member.name)}</header>
        <p class="board-note">${escapeHtml(tr('vw.emptyMenu'))}</p>
      </article>`;
    }
    // Ein Raster wie eine Truhe: neun Felder je Reihe, klickbar. Was in einem Feld liegt, steht
    // in `view.items` – meldet der Client dazu nichts, bleibt das Feld leer und behält nur seine
    // Nummer. Ein leeres Feld ist im Spiel schließlich auch nur ein leeres Feld.
    const slots = Math.max(9, Math.min(120, Number(view.slots) || 27));
    const items = view.items || {};
    return `<article class="board menu-card">
      <header>${view.title ? mcText(view.title) : escapeHtml(tr('vw.menu'))}</header>
      <div class="menu-grid">
        ${Array.from({ length: slots }, (_, index) =>
          itemSlot({
            item: items[index] || null,
            index,
            accountId: member.account_id,
            profileId: profile.id,
          })
        ).join('')}
      </div>
      <footer>${escapeHtml(member.name)} · ${escapeHtml(tr('vw.slots', { n: slots }))} · ${escapeHtml(
        tr('vw.clickSlot')
      )}</footer>
    </article>`;
  }

  function bindSlots() {
    $$('[data-slot]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const target = event.currentTarget;
        const which = event.shiftKey ? 'shift' : event.ctrlKey || event.metaKey ? 'rechts' : '';
        try {
          await api(`/profiles/${profile.id}/command`, {
            method: 'POST',
            body: {
              verb: 'click',
              arg: `${target.dataset.slot}${which ? ` ${which}` : ''}`,
              accounts: [Number(target.dataset.account)],
            },
          });
        } catch (error) {
          fail(error);
        }
      });

      // Namen kommen schon mit `:menu`; Lore liefert der Rust-Client gezielt mit `:slot`.
      // Beim ersten Hover oder Tastaturfokus wird sie nachgeladen, ohne das Menü anzuklicken.
      const inspect = async () => {
        if (button.dataset.inspect !== '1') return;
        const key = `${button.dataset.account}:${button.dataset.slot}`;
        if (inspected.has(key)) return;
        inspected.add(key);
        try {
          const result = await api(`/profiles/${profile.id}/command`, {
            method: 'POST',
            body: {
              verb: 'slot',
              arg: button.dataset.slot,
              accounts: [Number(button.dataset.account)],
            },
          });
          if (!result.results?.some((entry) => entry.ok)) inspected.delete(key);
        } catch {
          inspected.delete(key);
        }
      };
      button.addEventListener('mouseenter', inspect);
      button.addEventListener('focus', inspect);
    });
  }

  paint();
  // Wie bei der Anzeigetafel: ohne laufenden Bot gibt es nichts abzufragen, und die Absage
  // darauf wäre eine Fehlermeldung ohne Anlass.
  if (anyOnline(profile, members)) {
    run('menu');
    pullLive();
  }
  window.addEventListener('hashchange', () => clearTimeout(timer), { once: true });

  state.onLive = (event) => {
    if ((event.type === 'view' || event.type === 'state') && event.key.startsWith(`${profile.id}:`)) paint();
  };
}

// ---------------------------------------------------------------- Zusätze

async function tabAddons(root, profile) {
  const data = await api(`/profiles/${profile.id}/addons`);

  root.innerHTML = `
    <div class="row spread wrap" style="margin-bottom:1.25rem;gap:1rem">
      <div style="max-width:44rem">
        <h2 style="font-size:1.25rem;margin:0 0 .35rem">${escapeHtml(tr('ad.title'))}</h2>
        <p class="small muted" style="margin:0">${escapeHtml(tr('ad.sub'))}</p>
      </div>
      <div class="stat" style="min-width:12rem">
        <div class="k">${escapeHtml(tr('ad.monthlyAfter'))}</div>
        <div class="v">${credits(data.monthly_credits)}</div>
        <div class="s">${escapeHtml(euro(data.monthly_credits))}</div>
      </div>
    </div>

    ${
      data.allowed
        ? ''
        : `<div class="note warn" style="margin-bottom:1.25rem">${icon('info')}
            <div>${escapeHtml(data.reason || tr('ad.freePlan'))}
            <a href="#/servers/${profile.id}/plan">${escapeHtml(tr('srv.changePlan'))}</a></div></div>`
    }

    <div class="grid two addon-grid">${data.addons.map(card).join('')}</div>`;

  function card(addon) {
    const soon = addon.announced;
    const state_ =
      addon.included ? 'included' : addon.qty > 0 ? 'booked' : soon ? 'soon' : 'open';
    return `<article class="card addon ${state_}">
      <div class="row spread" style="align-items:flex-start">
        <div style="min-width:0">
          <div class="strong">${escapeHtml(addon.name)}</div>
          <p class="small muted" style="margin:.35rem 0 0">${escapeHtml(addon.text)}</p>
        </div>
        ${
          addon.included
            ? `<span class="pill primary">${escapeHtml(tr('ad.included'))}</span>`
            : addon.qty > 0
              ? `<span class="pill primary">${escapeHtml(tr('ad.booked'))}${
                  addon.max_qty > 1 ? ` · ${addon.qty}×` : ''
                }</span>`
              : soon
                ? `<span class="pill missing">${escapeHtml(tr('ad.soon'))}</span>`
                : ''
        }
      </div>

      <div class="row spread" style="margin-top:1rem;align-items:flex-end">
        <div>
          <!-- Euro zuerst: das ist die Zahl, mit der jemand entscheidet. Credits stehen darunter,
               weil im Panel damit gerechnet wird. -->
          <div class="price-line" style="margin:0">${escapeHtml(euro(addon.price_credits))}
            <span class="small muted">${escapeHtml(tr('ad.perMonth'))}</span></div>
          <div class="small muted">${credits(addon.price_credits)} ${escapeHtml(
            tr('common.creditsInline')
          )} ${escapeHtml(tr('ad.perMonth'))}</div>
          ${
            !addon.included && !soon && data.allowed && data.days_left !== null
              ? `<div class="small" style="color:var(--ok-text)">${escapeHtml(
                  tr('ad.nowOnly', { credits: credits(addon.prorated) })
                )} — ${escapeHtml(tr('ad.restOfMonth', { n: data.days_left }))}</div>`
              : ''
          }
        </div>
        <div class="row">
          ${
            !addon.included && !soon && data.allowed && addon.max_qty > 1 && addon.qty < addon.max_qty
              ? `<label class="field addon-qty"><span>${escapeHtml(tr('ad.qty'))}</span>
                  <input type="number" min="1" max="${addon.max_qty - addon.qty}" value="1"
                    data-qty="${addon.id}"></label>`
              : ''
          }
          ${
            addon.qty > 0
              ? `<button class="btn btn-sm btn-danger" data-drop="${addon.id}">${escapeHtml(tr('ad.cancel'))}</button>`
              : ''
          }
          ${
            !addon.included && !soon && data.allowed && (addon.qty < addon.max_qty)
              ? `<button class="btn btn-sm btn-primary" data-buy="${addon.id}">${escapeHtml(tr('ad.book'))}</button>`
              : ''
          }
        </div>
      </div>
      ${soon ? `<p class="small muted" style="margin:.75rem 0 0">${escapeHtml(tr('ad.soonHint'))}</p>` : ''}
    </article>`;
  }

  $$('[data-buy]').forEach((button) =>
    button.addEventListener('click', async () => {
      const addon = data.addons.find((entry) => entry.id === Number(button.dataset.buy));
      const input = $(`[data-qty="${addon.id}"]`);
      const qty = Math.max(
        1,
        Math.min(addon.max_qty - addon.qty, Math.trunc(Number(input?.value) || 1))
      );
      const price =
        data.days_left === null
          ? addon.price_credits * qty
          : addon.prorated_by_qty?.[qty] ?? addon.prorated * qty;
      if (!(await confirmDialog(tr('ad.confirmBuy', { name: addon.name, credits: price, qty }), {
        confirm: tr('ad.book'),
        danger: false,
      })))
        return;
      try {
        await api(`/profiles/${profile.id}/addons`, { method: 'POST', body: { addon_id: addon.id, qty } });
        await refresh({ accounts: false });
        ok(tr('srv.saved'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $$('[data-drop]').forEach((button) =>
    button.addEventListener('click', async () => {
      const addon = data.addons.find((entry) => entry.id === Number(button.dataset.drop));
      if (!(await confirmDialog(tr('ad.confirmDrop', { name: addon.name }), { confirm: tr('ad.cancel') })))
        return;
      try {
        await api(`/profiles/${profile.id}/addons/${addon.id}`, { method: 'DELETE' });
        await refresh({ accounts: false });
        ok(tr('srv.saved'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );
}

// ---------------------------------------------------------------- Proxys

async function tabProxies(root, profile) {
  const data = await api('/proxies');

  if (!data.allowed) {
    root.innerHTML = `
      <div class="note warn" style="margin-bottom:1.25rem">${icon('info')}
        <div>${escapeHtml(tr('srv.proxyFree'))}</div></div>
      <a class="btn btn-primary" href="#/proxies">${icon('globe')} ${escapeHtml(tr('px.title'))}</a>`;
    return;
  }

  root.innerHTML = `
    ${
      data.proxies.length
        ? `<section class="panel"><div class="table-wrap"><table class="table">
            <thead><tr><th>${escapeHtml(tr('ov.col.account'))}</th><th>${escapeHtml(
              tr('px.title')
            )}</th></tr></thead>
            <tbody>${profile.accounts
              .map(
                (member) => `<tr>
                  <td><span class="row"><img class="head" src="${escapeHtml(member.head)}" alt="">${escapeHtml(
                    member.name
                  )}</span></td>
                  <td><select data-proxy="${member.account_id}" style="max-width:22rem">
                    <option value="">${escapeHtml(tr('common.none'))}</option>
                    ${data.proxies
                      .map(
                        (proxy) =>
                          `<option value="${proxy.id}" ${member.proxy_id === proxy.id ? 'selected' : ''}>
                            ${escapeHtml(proxy.label || `#${proxy.id}`)} · ${escapeHtml(proxy.kind)}://${escapeHtml(
                              proxy.host
                            )}:${proxy.port}</option>`
                      )
                      .join('')}
                  </select></td>
                </tr>`
              )
              .join('')}</tbody></table></div></section>`
        : `<div class="empty"><h3>${escapeHtml(tr('px.none'))}</h3>
            <p>${escapeHtml(tr('px.requestNote'))}</p>
            <a class="btn btn-primary" href="#/proxies">${escapeHtml(tr('px.request'))}</a></div>`
    }`;

  $$('[data-proxy]').forEach((select) =>
    select.addEventListener('change', async () => {
      try {
        await api(`/profiles/${profile.id}/accounts/${select.dataset.proxy}`, {
          method: 'PATCH',
          body: { proxy_id: select.value ? Number(select.value) : null },
        });
        ok(tr('srv.saved'));
      } catch (error) {
        fail(error);
      }
    })
  );
}

// ---------------------------------------------------------------- Macros

async function tabMacros(root, profile) {
  const { macros } = await api(`/profiles/${profile.id}/macros`);
  const events = Object.fromEntries(state.meta.events.map((event) => [event.type, event.label]));

  root.innerHTML = `
    <div class="row spread" style="margin-bottom:1rem">
      <p class="small muted" style="max-width:44rem">${escapeHtml(tr('srv.macroHint'))}</p>
      <button class="btn btn-primary btn-sm" id="add-macro">${icon('plus')} ${escapeHtml(
        tr('srv.newMacro')
      )}</button>
    </div>

    ${
      macros.length
        ? `<div class="stack">${macros.map(macroCard).join('')}</div>`
        : `<div class="empty"><h3>${escapeHtml(tr('common.none'))}</h3>
            <p>${escapeHtml(tr('srv.macroExample'))}</p>
            <button class="btn btn-primary" id="add-macro-2">${icon('plus')} ${escapeHtml(
              tr('srv.newMacro')
            )}</button></div>`
    }`;

  function macroCard(macro) {
    const summary = macro.actions
      .map((action) => {
        if (action.type === 'chat') return `"${action.text}"`;
        if (action.type === 'wait') return `${action.seconds} s`;
        if (action.type === 'move') return `${action.direction} ${action.blocks}`;
        if (action.type === 'look') return `${action.yaw}/${action.pitch}`;
        return action.type;
      })
      .join(' → ');
    const when =
      macro.event === 'timer'
        ? `${macro.config.interval_sec || 300} s`
        : macro.event === 'chat'
          ? `"${macro.config.contains || macro.config.regex || '…'}"`
          : events[macro.event] || macro.event;
    return `<article class="card">
      <div class="row spread">
        <div>
          <div class="strong">${escapeHtml(macro.name)}</div>
          <div class="small muted">${escapeHtml(when)} · ${macro.actions.length} ·
            ${escapeHtml(macro.accounts.length ? `${macro.accounts.length}` : tr('common.all'))}</div>
        </div>
        <span class="switch" role="switch" tabindex="0" aria-checked="${macro.enabled}"
          data-macro-toggle="${macro.id}"></span>
      </div>
      <p class="small mono muted" style="margin-top:.75rem">${escapeHtml(summary || '–')}</p>
      <div class="row" style="margin-top:1rem">
        <button class="btn btn-sm" data-macro-test="${macro.id}">${escapeHtml(tr('srv.chatSend'))}</button>
        <button class="btn btn-sm" data-macro-edit="${macro.id}">${escapeHtml(tr('common.edit'))}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-macro-del="${macro.id}">${icon('trash')}</button>
      </div>
    </article>`;
  }

  $('#add-macro')?.addEventListener('click', () => editMacro(profile, null));
  $('#add-macro-2')?.addEventListener('click', () => editMacro(profile, null));
  $$('[data-macro-edit]').forEach((button) =>
    button.addEventListener('click', () =>
      editMacro(profile, macros.find((macro) => macro.id === Number(button.dataset.macroEdit)))
    )
  );
  $$('[data-macro-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/profiles/${profile.id}/macros/${button.dataset.macroDel}`, { method: 'DELETE' });
      draw();
    })
  );
  $$('[data-macro-test]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/profiles/${profile.id}/macros/${button.dataset.macroTest}/test`, { method: 'POST' });
        ok(tr('srv.saved'));
      } catch (error) {
        fail(error);
      }
    })
  );
  bindSwitches('[data-macro-toggle]', (id, enabled) =>
    api(`/profiles/${profile.id}/macros/${id}`, { method: 'PATCH', body: { enabled } })
  );
}

/** Macro-Editor: Auslöser oben, darunter die Schritte in der Reihenfolge, in der sie laufen. */
async function editMacro(profile, macro) {
  const actions = structuredClone(macro?.actions || [{ type: 'chat', text: '/afk' }]);
  // Nur Schritte anbieten, die dieser Serverplatz auch ausführen kann.
  const available = state.meta.actions.filter((action) => !action.needs || profile.caps[action.needs]);

  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <header><h3>${escapeHtml(macro ? tr('common.edit') : tr('srv.newMacro'))}</h3></header>
    <div class="body"><div class="stack" id="editor"></div></div>
    <footer>
      <button class="btn" id="cancel">${escapeHtml(tr('common.cancel'))}</button>
      <button class="btn btn-primary" id="save">${escapeHtml(tr('common.save'))}</button>
    </footer>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
  $('#cancel', dialog).addEventListener('click', () => dialog.close());

  const paint = () => {
    const event = $('#event', dialog)?.value || macro?.event || 'join';
    $('#editor', dialog).innerHTML = `
      <div class="field">
        <label for="name">${escapeHtml(tr('common.name'))}</label>
        <input id="name" value="${escapeHtml(macro?.name || '')}">
      </div>

      <div class="field">
        <label for="event">${escapeHtml(tr('srv.trigger'))}</label>
        <select id="event">
          ${state.meta.events
            .map(
              (entry) =>
                `<option value="${entry.type}" ${entry.type === event ? 'selected' : ''}>${escapeHtml(
                  entry.label
                )}</option>`
            )
            .join('')}
        </select>
      </div>

      ${
        event === 'timer'
          ? `<div class="field"><label for="interval">${escapeHtml(tr('srv.intervalSec'))}</label>
              <input id="interval" type="number" min="5" max="86400"
                value="${macro?.config?.interval_sec ?? 300}"></div>`
          : ''
      }
      ${
        event === 'chat'
          ? `<div class="field"><label for="contains">${escapeHtml(tr('srv.chatContains'))}</label>
              <input id="contains" value="${escapeHtml(macro?.config?.contains || '')}">
              <span class="hint">${escapeHtml(tr('srv.chatContainsHint'))}</span></div>
             <div class="field"><label for="regex">${escapeHtml(tr('srv.chatRegex'))}</label>
              <input id="regex" value="${escapeHtml(macro?.config?.regex || '')}">
              <span class="hint">${escapeHtml(tr('srv.chatRegexHint'))}</span></div>`
          : ''
      }

      <div class="field">
        <label for="accounts">${escapeHtml(tr('ov.col.account'))}</label>
        <select id="accounts">
          <option value="">${escapeHtml(tr('common.all'))}</option>
          ${profile.accounts
            .map(
              (member) =>
                `<option value="${member.account_id}" ${
                  macro?.accounts?.length === 1 && macro.accounts[0] === member.account_id ? 'selected' : ''
                }>${escapeHtml(member.name)}</option>`
            )
            .join('')}
        </select>
      </div>

      <div>
        <div class="row spread" style="margin-bottom:.5rem">
          <span class="strong small">${escapeHtml(tr('srv.steps'))}</span>
          <button class="btn btn-sm" id="add-step">${icon('plus')}</button>
        </div>
        <div class="stack" id="steps">${
          actions.map(stepRow).join('') || `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`
        }</div>
      </div>`;

    $('#event', dialog).addEventListener('change', paint);
    $('#add-step', dialog).addEventListener('click', () => {
      actions.push({ type: 'chat', text: '' });
      paint();
    });
    bindSteps();
  };

  function stepRow(action, index) {
    const definition = available.find((entry) => entry.type === action.type) || available[0];
    const fields = (definition.fields || [])
      .map((field) => {
        const value = action[field.key] ?? (field.type === 'number' ? field.min ?? 1 : '');
        if (field.type === 'select') {
          return `<div class="field"><label>${escapeHtml(field.label)}</label>
            <select data-step="${index}" data-key="${field.key}">
              ${field.options
                .map(
                  (option) =>
                    `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(
                      option
                    )}</option>`
                )
                .join('')}</select></div>`;
        }
        return `<div class="field"><label>${escapeHtml(field.label)}</label>
          <input data-step="${index}" data-key="${field.key}" type="${
            field.type === 'number' ? 'number' : 'text'
          }" value="${escapeHtml(value)}"
            ${field.min !== undefined ? `min="${field.min}"` : ''}
            ${field.max !== undefined ? `max="${field.max}"` : ''}></div>`;
      })
      .join('');

    return `<div class="card tight">
      <div class="row spread">
        <div class="row">
          <span class="mono small muted">${String(index + 1).padStart(2, '0')}</span>
          <select data-step="${index}" data-key="type" style="width:auto">
            ${available
              .map(
                (entry) =>
                  `<option value="${entry.type}" ${entry.type === action.type ? 'selected' : ''}>${escapeHtml(
                    entry.label
                  )}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-ghost btn-sm" data-down="${index}" ${
            index === actions.length - 1 ? 'disabled' : ''
          }>↓</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-del-step="${index}">${icon('x')}</button>
        </div>
      </div>
      ${fields ? `<div class="row wrap" style="margin-top:.6rem;align-items:flex-end">${fields}</div>` : ''}
      <div class="field" style="margin-top:.6rem;max-width:12rem">
        <label>${escapeHtml(tr('srv.waitBefore'))}</label>
        <input data-step="${index}" data-key="delay" type="number" min="0" max="3600" value="${
          action.delay ?? 0
        }">
      </div>
    </div>`;
  }

  function bindSteps() {
    $$('[data-step]', dialog).forEach((input) =>
      input.addEventListener('change', () => {
        const index = Number(input.dataset.step);
        const key = input.dataset.key;
        if (key === 'type') {
          actions[index] = { type: input.value };
          paint();
          return;
        }
        const value = input.type === 'number' ? Number(input.value) : input.value;
        if (key === 'delay' && !value) delete actions[index].delay;
        else actions[index][key] = value;
      })
    );
    $$('[data-del-step]', dialog).forEach((button) =>
      button.addEventListener('click', () => {
        actions.splice(Number(button.dataset.delStep), 1);
        paint();
      })
    );
    $$('[data-up]', dialog).forEach((button) =>
      button.addEventListener('click', () => {
        const index = Number(button.dataset.up);
        [actions[index - 1], actions[index]] = [actions[index], actions[index - 1]];
        paint();
      })
    );
    $$('[data-down]', dialog).forEach((button) =>
      button.addEventListener('click', () => {
        const index = Number(button.dataset.down);
        [actions[index + 1], actions[index]] = [actions[index], actions[index + 1]];
        paint();
      })
    );
  }

  paint();

  $('#save', dialog).addEventListener('click', async () => {
    const event = $('#event', dialog).value;
    const config = {};
    if (event === 'timer') config.interval_sec = Number($('#interval', dialog).value);
    if (event === 'chat') {
      // Beide Felder mitschicken, sonst verschwindet beim Speichern still, was gerade nicht
      // im Formular stand.
      config.contains = $('#contains', dialog).value.trim();
      config.regex = $('#regex', dialog).value.trim();
    }
    const accountValue = $('#accounts', dialog).value;

    const body = {
      name: $('#name', dialog).value,
      event,
      config,
      accounts: accountValue ? [Number(accountValue)] : [],
      actions: actions.map((action) => {
        const clean = { type: action.type };
        if (action.delay) clean.delay = Number(action.delay);
        for (const field of state.meta.actions.find((entry) => entry.type === action.type)?.fields || []) {
          clean[field.key] =
            field.type === 'number' ? Number(action[field.key] ?? field.min ?? 1) : action[field.key] ?? '';
        }
        return clean;
      }),
    };

    try {
      if (macro) await api(`/profiles/${profile.id}/macros/${macro.id}`, { method: 'PATCH', body });
      else await api(`/profiles/${profile.id}/macros`, { method: 'POST', body });
      dialog.close();
      ok(tr('srv.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });
}

// ---------------------------------------------------------------- Tarif

/**
 * Die Merkmale eines Tarifs, wie sie im Kasten stehen.
 *
 * Hat der Betreiber im Admin-Bereich einen eigenen Text hinterlegt, steht genau der da – wie auf
 * der Preisseite auch. Sonst baut sich die Liste aus den Zahlen des Tarifs.
 */
function planLines(plan) {
  if (plan.features?.length) return plan.features;
  const lines = [
    `${plan.max_accounts} ${tr(plan.max_accounts === 1 ? 'pricing.bot' : 'pricing.bots')}`,
    tr(plan.premium ? 'pricing.premiumClient' : 'pricing.slimClient'),
    // Mit Tausendertrennzeichen wie überall sonst: "50000 Zeilen Chatverlauf" stand hier als
    // nackte Zahl, auf der Preisseite daneben aber als "50.000".
    `${credits(plan.chat_limit)} ${tr('pricing.chatHistory')}`,
  ];
  if (plan.board) lines.push(tr('pricing.board'));
  if (plan.menus) lines.push(tr('pricing.menus'));
  if (plan.proxy) lines.push(tr('pricing.proxyOnRequest'));
  if (plan.priority_support) lines.push(tr('pricing.prioritySupport'));
  return lines;
}

async function tabPlan(root, profile) {
  const plans = state.meta.plans || [];
  const freeLeft = state.stats?.free_slots_left ?? 0;

  root.innerHTML = `
    <div class="grid four" style="margin-bottom:1.5rem">
      <div class="stat"><div class="k">${escapeHtml(tr('srv.plan'))}</div>
        <div class="v" style="font-size:1.5rem">${escapeHtml(profile.plan.name)}</div>
        <div class="s">${
          profile.plan.free_slot
            ? escapeHtml(tr('common.forever'))
            : `${credits(profile.plan.price_credits)} / ${state.meta.month_days} ${escapeHtml(tr('common.days'))}`
        }</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('common.status'))}</div>
        <div class="v" style="font-size:1.5rem">${
          profile.suspended ? escapeHtml(tr('tk.status.closed')) : escapeHtml(tr('state.online'))
        }</div>
        <div class="s">${
          profile.paid_until ? escapeHtml(tr('srv.daysLeft', { n: profile.days_left })) : '–'
        }</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('common.month'))}</div>
        <div class="v" style="font-size:1.5rem">${
          profile.paid_until ? date(profile.paid_until) : '–'
        }</div>
        <div class="s">${escapeHtml(profile.renew ? tr('srv.renewOn') : tr('srv.renewOff'))}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('ov.builds'))}</div>
        <div class="v" style="font-size:1.5rem">${escapeHtml(profile.build || '–')}</div>
        <div class="s">${Object.keys(profile.caps)
          .filter((key) => profile.caps[key])
          .slice(0, 4)
          .map(escapeHtml)
          .join(', ')}</div></div>
    </div>

    ${
      profile.suspended
        ? `<div class="note warn" style="margin-bottom:1.25rem">${icon('alert')}
            <div>${escapeHtml(tr('srv.suspended'))}</div></div>
           <button class="btn btn-primary" id="resume" style="margin-bottom:1.5rem">${escapeHtml(
             tr('srv.resume')
           )}</button>`
        : ''
    }

    <div class="plans-grid">
      ${plans
        .map(
          (plan) => `<article class="card ${plan.id === profile.plan.id ? 'is-current' : ''}">
            <div class="row spread">
              <h3>${escapeHtml(plan.name)}</h3>
              ${
                plan.id === profile.plan.id
                  ? `<span class="pill primary">${escapeHtml(tr('common.status'))}</span>`
                  : ''
              }
            </div>
            <p class="price-line">${
              plan.free_slot
                ? escapeHtml(tr('common.free'))
                : `${escapeHtml(euro(plan.price_credits))} <span class="small muted">${escapeHtml(
                    tr('pricing.perServer')
                  )}</span>`
            }</p>
            ${
              plan.free_slot
                ? ''
                : `<p class="small muted" style="margin:.2rem 0 0">${credits(
                    plan.price_credits
                  )} ${escapeHtml(tr('common.creditsInline'))}</p>`
            }
            <p class="small muted">${escapeHtml(plan.blurb || '')}</p>
            <ul class="plan-list grow">${planLines(plan)
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join('')}</ul>
            ${
              plan.id === profile.plan.id
                ? ''
                : `<button class="btn btn-primary btn-block" style="margin-top:1.25rem"
                     data-plan="${plan.id}"
                     ${plan.free_slot && freeLeft <= 0 ? 'disabled' : ''}>${escapeHtml(
                       tr('srv.changePlan')
                     )}</button>`
            }
          </article>`
        )
        .join('')}
    </div>

    ${
      profile.addons?.length
        ? `<section class="panel" style="margin-top:1.5rem">
            <header><h3>${escapeHtml(tr('ad.title'))}</h3>
              <a class="btn btn-sm" href="#/servers/${profile.id}/addons">${escapeHtml(tr('common.edit'))}</a></header>
            <div class="body stack">
              ${profile.addons
                .map(
                  (addon) => `<div class="row spread">
                    <span>${escapeHtml(addon.name)}${addon.qty > 1 ? ` · ${addon.qty}×` : ''}</span>
                    <span class="mono">${credits(addon.price_credits)}</span>
                  </div>`
                )
                .join('')}
              <hr class="rule">
              <div class="row spread strong">
                <span>${escapeHtml(tr('ad.monthlyAfter'))}</span>
                <span class="mono">${credits(profile.monthly_credits)} · ${escapeHtml(
                  euro(profile.monthly_credits)
                )}</span>
              </div>
            </div>
          </section>`
        : ''
    }

    ${
      profile.node
        ? `<section class="panel" style="margin-top:1.5rem">
            <header><h3>${escapeHtml(tr('nd.title'))}</h3></header>
            <div class="body row spread wrap" style="gap:1rem">
              <div>
                <div class="row" style="gap:.5rem">${icon('pin')}
                  <span class="strong">${escapeHtml(profile.node.name)}</span>
                  ${profile.node.region ? `<span class="pill">${escapeHtml(profile.node.region)}</span>` : ''}</div>
                <p class="small muted" style="margin:.4rem 0 0;max-width:34rem">${escapeHtml(
                  profile.node.note || tr('nd.sub')
                )}</p>
              </div>
              <button class="btn btn-sm" id="change-node">${escapeHtml(tr('nd.change'))}</button>
            </div>
          </section>`
        : ''
    }

    ${
      profile.plan.free_slot
        ? ''
        : `<section class="panel" style="margin-top:1.5rem">
            <header><h3>${escapeHtml(tr('srv.renewOn'))}</h3></header>
            <div class="body row spread">
              <p class="small muted" style="max-width:34rem">${escapeHtml(tr('faq.3.a'))}</p>
              <span class="switch" role="switch" tabindex="0" aria-checked="${profile.renew}"
                data-renew="${profile.id}"></span>
            </div>
          </section>`
    }`;

  $('#resume')?.addEventListener('click', async () => {
    try {
      await api(`/profiles/${profile.id}/resume`, { method: 'POST' });
      await refresh({ accounts: false });
      ok(tr('srv.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-plan]').forEach((button) =>
    button.addEventListener('click', async () => {
      const plan = plans.find((entry) => entry.id === Number(button.dataset.plan));
      const question = plan.free_slot
        ? tr('srv.changePlan')
        : `${tr('srv.changePlan')}: ${plan.name} — ${plan.price_credits} ${tr('common.credits')}`;
      if (!(await confirmDialog(question, { confirm: tr('srv.changePlan'), danger: false }))) return;
      try {
        await api(`/profiles/${profile.id}/plan`, { method: 'POST', body: { plan_id: plan.id } });
        await refresh({ accounts: false });
        ok(tr('srv.planChanged'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $('#change-node')?.addEventListener('click', async () => {
    const { nodes } = await api('/nodes');
    const options = nodes
      .filter((node) => !node.full || node.id === profile.node?.id)
      .map((node) => ({
        value: String(node.id),
        label: `${node.name}${node.region ? ` · ${node.region}` : ''}`,
      }));
    if (!options.length) return toast(tr('common.none'));
    const answer = await formDialog(
      tr('nd.change'),
      [
        { type: 'note', key: 'note', label: tr('nd.changeHint') },
        {
          key: 'node_id',
          label: tr('nd.title'),
          type: 'select',
          value: String(profile.node?.id || options[0].value),
          options,
        },
      ],
      { submit: tr('nd.change') }
    );
    if (!answer) return;
    try {
      await api(`/profiles/${profile.id}/node`, { method: 'POST', body: { node_id: Number(answer.node_id) } });
      await refresh({ accounts: false });
      ok(tr('srv.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  bindSwitches('[data-renew]', (id, enabled) =>
    api(`/profiles/${id}`, { method: 'PATCH', body: { renew: enabled } })
  );
}

// ---------------------------------------------------------------- Einstellungen

async function tabSettings(root, profile) {
  const plan = profile.plan;

  root.innerHTML = `
    <div class="grid two">
      <section class="panel">
        <header><h3>${escapeHtml(tr('dash.servers'))}</h3></header>
        <div class="body stack">
          <div class="field"><label for="name">${escapeHtml(tr('srv.name'))}</label>
            <input id="name" value="${escapeHtml(profile.name)}"></div>
          <div class="field"><label for="address">${escapeHtml(tr('srv.address'))}</label>
            <input id="address" value="${escapeHtml(profile.address)}">
            <span class="hint">${escapeHtml(tr('srv.addressHint'))}</span></div>
          <div class="field"><label for="mc_version">${escapeHtml(tr('srv.version'))}</label>
            <select id="mc_version">${state.meta.versions
              .map(
                (version) =>
                  `<option ${version === profile.mc_version ? 'selected' : ''}>${escapeHtml(version)}</option>`
              )
              .join('')}</select></div>
          <div class="field"><label for="chat_limit">${escapeHtml(tr('srv.chatLimit'))}</label>
            <input id="chat_limit" type="number" min="20" max="${plan.chat_limit}"
              value="${profile.chat_limit}" ${plan.chat_limit_editable ? '' : 'disabled'}>
            <span class="hint">${escapeHtml(
              plan.chat_limit_editable
                ? `≤ ${plan.chat_limit}`
                : tr('srv.chatLimitLocked', { n: plan.chat_limit })
            )}</span></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.behaviour'))}</h3></header>
        <div class="body stack">
          <div class="field"><label for="join_delay">${escapeHtml(tr('srv.joinDelay'))}</label>
            <input id="join_delay" type="number" min="0" max="600" value="${profile.join_delay}"></div>
          <div class="note">${icon('info')}<div>${escapeHtml(tr('srv.disconnectStops'))}</div></div>
          <div class="field"><label for="chat_delay">${escapeHtml(tr('srv.chatDelay'))}</label>
            <input id="chat_delay" type="number" min="200" max="60000" value="${profile.chat_delay}"></div>
          <div class="field"><label for="on_cooldown">${escapeHtml(tr('srv.onCooldown'))}</label>
            <input id="on_cooldown" type="number" min="1" max="3600" value="${profile.on_cooldown || 5}">
            <span class="hint">${escapeHtml(tr('srv.onCooldownHint'))}</span></div>
          <!-- Sichtweite. Für einen Bot, der nur dastehen soll, ist sie eine Zahl ohne Wirkung;
               für die Live-Ansicht ist sie die eine Zahl, die zählt. Deshalb steht der Grund
               daneben und nicht nur die Einheit. -->
          <div class="field"><label for="view_distance">${escapeHtml(tr('srv.viewDistance'))}</label>
            <input id="view_distance" type="number" min="0" max="32" value="${profile.view_distance || 0}"
              ${plan.premium ? '' : 'disabled'}>
            <span class="hint">${escapeHtml(tr('srv.viewDistanceHint'))}</span></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('tab.movement'))}</h3>
          ${plan.premium ? '' : `<span class="pill missing">${escapeHtml(tr('common.paidSlot'))}</span>`}
        </header>
        <div class="body stack">
          <label class="check"><input type="checkbox" id="movement" ${profile.movement ? 'checked' : ''}
            ${plan.movement ? '' : 'disabled'}> ${escapeHtml(tr('srv.useMovement'))}</label>
          <div class="field"><label for="antiafk_sec">${escapeHtml(tr('srv.antiafk'))} (s)</label>
            <input id="antiafk_sec" type="number" min="0" max="3600" value="${profile.antiafk_sec || 0}"
              ${plan.premium ? '' : 'disabled'}>
            <span class="hint">${escapeHtml(tr('srv.antiafkHint'))}</span></div>
          <label class="check"><input type="checkbox" id="sneak" ${profile.sneak ? 'checked' : ''}
            ${plan.premium ? '' : 'disabled'}> ${escapeHtml(tr('srv.sneakAlways'))}</label>
          ${plan.premium ? '' : `<p class="small muted">${escapeHtml(tr('srv.premiumOnly'))}</p>`}
        </div>
      </section>

    </div>

    <div class="row" style="margin-top:1.25rem">
      <button class="btn btn-primary" id="save">${escapeHtml(tr('common.save'))}</button>
      <span class="small muted" id="hint"></span>
    </div>

    <section class="panel" style="margin-top:2rem">
      <header><h3>${escapeHtml(tr('srv.danger'))}</h3></header>
      <div class="body row spread wrap" style="gap:1rem">
        <p class="small muted" style="max-width:38rem">${escapeHtml(tr('srv.deleteHint'))}</p>
        <button class="btn btn-danger" id="delete">${icon('trash')} ${escapeHtml(tr('common.delete'))}</button>
      </div>
    </section>`;

  $('#save').addEventListener('click', async () => {
    const body = {
      name: $('#name').value,
      address: $('#address').value,
      mc_version: $('#mc_version').value,
      join_delay: Number($('#join_delay').value),
      chat_delay: Number($('#chat_delay').value),
      on_cooldown: Number($('#on_cooldown').value),
    };
    if (plan.chat_limit_editable) body.chat_limit = Number($('#chat_limit').value);
    if (plan.movement) body.movement = $('#movement').checked;
    if (plan.premium) {
      body.antiafk_sec = Number($('#antiafk_sec').value);
      body.sneak = $('#sneak').checked;
      body.view_distance = Number($('#view_distance').value);
    }

    try {
      const result = await api(`/profiles/${profile.id}`, { method: 'PATCH', body });
      await refresh({ accounts: false });
      ok(tr('srv.saved'));
      $('#hint').textContent = result.restart_needed ? tr('srv.restartNeeded') : '';
    } catch (error) {
      fail(error);
    }
  });

  $('#delete').addEventListener('click', async () => {
    if (!(await confirmDialog(tr('srv.deleteAsk', { name: profile.name }), { confirm: tr('common.delete') })))
      return;
    await api(`/profiles/${profile.id}`, { method: 'DELETE' });
    await refresh();
    location.hash = '#/servers';
    draw();
  });
}

/** Schalter, die sofort speichern – mit Tastatur bedienbar. */
function bindSwitches(selector, save) {
  $$(selector).forEach((node) => {
    const key = Object.values(node.dataset)[0];
    const toggle = async () => {
      const enabled = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(enabled));
      try {
        await save(key, enabled);
      } catch (error) {
        node.setAttribute('aria-checked', String(!enabled));
        fail(error);
      }
    };
    node.addEventListener('click', toggle);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });
}
