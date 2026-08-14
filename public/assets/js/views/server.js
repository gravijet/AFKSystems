// Serverprofile: Liste, Anlegen – und die Registerkarten eines Profils.

import {
  api, icon, escapeHtml, since, clock, stateBadge, $, $$, ok, fail, toast,
  confirmDialog, formDialog, debounce,
} from '../ui.js';
import { state, appbar, refresh, draw, profileById, TABS, linesOf } from '../app.js';

export async function render(root, route) {
  if (route.name === 'server') return renderList(root);
  return renderProfile(root, route);
}

// ---------------------------------------------------------------- Liste

async function renderList(root) {
  root.innerHTML = `
    ${appbar('Serverprofile', `<button class="btn btn-primary btn-sm" id="add">${icon('plus')} Serverprofil</button>`,
      'Ein Profil ist ein Server samt Einstellungen')}
    ${
      state.profiles.length
        ? `<div class="grid two">${state.profiles.map(card).join('')}</div>`
        : `<div class="empty"><h3>Noch kein Serverprofil</h3>
            <p>Leg den ersten Server an: Adresse, Minecraft-Version, und was beim Beitritt passieren soll.</p>
            <button class="btn btn-primary" id="add-2">${icon('plus')} Serverprofil anlegen</button></div>`
    }`;

  $('#add')?.addEventListener('click', newProfile);
  $('#add-2')?.addEventListener('click', newProfile);
}

function card(profile) {
  return `<a class="card" href="#/server/${profile.id}/verbinden" style="display:block">
    <div class="row spread">
      <div class="row">
        <span class="dot ${profile.online ? 'live' : ''}"
          style="color:${profile.online ? 'var(--ok)' : 'var(--text-2)'}"></span>
        <div>
          <div class="strong">${escapeHtml(profile.name)}</div>
          <div class="small muted mono">${escapeHtml(profile.address)}</div>
        </div>
      </div>
      <span class="pill">MC ${escapeHtml(profile.mc_version)}</span>
    </div>
    <div class="row spread" style="margin-top:1rem">
      <span class="small muted">${profile.online} von ${profile.total} Konten im Spiel</span>
      <span class="small" style="color:var(--primary)">Öffnen ${icon('arrow')}</span>
    </div>
  </a>`;
}

