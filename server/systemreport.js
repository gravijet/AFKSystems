// Der Lagebericht – was über den Webhook des Betreibers hinausgeht.
//
// **Wofür dieser Kanal jetzt da ist.** Er meldete früher neue Tickets und jede Antwort darauf.
// Das war die vierte Kopie einer Nachricht, die schon im Panel, in der Seitenleiste und in einem
// eigenen Discord-Kanal stand – Rauschen also, und ein Kanal, der rauscht, wird nicht gelesen.
//
// Hier steht stattdessen das, was **sonst nirgends** steht: wie es der Maschine geht. Wer den
// Dienst betreibt, sitzt nicht im Admin-Bereich und sieht nicht zu, wie die Platte volläuft. Zwei
// Dinge kommen deshalb an:
//
//   * **Der Bericht.** In einem festen Takt (Vorgabe: alle zwölf Stunden) eine Nachricht mit
//     Auslastung, Standorten, Bots, Kunden, Sicherungen und dem Zustand der wiederkehrenden
//     Aufgaben. Das ist der Blick, den man sonst nur bekommt, wenn man hinsieht.
//   * **Die Warnung.** Wenn etwas kippt: Platte fast voll, Speicher fast voll, ein Standort weg,
//     eine Aufgabe scheitert wiederholt, der Client fehlt. Sie kommt **sofort** und höchstens
//     einmal je Zustand und Tag – eine Warnung, die stündlich wiederkommt, ist keine Warnung mehr.
//
// **Nichts davon betrifft einen einzelnen Kunden.** Wer wie viel bezahlt hat und wer was
// geschrieben hat, gehört ins Panel und nicht in einen Chat. Hier stehen Zahlen über die Anlage,
// keine über Personen.

import os from 'node:os';
import { db, getSetting } from './db.js';
import { config } from './config.js';
import * as notify from './notify.js';
import * as mail from './mail.js';
import * as metrics from './metrics.js';
import * as nodes from './nodes.js';
import * as binaries from './binaries.js';
import * as backup from './backup.js';
import * as jobs from './jobs.js';
import { supervisor } from './supervisor.js';

/** Ab wann eine Auslastung eine Warnung wert ist. */
const WARN = { disk: 85, memory: 90, cpu: 95 };

/** Höchstens eine gleiche Warnung je Tag – siehe oben. */
const DAY_MS = 20 * 60 * 60 * 1000;
const lastAlert = new Map();

function once(key) {
  const now = Date.now();
  if (now - (lastAlert.get(key) || 0) < DAY_MS) return false;
  lastAlert.set(key, now);
  if (lastAlert.size > 500) {
    for (const [entry, at] of lastAlert) if (now - at > DAY_MS) lastAlert.delete(entry);
  }
  return true;
}

const bytes = (value) => {
  const number = Number(value) || 0;
  if (number < 1024) return `${number} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let size = number / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
};

const percent = (value) => (value === null || value === undefined ? '–' : `${Math.round(value)} %`);

/** "3 d 4 h" – für eine Laufzeit, die man auf einen Blick einordnen soll. */
function duration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

/**
 * Ein Balken aus Blöcken.
 *
 * Discord kann keine Diagramme, aber es kann eine Schriftart mit gleichen Zeichenbreiten. Zehn
 * Blöcke sagen "wie voll" schneller als eine Zahl – und die Zahl steht trotzdem daneben.
 */
function bar(value) {
  const filled = Math.max(0, Math.min(10, Math.round((Number(value) || 0) / 10)));
  return `\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\` ${percent(value)}`;
}

// ---------------------------------------------------------------- Die Zahlen sammeln

/**
 * Alles, was in den Bericht gehört – als einfaches Objekt.
 *
 * Getrennt vom Zeichnen, weil derselbe Datensatz zweimal gebraucht wird: für die Nachricht und
 * für die Prüfung, ob eine Warnung fällig ist. Zwei Messungen davon wären zwei Wahrheiten.
 */
