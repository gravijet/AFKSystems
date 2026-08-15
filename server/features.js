// Was das Panel kann – und was davon der Client heute wirklich hergibt.
//
// Diese Liste ist die einzige Wahrheitsquelle: das Dashboard zeichnet daraus die Hinweise an den
// betroffenen Stellen, die Startseite ihre Übersicht, und `GET /api/meta` liefert sie ans
// Frontend. Der Zustand wird **nicht von Hand gepflegt**, sondern aus den Fähigkeiten der
// Client-Dateien berechnet (binaries.js liest sie aus `--help`). Kommt im Client etwas dazu,
// stimmt das Panel nach dem nächsten Abgleich von selbst.
//
// status:
//   ready    – läuft, für alle
//   premium  – läuft mit einem bezahlten Serverplatz (Premium-Client)
//   soon     – geplant, noch nicht da
//   no       – bewusst nicht gebaut, mit Begründung
//   missing  – der Client müsste es können, kann es aber gerade nicht (Datei fehlt/veraltet)

const list = (caps) => [
  {
    key: 'versions',
    group: 'connection',
    status: 'ready',
    de: {
      title: 'Alle Client-Versionen',
      text: 'Jede Minecraft-Version, die der Client spricht, ist im Panel wählbar – die Liste kommt aus dem Client selbst.',
    },
    en: {
      title: 'Every client version',
      text: 'Every Minecraft version the client speaks is selectable in the panel – the list comes from the client itself.',
    },
  },
  {
    key: 'always-online',
    group: 'connection',
    status: 'ready',
    de: { title: '24/7 online', text: 'Die Bots laufen auf unserem Server weiter, auch wenn dein Rechner aus ist.' },
    en: { title: '24/7 online', text: 'Bots keep running on our server, even with your own machine switched off.' },
  },
  {
    key: 'reconnect',
    group: 'connection',
    status: 'ready',
    de: { title: 'Automatischer Reconnect', text: 'Nach Kick oder Abbruch verbindet der Client von selbst neu, mit wachsender Wartezeit.' },
    en: { title: 'Automatic reconnect', text: 'After a kick or drop the client reconnects on its own, with growing backoff.' },
  },
  {
    key: 'anti-kick',
    group: 'connection',
    status: 'ready',
    de: {
      title: 'Kick-Schutz',
      text: 'KeepAlive, Ping/Pong, Teleport-Bestätigung, Resource-Packs, Chat-Quittungen, Respawn, Verhaltenskodex – alles im Protokoll, ohne Gezappel.',
    },
    en: {
      title: 'Kick protection',
      text: 'KeepAlive, ping/pong, teleport confirmations, resource packs, chat acknowledgements, respawn, code of conduct – all in-protocol, no twitching.',
    },
  },
  {
    key: 'transfer',
    group: 'connection',
    status: 'ready',
    de: { title: 'Server-Transfer folgen', text: 'Schickt der Server den Bot weiter, folgt der Client dem neuen Ziel.' },
    en: { title: 'Follow server transfers', text: 'If the server hands the bot on, the client follows to the new target.' },
  },
  {
    key: 'multi-server',
    group: 'connection',
    status: 'ready',
    de: { title: 'Mehrere Server', text: 'Beliebig viele Serverplätze; dieselben Konten dürfen auf mehreren gleichzeitig laufen.' },
    en: { title: 'Multiple servers', text: 'As many server slots as you like; the same accounts may run on several at once.' },
  },
  {
    key: 'chat-read',
    group: 'chat',
    status: 'ready',
    de: { title: 'Chat mitlesen', text: 'Jede Nachricht landet live im Panel, mit Farben und Formatierung des Servers.' },
    en: { title: 'Read chat', text: 'Every message lands in the panel live, with the server’s colours and formatting.' },
  },
  {
    key: 'chat-send',
    group: 'chat',
    status: 'ready',
    de: { title: 'Chat schreiben', text: 'Nachrichten und Befehle an ein Konto oder an alle ausgewählten gleichzeitig.' },
    en: { title: 'Write chat', text: 'Messages and commands to one account or to every selected one at once.' },
  },
  {
    key: 'spam',
    group: 'chat',
    status: 'ready',
    de: { title: 'Wiederholte Nachrichten', text: 'Nachrichten und Befehle im Zeittakt, änderbar ohne Neustart des Bots.' },
    en: { title: 'Repeating messages', text: 'Messages and commands on a timer, changeable without restarting the bot.' },
  },
  {
    key: 'join-commands',
    group: 'chat',
    status: 'ready',
    de: { title: 'Befehle beim Beitritt', text: 'Beim Betreten laufen die hinterlegten Befehle, etwa /server survival.' },
    en: { title: 'Join commands', text: 'On joining, your stored commands run – /server survival, for instance.' },
  },
  {
    key: 'macros',
    group: 'automation',
    status: 'ready',
    de: { title: 'Macros', text: 'Auslöser (Beitritt, Zeittakt, Chatzeile, Weltwechsel, Tod, Abbruch) und eine Kette von Schritten.' },
    en: { title: 'Macros', text: 'Triggers (join, timer, chat line, world change, death, disconnect) and a chain of steps.' },
  },
  {
    key: 'world-change',
    group: 'automation',
    status: 'ready',
    de: { title: 'Befehle bei Weltwechsel', text: 'Unterserver-Wechsel und Respawn in einer anderen Welt melden sich – daran hängt ein eigenes Macro.' },
    en: { title: 'Commands on world change', text: 'Sub-server switches and respawns in another world are reported – hang a macro off it.' },
  },
  {
    key: 'anti-afk',
    group: 'automation',
    status: caps.antiafk ? 'premium' : 'missing',
    de: {
      title: 'Anti-AFK-Bewegung',
      text: 'Gegen Plugins, die auf echte Bewegung prüfen: Arm schwingen, Kopf drehen, zurückdrehen – zurückhaltend, im Minutenabstand.',
    },
    en: {
      title: 'Anti-AFK movement',
      text: 'Against plugins that look for real movement: swing arm, turn head, turn back – restrained, minutes apart.',
    },
  },
  {
    key: 'movement',
    group: 'movement',
    status: caps.movement ? 'premium' : 'missing',
    de: { title: 'Laufen, springen, umsehen', text: 'Gehen in vier Richtungen, Blickrichtung setzen, springen, fallen lassen.' },
    en: { title: 'Walk, jump, look around', text: 'Walk in four directions, set view direction, jump, drop down.' },
  },
  {
    key: 'home-route',
    group: 'movement',
    status: caps.movement ? 'premium' : 'missing',
    de: { title: 'Heimatposition und Route', text: 'Position merken, Weg aufzeichnen und nach jedem Beitritt automatisch dorthin zurücklaufen.' },
    en: { title: 'Home position and route', text: 'Remember a spot, record a path, and walk back there automatically after every join.' },
  },
  {
    key: 'sneak',
    group: 'movement',
    status: caps.sneak ? 'premium' : 'missing',
    de: { title: 'Schleichen, Sprinten, Schlagen', text: 'Geduckt bleiben, sprinten, Arm schwingen, Gegenstand benutzen, Schnellleiste wählen.' },
    en: { title: 'Sneak, sprint, swing', text: 'Stay crouched, sprint, swing your arm, use an item, pick a hotbar slot.' },
  },
  {
    key: 'scoreboard',
    group: 'game',
    status: caps.board ? 'premium' : 'missing',
    de: { title: 'Anzeigetafel und Tab-Liste', text: 'Die Seitenleiste des Servers und die Spielerliste, so wie sie im Spiel stünden.' },
    en: { title: 'Scoreboard and tab list', text: 'The server’s sidebar and the player list, as they would appear in-game.' },
  },
  {
    key: 'inventory',
    group: 'game',
    status: caps.menu ? 'premium' : 'missing',
    de: {
      title: 'Menüs anklicken',
      text: 'Öffnet der Server ein Menü, siehst du Überschrift und Feldzahl und klickst ein Feld an. Was in den Feldern liegt, liest der Client bewusst nicht.',
    },
    en: {
      title: 'Click through menus',
      text: 'When the server opens a menu you see its title and slot count and can click a slot. What sits in the slots is deliberately not read.',
    },
  },
  {
    key: 'pov',
    group: 'game',
    status: 'no',
    de: {
      title: 'Live-Ansicht (POV)',
      text: 'Gibt es nicht. Für ein Bild müsste der Client Chunks, Blöcke und Entitäten im Speicher halten – aus wenigen MB würden Hunderte.',
    },
    en: {
      title: 'Live view (POV)',
      text: 'Not offered. Rendering a view would mean holding chunks, blocks and entities in memory – a few MB would become hundreds.',
    },
  },
  {
    key: 'accounts-microsoft',
    group: 'accounts',
    status: 'ready',
    de: { title: 'Microsoft-Konten', text: 'Anmeldung über den Gerätecode – dein Passwort sieht das Panel nie, gespeichert wird nur der Token des Clients.' },
    en: { title: 'Microsoft accounts', text: 'Device-code sign-in – the panel never sees your password, only the client’s token is stored.' },
  },
  {
    key: 'accounts-offline',
    group: 'accounts',
    status: caps.offline ? 'premium' : 'missing',
    de: { title: 'Offline-/Cracked-Konten', text: 'Für Server mit online-mode=false: Name eingeben, die UUID rechnet der Client wie der Server aus.' },
    en: { title: 'Offline / cracked accounts', text: 'For servers with online-mode=false: enter a name, the client derives the UUID exactly as the server does.' },
  },
  {
    key: 'accounts-bedrock',
    group: 'accounts',
    status: 'soon',
    de: { title: 'Bedrock-Konten', text: 'In Arbeit. Bedrock ist ein eigener Protokollstapel (RakNet), also im Grunde ein zweiter Client.' },
    en: { title: 'Bedrock accounts', text: 'In the works. Bedrock is a separate protocol stack (RakNet) – effectively a second client.' },
  },
  {
    key: 'proxies',
    group: 'network',
    status: caps.proxy ? 'premium' : 'missing',
    de: {
      title: 'Proxys je Konto',
      text: 'SOCKS5 oder HTTP je Bot – für mehr Konten auf einem Server. Für bezahlte Plätze, Zuteilung über ein Ticket.',
    },
    en: {
      title: 'Per-account proxies',
      text: 'SOCKS5 or HTTP per bot – for more accounts on one server. Paid slots only, assigned through a ticket.',
    },
  },
  {
    key: 'fakehost',
    group: 'network',
    status: caps.fakehost ? 'premium' : 'missing',
    de: { title: 'Fake-Host im Handshake', text: 'Die Adresse im Handshake lässt sich frei setzen; die Verbindung geht trotzdem zum echten Ziel.' },
    en: { title: 'Fake host in the handshake', text: 'Set the address sent in the handshake freely; the connection still goes to the real target.' },
  },
  {
    key: 'credits',
    group: 'panel',
    status: 'ready',
    de: { title: 'Guthaben statt Abo', text: 'Ein Credit ist ein Cent. Ein Serverplatz ist gratis, jeder weitere kostet seinen Monatspreis.' },
    en: { title: 'Credits, not subscriptions', text: 'One credit is one cent. One server slot is free, every further one costs its monthly price.' },
  },
  {
    key: 'tickets',
    group: 'panel',
    status: 'ready',
    de: { title: 'Support-Tickets', text: 'Fragen, Proxy-Anfragen und Fehlermeldungen laufen als Ticket im Panel – mit Verlauf.' },
    en: { title: 'Support tickets', text: 'Questions, proxy requests and bug reports run as tickets in the panel – with history.' },
  },
  {
    key: 'discord',
    group: 'panel',
    status: 'ready',
    de: { title: 'Discord', text: 'Konto verknüpfen und über einen Webhook Bescheid bekommen, wenn ein Bot abbricht oder das Guthaben knapp wird.' },
    en: { title: 'Discord', text: 'Link your account and get a webhook message when a bot drops or credits run low.' },
  },
  {
    key: 'mobile',
    group: 'panel',
    status: 'ready',
    de: { title: 'Vom Handy aus', text: 'Das Dashboard ist für kleine Bildschirme gebaut – starten, stoppen, chatten unterwegs.' },
    en: { title: 'From your phone', text: 'The dashboard is built for small screens – start, stop and chat on the move.' },
  },
];

export const GROUPS = {
  connection: { de: 'Verbindung', en: 'Connection' },
  chat: { de: 'Chat', en: 'Chat' },
  automation: { de: 'Automatik', en: 'Automation' },
  movement: { de: 'Bewegung', en: 'Movement' },
  game: { de: 'Im Spiel', en: 'In-game' },
  accounts: { de: 'Konten', en: 'Accounts' },
  network: { de: 'Netzwerk', en: 'Network' },
  panel: { de: 'Panel', en: 'Panel' },
};

/** Die Feature-Liste für eine Sprache, berechnet aus den Fähigkeiten der vorhandenen Bauformen. */
export function features(caps = {}, lang = 'de') {
  const key = lang === 'en' ? 'en' : 'de';
  return list(caps).map((feature) => ({
    key: feature.key,
    group: feature.group,
    group_label: GROUPS[feature.group][key],
    status: feature.status,
    title: feature[key].title,
    text: feature[key].text,
  }));
}

/** Zustand eines einzelnen Schlüssels – für Prüfungen im Backend. */
export function statusOf(key, caps = {}) {
  return list(caps).find((feature) => feature.key === key)?.status || 'missing';
}