export async function newProfile() {
  const data = await formDialog(
    'Serverprofil anlegen',
    [
      { key: 'name', label: 'Name', placeholder: 'z. B. HugoSMP', value: '' },
      {
        key: 'address',
        label: 'Serveradresse',
        placeholder: 'hugosmp.net oder hugosmp.net:25565',
        hint: 'Ohne Port fragt der Client den SRV-Eintrag ab.',
        value: '',
      },
      {
        key: 'mc_version',
        label: 'Minecraft-Version',
        type: 'select',
        value: state.meta.default_version,
        options: state.meta.versions,
      },
      {
        key: 'runtime',
        label: 'Bauform',
        type: 'select',
        value: 'rust',
        options: [
          { value: 'rust', label: 'Rust – eine Datei, sparsam (empfohlen)' },
          { value: 'java', label: 'Java – eine Jar je Version' },
        ],
      },
    ],
    { submit: 'Anlegen' }
  );
  if (!data) return;
  try {
    const result = await api('/profiles', { method: 'POST', body: data });
    await refresh();
    ok('Serverprofil angelegt.');
    location.hash = `#/server/${result.profile.id}/verbinden`;
    draw();
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------- Profil

async function renderProfile(root, route) {
  let profile = profileById(route.id);
  if (!profile) {
    await refresh({ accounts: false });
    profile = profileById(route.id);
  }
  if (!profile) {
    root.innerHTML = `<div class="empty"><h3>Dieses Serverprofil gibt es nicht</h3>
      <p>Vielleicht wurde es gelöscht.</p><a class="btn" href="#/server">Zur Übersicht</a></div>`;
    return;
  }

  const tabs = TABS.map(
    (tab) =>
      `<a class="${route.tab === tab.key ? 'active' : ''}" href="#/server/${profile.id}/${tab.key}">${tab.label}</a>`
  ).join('');

  root.innerHTML = `
    ${appbar(
      profile.name,
      `<span class="pill">MC ${escapeHtml(profile.mc_version)}</span>
       <span class="pill">${profile.online}/${profile.total} online</span>`,
      `<span class="mono">${escapeHtml(profile.address)}</span>`
    )}
    <nav class="tabs">${tabs}</nav>
    <div id="tab-body"></div>`;

  const body = $('#tab-body');
  const views = {
    verbinden: tabConnect,
    chat: tabChat,
    bewegung: tabMovement,
    inventar: tabInventory,
    pov: tabPov,
    proxys: tabProxies,
    macros: tabMacros,
    einstellungen: tabSettings,
  };
  await (views[route.tab] || tabConnect)(body, profile);
}

// ---------------------------------------------------------------- Verbinden

async function tabConnect(root, profile) {
  const free = state.accounts.filter(
    (account) => !profile.accounts.some((member) => member.account_id === account.id)
  );

  const draw2 = () => {
    // Wartet ein Bot auf eine neue Microsoft-Anmeldung, gehört der Code nach ganz oben – sonst
    // sucht man ihn im Chatverlauf.
    const waiting = profile.accounts
      .map((member) => state.bots.get(`${profile.id}:${member.account_id}`))
      .filter((bot) => bot && bot.state === 'auth' && bot.auth?.code);

    root.innerHTML = `
      ${waiting
        .map(
          (bot) => `<div class="note warn" style="margin-bottom:1rem">${icon('key')}
            <div><strong>${escapeHtml(bot.account)} braucht eine neue Anmeldung.</strong>
            Öffne <a href="${escapeHtml(bot.auth.uri || 'https://www.microsoft.com/link')}" target="_blank"
              rel="noopener" style="color:var(--primary)">microsoft.com/link</a> und gib den Code
            <span class="mono strong" style="letter-spacing:.1em">${escapeHtml(bot.auth.code)}</span> ein.
            Der Bot verbindet danach von selbst weiter.</div></div>`
        )
        .join('')}

      <div class="row wrap" style="margin-bottom:1rem">
        <button class="btn btn-primary btn-sm" id="start">${icon('play')} Ausgewählte starten</button>
        <button class="btn btn-sm" id="stop">${icon('stop')} Ausgewählte stoppen</button>
        <button class="btn btn-sm" id="restart">${icon('refresh')} Neu starten</button>
        <div class="grow"></div>
        <button class="btn btn-sm" id="attach" ${free.length ? '' : 'disabled'}>${icon('plus')} Konto hinzufügen</button>
      </div>

      ${
        profile.accounts.length
          ? `<section class="panel"><div class="table-wrap"><table class="table">
              <thead><tr>
                <th style="width:2rem"><input type="checkbox" id="all" aria-label="Alle auswählen"></th>
                <th>Konto</th><th>Zustand</th><th>Läuft seit</th><th>Notiz</th><th></th>
              </tr></thead>
              <tbody>${profile.accounts.map(row).join('')}</tbody>
            </table></div></section>`
          : `<div class="empty"><h3>Diesem Profil ist noch kein Konto zugeordnet</h3>
              <p>Ordne ein verbundenes Minecraft-Konto zu, dann kannst du es hier starten.</p>
              ${
                state.accounts.length
                  ? `<button class="btn btn-primary" id="attach-2">${icon('plus')} Konto hinzufügen</button>`
                  : `<a class="btn btn-primary" href="#/konten">${icon('users')} Erst ein Konto verbinden</a>`
              }
            </div>`
      }`;

    $('#all')?.addEventListener('change', (event) => {
      $$('[data-pick]').forEach((box) => {
        box.checked = event.target.checked;
      });
    });

    $('#start')?.addEventListener('click', () => act('start'));
    $('#stop')?.addEventListener('click', () => act('stop'));
    $('#restart')?.addEventListener('click', () => act('restart'));
    $('#attach')?.addEventListener('click', attach);
    $('#attach-2')?.addEventListener('click', attach);

    $$('[data-toggle]').forEach((button) =>
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.toggle);
        const member = profile.accounts.find((entry) => entry.account_id === accountId);
        button.disabled = true;
        try {
          if (member.state && member.state !== 'offline') {
            await api(`/profiles/${profile.id}/stop`, { method: 'POST', body: { accounts: [accountId] } });
          } else {
            const result = await api(`/profiles/${profile.id}/start`, {
              method: 'POST',
              body: { accounts: [accountId] },
            });
            const failed = result.results.find((entry) => !entry.ok);
            if (failed) throw new Error(failed.error);
          }
        } catch (error) {
          fail(error);
        } finally {
          button.disabled = false;
        }
      })
    );

    $$('[data-note]').forEach((button) =>
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.note);
        const member = profile.accounts.find((entry) => entry.account_id === accountId);
        const data = await formDialog('Notiz', [
          { key: 'note', label: `Notiz zu ${member.name}`, value: member.note || '' },
        ]);
        if (!data) return;
        await api(`/profiles/${profile.id}/accounts/${accountId}`, { method: 'PATCH', body: data });
        await refresh({ accounts: false });
        draw();
      })
    );

    $$('[data-detach]').forEach((button) =>
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.detach);
        const member = profile.accounts.find((entry) => entry.account_id === accountId);
        if (!(await confirmDialog(`"${member.name}" aus diesem Profil entfernen?`, { confirm: 'Entfernen' }))) return;
        await api(`/profiles/${profile.id}/accounts/${accountId}`, { method: 'DELETE' });
        await refresh({ accounts: false });
        draw();
      })
    );
  };

  function row(member) {
    const bot = state.bots.get(`${profile.id}:${member.account_id}`) || member;
    const running = bot.state && bot.state !== 'offline';
    return `<tr>
      <td><input type="checkbox" data-pick="${member.account_id}" aria-label="${escapeHtml(member.name)}"></td>
      <td><span class="row"><img class="head" src="${escapeHtml(member.head)}" alt="" loading="lazy">
        <span>${escapeHtml(member.name)}
        ${member.account_status === 'error' ? '<span class="pill missing" style="margin-left:.4rem">Anmeldung nötig</span>' : ''}
        </span></span></td>
      <td>${stateBadge(bot.state || 'offline', bot.detail || bot.last_error || '')}</td>
      <td class="mono small muted">${running && bot.since ? since(bot.since) : '–'}</td>
      <td class="small muted">${escapeHtml(member.note || '')}
        <button class="btn btn-ghost btn-sm" data-note="${member.account_id}" title="Notiz bearbeiten">${icon('settings')}</button></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm ${running ? '' : 'btn-primary'}" data-toggle="${member.account_id}">
          ${running ? 'Stoppen' : 'Starten'}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-detach="${member.account_id}" title="Aus Profil entfernen">${icon('x')}</button>
      </td>
    </tr>`;
  }

  function picked() {
    const ids = $$('[data-pick]:checked').map((box) => Number(box.dataset.pick));
    return ids.length ? ids : profile.accounts.map((member) => member.account_id);
  }

  async function act(what) {
    const accounts = picked();
    if (!accounts.length) return toast('Diesem Profil ist kein Konto zugeordnet.');
    try {
      const result = await api(`/profiles/${profile.id}/${what}`, { method: 'POST', body: { accounts } });
      const failures = (result.results || []).filter((entry) => !entry.ok);
      for (const failure of failures) {
        const member = profile.accounts.find((entry) => entry.account_id === failure.account_id);
        toast(`${member?.name || failure.account_id}: ${failure.error}`, 'bad');
      }
      if (!failures.length) ok(what === 'stop' ? 'Gestoppt.' : 'Läuft.');
    } catch (error) {
      fail(error);
    }
  }

  async function attach() {
    if (!free.length) return toast('Alle verbundenen Konten sind schon zugeordnet.');
    const data = await formDialog(
      'Konto hinzufügen',
      [
        {
          key: 'account_id',
          label: 'Konto',
          type: 'select',
          value: free[0].id,
          options: free.map((account) => ({ value: account.id, label: account.name })),
        },
        { key: 'note', label: 'Notiz (optional)', value: '' },
      ],
      { submit: 'Hinzufügen' }
    );
    if (!data) return;
    await api(`/profiles/${profile.id}/accounts`, {
      method: 'POST',
      body: { account_id: Number(data.account_id), note: data.note },
    });
    await refresh({ accounts: false });
    draw();
  }

  draw2();

  const redraw = debounce(async () => {
    if (state.route.tab !== 'verbinden') return;
    await refresh({ accounts: false });
    const fresh = profileById(profile.id);
    if (fresh) {
      profile.accounts = fresh.accounts;
      profile.online = fresh.online;
      draw2();
    }
  }, 500);
  state.onLive = (event) => {
    if (event.type === 'state') redraw();
  };
}