export async function collect() {
  const snapshot = await metrics.snapshot();
  // Ein Proxy (`egress`) hat keine Maschine und kann deshalb weder online noch offline sein –
  // er zählt hier gar nicht mit. Sonst stünde im Bericht dauerhaft "3/5 online", und die zwei
  // fehlenden wären zwei Adressen, an denen nie etwas gelaufen ist.
  const machines = nodes.list().filter((node) => node.kind !== 'egress');
  const offline = machines.filter((node) => !nodes.reachable(node));

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE blocked = 0) AS users,
         (SELECT COUNT(*) FROM users WHERE last_seen_at > ?) AS active_users,
         (SELECT COUNT(*) FROM profiles) AS profiles,
         (SELECT COUNT(*) FROM profiles WHERE suspended = 1) AS suspended,
         (SELECT COUNT(*) FROM tickets WHERE status = 'open') AS open_tickets,
         (SELECT COUNT(*) FROM topups WHERE status = 'open') AS open_topups,
         (SELECT COUNT(*) FROM users WHERE delete_due_at IS NOT NULL) AS leaving`
    )
    .get(Date.now() - 7 * 86_400_000);

  const backups = backup.list();
  const failing = jobs.list().filter((job) => job.last_error);

  return {
    at: Date.now(),
    host: snapshot.host,
    afksystems: snapshot.afksystems,
    bots: supervisor.runningCount(),
    nodes: {
      total: machines.length,
      online: machines.length - offline.length,
      offline: offline.map((node) => node.name),
    },
    counts,
    client: {
      version: binaries.state.clientVersion,
      ready: binaries.state.ready,
      error: binaries.state.error,
    },
    backup: backups.length ? { name: backups[0].name, at: backups[0].created_at, size: backups[0].size } : null,
    failing: failing.map((job) => ({ key: job.key, error: job.last_error })),
  };
}

// ---------------------------------------------------------------- Der Bericht

/**
 * Der Bericht als Discord-Nachricht.
 *
 * Vier Felder nebeneinander statt eines Fließtextes: In der schmalen Ansicht von Discord ist ein
 * Absatz mit acht Zahlen darin unlesbar, vier beschriftete Kästchen sind es nicht.
 */
export function embed(data) {
  const memory = data.host.memory;
  const disk = data.host.disk;
  const worried =
    (disk && disk.percent >= WARN.disk) ||
    (memory && memory.percent >= WARN.memory) ||
    data.nodes.offline.length > 0 ||
    data.failing.length > 0 ||
    !data.client.ready;

  const fields = [
    {
      name: 'Load',
      value: [
        `CPU ${bar(data.host.cpu_percent)}`,
        `RAM ${bar(memory?.percent)} · ${bytes(memory?.used)} / ${bytes(memory?.total)}`,
        disk ? `Disk ${bar(disk.percent)} · ${bytes(disk.free)} free` : 'Disk –',
      ].join('\n'),
      inline: false,
    },
    {
      name: 'AFKSystems',
      value: [
        `${data.bots} bot(s) running`,
        `${bytes(data.afksystems.memory_bytes)} memory`,
        `up ${duration(data.afksystems.uptime_sec)}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Machine',
      value: [
        `${data.host.hostname}`,
        `${data.host.cores} core(s), load ${data.host.load.join(' / ')}`,
        `up ${duration(data.host.uptime_sec)}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Locations',
      value: data.nodes.offline.length
        ? `${data.nodes.online}/${data.nodes.total} online\n**Missing:** ${data.nodes.offline.join(', ')}`
        : `${data.nodes.online}/${data.nodes.total} online`,
      inline: true,
    },
    {
      name: 'Service',
      value: [
        `${data.counts.users} account(s), ${data.counts.active_users} seen this week`,
        `${data.counts.profiles} server slot(s), ${data.counts.suspended} suspended`,
        `${data.counts.open_tickets} open ticket(s), ${data.counts.open_topups} pending top-up(s)`,
        data.counts.leaving ? `${data.counts.leaving} account(s) scheduled for deletion` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      inline: false,
    },
    {
      name: 'Client & backup',
      value: [
        data.client.ready ? `Client ${data.client.version || '?'}` : '**No client binary**',
        data.client.error ? `⚠ ${String(data.client.error).slice(0, 180)}` : null,
        data.backup
          ? `Last backup ${new Date(data.backup.at).toISOString().slice(0, 16).replace('T', ' ')} (${bytes(
              data.backup.size
            )})`
          : 'No backup yet',
      ]
        .filter(Boolean)
        .join('\n'),
      inline: false,
    },
  ];

  if (data.failing.length) {
    fields.push({
      name: 'Jobs with errors',
      value: data.failing
        .slice(0, 5)
        .map((job) => `\`${job.key}\` — ${String(job.error).slice(0, 140)}`)
        .join('\n'),
      inline: false,
    });
  }

  return {
    title: `${config.brand} · system report`,
    url: `${config.publicUrl}/en/app#/admin/system`,
    color: worried ? notify.COLORS.warn : notify.COLORS.ok,
    fields,
  };
}

