// Was der Bot sieht: die Live-Ansicht und sein Inventar.
//
// Es gibt zwei Wege zu einem Bild, und welcher gilt, entscheidet der Client:
//
//   * **Texturiert** (Client ab 2.5.0, Original-JAR beim Betreiber hinterlegt). Der Client führt
//     für diesen Bot einen kleinen Webserver auf seinem Localhost, der fertige PNG-Bilder aus
//     echten Blockmodellen liefert, dazu Hotbar, Inventar und das offene Menü als Daten. Das
//     Panel reicht die Anfragen durch (server/routes/profiles.js), der Browser holt sich Bilder
//     im eingestellten Takt. Wer hier zusieht, sieht Minecraft.
//   * **Voxel** (alles davor, und immer dann, wenn keine JAR hinterlegt ist). Der Client schreibt
//     das Bild als Raster gefärbter Halbblöcke auf die Fehlerausgabe, der Server zerlegt es in
//     Farbläufe und schickt sie über die Live-Leitung. Der Browser malt sie auf ein Canvas.
//
// Beide Wege stehen nebeneinander, und keiner ist ein Notbehelf des anderen: Der Voxelweg kostet
// nichts an Einrichtung und läuft überall; der texturierte braucht eine Datei, die wir nicht
// mitliefern dürfen. Welcher gerade gilt, steht an der Ansicht – nicht in einer Fehlermeldung.
//
// Gesteuert wird in beiden Fällen über dieselben örtlichen Befehle wie im Reiter „Bewegung“. Neu
// ist nur, dass man dabei zusieht: Wer die Ansicht anklickt, steuert mit WASD, dreht mit der Maus
// und greift mit den Zifferntasten in die Schnellleiste.

import { api, icon, escapeHtml, mcText, tr, $, $$, toast, fail } from '../ui.js';
import { state } from '../app.js';
import { noAccounts, anyOnline, itemSlot } from './parts.js';

// ---------------------------------------------------------------- Einstellungen des Betrachters
//
// Größe, Takt und ob gesteuert wird, sind Sachen des Zusehers und nicht des Serverplatzes: Wer am
// Telefon zusieht, will ein kleines Bild, und wer am Schreibtisch sitzt, ein großes. Sie gehören
// deshalb in den Browser und nicht in die Datenbank.

const PREF_KEY = 'afk-pov';

function prefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

function savePref(patch) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...prefs(), ...patch }));
  } catch {
    /* privater Modus: die Wahl gilt für diese Sitzung, gemerkt wird sie nicht */
  }
}

/**
 * Die drei Bildgrößen.
 *
 * Der Client rechnet jedes Bild frisch aus der geladenen Welt – jeder Bildpunkt ist ein Strahl.
 * Groß ist deshalb wirklich teurer und nicht nur größer, und die Wahl steht bewusst da, statt
 * dass irgendwer irgendwo eine Zahl für alle festlegt.
 */
const SIZES = [
  { key: 'small', w: 320, h: 180, label: 'pov.size.small' },
  { key: 'normal', w: 426, h: 240, label: 'pov.size.normal' },
  { key: 'large', w: 640, h: 360, label: 'pov.size.large' },
];

/** Bilder je Sekunde. Mehr als zehn sieht niemand, und der Client rechnet sie trotzdem. */
const RATES = [2, 5, 10];

/** Kürzester Abstand zwischen zwei Befehlen aus der Steuerung. Eine gehaltene Taste ist kein Spam. */
const COMMAND_GAP_MS = 120;

// ---------------------------------------------------------------- Live-Ansicht

