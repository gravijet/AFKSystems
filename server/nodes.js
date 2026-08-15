// Standorte.
//
// Ein Standort ist der Ort, über den ein Serverplatz nach draußen geht. Es gibt genau einen vom
// Typ `local` – diese Maschine – und beliebig viele weitere, hinter denen eine andere Adresse
// steckt: ein zweiter VPS mit einem SOCKS5-Dienst darauf, oder eine zweite IP dieses Servers.
//
// Warum das so und nicht anders: Was einen zweiten Standort ausmacht, ist aus Sicht eines
// Minecraft-Servers seine **IP-Adresse**. Ob der Bot-Prozess neben dem Panel oder auf dem anderen
// Rechner läuft, sieht dort niemand – die Adresse dagegen schon, und an ihr hängt, wie viele
// Konten auf denselben Server dürfen. Ein Standort ist deshalb eine Ausgangsadresse plus die
// Regeln, wer sie benutzen darf und wie viel dort laufen darf.
//
// Wie man einen anlegt, steht Schritt für Schritt in docs/standorte.md.

import { db, audit } from './db.js';
import { supervisor } from './supervisor.js';
import { bad, notFound, requireInt, requireString } from './util.js';

export const ACCESS = ['all', 'listed', 'admin'];

export const list = ({ includeInactive = false } = {}) =>
  db
    .prepare(`SELECT * FROM nodes ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`)
    .all();

export const byId = (id) => db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);

export const localNode = () =>
  db.prepare("SELECT * FROM nodes WHERE kind = 'local' ORDER BY id LIMIT 1").get();

export const usersOf = (nodeId) =>
  db
    .prepare(
      `SELECT u.id, u.username FROM node_users nu JOIN users u ON u.id = nu.user_id
        WHERE nu.node_id = ? ORDER BY u.username COLLATE NOCASE`
    )
    .all(nodeId);

/** Wie viel auf einem Standort schon liegt. */
export function usage(nodeId) {
  const profiles = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE node_id = ?').get(nodeId).n;
  const accounts = db
    .prepare(
      `SELECT COUNT(*) AS n FROM profile_accounts pa JOIN profiles p ON p.id = pa.profile_id
        WHERE p.node_id = ?`
    )
    .get(nodeId).n;
  return { profiles, accounts, bots_running: supervisor.runningOnNode(nodeId) };
}

/** Darf dieser Nutzer hier einen Serverplatz anlegen? */
export function canUse(node, user) {
  if (!node || !node.active) return false;
  if (user.role === 'admin') return true;
  if (node.access === 'admin') return false;
  if (node.access === 'all') return true;
  return Boolean(
    db.prepare('SELECT 1 FROM node_users WHERE node_id = ? AND user_id = ?').get(node.id, user.id)
  );
}

/** Die Standorte, die dieser Nutzer zur Auswahl bekommt – samt Auslastung. */
export function visibleFor(user) {
  return list()
    .filter((node) => canUse(node, user))
    .map((node) => ({ ...view(node), full: isFull(node) }));
}

export function isFull(node) {
  const used = usage(node.id);
  if (node.max_profiles > 0 && used.profiles >= node.max_profiles) return true;
  if (node.max_bots > 0 && used.bots_running >= node.max_bots) return true;
  return false;
}

/** Was ein Kunde von einem Standort zu sehen bekommt – ohne Innereien wie die Proxy-Zugangsdaten. */
export function view(node) {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    region: node.region || '',
    note: node.note || '',
    shared: node.access === 'all',
  };
}

/** Dasselbe für den Admin-Bereich: mit allem. */
export function adminView(node) {
  const proxy = node.proxy_id
    ? db.prepare('SELECT id, label, kind, host, port FROM proxies WHERE id = ?').get(node.proxy_id)
    : null;
  return {
    ...node,
    active: Boolean(node.active),
    proxy,
    users: usersOf(node.id),
    usage: usage(node.id),
    full: isFull(node),
  };
}

/**
 * Den Standort für einen neuen Serverplatz bestimmen. Ohne Wunsch nimmt er den ersten freien,
 * den der Nutzer benutzen darf – gibt es keinen, ist das ein Fehler und keine stille Zuweisung
 * auf einen vollen Standort.
 */
export function pick(user, wantedId = null) {
  if (wantedId) {
    const node = byId(requireInt(wantedId, 'Standort'));
    if (!node) throw notFound('Diesen Standort gibt es nicht.', { en: 'No such location.' });
    if (!canUse(node, user)) {
      throw bad('Dieser Standort steht dir nicht zur Verfügung.', {
        en: 'That location is not available to you.',
      });
    }
    if (isFull(node) && user.role !== 'admin') {
      throw bad(`Der Standort "${node.name}" ist voll. Bitte einen anderen wählen.`, {
        en: `Location "${node.name}" is full. Please pick another one.`,
      });
    }
    return node;
  }
  const open = list().filter((node) => canUse(node, user) && !isFull(node));
  if (!open.length) {
    const any = list().filter((node) => canUse(node, user));
    if (!any.length) {
      throw bad('Für dieses Konto ist gerade kein Standort freigegeben. Bitte melde dich beim Support.', {
        en: 'No location is enabled for this account right now. Please contact support.',
      });
    }
    throw bad('Alle für dich freigegebenen Standorte sind voll. Bitte melde dich beim Support.', {
      en: 'Every location you may use is full. Please contact support.',
    });
  }
  return open[0];
}

// ---------------------------------------------------------------- Verwalten

