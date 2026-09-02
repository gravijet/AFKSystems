// Standorte.
//
// Ein Standort ist eine **Maschine**, auf der Bots laufen. Dort werden CPU, Arbeitsspeicher und
// Platte verbraucht, und genau die begrenzt ein Standort auch. Ein Proxy ist etwas anderes: nur
// eine Ausgangsadresse, ohne eigene Rechenleistung – deshalb steht an einem Proxy nie eine
// Auslastung.
//
// Drei Arten:
//
//   local   diese Maschine. Gibt es immer genau einmal, braucht kein Token, lässt sich nicht
//           abschalten und nicht löschen.
//   agent   ein anderer Rechner mit dem Standort-Agenten darauf (agent/index.js). Er meldet sich
//           mit seinem Token beim Panel und bekommt von dort Bots zugewiesen; die Prozesse laufen
//           auf ihm, und er meldet seine Auslastung zurück.
//   egress  nur eine Ausgangsadresse: die Bots laufen weiter auf der Panel-Maschine und gehen
//           über einen Proxy hinaus. Das war früher die einzige Art; sie bleibt für alles, wo es
//           wirklich nur um eine zweite IP geht.
//
// Aus Sicht eines Minecraft-Servers ist ein Bot seine IP-Adresse. Ein `agent`-Standort bringt
// beides mit: eine eigene Adresse **und** eigene Rechenleistung. Ein `egress`-Standort nur die
// Adresse.
//
// Wie man einen anlegt, steht Schritt für Schritt in docs/standorte.md.

import { db, audit } from './db.js';
import { supervisor } from './supervisor.js';
import * as agents from './agents.js';
import { bad, notFound, requireInt, requireString, token as randomToken } from './util.js';

export const ACCESS = ['all', 'listed', 'admin'];
export const KINDS = ['agent', 'egress'];

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

/**
 * Was die Maschine hinter einem Standort gerade tut.
 *
 * Für `local` kommt das aus dem eigenen /proc (metrics.js sammelt es und legt es hier ab), für
 * `agent` aus dem, was der Standort zuletzt gemeldet hat. Für `egress` gibt es nichts – dort
 * läuft kein Prozess, dort ist nur eine Adresse.
 */
let localStats = null;
export const setLocalStats = (stats) => {
  localStats = stats;
};

export function resources(node) {
  if (node.kind === 'local') return localStats;
  if (node.kind === 'agent') return agents.stats(node.id);
  return null;
}