/** Den Bericht jetzt schicken. Gibt zurück, ob er angekommen ist. */
export async function send() {
  if (!notify.systemWebhook()) return false;
  const data = await collect();
  return notify.system(embed(data));
}

// ---------------------------------------------------------------- Die Warnungen

/**
 * Was gerade nicht in Ordnung ist.
 *
 * **Diese Funktion verschickt nichts.** Sie sieht nach und gibt eine Liste zurück – das ist die
 * eigentliche Auskunft, und sie steht im Admin-Bereich auch dann da, wenn gar kein Webhook
 * eingetragen ist. Ein `GET`, das nebenbei Nachrichten hinausschickt, wäre eine Überraschung:
 * Wer die Seite offen lässt, löste damit alle vier Sekunden etwas aus.
 *
 * Verschickt wird in `sendAlerts()`, und das ruft nur der Takt.
 */
export async function findAlerts() {
  const data = await collect();
  const found = [];

  const disk = data.host.disk;
  if (disk && disk.percent >= WARN.disk) {
    found.push({
      key: 'disk',
      title: { de: 'Die Platte läuft voll', en: 'Disk is filling up' },
      text: {
        de: `${percent(disk.percent)} belegt, noch ${bytes(disk.free)} frei auf ${disk.mount}.`,
        en: `${percent(disk.percent)} used, ${bytes(disk.free)} left on ${disk.mount}.`,
      },
      color: disk.percent >= 95 ? notify.COLORS.bad : notify.COLORS.warn,
    });
  }
  if (data.host.memory && data.host.memory.percent >= WARN.memory) {
    found.push({
      key: 'memory',
      title: { de: 'Der Arbeitsspeicher ist fast voll', en: 'Memory is nearly full' },
      text: {
        de: `${percent(data.host.memory.percent)} in Benutzung, noch ${bytes(data.host.memory.available)} verfügbar.`,
        en: `${percent(data.host.memory.percent)} in use, ${bytes(data.host.memory.available)} available.`,
      },
      color: notify.COLORS.warn,
    });
  }
  for (const name of data.nodes.offline) {
    found.push({
      key: `node:${name}`,
      title: { de: `Standort "${name}" meldet sich nicht`, en: `Location "${name}" is not reporting` },
      text: {
        de: 'Seine Bots wurden gestoppt. Sie kommen von selbst zurück, sobald er sich wieder meldet.',
        en: 'Its bots were stopped. They come back on their own once it reconnects.',
      },
      color: notify.COLORS.bad,
    });
  }
  if (!data.client.ready) {
    // Der Grund kommt aus binaries.js und steht dort nur auf Deutsch – ihn hier zu übersetzen
    // hieße, ihn zu erfinden. Was übersetzt ist, ist die Überschrift; der Grund bleibt im Original.
    const reason = data.client.error || '';
    found.push({
      key: 'client',
      title: { de: 'Keine Client-Datei', en: 'No client binary' },
      text: {
        de: reason || 'In data/bin liegt kein brauchbarer Client – es kann kein Bot starten.',
        en: reason || 'data/bin holds no usable client – no bot can start.',
      },
      color: notify.COLORS.bad,
    });
  }
  for (const job of data.failing) {
    const reason = String(job.error).slice(0, 400);
    found.push({
      key: `job:${job.key}`,
      title: {
        de: `Aufgabe "${job.key}" ist gescheitert`,
        en: `Scheduled task "${job.key}" failed`,
      },
      text: { de: reason, en: reason },
      color: notify.COLORS.warn,
    });
  }

  return found;
}

/** Ein Feld einer Warnung in einer Sprache. Beide Fassungen stehen daran (siehe `findAlerts`). */
export const alertText = (value, lang = 'en') =>
  value && typeof value === 'object' ? value[lang] ?? value.en ?? '' : String(value ?? '');