export function create(body, by) {
  const name = requireString(body.name, 'Name', { max: 60 });
  const access = ACCESS.includes(body.access) ? body.access : 'all';
  const info = db
    .prepare(
      `INSERT INTO nodes (name, kind, region, proxy_id, max_bots, max_profiles, access, note, active, sort, created_at)
       VALUES (?, 'egress', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      String(body.region || '').slice(0, 60),
      body.proxy_id ? requireInt(body.proxy_id, 'Proxy') : null,
      requireInt(body.max_bots ?? 0, 'Bots', { max: 10_000 }),
      requireInt(body.max_profiles ?? 0, 'Server', { max: 10_000 }),
      access,
      String(body.note || '').slice(0, 400) || null,
      body.active === false ? 0 : 1,
      requireInt(body.sort ?? 50, 'Reihenfolge', { max: 999 }),
      Date.now()
    );
  if (Array.isArray(body.users)) setUsers(info.lastInsertRowid, body.users);
  audit(by, 'node-create', { id: info.lastInsertRowid, name, access });
  return byId(info.lastInsertRowid);
}

export function update(id, body, by) {
  const node = byId(id);
  if (!node) throw notFound('Diesen Standort gibt es nicht.', { en: 'No such location.' });
  const set = [];
  const values = [];
  const put = (column, value) => {
    set.push(`${column} = ?`);
    values.push(value);
  };

  if (body.name !== undefined) put('name', requireString(body.name, 'Name', { max: 60 }));
  if (body.region !== undefined) put('region', String(body.region || '').slice(0, 60));
  if (body.note !== undefined) put('note', String(body.note || '').slice(0, 400) || null);
  if (body.proxy_id !== undefined) {
    const proxyId = body.proxy_id ? requireInt(body.proxy_id, 'Proxy') : null;
    if (proxyId && !db.prepare('SELECT 1 FROM proxies WHERE id = ?').get(proxyId)) {
      throw notFound('Diesen Proxy gibt es nicht.', { en: 'No such proxy.' });
    }
    put('proxy_id', proxyId);
  }
  if (body.max_bots !== undefined) put('max_bots', requireInt(body.max_bots, 'Bots', { max: 10_000 }));
  if (body.max_profiles !== undefined) {
    put('max_profiles', requireInt(body.max_profiles, 'Server', { max: 10_000 }));
  }
  if (body.access !== undefined) {
    if (!ACCESS.includes(body.access)) throw bad('Unbekannte Zugangsregel.', { en: 'Unknown access rule.' });
    put('access', body.access);
  }
  if (body.sort !== undefined) put('sort', requireInt(body.sort, 'Reihenfolge', { max: 999 }));
  if (body.active !== undefined) {
    // Der Haupt-Standort lässt sich nicht abschalten – auf ihm läuft alles, was kein Zuhause hat.
    if (node.kind === 'local' && !body.active) {
      throw bad('Der Haupt-Standort lässt sich nicht abschalten.', {
        en: 'The main location cannot be switched off.',
      });
    }
    put('active', body.active ? 1 : 0);
  }

  if (set.length) {
    values.push(node.id);
    db.prepare(`UPDATE nodes SET ${set.join(', ')} WHERE id = ?`).run(...values);
  }
  if (Array.isArray(body.users)) setUsers(node.id, body.users);
  audit(by, 'node-update', { id: node.id, ...body, users: undefined });
  return byId(node.id);
}

export function setUsers(nodeId, userIds) {
  const insert = db.prepare(
    'INSERT INTO node_users (node_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
  );
  db.transaction(() => {
    db.prepare('DELETE FROM node_users WHERE node_id = ?').run(nodeId);
    for (const raw of userIds) {
      const id = Number(raw);
      if (Number.isFinite(id) && db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
        insert.run(nodeId, id);
      }
    }
  })();
  return usersOf(nodeId);
}

export function remove(id, by) {
  const node = byId(id);
  if (!node) throw notFound('Diesen Standort gibt es nicht.', { en: 'No such location.' });
  if (node.kind === 'local') {
    throw bad('Der Haupt-Standort lässt sich nicht löschen.', {
      en: 'The main location cannot be deleted.',
    });
  }
  const used = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE node_id = ?').get(id).n;
  if (used) {
    throw bad(
      `Auf diesem Standort liegen noch ${used} Serverplätze. Verschiebe sie zuerst oder schalte ihn nur ab.`,
      { en: `${used} server slots still sit on this location. Move them first, or just switch it off.` }
    );
  }
  db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  audit(by, 'node-delete', { id, name: node.name });
}

/** Einen Serverplatz auf einen anderen Standort schieben. Läuft er, geht er dafür kurz aus. */
export function move(profileId, nodeId, by) {
  const node = byId(nodeId);
  if (!node) throw notFound('Diesen Standort gibt es nicht.', { en: 'No such location.' });
  db.prepare('UPDATE profiles SET node_id = ? WHERE id = ?').run(node.id, profileId);
  // Die Ausgangsadresse steht in den Startargumenten des Clients – ein laufender Bot benutzt
  // weiter die alte, bis er neu startet. Also gleich anhalten und wieder hochfahren lassen.
  supervisor.stopProfile(profileId, `Standort gewechselt zu "${node.name}" – Bots starten neu.`, {
    keepWanted: true,
  });
  setTimeout(() => {
    for (const row of db
      .prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ? AND wanted = 1')
      .all(profileId)) {
      const context = supervisor.context(profileId, row.account_id);
      if (context) {
        try {
          supervisor.start(context);
        } catch {
          /* der Zustand des Bots sagt, warum */
        }
      }
    }
  }, 2000).unref();
  audit(by, 'node-move', { profile: profileId, node: node.id });
  return node;
}