/** Ist der Standort gerade ansprechbar? `local` immer, `egress` immer, `agent` nur mit Leitung. */
export function reachable(node) {
  if (!node?.active) return false;
  if (node.kind === 'agent') return agents.isOnline(node.id);
  return true;
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

/**
 * Ist hier kein Platz mehr?
 *
 * Neben den gezählten Grenzen (Serverplätze, Bots) zählen jetzt auch die gemessenen: ein Standort,
 * dessen Maschine bei 95 % CPU steht oder dessen Platte voll ist, ist voll, auch wenn
 * rechnerisch noch Bots hineinpassten.
 * Das ist der Unterschied zwischen einer Zahl im Formular und der Wirklichkeit.
 */
export function isFull(node) {
  const used = usage(node.id);
  if (node.max_profiles > 0 && used.profiles >= node.max_profiles) return true;
  if (node.max_bots > 0 && used.bots_running >= node.max_bots) return true;
  const stats = resources(node);
  if (stats) {
    if (node.max_cpu_percent > 0 && (stats.cpu_percent ?? 0) >= node.max_cpu_percent) return true;
    if (node.max_mem_percent > 0 && (stats.memory?.percent ?? 0) >= node.max_mem_percent) return true;
    if (node.max_disk_percent > 0 && (stats.disk?.percent ?? 0) >= node.max_disk_percent) return true;
  }
  return false;
}

/** Was ein Kunde von einem Standort zu sehen bekommt – ohne Innereien wie die Proxy-Zugangsdaten. */
export function view(node) {
  const stats = resources(node);
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    region: node.region || '',
    note: node.note || '',
    shared: node.access === 'all',
    online: reachable(node),
    // Grob genug, um einen vollen Standort zu erkennen, und zu grob, um daraus etwas über die
    // Maschine zu lernen, das einen Kunden nichts angeht.
    load: stats
      ? {
          cpu: Math.round(stats.cpu_percent ?? 0),
          memory: Math.round(stats.memory?.percent ?? 0),
        }
      : null,
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
    online: reachable(node),
    // Ressourcen gibt es nur, wo etwas läuft. Ein reiner Ausgangs-Standort hat keine.
    resources: resources(node),
    agent: node.kind === 'agent' ? agents.info(node.id) : null,
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
    // Ein Standort ohne Leitung kann keinen Bot starten. Das jetzt zu sagen ist ehrlicher, als
    // den Serverplatz dort anzulegen und den Fehler beim ersten Startversuch zu zeigen.
    if (!reachable(node) && user.role !== 'admin') {
      throw bad(`Der Standort "${node.name}" ist gerade nicht erreichbar.`, {
        en: `Location "${node.name}" is not reachable right now.`,
      });
    }
    return node;
  }
  // Ein Standort, dessen Agent gerade nicht verbunden ist, ist keine stille Zuweisung wert:
  // dort ließe sich kein Bot starten, und der Kunde stünde vor einer Fehlermeldung, die er sich
  // nicht erklären kann.
  const open = list().filter((node) => canUse(node, user) && !isFull(node) && reachable(node));
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
  const kind = KINDS.includes(body.kind) ? body.kind : 'agent';
  // Ein Standort mit eigener Maschine bekommt sein Token beim Anlegen. Es ist das Einzige, was
  // der andere Rechner braucht – und es steht danach nur noch im Admin-Bereich.
  const token = kind === 'agent' ? randomToken(32) : null;
  // Genauso geprüft wie beim Ändern: Ohne diese Zeile lief eine unbekannte Proxy-Nummer in den
  // Fremdschlüssel der Datenbank und kam als nackter SQLite-Fehler mit Status 500 zurück – für
  // den Betreiber ununterscheidbar von "das Panel ist kaputt".
  const proxyId = body.proxy_id ? requireInt(body.proxy_id, 'Proxy') : null;
  if (proxyId && !db.prepare('SELECT 1 FROM proxies WHERE id = ?').get(proxyId)) {
    throw notFound('Diesen Proxy gibt es nicht.', { en: 'No such proxy.' });
  }
  const info = db
    .prepare(
      `INSERT INTO nodes (name, kind, region, proxy_id, max_bots, max_profiles, max_cpu_percent,
                          max_mem_percent, max_disk_percent, access, note, active, sort, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      kind,
      String(body.region || '').slice(0, 60),
      proxyId,
      requireInt(body.max_bots ?? 0, 'Bots', { max: 10_000 }),
      requireInt(body.max_profiles ?? 0, 'Server', { max: 10_000 }),
      requireInt(body.max_cpu_percent ?? 0, 'CPU-Grenze', { max: 100 }),
      requireInt(body.max_mem_percent ?? 0, 'Speichergrenze', { max: 100 }),
      requireInt(body.max_disk_percent ?? 0, 'Festplattengrenze', { max: 100 }),
      access,
      String(body.note || '').slice(0, 400) || null,
      body.active === false ? 0 : 1,
      requireInt(body.sort ?? 50, 'Reihenfolge', { max: 999 }),
      token,
      Date.now()
    );
  if (Array.isArray(body.users)) setUsers(info.lastInsertRowid, body.users);
  audit(by, 'node-create', { id: info.lastInsertRowid, name, kind, access });
  return byId(info.lastInsertRowid);
}

/**
 * Ein neues Token setzen.
 *
 * Nötig, wenn eines abhandengekommen ist. Der Standort fliegt damit sofort heraus und muss mit
 * dem neuen Token wieder eingerichtet werden – das ist der Sinn der Sache.
 */
export function rotateToken(id, by) {
  const node = byId(id);
  if (!node) throw notFound('Diesen Standort gibt es nicht.', { en: 'No such location.' });
  if (node.kind !== 'agent') {
    throw bad('Nur ein Standort mit eigener Maschine hat ein Token.', {
      en: 'Only a location with its own machine has a token.',
    });
  }
  const token = randomToken(32);
  db.prepare('UPDATE nodes SET token = ? WHERE id = ?').run(token, node.id);
  audit(by, 'node-token', { id: node.id, name: node.name });
  return byId(node.id);
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
  if (body.max_cpu_percent !== undefined) {
    put('max_cpu_percent', requireInt(body.max_cpu_percent, 'CPU-Grenze', { max: 100 }));
  }
  if (body.max_mem_percent !== undefined) {
    put('max_mem_percent', requireInt(body.max_mem_percent, 'Speichergrenze', { max: 100 }));
  }
  if (body.max_disk_percent !== undefined) {
    put('max_disk_percent', requireInt(body.max_disk_percent, 'Festplattengrenze', { max: 100 }));
  }
  // Die Art lässt sich nachträglich ändern – aus einer reinen Adresse wird eine Maschine, sobald
  // jemand den Agenten darauf installiert. Ein Token entsteht dabei von selbst.
  if (body.kind !== undefined && node.kind !== 'local') {
    if (!KINDS.includes(body.kind)) throw bad('Unbekannte Art.', { en: 'Unknown kind.' });
    put('kind', body.kind);
    if (body.kind === 'agent' && !node.token) put('token', randomToken(32));
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