/** Eine Betriebswarnung an Discord und zwingend an die E-Mail-Adressen aller Administratoren. */
async function deliverAlert(alert) {
  const tasks = [];
  if (notify.systemWebhook()) {
    tasks.push(
      notify.system({
        title: `${config.brand} · ${alertText(alert.title, 'en')}`,
        description: alertText(alert.text, 'en'),
        color: alert.color,
        url: `${config.publicUrl}/en/app#/admin/system`,
      })
    );
  }
  if (mail.configured()) {
    const admins = db.prepare("SELECT * FROM users WHERE role = 'admin' AND blocked = 0").all();
    for (const admin of admins) {
      tasks.push(
        mail.sendTo(
          admin,
          'system_alert',
          {
            title: alertText(alert.title, admin.language === 'en' ? 'en' : 'de'),
            text: alertText(alert.text, admin.language === 'en' ? 'en' : 'de'),
          },
          { force: true }
        )
      );
    }
  }
  await Promise.allSettled(tasks);
}

/**
 * Dasselbe, aber mit Post: Jede Warnung geht einmal am Tag hinaus, nicht öfter.
 *
 * Eine Warnung, die stündlich wiederkommt, ist keine Warnung mehr – sie ist der Grund, warum
 * niemand mehr in den Kanal sieht. Zurück kommt trotzdem die vollständige Liste; der Takt
 * schreibt sie ins Protokoll.
 */
export async function sendAlerts() {
  const found = await findAlerts();
  for (const alert of found) {
    if (!once(alert.key)) continue;
    // Nacheinander und ohne Abbruch: Externe Dienste nehmen nur eine begrenzte Zahl Nachrichten
    // je Sekunde, und eine Warnung, die nicht durchkommt, darf die nächste nicht verschlucken.
    // eslint-disable-next-line no-await-in-loop
    await deliverAlert(alert);
  }
  return found;
}

/** Einen konkreten Standortfehler sofort melden; der normale Takt bleibt als Sicherheitsnetz. */
export async function locationFailure({ nodeName, error = '', fallbackName = null }) {
  const alert = {
    key: `node:${nodeName}`,
    title: {
      de: `Standort "${nodeName}" ist ausgefallen`,
      en: `Location "${nodeName}" failed`,
    },
    text: {
      de: fallbackName
        ? `${error || 'Der Start ist fehlgeschlagen.'}\nErsatzstandort "${fallbackName}" übernimmt automatisch.`
        : `${error || 'Der Standort ist nicht erreichbar.'}\nEs steht gerade kein Ersatzstandort zur Verfügung.`,
      en: fallbackName
        ? `${error || 'The start failed.'}\nReplacement location "${fallbackName}" is taking over automatically.`
        : `${error || 'The location is not reachable.'}\nNo replacement location is currently available.`,
    },
    color: notify.COLORS.bad,
  };
  if (!once(alert.key)) return false;
  await deliverAlert(alert);
  return true;
}

/**
 * Ein Ereignis, das den Betreiber sofort angeht – aus dem laufenden Betrieb heraus aufgerufen.
 *
 * Beim Start und beim Beenden des Dienstes zum Beispiel: Wer nachts einen Neustart sieht, den
 * niemand ausgelöst hat, weiß mehr als jeder Bericht am Morgen ihm sagen könnte.
 */
export const event = (title, text, color = notify.COLORS.info) =>
  notify.system({ title: `${config.brand} · ${title}`, description: text, color });

/** Der Takt: wie viele Millisekunden zwischen zwei Berichten liegen. 0 = kein Bericht. */
export function reportInterval() {
  const hours = Number(getSetting('system_report_hours'));
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.min(168, Math.max(1, hours)) * 3_600_000;
}

/** Wann zuletzt ein Bericht hinausging – damit ein Neustart nicht jedes Mal einen auslöst. */
let lastReport = 0;

/**
 * Der Aufruf aus dem Takt.
 *
 * Warnungen werden **jedes Mal** geprüft (sie sollen nicht bis zum nächsten Bericht warten), der
 * Bericht selbst nur, wenn seit dem letzten genug Zeit vergangen ist. So kann der Takt eng sein,
 * ohne dass der Kanal volläuft.
 */
export async function tick() {
  const found = await sendAlerts();
  const interval = reportInterval();
  if (interval && Date.now() - lastReport >= interval) {
    lastReport = Date.now();
    await send();
  }
  return found.length;
}

/** Die Meldung beim Hochfahren. Sie steht hier, damit index.js nur einen Aufruf braucht. */
export function announceStart() {
  if (!notify.systemWebhook()) return;
  event(
    'Panel started',
    [
      `Version ${binaries.state.clientVersion || 'client not loaded'}`,
      `Host ${os.hostname()} · Node ${process.version}`,
      `Address ${config.publicUrl}`,
    ].join('\n'),
    notify.COLORS.ok
  );
}