export async function tabPov(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  const saved = prefs();
  let size = SIZES.find((entry) => entry.key === saved.size) || SIZES[1];
  let rate = RATES.includes(saved.rate) ? saved.rate : 5;
  let steering = saved.steer !== false;
  let step = Number(saved.step) >= 1 ? Math.min(16, Math.round(Number(saved.step))) : 2;

  root.innerHTML = `
    <div class="row spread wrap" style="margin-bottom:1rem;gap:1rem">
      <div style="max-width:44rem;min-width:0">
        <h2 style="font-size:1.25rem;margin:0 0 .35rem">${escapeHtml(tr('pov.title'))}</h2>
        <p class="small muted" style="margin:0">${escapeHtml(tr('pov.lead'))}</p>
      </div>
    </div>

    <div class="pov-bar">
      <label class="field">
        <span>${escapeHtml(tr('pov.size'))}</span>
        <select id="pov-size">
          ${SIZES.map(
            (entry) =>
              `<option value="${entry.key}" ${entry.key === size.key ? 'selected' : ''}>${escapeHtml(
                tr(entry.label)
              )} · ${entry.w}×${entry.h}</option>`
          ).join('')}
        </select>
      </label>
      <label class="field">
        <span>${escapeHtml(tr('pov.rate'))}</span>
        <select id="pov-rate">
          ${RATES.map(
            (value) =>
              `<option value="${value}" ${value === rate ? 'selected' : ''}>${escapeHtml(
                tr('pov.perSecond', { n: value })
              )}</option>`
          ).join('')}
        </select>
      </label>
      <label class="field">
        <span>${escapeHtml(tr('srv.blocks'))}</span>
        <input id="pov-step" type="number" min="1" max="16" value="${step}">
      </label>
      <label class="check small" title="${escapeHtml(tr('pov.controlHint'))}">
        <input type="checkbox" id="pov-control" ${steering ? 'checked' : ''}>
        ${escapeHtml(tr('pov.control'))}
      </label>
      <div class="grow"></div>
      <div class="row" id="pov-voxel-tools" hidden>
        <button class="btn btn-sm btn-primary" id="pov-live">${icon('play')} ${escapeHtml(tr('pov.start'))}</button>
        <button class="btn btn-sm" id="pov-frame">${icon('eye')} ${escapeHtml(tr('pov.frame'))}</button>
        <button class="btn btn-sm" id="pov-stop">${icon('stop')} ${escapeHtml(tr('pov.stop'))}</button>
      </div>
    </div>

    <div class="pov-grid" id="pov-views"></div>

    <details class="fold pov-keys">
      <summary>${escapeHtml(tr('pov.keysTitle'))}</summary>
      <div class="keymap">
        ${[
          ['W A S D', 'pov.key.walk'],
          ['Q E', 'pov.key.turn'],
          ['R F', 'pov.key.pitch'],
          ['Space', 'pov.key.jump'],
          ['Shift', 'pov.key.sneak'],
          ['Ctrl', 'pov.key.sprint'],
          ['1 – 9', 'pov.key.hand'],
          [tr('pov.key.mouseLeft'), 'pov.key.swing'],
          [tr('pov.key.mouseRight'), 'pov.key.use'],
          [tr('pov.key.drag'), 'pov.key.look'],
          ['Esc', 'pov.key.escape'],
        ]
          .map(
            ([keys, label]) =>
              `<div class="keyrow"><kbd>${escapeHtml(keys)}</kbd><span>${escapeHtml(tr(label))}</span></div>`
          )
          .join('')}
      </div>
    </details>

    <p class="small muted" style="margin-top:1rem">${escapeHtml(tr('pov.note'))}</p>`;

  const stages = new Map();
  $('#pov-views').innerHTML = members.map(shell).join('');

  function shell(member) {
    return `<article class="pov" data-account="${member.account_id}" tabindex="0"
        aria-label="${escapeHtml(tr('pov.stageLabel', { name: member.name }))}">
      <header>
        <span class="truncate strong">${escapeHtml(member.name)}</span>
        <span class="small muted pov-status mono"></span>
      </header>
      <div class="pov-stage">
        <img class="pov-frame" alt="" draggable="false">
        <canvas class="pov-canvas" width="640" height="320"></canvas>
        <span class="pov-cross" aria-hidden="true"></span>
        <div class="pov-badges">
          <span class="pov-badge" data-badge="sneak">${escapeHtml(tr('srv.sneak'))}</span>
          <span class="pov-badge" data-badge="sprint">${escapeHtml(tr('srv.sprint'))}</span>
        </div>
        <div class="pov-tools">
          <button class="pov-tool" data-tool="shot" title="${escapeHtml(tr('pov.shot'))}"
            aria-label="${escapeHtml(tr('pov.shot'))}">${icon('image')}</button>
          <button class="pov-tool" data-tool="full" title="${escapeHtml(tr('pov.full'))}"
            aria-label="${escapeHtml(tr('pov.full'))}">${icon('expand')}</button>
        </div>
        <div class="pov-menu" hidden></div>
        <p class="pov-hint"></p>
      </div>
      <div class="pov-hotbar" hidden></div>
    </article>`;
  }

  for (const member of members) {
    const node = $(`.pov[data-account="${member.account_id}"]`);
    const stage = {
      accountId: member.account_id,
      name: member.name,
      node,
      img: $('.pov-frame', node),
      canvas: $('.pov-canvas', node),
      status: $('.pov-status', node),
      hintNode: $('.pov-hint', node),
      hotbar: $('.pov-hotbar', node),
      menu: $('.pov-menu', node),
      world: null,
      lastUrl: '',
      /** Die letzten Blob-Adressen dieses Bildes – siehe pullFrame. */
      urls: [],
      lastCommand: 0,
      sneak: false,
      sprint: false,
      dead: false,
      frameTimer: null,
      stateTimer: null,
      // Was der Voxelweg braucht: ob wir für dieses Konto schon `:pov live` geschickt haben.
      voxelAsked: false,
    };
    stages.set(member.account_id, stage);
    bindStage(stage);
  }

  const botOf = (stage) => state.bots.get(`${profile.id}:${stage.accountId}`);
  const textured = (stage) => Boolean(botOf(stage)?.pov?.web);

  /** Läuft dieser Reiter noch? Nach einem Wechsel hängen die Flächen unten am toten DOM. */
  const alive = () => state.route.name === 'server' && state.route.id === profile.id && state.route.tab === 'pov';

  // ------------------------------------------------------------ Bilder holen

  async function pullFrame(stage) {
    if (stage.dead) return;
    if (!alive()) return stop();
    let wait = Math.round(1000 / rate);
    const bot = botOf(stage);
    if (document.hidden) {
      // Ein Bild für einen Reiter im Hintergrund ist Rechenzeit für eine schwarze Fläche. Ganz
      // aufhören wäre falsch – wer zurückkommt, soll nicht auf den Neustart einer Schleife warten.
      wait = 1000;
    } else if (!bot?.online || !bot?.pov?.web) {
      wait = 1200;
    } else {
      try {
        const response = await api(
          `/profiles/${profile.id}/pov/${stage.accountId}/frame.png?w=${size.w}&h=${size.h}`,
          { raw: true }
        );
        if (response.ok) {
          // Jedes Bild ist ein Blob, und ein Blob bleibt im Speicher, bis ihn jemand freigibt.
          // Freigegeben wird deshalb nicht "das vorherige beim Laden des nächsten" – dieses
          // Ereignis fällt aus, wenn schon das übernächste unterwegs ist –, sondern alles, was
          // zwei Bilder zurückliegt. Das aktuelle und sein Vorgänger bleiben stehen: Eines zeigt
          // der Browser gerade, das andere hält er noch fest, während er das neue dekodiert.
          const url = URL.createObjectURL(await response.blob());
          stage.urls.push(url);
          while (stage.urls.length > 2) URL.revokeObjectURL(stage.urls.shift());
          stage.lastUrl = url;
          stage.img.src = url;
          stage.node.classList.add('has-frame', 'is-textured');
          setHint(stage, '');
        } else {
          // Der Client sagt selbst, warum gerade kein Bild geht ("Position noch unbekannt",
          // "keine Ressourcen"). Diesen Satz weiterzugeben ist mehr wert als jeder eigene.
          setHint(stage, (await response.text()).slice(0, 200));
          wait = 1500;
        }
      } catch (error) {
        setHint(stage, error?.message || String(error));
        wait = 2000;
      }
    }
    stage.frameTimer = setTimeout(() => pullFrame(stage), wait);
  }

  async function pullState(stage) {
    if (stage.dead) return;
    if (!alive()) return stop();
    let wait = 700;
    const bot = botOf(stage);
    if (document.hidden || !bot?.online || !bot?.pov?.web) {
      wait = 1500;
    } else {
      try {
        const response = await api(`/profiles/${profile.id}/pov/${stage.accountId}/state.json`, {
          raw: true,
        });
        if (response.ok) {
          stage.world = await response.json();
          paintOverlay(stage);
        } else {
          wait = 2000;
        }
      } catch {
        wait = 2500;
      }
    }
    stage.stateTimer = setTimeout(() => pullState(stage), wait);
  }

  // ------------------------------------------------------------ Anzeige

  function setHint(stage, text) {
    const bot = botOf(stage);
    const painted = stage.node.classList.contains('has-frame');
    const message = !bot?.online
      ? tr('pov.offline')
      : text
        ? text
        : painted
          ? ''
          : bot?.pov?.web
            ? tr('pov.waiting')
            : bot?.pov?.pending
              ? tr('pov.starting')
              : bot?.pov?.on
                ? tr('pov.waiting')
                : tr('pov.idle');
    stage.hintNode.textContent = message;
  }

  /** Kopfzeile, Schnellleiste und das offene Menü aus dem letzten Zustand zeichnen. */
  function paintOverlay(stage) {
    const world = stage.world;
    if (!world) return;
    const position = world.position;
    stage.status.textContent = position
      ? `x ${position.x.toFixed(1)}  y ${position.y.toFixed(1)}  z ${position.z.toFixed(1)}  ·  ${
          world.chunks || 0
        } ${tr('pov.chunks')}`
      : tr('pov.notInGame');

    paintHotbar(stage);
    paintMenu(stage);
    // Warum es keine Texturen gibt, sagt schon die Absage auf das Bild – dort steht derselbe Satz
    // des Clients, und zwar in dem Augenblick, in dem er wirklich gilt.
  }

  function paintHotbar(stage) {
    const inventory = stage.world?.menu?.inventory || [];
    if (!inventory.length) {
      stage.hotbar.hidden = true;
      return;
    }
    const selected = Number(stage.world.selected_hotbar) || 0;
    const key = JSON.stringify([selected, inventory.slice(36, 45)]);
    if (stage.hotbarKey === key) return;
    stage.hotbarKey = key;
    stage.hotbar.hidden = false;
    stage.hotbar.innerHTML = Array.from({ length: 9 }, (_, index) =>
      itemSlot({
        item: inventory[36 + index] || null,
        // Die Feldnummer ist die des Protokolls (36 bis 44); `data-hand` ist die Taste darüber.
        index: 36 + index,
        accountId: stage.accountId,
        profileId: profile.id,
        extra: `data-hand="${index}" ${index === selected ? 'data-active="1"' : ''}`,
      })
    ).join('');
    for (const button of $$('[data-hand]', stage.hotbar)) {
      button.addEventListener('click', () => hand(stage, Number(button.dataset.hand)));
    }
  }

  /**
   * Das offene Fenster des Servers – mit denselben Feldern wie im Reiter „Menüs“.
   *
   * Bewusst keine nachgebaute Minecraft-Oberfläche mit Truhentextur: Die Felder des Panels sind
   * für genau diesen Zweck gemacht, sie sehen im hellen wie im dunklen Schema richtig aus, und
   * sie tragen den Aufklapper mit Name und Beschreibungstext. Was aus dem Spiel kommt, ist das,
   * worauf es ankommt – das Bild im Feld.
   */
  function paintMenu(stage) {
    const menu = stage.world?.menu;
    // Der Vergleich lässt das Inventar bewusst weg: Es steckt im selben Zustand, gehört aber in
    // die Schnellleiste und nicht ins Fenster. Mit ihm im Schlüssel würde das offene Menü jedes
    // Mal neu gebaut, wenn sich irgendwo ein Feld ändert – samt Verlust des Aufklappers, den
    // gerade jemand liest.
    const key = menu?.open ? JSON.stringify([menu.title, menu.slots, menu.items]) : 'zu';
    if (stage.menuKey === key) return;
    stage.menuKey = key;
    if (!menu?.open) {
      stage.menu.hidden = true;
      stage.menu.innerHTML = '';
      stage.node.classList.remove('has-menu');
      return;
    }
    stage.menu.hidden = false;
    stage.node.classList.add('has-menu');

    const items = menu.items || [];
    // Die letzten 36 Felder eines jeden Fensters sind immer das eigene Inventar – 27 Tasche,
    // 9 Schnellleiste. Alles davor gehört dem Server.
    const own = Math.max(0, (Number(menu.slots) || items.length) - 36);
    const slot = (index) =>
      itemSlot({
        item: items[index] || null,
        index,
        accountId: stage.accountId,
        profileId: profile.id,
        extra: 'data-click="1"',
      });

    stage.menu.innerHTML = `
      <div class="pov-menu-card">
        <header>
          <span class="truncate">${menu.title ? mcText(menu.title) : escapeHtml(tr('vw.menu'))}</span>
          <button class="btn btn-ghost btn-sm" data-menu-close
            aria-label="${escapeHtml(tr('srv.menuClose'))}">${icon('x')}</button>
        </header>
        ${own ? `<div class="menu-grid">${Array.from({ length: own }, (_, i) => slot(i)).join('')}</div>` : ''}
        <div class="menu-split">${escapeHtml(tr('pov.ownInventory'))}</div>
        <div class="menu-grid">${Array.from({ length: 27 }, (_, i) => slot(own + i)).join('')}</div>
        <div class="menu-grid hotline">${Array.from({ length: 9 }, (_, i) => slot(own + 27 + i)).join('')}</div>
      </div>`;

    $('[data-menu-close]', stage.menu).addEventListener('click', () => closeMenu(stage));
    for (const button of $$('[data-click]', stage.menu)) {
      button.addEventListener('click', (event) =>
        clickSlot(stage, Number(button.dataset.slot), event.shiftKey ? 'shift' : 'left')
      );
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        clickSlot(stage, Number(button.dataset.slot), 'right');
      });
    }
  }

  /** Der Voxelweg: Farbläufe auf ein Canvas, ohne Glättung hochskaliert. */
  function paintVoxel(stage, view) {
    if (!view || view.empty || !view.rows?.length) return;
    const cols = view.width;
    const rows = view.rows.length;
    if (!cols || !rows) return;

    const buffer = document.createElement('canvas');
    buffer.width = cols;
    buffer.height = rows;
    const source = buffer.getContext('2d');
    const image = source.createImageData(cols, rows);
    const pixels = image.data;

    for (let y = 0; y < rows; y++) {
      let at = y * cols * 4;
      const end = at + cols * 4;
      for (const [color, count] of view.rows[y]) {
        // "4182d2" -> 0x4182d2. Eine Zahl statt dreier Teilzeichenketten je Lauf: bei fünf Bildern
        // in der Sekunde und ein paar tausend Läufen je Bild ist das der Unterschied zwischen
        // "fällt nicht auf" und "der Browser hat zu tun".
        const rgb = parseInt(color, 16);
        const red = (rgb >> 16) & 255;
        const green = (rgb >> 8) & 255;
        const blue = rgb & 255;
        for (let i = 0; i < count && at < end; i++) {
          pixels[at] = red;
          pixels[at + 1] = green;
          pixels[at + 2] = blue;
          pixels[at + 3] = 255;
          at += 4;
        }
      }
    }
    source.putImageData(image, 0, 0);

    const canvas = stage.canvas;
    canvas.width = Math.min(640, cols * 4);
    canvas.height = Math.round((canvas.width * rows) / cols);
    const target = canvas.getContext('2d');
    target.imageSmoothingEnabled = false;
    target.drawImage(buffer, 0, 0, canvas.width, canvas.height);

    stage.node.classList.add('has-frame');
    stage.node.classList.remove('is-textured');
    stage.status.textContent = view.status || '';
    setHint(stage, '');
  }

  // ------------------------------------------------------------ Steuern

  /** Einen örtlichen Befehl an genau diesen Bot schicken – gedrosselt, aber ohne Warteschlange. */
  async function act(stage, verb, arg = '') {
    const now = Date.now();
    if (now - stage.lastCommand < COMMAND_GAP_MS) return false;
    stage.lastCommand = now;
    try {
      const result = await api(`/profiles/${profile.id}/command`, {
        method: 'POST',
        body: { verb, arg, accounts: [stage.accountId] },
      });
      const failed = (result.results || []).find((entry) => !entry.ok);
      if (failed) {
        toast(failed.error, 'bad');
        return false;
      }
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }

  /** Ein Feld anklicken. Über den Viewer, wenn er läuft – sonst über `:click`. */
  async function clickSlot(stage, index, action) {
    if (textured(stage)) {
      try {
        await api(`/profiles/${profile.id}/pov/${stage.accountId}/click`, {
          method: 'POST',
          body: { slot: index, action },
        });
        return;
      } catch (error) {
        fail(error);
        return;
      }
    }
    act(stage, 'click', `${index}${action === 'shift' ? ' shift' : action === 'right' ? ' rechts' : ''}`);
  }

  async function closeMenu(stage) {
    if (textured(stage)) {
      try {
        await api(`/profiles/${profile.id}/pov/${stage.accountId}/close`, { method: 'POST' });
        return;
      } catch (error) {
        fail(error);
        return;
      }
    }
    act(stage, 'close');
  }

  /**
   * Das Schnellleistenfeld wechseln.
   *
   * Zwei Wege für dieselbe Sache, und das ist kein Zufall: `:hand` zählt wie im Spiel von 1 bis 9,
   * der Viewer von 0 bis 8 (so steht die Nummer im Protokoll). Wer den Viewer hat, geht direkt
   * dorthin – dann steht das neue Feld schon im nächsten Zustand, ohne Umweg über die Ausgabe.
   */
  async function hand(stage, index) {
    if (textured(stage)) {
      try {
        await api(`/profiles/${profile.id}/pov/${stage.accountId}/hotbar`, {
          method: 'POST',
          body: { slot: index },
        });
        return;
      } catch (error) {
        fail(error);
        return;
      }
    }
    act(stage, 'hand', String(index + 1));
  }

  const DIRECTIONS = {
    w: 'vor',
    a: 'links',
    s: 'zurück',
    d: 'rechts',
    arrowup: 'vor',
    arrowleft: 'links',
    arrowdown: 'zurück',
    arrowright: 'rechts',
  };

  /** Blick drehen – relativ zum Winkel, den der Bot gerade wirklich hat. */
  function turn(stage, deltaYaw, deltaPitch) {
    const position = stage.world?.position;
    if (!position) {
      toast(tr('pov.needState'));
      return;
    }
    const yaw = Math.round(((position.yaw + deltaYaw + 540) % 360) - 180);
    const pitch = Math.max(-90, Math.min(90, Math.round(position.pitch + deltaPitch)));
    // Die Blickrichtung ändert sich im Zustand erst mit der nächsten Abfrage. Bis dahin lokal
    // mitzählen, sonst dreht zweimaliges Drücken nur einmal.
    position.yaw = yaw;
    position.pitch = pitch;
    act(stage, 'look', `${yaw} ${pitch}`);
  }

  function toggle(stage, what) {
    const next = !stage[what];
    stage[what] = next;
    stage.node.querySelector(`[data-badge="${what}"]`)?.toggleAttribute('data-on', next);
    act(stage, what, next ? 'on' : 'off');
  }

  function bindStage(stage) {
    const node = stage.node;

    // Ein Klick neben das Fenster schließt es, wie im Spiel. Der Zuhörer sitzt an der Fläche und
    // nicht an ihrem Inhalt: Der Inhalt wird bei jeder Änderung neu gebaut, und ein Zuhörer je
    // Neubau wären nach zehn Minuten hundert davon.
    stage.menu.addEventListener('click', (event) => {
      if (event.target === stage.menu) closeMenu(stage);
    });

    node.addEventListener('keydown', (event) => {
      if (!steering) return;
      // Eine gehaltene Taste wiederholt sich im Browser dutzendfach je Sekunde. Ein `:go` ist aber
      // eine Strecke und keine Taste – der Client läuft sie zu Ende, und zwanzig Aufträge dafür
      // wären zwanzig Strecken hintereinander.
      if (event.repeat || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      // Strg+R, Strg+C und ihresgleichen gehören dem Browser. Nur Strg **allein** ist hier ein
      // Befehl – sonst drehte ausgerechnet das Neuladen der Seite noch den Blick nach unten.
      if (event.ctrlKey && key !== 'control') return;
      // Und im offenen Menü sind Shift und Strg keine Tasten für Schleichen und Sprinten, sondern
      // die Zusatztasten des Klicks: Shift zieht einen Stapel hinüber, wie im Spiel.
      if ((key === 'shift' || key === 'control') && !stage.menu.hidden) return;

      if (DIRECTIONS[key]) {
        event.preventDefault();
        return void act(stage, 'go', `${DIRECTIONS[key]} ${step}`);
      }
      if (key >= '1' && key <= '9') {
        event.preventDefault();
        return void hand(stage, Number(key) - 1);
      }
      switch (key) {
        case ' ':
          event.preventDefault();
          return void act(stage, 'jump');
        case 'q':
          event.preventDefault();
          return turn(stage, -30, 0);
        case 'e':
          event.preventDefault();
          return turn(stage, 30, 0);
        case 'r':
          event.preventDefault();
          return turn(stage, 0, -15);
        case 'f':
          event.preventDefault();
          return turn(stage, 0, 15);
        case 'shift':
          event.preventDefault();
          return toggle(stage, 'sneak');
        case 'control':
          event.preventDefault();
          return toggle(stage, 'sprint');
        case 'x':
          event.preventDefault();
          return void act(stage, 'stop');
        case 'escape':
          if (!stage.menu.hidden) {
            event.preventDefault();
            return void closeMenu(stage);
          }
          return;
        default:
          return;
      }
    });

    // Klicken auf die Fläche: links schlagen, rechts benutzen. Beides sind Premium-Befehle; wo
    // sie fehlen, sagt die Absage des Servers das, und zwar einmal statt bei jedem Klick.
    const stageBox = $('.pov-stage', node);
    stageBox.addEventListener('mousedown', (event) => {
      if (!steering || event.target.closest('.pov-menu, .pov-tools')) return;
      if (event.button === 0) {
        node.focus();
        stage.drag = { x: event.clientX, y: event.clientY, moved: false };
      }
    });
    stageBox.addEventListener('mousemove', (event) => {
      if (!stage.drag) return;
      const dx = event.clientX - stage.drag.x;
      const dy = event.clientY - stage.drag.y;
      // Erst ab zehn Bildpunkten, und dann ein Grad je drei. Ohne die Schwelle zitterte der Blick
      // bei jedem Wackeln der Hand; ohne den Teiler drehte ein Ruck über die halbe Fläche den Bot
      // einmal um die eigene Achse.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      stage.drag = { x: event.clientX, y: event.clientY, moved: true };
      turn(stage, Math.round(dx / 3), Math.round(dy / 3));
    });
    const endDrag = (event) => {
      if (!stage.drag) return;
      const dragged = stage.drag.moved;
      stage.drag = null;
      if (!dragged && steering && !event.target.closest('.pov-menu, .pov-tools')) act(stage, 'swing');
    };
    stageBox.addEventListener('mouseup', endDrag);
    stageBox.addEventListener('mouseleave', () => {
      stage.drag = null;
    });
    stageBox.addEventListener('contextmenu', (event) => {
      if (!steering || event.target.closest('.pov-menu')) return;
      event.preventDefault();
      act(stage, 'use');
    });

    for (const button of $$('[data-tool]', node)) {
      button.addEventListener('click', () => {
        if (button.dataset.tool === 'shot') return snapshot(stage);
        if (document.fullscreenElement === node) document.exitFullscreen?.();
        else node.requestFullscreen?.();
      });
    }
  }

  /**
   * Das Bild speichern.
   *
   * Der texturierte Weg hat es schon als PNG im Speicher – da genügt der Verweis darauf. Der
   * Voxelweg hat ein Canvas, und `toBlob` macht daraus dieselbe Datei. Beide landen unter einem
   * Namen, der sagt, von wem und wann: Ein Bildschirmfoto ist meistens der Anhang eines Tickets.
   */
  function snapshot(stage) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `${profile.slug || 'server'}-${stage.name}-${stamp}.png`;
    const download = (href, revoke = false) => {
      const link = document.createElement('a');
      link.href = href;
      link.download = name;
      link.click();
      if (revoke) setTimeout(() => URL.revokeObjectURL(href), 10_000);
    };
    if (stage.node.classList.contains('is-textured') && stage.lastUrl) return download(stage.lastUrl);
    if (!stage.node.classList.contains('has-frame')) return toast(tr('pov.nothingYet'));
    stage.canvas.toBlob((blob) => {
      if (blob) download(URL.createObjectURL(blob), true);
    }, 'image/png');
  }

  // ------------------------------------------------------------ Voxelweg

  /** Der Voxelweg wird angefordert; der texturierte nicht – dort holt der Browser sich die Bilder. */
  async function voxelCommand(mode) {
    // Gefragt wird nur, wen es angeht: kein texturierter Bot (der zeichnet auf Abruf) und kein
    // Bot, der gar nicht läuft. Sonst käme beim bloßen Öffnen des Reiters eine rote Absage für
    // etwas, das niemand angestoßen hat – und zwar genau dann, wenn ein zweiter Bot danebensteht
    // und alles richtig läuft.
    const accounts = [...stages.values()]
      .filter((stage) => !textured(stage) && (mode === 'stop' ? stage.voxelAsked : botOf(stage)?.online))
      .map((stage) => stage.accountId);
    if (!accounts.length) return;
    try {
      await api(`/profiles/${profile.id}/command`, {
        method: 'POST',
        body: { verb: 'pov', arg: mode, accounts },
      });
      for (const id of accounts) {
        const stage = stages.get(id);
        if (!stage) continue;
        stage.voxelAsked = mode !== 'stop';
        if (mode === 'stop') {
          stage.node.classList.remove('has-frame');
          stage.hintNode.textContent = tr('pov.stopped');
        }
      }
    } catch (error) {
      fail(error);
    }
  }

  /** Zeigt die Voxel-Knöpfe nur, wenn es überhaupt einen Bot gibt, der sie braucht. */
  function updateMode() {
    const voxel = [...stages.values()].some((stage) => !textured(stage));
    $('#pov-voxel-tools').hidden = !voxel;
    for (const stage of stages.values()) setHint(stage, '');
  }

  // ------------------------------------------------------------ Leben und Sterben

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('hashchange', stop);
    window.removeEventListener('pagehide', stop);
    document.removeEventListener('visibilitychange', onVisible);
    for (const stage of stages.values()) {
      stage.dead = true;
      clearTimeout(stage.frameTimer);
      clearTimeout(stage.stateTimer);
      for (const url of stage.urls) URL.revokeObjectURL(url);
      stage.urls = [];
    }
    // Nur der Voxelweg muss abbestellt werden: Dort zeichnet der Client von sich aus weiter, bis
    // ihm jemand sagt, dass niemand mehr zusieht. Der texturierte rechnet ohnehin nur auf Zuruf.
    const voxel = [...stages.values()].filter((stage) => stage.voxelAsked).map((stage) => stage.accountId);
    if (voxel.length) {
      api(`/profiles/${profile.id}/command`, {
        method: 'POST',
        keepalive: true,
        body: { verb: 'pov', arg: 'stop', accounts: voxel },
      }).catch(() => {});
    }
  }

  // Ein zugeklappter Laptop soll die Schleifen nicht im Vollgas weiterlaufen lassen; sie prüfen
  // `document.hidden` selbst, brauchen dafür aber einen Anstoß, wenn jemand zurückkommt.
  const onVisible = () => {
    if (document.hidden) return;
    for (const stage of stages.values()) {
      clearTimeout(stage.frameTimer);
      clearTimeout(stage.stateTimer);
      pullFrame(stage);
      pullState(stage);
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('hashchange', stop);
  window.addEventListener('pagehide', stop);

  // ------------------------------------------------------------ Bedienung der Leiste

  $('#pov-size').addEventListener('change', (event) => {
    size = SIZES.find((entry) => entry.key === event.target.value) || size;
    savePref({ size: size.key });
  });
  $('#pov-rate').addEventListener('change', (event) => {
    rate = Number(event.target.value) || rate;
    savePref({ rate });
  });
  $('#pov-step').addEventListener('change', (event) => {
    step = Math.min(16, Math.max(1, Math.round(Number(event.target.value) || 2)));
    event.target.value = step;
    savePref({ step });
  });
  $('#pov-control').addEventListener('change', (event) => {
    steering = event.target.checked;
    savePref({ steer: steering });
    for (const stage of stages.values()) stage.node.classList.toggle('no-control', !steering);
  });
  for (const stage of stages.values()) stage.node.classList.toggle('no-control', !steering);

  $('#pov-live').addEventListener('click', () => voxelCommand('live'));
  $('#pov-frame').addEventListener('click', () => voxelCommand('frame'));
  $('#pov-stop').addEventListener('click', () => voxelCommand('stop'));

  // ------------------------------------------------------------ Loslegen

  for (const stage of stages.values()) {
    const bot = botOf(stage);
    if (bot?.views?.pov) paintVoxel(stage, bot.views.pov);
    setHint(stage, '');
    pullFrame(stage);
    pullState(stage);
  }
  updateMode();

  // Beim Öffnen von selbst anfangen – wer diesen Reiter anklickt, will sehen, was der Bot sieht.
  // Der texturierte Weg braucht dafür nichts; der Voxelweg genau einen Befehl.
  if (anyOnline(profile, members)) voxelCommand('live');

  state.onLive = (event) => {
    const [profileId, accountId] = String(event.key || '').split(':').map(Number);
    if (profileId !== profile.id) return;
    const stage = stages.get(accountId);
    if (!stage) return;
    if (event.type === 'state') {
      updateMode();
      return;
    }
    if (event.type !== 'view' || event.kind !== 'pov') return;
    if (event.view?.empty) {
      stage.node.classList.remove('has-frame');
      setHint(stage, '');
      return;
    }
    paintVoxel(stage, event.view);
  };
}

// ---------------------------------------------------------------- Inventar
//
// Das eigene Inventar des Bots, so angeordnet wie im Spiel. Die Feldnummern sind die des
// Protokolls und stehen an jedem leeren Feld – wer ein Macro mit `:click` schreibt, braucht genau
// diese Zahl, und sie irgendwo nachschlagen zu müssen wäre eine vermeidbare Suche.
//
//   0        Ergebnis der Werkbank
//   1 – 4    die vier Werkbankfelder
//   5 – 8    Rüstung: Helm, Brust, Hose, Schuhe
//   9 – 35   Tasche (drei Reihen zu neun)
//   36 – 44  Schnellleiste
//   45       Nebenhand

const ARMOR = [5, 6, 7, 8];
const CRAFT = [1, 2, 3, 4];

export async function tabInventory(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  root.innerHTML = `
    <div class="row spread wrap" style="margin-bottom:1rem;gap:1rem">
      <div style="max-width:44rem;min-width:0">
        <h2 style="font-size:1.25rem;margin:0 0 .35rem">${escapeHtml(tr('inv.title'))}</h2>
        <p class="small muted" style="margin:0">${escapeHtml(tr('inv.lead'))}</p>
      </div>
      <button class="btn btn-sm" id="inv-refresh">${icon('refresh')} ${escapeHtml(tr('vw.fetch'))}</button>
    </div>
    <div class="views" id="inv-views"></div>`;

  const alive = () =>
    state.route.name === 'server' && state.route.id === profile.id && state.route.tab === 'inventory';

  /** Der texturierte Weg gibt das Inventar als Liste, der Textweg als Verzeichnis nach Feldnummer. */
  const worlds = new Map();

  async function pullState() {
    if (!alive()) return;
    for (const member of members) {
      const bot = state.bots.get(`${profile.id}:${member.account_id}`);
      if (!bot?.online || !bot?.pov?.web) continue;
      try {
        const response = await api(`/profiles/${profile.id}/pov/${member.account_id}/state.json`, {
          raw: true,
        });
        if (response.ok) worlds.set(member.account_id, await response.json());
      } catch {
        /* der Bot ist gerade gegangen – dann steht eben der letzte Stand da */
      }
    }
    paint();
    if (alive()) timer = setTimeout(pullState, 1500);
  }
  let timer = null;

  /** Der Textweg: `:inv` fragen, die Antwort kommt als Ansicht zurück (siehe supervisor.js). */
  async function askText() {
    const accounts = members
      .filter((member) => {
        const bot = state.bots.get(`${profile.id}:${member.account_id}`);
        return bot?.online && !bot?.pov?.web;
      })
      .map((member) => member.account_id);
    if (!accounts.length) return;
    try {
      await api(`/profiles/${profile.id}/command`, {
        method: 'POST',
        body: { verb: 'inv', arg: '', accounts },
      });
    } catch (error) {
      fail(error);
    }
  }

  function itemsOf(accountId) {
    const world = worlds.get(accountId);
    if (world?.menu?.inventory?.length) {
      const out = {};
      world.menu.inventory.forEach((item, index) => {
        if (item) out[index] = item;
      });
      return { items: out, live: true, selected: Number(world.selected_hotbar) || 0 };
    }
    const view = state.bots.get(`${profile.id}:${accountId}`)?.views?.inv;
    return { items: view && !view.empty ? view.items || {} : null, live: false, selected: -1 };
  }

  function paint() {
    const cards = members.map((member) => card(member)).filter(Boolean);
    $('#inv-views').innerHTML =
      cards.join('') ||
      `<div class="empty" style="grid-column:1/-1"><h3>${escapeHtml(tr('inv.empty'))}</h3>
        <p>${escapeHtml(tr('inv.emptyHint'))}</p></div>`;
    bindHands();
  }

  function card(member) {
    const bot = state.bots.get(`${profile.id}:${member.account_id}`);
    const { items, live, selected } = itemsOf(member.account_id);
    if (!items) {
      if (!bot?.online) return '';
      return `<article class="board is-empty">
        <header>${escapeHtml(member.name)}</header>
        <p class="board-note">${escapeHtml(tr('inv.waiting'))}</p>
      </article>`;
    }
    const slot = (index, extra = '') =>
      itemSlot({
        item: items[index] || null,
        index,
        accountId: member.account_id,
        profileId: profile.id,
        extra,
        tag: 'div',
      });
    const hand = (index) =>
      itemSlot({
        item: items[36 + index] || null,
        index: 36 + index,
        accountId: member.account_id,
        profileId: profile.id,
        extra: `data-hand="${index}" data-owner="${member.account_id}" ${
          selected === index ? 'data-active="1"' : ''
        }`,
        tag: live ? 'button' : 'div',
      });

    return `<article class="board inv-card">
      <header>${escapeHtml(member.name)}</header>
      <div class="inv-top">
        <div class="inv-block">
          <span class="inv-label">${escapeHtml(tr('inv.armor'))}</span>
          <div class="menu-grid tall">${ARMOR.map((index) => slot(index)).join('')}</div>
        </div>
        <div class="inv-block">
          <span class="inv-label">${escapeHtml(tr('inv.offhand'))}</span>
          <div class="menu-grid">${slot(45)}</div>
        </div>
        <div class="inv-block grow">
          <span class="inv-label">${escapeHtml(tr('inv.craft'))}</span>
          <div class="row" style="gap:.5rem;align-items:center">
            <div class="menu-grid craft">${CRAFT.map((index) => slot(index)).join('')}</div>
            <span class="muted">${icon('arrow')}</span>
            <div class="menu-grid">${slot(0)}</div>
          </div>
        </div>
      </div>
      <span class="inv-label">${escapeHtml(tr('inv.bag'))}</span>
      <div class="menu-grid">${Array.from({ length: 27 }, (_, i) => slot(9 + i)).join('')}</div>
      <span class="inv-label">${escapeHtml(tr('inv.hotbar'))}</span>
      <div class="menu-grid hotline">${Array.from({ length: 9 }, (_, i) => hand(i)).join('')}</div>
      <footer>${escapeHtml(live ? tr('inv.liveSource') : tr('inv.textSource'))}</footer>
    </article>`;
  }

  function bindHands() {
    for (const button of $$('#inv-views button[data-hand]')) {
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.owner);
        try {
          await api(`/profiles/${profile.id}/pov/${accountId}/hotbar`, {
            method: 'POST',
            body: { slot: Number(button.dataset.hand) },
          });
        } catch (error) {
          fail(error);
        }
      });
    }
  }

  $('#inv-refresh').addEventListener('click', () => {
    askText();
    pullState();
  });

  paint();
  if (anyOnline(profile, members)) {
    askText();
    pullState();
  }

  window.addEventListener(
    'hashchange',
    () => {
      clearTimeout(timer);
    },
    { once: true }
  );

  state.onLive = (event) => {
    if (!String(event.key || '').startsWith(`${profile.id}:`)) return;
    if (event.type === 'view' && event.kind === 'inv') paint();
    if (event.type === 'state') paint();
  };
}