// ---------------------------------------------------------------- Chat

async function tabChat(root, profile) {
  const members = profile.accounts;
  if (!members.length) {
    root.innerHTML = `<div class="empty"><h3>Kein Konto zugeordnet</h3>
      <p>Chat gibt es, sobald diesem Profil ein Konto zugeordnet ist und läuft.</p>
      <a class="btn btn-primary" href="#/server/${profile.id}/verbinden">Zu "Verbinden"</a></div>`;
    return;
  }

  const spam = (await api(`/profiles/${profile.id}/spam`)).spam;
  const receiverKey = `afk-chat-recv-${profile.id}`;
  let receivers = JSON.parse(localStorage.getItem(receiverKey) || '[]');
  if (!receivers.length) receivers = members.map((member) => member.account_id);

  root.innerHTML = `
    <div class="grid" style="grid-template-columns:1fr;gap:1.25rem">
      <section class="panel">
        <header>
          <h3>Chat</h3>
          <div class="row">
            <label class="check small"><input type="checkbox" id="autoscroll" checked> Mitlaufen</label>
            <button class="btn btn-ghost btn-sm" id="clear">Leeren</button>
          </div>
        </header>
        <div class="body" style="padding:0">
          <div class="row wrap" style="padding:.75rem 1.1rem;box-shadow:inset 0 -1px 0 var(--line-soft)">
            <span class="small muted">Zeigt:</span>
            ${members
              .map(
                (member) => `<label class="check small">
                  <input type="checkbox" data-recv="${member.account_id}"
                    ${receivers.includes(member.account_id) ? 'checked' : ''}>
                  ${escapeHtml(member.name)}</label>`
              )
              .join('')}
          </div>
          <div class="console" id="chat" style="height:min(52vh,32rem);border-radius:0;box-shadow:none"></div>
          <div class="row" style="padding:.75rem 1.1rem;gap:.5rem">
            <input type="text" id="msg" placeholder="Nachricht oder /befehl – Enter sendet"
              autocomplete="off" aria-label="Nachricht">
            <select id="sender" style="width:auto;min-width:9rem" aria-label="Senden als">
              <option value="">alle ausgewählten</option>
              ${members.map((member) => `<option value="${member.account_id}">${escapeHtml(member.name)}</option>`).join('')}
            </select>
            <button class="btn btn-primary" id="send">Senden</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>Wiederholte Nachrichten</h3>
          <button class="btn btn-sm btn-primary" id="add-spam">${icon('plus')} Hinzufügen</button></header>
        <div class="body" style="padding:0">
          ${
            spam.length
              ? `<div class="table-wrap"><table class="table">
                  <thead><tr><th>Nachricht</th><th>Takt</th><th>Konten</th><th>Aktiv</th><th></th></tr></thead>
                  <tbody>${spam.map(spamRow).join('')}</tbody></table></div>`
              : `<p class="muted small" style="padding:1.25rem">Noch nichts eingerichtet. Typisch:
                 <span class="mono">/afk</span> alle 300 Sekunden, damit der Server dich nicht als untätig wegwirft.</p>`
          }
        </div>
      </section>
    </div>`;

  function spamRow(entry) {
    const names = entry.accounts.length
      ? entry.accounts
          .map((id) => members.find((member) => member.account_id === id)?.name || id)
          .join(', ')
      : 'alle';
    return `<tr>
      <td class="mono">${escapeHtml(entry.message)}</td>
      <td class="mono small">alle ${entry.interval_sec} s</td>
      <td class="small muted">${escapeHtml(names)}</td>
      <td><span class="switch" role="switch" tabindex="0" aria-checked="${entry.enabled}" data-spam-toggle="${entry.id}"></span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" data-spam-test="${entry.id}">Jetzt senden</button>
        <button class="btn btn-sm" data-spam-edit="${entry.id}">Ändern</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-spam-del="${entry.id}">${icon('trash')}</button>
      </td>
    </tr>`;
  }

  const box = $('#chat');
  const autoscroll = $('#autoscroll');

  const paint = () => {
    const lines = [];
    for (const member of members) {
      if (!receivers.includes(member.account_id)) continue;
      for (const entry of linesOf(`${profile.id}:${member.account_id}`)) {
        lines.push({ ...entry, who: member.name });
      }
    }
    lines.sort((a, b) => a.t - b.t);
    box.innerHTML = lines
      .slice(-400)
      .map(
        (entry) => `<div class="line ${entry.type}">
          <span class="t">${clock(entry.t)}</span>
          ${members.length > 1 ? `<span class="who">${escapeHtml(entry.who)}</span>` : ''}
          <span class="msg">${escapeHtml(entry.text)}</span></div>`
      )
      .join('');
    if (autoscroll.checked) box.scrollTop = box.scrollHeight;
  };

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
  paint();

  $$('[data-recv]').forEach((box2) =>
    box2.addEventListener('change', () => {
      receivers = $$('[data-recv]:checked').map((entry) => Number(entry.dataset.recv));
      localStorage.setItem(receiverKey, JSON.stringify(receivers));
      paint();
    })
  );

  $('#clear').addEventListener('click', () => {
    for (const member of members) state.lines.set(`${profile.id}:${member.account_id}`, []);
    paint();
  });

  const send = async () => {
    const input = $('#msg');
    const text = input.value.trim();
    if (!text) return;
    const sender = $('#sender').value;
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

  // Spam-Verwaltung
  $('#add-spam').addEventListener('click', () => editSpam(profile, members, null));
  $$('[data-spam-edit]').forEach((button) =>
    button.addEventListener('click', () =>
      editSpam(profile, members, spam.find((entry) => entry.id === Number(button.dataset.spamEdit)))
    )
  );
  $$('[data-spam-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog('Diese Wiederholung löschen?', { confirm: 'Löschen' }))) return;
      await api(`/profiles/${profile.id}/spam/${button.dataset.spamDel}`, { method: 'DELETE' });
      draw();
    })
  );
  $$('[data-spam-test]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/profiles/${profile.id}/spam/${button.dataset.spamTest}/test`, { method: 'POST' });
        ok('Gesendet.');
      } catch (error) {
        fail(error);
      }
    })
  );
  $$('[data-spam-toggle]').forEach((node) => {
    const toggle = async () => {
      const enabled = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(enabled));
      await api(`/profiles/${profile.id}/spam/${node.dataset.spamToggle}`, {
        method: 'PATCH',
        body: { enabled },
      }).catch(fail);
    };
    node.addEventListener('click', toggle);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });

  state.onLive = (event) => {
    if (event.type === 'line' && event.key.startsWith(`${profile.id}:`)) paint();
  };
}

async function editSpam(profile, members, entry) {
  const data = await formDialog(
    entry ? 'Wiederholung ändern' : 'Wiederholte Nachricht',
    [
      { key: 'message', label: 'Nachricht oder Befehl', value: entry?.message || '/afk' },
      {
        key: 'interval_sec',
        label: 'Alle … Sekunden',
        type: 'number',
        min: 5,
        max: 86400,
        value: entry?.interval_sec ?? 300,
        hint: 'Weniger als 5 Sekunden lässt der Server ohnehin nicht zu.',
      },
      {
        key: 'accounts',
        label: 'Konten',
        type: 'select',
        value: entry?.accounts?.length === 1 ? String(entry.accounts[0]) : '',
        options: [
          { value: '', label: 'Alle Konten dieses Profils' },
          ...members.map((member) => ({ value: String(member.account_id), label: member.name })),
        ],
      },
    ],
    { submit: entry ? 'Speichern' : 'Anlegen' }
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
    ok('Gespeichert.');
    draw();
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------- Bewegung

async function tabMovement(root, profile) {
  if (!profile.movement_ready) {
    root.innerHTML = `
      <div class="note warn" style="margin-bottom:1.25rem">${icon('alert')}
        <div><strong>Bewegung ist für dieses Profil aus.</strong>
        ${
          profile.movement
            ? 'Das Profil ist auf Bewegung gestellt, aber die Bewegungs-Bauform des Clients liegt nicht auf dem Server. Ein Administrator baut sie mit <span class="mono">scripts/build-movement.sh</span>.'
            : 'Der schlanke Client bewegt sich nie – das ist Absicht und der sicherste Betrieb. Für gesteuerte Bewegung stellst du das Profil auf die Bewegungs-Bauform um.'
        }</div></div>
      ${
        profile.movement
          ? ''
          : `<a class="btn btn-primary" href="#/server/${profile.id}/einstellungen">Zu den Einstellungen</a>`
      }
      <section class="panel" style="margin-top:1.5rem">
        <header><h3>Was die Bewegungs-Bauform kann</h3></header>
        <div class="body stack small muted">
          <div>Gehen in vier Richtungen, mit Blockangabe</div>
          <div>Blickrichtung setzen: Himmelsrichtung, relativ oder als Winkel</div>
          <div>Springen und kontrolliertes Fallen</div>
          <div>Heimatposition merken und nach jedem Beitritt dorthin zurücklaufen</div>
          <div>Route aufzeichnen und ablaufen</div>
          <div class="row" style="gap:.5rem;margin-top:.5rem">
            <span class="pill missing">Schleichen fehlt im Client</span>
            <span class="pill missing">Physik-Schalter fehlt im Client</span>
          </div>
        </div>
      </section>`;
    return;
  }

  const members = profile.accounts;
  root.innerHTML = `
    <div class="row wrap" style="margin-bottom:1rem">
      <span class="small muted">Gilt für:</span>
      ${members
        .map(
          (member) => `<label class="check small"><input type="checkbox" data-move-acc="${member.account_id}" checked>
            ${escapeHtml(member.name)}</label>`
        )
        .join('')}
    </div>

    <div class="grid two">
      <section class="panel">
        <header><h3>Gehen</h3></header>
        <div class="body stack">
          <div class="padgrid">
            <span></span>
            <button class="btn" data-go="vor">↑</button>
            <span></span>
            <button class="btn" data-go="links">←</button>
            <button class="btn btn-danger" data-verb="stop">Stopp</button>
            <button class="btn" data-go="rechts">→</button>
            <span></span>
            <button class="btn" data-go="zurück">↓</button>
            <span></span>
          </div>
          <div class="field" style="max-width:12rem">
            <label for="blocks">Blöcke je Schritt</label>
            <input id="blocks" type="number" min="1" max="64" value="3">
          </div>
          <div class="row">
            <button class="btn btn-sm" data-verb="jump">Springen</button>
            <button class="btn btn-sm" data-verb="fall">Fallen lassen</button>
            <button class="btn btn-sm" data-verb="pos">Position abfragen</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>Blickrichtung</h3></header>
        <div class="body stack">
          <div class="row wrap">
            ${['nord', 'ost', 'sued', 'west']
              .map(
                (dir) =>
                  `<button class="btn btn-sm" data-look="${dir}">${dir.replace('sued', 'süd').toUpperCase()}</button>`
              )
              .join('')}
            <button class="btn btn-sm" data-look="hoch">Hoch</button>
            <button class="btn btn-sm" data-look="runter">Runter</button>
            <button class="btn btn-sm" data-look="gerade">Waagerecht</button>
            <button class="btn btn-sm" data-look="um">Umdrehen</button>
          </div>
          <div class="row">
            <div class="field"><label for="yaw">Links/Rechts (Yaw)</label>
              <input id="yaw" type="number" min="-180" max="180" value="0"></div>
            <div class="field"><label for="pitch">Hoch/Runter (Pitch)</label>
              <input id="pitch" type="number" min="-90" max="90" value="0"></div>
            <button class="btn" id="look-exact" style="align-self:flex-end">Setzen</button>
          </div>
          <p class="small muted">Yaw wie im F3-Bildschirm: 0 = Süden, 90 = Westen, −90 = Osten, 180 = Norden.
            Pitch negativ heißt nach oben.</p>
        </div>
      </section>

      <section class="panel">
        <header><h3>Heimatposition</h3></header>
        <div class="body stack">
          <p class="small muted">Der Bot merkt sich eine Stelle und läuft nach jedem Beitritt dorthin zurück –
            praktisch, wenn dich der Server beim Beitritt in die Lobby setzt.</p>
          <div class="row wrap">
            <button class="btn btn-sm" data-home="set">Hier merken</button>
            <button class="btn btn-sm" data-home="go">Jetzt hinlaufen</button>
            <button class="btn btn-sm" data-home="on">Automatisch an</button>
            <button class="btn btn-sm" data-home="off">Automatisch aus</button>
            <button class="btn btn-sm" data-home="">Status zeigen</button>
            <button class="btn btn-sm btn-danger" data-home="clear">Löschen</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>Route</h3></header>
        <div class="body stack">
          <p class="small muted">Aufzeichnen, die Strecke mit den Gehen-Knöpfen ablaufen, beenden –
            danach nimmt der Bot beim Heimlaufen genau diesen Weg.</p>
          <div class="row wrap">
            <button class="btn btn-sm" data-route="rec">Aufzeichnung starten</button>
            <button class="btn btn-sm" data-route="stop">Aufzeichnung beenden</button>
            <button class="btn btn-sm" data-route="">Status zeigen</button>
          </div>
        </div>
      </section>
    </div>

    <section class="panel" style="margin-top:1.25rem">
      <header><h3>Antworten des Clients</h3></header>
      <div class="body" style="padding:0">
        <div class="console" id="move-log" style="height:12rem;border-radius:0;box-shadow:none"></div>
      </div>
    </section>`;

  const picked = () => $$('[data-move-acc]:checked').map((box) => Number(box.dataset.moveAcc));

  async function move(verb, arg = '') {
    const accounts = picked();
    if (!accounts.length) return toast('Kein Konto ausgewählt.');
    try {
      const result = await api(`/profiles/${profile.id}/move`, {
        method: 'POST',
        body: { verb, arg, accounts },
      });
      const failures = result.results.filter((entry) => !entry.ok);
      if (failures.length === result.results.length) toast(failures[0].error, 'bad');
    } catch (error) {
      fail(error);
    }
  }

  $$('[data-go]').forEach((button) =>
    button.addEventListener('click', () => move('go', `${button.dataset.go} ${$('#blocks').value || 1}`))
  );
  $$('[data-verb]').forEach((button) => button.addEventListener('click', () => move(button.dataset.verb)));
  $$('[data-look]').forEach((button) => button.addEventListener('click', () => move('look', button.dataset.look)));
  $('#look-exact').addEventListener('click', () => move('look', `${$('#yaw').value} ${$('#pitch').value}`));
  $$('[data-home]').forEach((button) => button.addEventListener('click', () => move('home', button.dataset.home)));
  $$('[data-route]').forEach((button) => button.addEventListener('click', () => move('route', button.dataset.route)));

  // Die Antworten auf Bewegungsbefehle kommen als Zustandszeilen zurück.
  const log = $('#move-log');
  const paint = () => {
    const lines = [];
    for (const member of members) {
      for (const entry of linesOf(`${profile.id}:${member.account_id}`)) {
        if (entry.type === 'chat' || entry.type === 'sent') continue;
        lines.push({ ...entry, who: member.name });
      }
    }
    lines.sort((a, b) => a.t - b.t);
    log.innerHTML = lines
      .slice(-80)
      .map(
        (entry) => `<div class="line ${entry.type}"><span class="t">${clock(entry.t)}</span>
          <span class="who">${escapeHtml(entry.who)}</span><span class="msg">${escapeHtml(entry.text)}</span></div>`
      )
      .join('');
    log.scrollTop = log.scrollHeight;
  };
  paint();
  state.onLive = (event) => {
    if (event.type === 'line' && event.key.startsWith(`${profile.id}:`)) paint();
  };
}

// ---------------------------------------------------------------- Inventar / POV

function missingPanel(title, text, details) {
  return `<div class="empty">
      <span class="pill missing" style="margin-bottom:1rem">Der Client kann das noch nicht</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </div>
    <section class="panel" style="margin-top:1.25rem">
      <header><h3>Was dafür nötig wäre</h3></header>
      <div class="body stack small muted">${details.map((entry) => `<div>${escapeHtml(entry)}</div>`).join('')}</div>
    </section>`;
}

async function tabInventory(root) {
  root.innerHTML = missingPanel(
    'Inventar',
    'Der Client öffnet keine Container und klickt keine Felder an – er hält absichtlich keinen Spielzustand im Speicher. Deshalb gibt es hier nichts zu bedienen, statt einer Anzeige, die nichts tut.',
    [
      'Fenster-Pakete lesen und den Inhalt behalten (Set Container Content / Set Slot)',
      'Klicks im Fenster senden (Click Container) mit Klickart und Prüfsumme',
      'Gegenstände darstellen: Item-IDs je Version auflösen und Bilder dazu ausliefern',
      'Rüstung, Zweithand und aktiver Slot im Hotbar-Wechsel',
    ]
  );
}

async function tabPov(root) {
  root.innerHTML = missingPanel(
    'Live-Ansicht',
    'Für ein Bild müsste der Client die Welt um den Bot herum kennen. Er lädt bewusst keine Blöcke und keine Entitäten – das ist der Grund, warum er mit wenigen MB Arbeitsspeicher auskommt.',
    [
      'Chunk-Daten entpacken und einen Ausschnitt der Welt vorhalten',
      'Entitäten verfolgen (Spawn, Bewegung, Entfernen)',
      'Blocktexturen je Version bereitstellen',
      'Ein Bild daraus rendern und zum Browser streamen',
    ]
  );
}

// ---------------------------------------------------------------- Proxys

async function tabProxies(root, profile) {
  const data = await api('/proxies');
  root.innerHTML = `
    <div class="note warn" style="margin-bottom:1.25rem">${icon('alert')}
      <div><strong>Der Client verbindet immer direkt.</strong> ${escapeHtml(data.hint)}
      Zuordnungen kannst du hier trotzdem schon pflegen – sie greifen, sobald der Client Proxys unterstützt.</div></div>

    ${
      data.proxies.length
        ? `<section class="panel"><div class="table-wrap"><table class="table">
            <thead><tr><th>Konto</th><th>Proxy</th></tr></thead>
            <tbody>${profile.accounts
              .map(
                (member) => `<tr>
                  <td><span class="row"><img class="head" src="${escapeHtml(member.head)}" alt="">${escapeHtml(member.name)}</span></td>
                  <td><select data-proxy="${member.account_id}" style="max-width:22rem">
                    <option value="">direkt (ohne Proxy)</option>
                    ${data.proxies
                      .map(
                        (proxy) =>
                          `<option value="${proxy.id}" ${member.proxy_id === proxy.id ? 'selected' : ''}>
                            ${escapeHtml(proxy.label)} · ${escapeHtml(proxy.kind)}://${escapeHtml(proxy.host)}:${proxy.port}</option>`
                      )
                      .join('')}
                  </select></td>
                </tr>`
              )
              .join('')}</tbody></table></div></section>`
        : `<div class="empty"><h3>Noch kein Proxy hinterlegt</h3>
            <p>Unter "Proxys" in der Seitenleiste legst du Zugangsdaten an, danach kannst du sie hier zuordnen.</p>
            <a class="btn btn-primary" href="#/proxys">Proxys verwalten</a></div>`
    }`;

  $$('[data-proxy]').forEach((select) =>
    select.addEventListener('change', async () => {
      try {
        await api(`/profiles/${profile.id}/accounts/${select.dataset.proxy}`, {
          method: 'PATCH',
          body: { proxy_id: select.value ? Number(select.value) : null },
        });
        ok('Zuordnung gespeichert.');
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
      <p class="small muted" style="max-width:44rem">Ein Macro hat einen Auslöser und eine Kette von Schritten,
        die der Reihe nach laufen. Reine Chat-Ketten beim Beitritt übernimmt der Client selbst –
        alles andere taktet das Panel, damit Änderungen sofort greifen.</p>
      <button class="btn btn-primary btn-sm" id="add-macro">${icon('plus')} Macro</button>
    </div>

    ${
      macros.length
        ? `<div class="stack">${macros.map(macroCard).join('')}</div>`
        : `<div class="empty"><h3>Noch kein Macro</h3>
            <p>Typischer Anfang: beim Beitritt <span class="mono">/afk</span> senden, oder alle fünf Minuten
              einen Befehl absetzen.</p>
            <button class="btn btn-primary" id="add-macro-2">${icon('plus')} Erstes Macro</button></div>`
    }`;

  function macroCard(macro) {
    const summary = macro.actions
      .map((action) => {
        if (action.type === 'chat') return `sendet "${action.text}"`;
        if (action.type === 'wait') return `wartet ${action.seconds} s`;
        if (action.type === 'move') return `geht ${action.blocks} ${action.direction}`;
        if (action.type === 'look') return `schaut ${action.yaw}/${action.pitch}`;
        return action.type;
      })
      .join(' → ');
    const when =
      macro.event === 'timer'
        ? `alle ${macro.config.interval_sec || 300} s`
        : macro.event === 'chat'
          ? `wenn Chat "${macro.config.contains || macro.config.regex || '…'}" enthält`
          : events[macro.event] || macro.event;
    return `<article class="card">
      <div class="row spread">
        <div>
          <div class="strong">${escapeHtml(macro.name)}</div>
          <div class="small muted">${escapeHtml(when)} · ${macro.actions.length} Schritt(e) ·
            ${macro.accounts.length ? `${macro.accounts.length} Konto/Konten` : 'alle Konten'}</div>
        </div>
        <span class="switch" role="switch" tabindex="0" aria-checked="${macro.enabled}" data-macro-toggle="${macro.id}"></span>
      </div>
      <p class="small mono muted" style="margin-top:.75rem">${escapeHtml(summary || 'keine Schritte')}</p>
      <div class="row" style="margin-top:1rem">
        <button class="btn btn-sm" data-macro-test="${macro.id}">Jetzt ausführen</button>
        <button class="btn btn-sm" data-macro-edit="${macro.id}">Bearbeiten</button>
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
      if (!(await confirmDialog('Dieses Macro löschen?', { confirm: 'Löschen' }))) return;
      await api(`/profiles/${profile.id}/macros/${button.dataset.macroDel}`, { method: 'DELETE' });
      draw();
    })
  );
  $$('[data-macro-test]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/profiles/${profile.id}/macros/${button.dataset.macroTest}/test`, { method: 'POST' });
        ok('Läuft.');
      } catch (error) {
        fail(error);
      }
    })
  );
  $$('[data-macro-toggle]').forEach((node) => {
    const toggle = async () => {
      const enabled = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(enabled));
      await api(`/profiles/${profile.id}/macros/${node.dataset.macroToggle}`, {
        method: 'PATCH',
        body: { enabled },
      }).catch(fail);
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

/** Macro-Editor: Auslöser oben, darunter die Schritte in der Reihenfolge, in der sie laufen. */
async function editMacro(profile, macro) {
  const actions = structuredClone(macro?.actions || [{ type: 'chat', text: '/afk' }]);
  const available = state.meta.actions.filter(
    (action) => action.needs !== 'movement' || profile.movement_ready
  );

  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <header><h3>${macro ? 'Macro bearbeiten' : 'Neues Macro'}</h3></header>
    <div class="body"><div class="stack" id="editor"></div></div>
    <footer>
      <button class="btn" id="cancel">Abbrechen</button>
      <button class="btn btn-primary" id="save">Speichern</button>
    </footer>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
  $('#cancel', dialog).addEventListener('click', () => dialog.close());

  const paint = () => {
    const event = $('#event', dialog)?.value || macro?.event || 'join';
    $('#editor', dialog).innerHTML = `
      <div class="field">
        <label for="name">Name</label>
        <input id="name" value="${escapeHtml(macro?.name || '')}" placeholder="z. B. Beitritt in die Lobby">
      </div>

      <div class="field">
        <label for="event">Auslöser</label>
        <select id="event">
          ${state.meta.events
            .map(
              (entry) =>
                `<option value="${entry.type}" ${entry.type === event ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`
            )
            .join('')}
        </select>
      </div>

      ${
        event === 'timer'
          ? `<div class="field"><label for="interval">Alle … Sekunden</label>
              <input id="interval" type="number" min="5" max="86400" value="${macro?.config?.interval_sec ?? 300}"></div>`
          : ''
      }
      ${
        event === 'chat'
          ? `<div class="field"><label for="contains">Chatzeile enthält</label>
              <input id="contains" value="${escapeHtml(macro?.config?.contains || '')}" placeholder="z. B. AFK-Warnung">
              <span class="hint">Groß-/Kleinschreibung egal. Im Schritt "Chat" steht {line} für die Zeile, die ausgelöst hat.</span></div>`
          : ''
      }

      <div class="field">
        <label for="accounts">Gilt für</label>
        <select id="accounts">
          <option value="">alle Konten dieses Profils</option>
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
          <span class="strong small">Schritte</span>
          <button class="btn btn-sm" id="add-step">${icon('plus')} Schritt</button>
        </div>
        <div class="stack" id="steps">${actions.map(stepRow).join('') || '<p class="small muted">Noch kein Schritt.</p>'}</div>
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
                    `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`
                )
                .join('')}</select></div>`;
        }
        return `<div class="field"><label>${escapeHtml(field.label)}</label>
          <input data-step="${index}" data-key="${field.key}" type="${field.type === 'number' ? 'number' : 'text'}"
            value="${escapeHtml(value)}"
            ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''}></div>`;
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
                  `<option value="${entry.type}" ${entry.type === action.type ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-ghost btn-sm" data-down="${index}" ${index === actions.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-del-step="${index}">${icon('x')}</button>
        </div>
      </div>
      ${fields ? `<div class="row wrap" style="margin-top:.6rem;align-items:flex-end">${fields}</div>` : ''}
      <div class="field" style="margin-top:.6rem;max-width:12rem">
        <label>Vorher warten (Sekunden)</label>
        <input data-step="${index}" data-key="delay" type="number" min="0" max="3600" value="${action.delay ?? 0}">
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
    if (event === 'chat') config.contains = $('#contains', dialog).value;
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
          clean[field.key] = field.type === 'number' ? Number(action[field.key] ?? field.min ?? 1) : action[field.key] ?? '';
        }
        return clean;
      }),
    };

    try {
      if (macro) await api(`/profiles/${profile.id}/macros/${macro.id}`, { method: 'PATCH', body });
      else await api(`/profiles/${profile.id}/macros`, { method: 'POST', body });
      dialog.close();
      ok('Macro gespeichert.');
      if (body.event === 'join') {
        toast('Beitrittsmacros greifen beim nächsten Start des Bots.');
      }
      draw();
    } catch (error) {
      fail(error);
    }
  });
}

// ---------------------------------------------------------------- Einstellungen

async function tabSettings(root, profile) {
  const antiAfk = profile.anti_afk || {};
  root.innerHTML = `
    <div class="grid two" style="align-items:start">
      <section class="panel">
        <header><h3>Server</h3></header>
        <div class="body stack">
          <div class="field"><label for="name">Profilname</label>
            <input id="name" value="${escapeHtml(profile.name)}"></div>
          <div class="field"><label for="address">Serveradresse</label>
            <input id="address" value="${escapeHtml(profile.address)}">
            <span class="hint">Ohne Port fragt der Client den SRV-Eintrag ab.</span></div>
          <div class="field"><label for="mc_version">Minecraft-Version</label>
            <select id="mc_version">${state.meta.versions
              .map(
                (version) =>
                  `<option ${version === profile.mc_version ? 'selected' : ''}>${escapeHtml(version)}</option>`
              )
              .join('')}</select></div>
          <div class="field"><label for="runtime">Bauform</label>
            <select id="runtime">
              <option value="rust" ${profile.runtime === 'rust' ? 'selected' : ''}>Rust – sparsam, empfohlen</option>
              <option value="java" ${profile.runtime === 'java' ? 'selected' : ''}>Java – eine Jar je Version</option>
            </select></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>Verhalten</h3></header>
        <div class="body stack">
          <div class="field"><label for="join_delay">Wartezeit nach dem Beitritt (Sekunden)</label>
            <input id="join_delay" type="number" min="0" max="600" value="${profile.join_delay}">
            <span class="hint">Bevor der erste Befehl rausgeht – der Server nimmt Chat sonst noch nicht an.</span></div>
          <label class="check"><input type="checkbox" id="auto_reconnect" ${profile.auto_reconnect ? 'checked' : ''}>
            Nach einem Abbruch automatisch neu verbinden</label>
          <div class="row">
            <div class="field"><label for="reconnect_delay">Erste Wartezeit (s)</label>
              <input id="reconnect_delay" type="number" min="1" max="600" value="${profile.reconnect_delay}"></div>
            <div class="field"><label for="max_backoff">Obergrenze (s)</label>
              <input id="max_backoff" type="number" min="1" max="3600" value="${profile.max_backoff}"></div>
          </div>
          <div class="field"><label for="chat_delay">Mindestabstand zweier Nachrichten (ms)</label>
            <input id="chat_delay" type="number" min="200" max="60000" value="${profile.chat_delay}">
            <span class="hint">Gegen den Spam-Schutz des Servers. Unter 200 ms geht nicht.</span></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>Bewegung</h3>
          ${state.meta.movement_available ? '' : '<span class="pill missing">Bauform fehlt auf dem Server</span>'}
        </header>
        <div class="body stack">
          <label class="check"><input type="checkbox" id="movement" ${profile.movement ? 'checked' : ''}
            ${state.meta.movement_available ? '' : 'disabled'}>
            Bewegungs-Bauform des Clients verwenden</label>
          <p class="small muted">Der schlanke Client bewegt sich nie – kein Byte davon ist enthalten. Erst diese
            Bauform kann laufen, schauen, springen und eine Heimatposition halten. Sie braucht etwas mehr
            Arbeitsspeicher.</p>
          ${
            state.meta.movement_available
              ? ''
              : `<div class="note warn">${icon('info')}<div>Ein Administrator muss sie einmalig mit
                  <span class="mono">scripts/build-movement.sh</span> bauen und nach data/bin legen.</div></div>`
          }
        </div>
      </section>

      <section class="panel">
        <header><h3>Anti-AFK</h3></header>
        <div class="body stack">
          <p class="small muted">Der Kick wegen Zeitüberschreitung wird schon vom Protokoll abgefangen
            (KeepAlive). Diese Aktionen sind gegen Server, die zusätzlich auf Bewegung prüfen.</p>
          <label class="check"><input type="checkbox" data-afk="command" ${antiAfk.command ? 'checked' : ''}>
            Befehl im Takt senden</label>
          <div class="row">
            <div class="field" style="max-width:10rem"><label for="afk_command">Befehl</label>
              <input id="afk_command" value="${escapeHtml(antiAfk.command_text || '/ping')}"></div>
            <div class="field" style="max-width:10rem"><label for="afk_interval">alle … Sekunden</label>
              <input id="afk_interval" type="number" min="30" max="3600" value="${antiAfk.interval_sec || 240}"></div>
          </div>
          <label class="check"><input type="checkbox" data-afk="look" ${antiAfk.look ? 'checked' : ''}
            ${profile.movement_ready ? '' : 'disabled'}> Umsehen</label>
          <label class="check"><input type="checkbox" data-afk="jump" ${antiAfk.jump ? 'checked' : ''}
            ${profile.movement_ready ? '' : 'disabled'}> Springen</label>
          <label class="check"><input type="checkbox" data-afk="walk" ${antiAfk.walk ? 'checked' : ''}
            ${profile.movement_ready ? '' : 'disabled'}> Ein Stück laufen</label>
          <div class="row" style="gap:.5rem;flex-wrap:wrap">
            <span class="pill missing">Arm schwingen fehlt im Client</span>
          </div>
          ${
            profile.movement_ready
              ? ''
              : '<p class="small muted">Umsehen, Springen und Laufen brauchen die Bewegungs-Bauform.</p>'
          }
        </div>
      </section>
    </div>

    <div class="row" style="margin-top:1.25rem">
      <button class="btn btn-primary" id="save">Speichern</button>
      <span class="small muted" id="hint"></span>
    </div>

    <section class="panel" style="margin-top:2rem">
      <header><h3>Gefährlicher Bereich</h3></header>
      <div class="body row spread wrap" style="gap:1rem">
        <p class="small muted" style="max-width:38rem">Das Profil zu löschen stoppt alle Bots darin und entfernt
          Macros, Wiederholungen und Zuordnungen. Die Minecraft-Konten selbst bleiben erhalten.</p>
        <button class="btn btn-danger" id="delete">${icon('trash')} Profil löschen</button>
      </div>
    </section>`;

  $('#save').addEventListener('click', async () => {
    const antiAfkNew = {
      command: $('[data-afk="command"]').checked,
      command_text: $('#afk_command').value,
      interval_sec: Number($('#afk_interval').value),
      look: $('[data-afk="look"]').checked,
      jump: $('[data-afk="jump"]').checked,
      walk: $('[data-afk="walk"]').checked,
    };
    try {
      const result = await api(`/profiles/${profile.id}`, {
        method: 'PATCH',
        body: {
          name: $('#name').value,
          address: $('#address').value,
          mc_version: $('#mc_version').value,
          runtime: $('#runtime').value,
          join_delay: Number($('#join_delay').value),
          auto_reconnect: $('#auto_reconnect').checked,
          reconnect_delay: Number($('#reconnect_delay').value),
          max_backoff: Number($('#max_backoff').value),
          chat_delay: Number($('#chat_delay').value),
          movement: $('#movement').checked,
          anti_afk: antiAfkNew,
        },
      });
      await refresh({ accounts: false });
      ok('Gespeichert.');
      $('#hint').textContent = result.restart_needed
        ? 'Laufende Bots übernehmen die Änderung erst nach einem Neustart.'
        : '';
    } catch (error) {
      fail(error);
    }
  });

  $('#delete').addEventListener('click', async () => {
    if (!(await confirmDialog(`Serverprofil "${profile.name}" wirklich löschen?`, { confirm: 'Löschen' }))) return;
    await api(`/profiles/${profile.id}`, { method: 'DELETE' });
    await refresh();
    location.hash = '#/server';
    draw();
  });
}
