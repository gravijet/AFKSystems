// Was das Panel kann – und was davon der Client heute wirklich hergibt.
//
// Diese Liste ist die einzige Wahrheitsquelle: das Dashboard zeichnet daraus die Hinweise an den
// betroffenen Stellen ("braucht die Bewegungs-Bauform", "kann der Client noch nicht"), die
// Startseite ihre Feature-Übersicht, und `GET /api/meta` liefert sie ans Frontend. Kommt im Client
// etwas dazu, wird hier ein Eintrag umgestellt – nicht an zehn Stellen im Frontend.
//
// status:
//   ready     – läuft
//   movement  – läuft, sobald das Profil die Bewegungs-Bauform nutzt (afk-linux-move)
//   missing   – der Client kann es noch nicht; im Panel sichtbar, aber abgeschaltet

export const FEATURES = [
  {
    key: 'versions',
    group: 'Verbindung',
    title: 'Alle Client-Versionen',
    status: 'ready',
    text: 'Jede Minecraft-Version, die der Client spricht, ist im Panel wählbar – die Liste kommt aus dem Client selbst.',
  },
  {
    key: 'always-online',
    group: 'Verbindung',
    title: '24/7 online',
    status: 'ready',
    text: 'Die Bots laufen auf dem Server weiter, auch wenn der eigene Rechner aus ist.',
  },
  {
    key: 'reconnect',
    group: 'Verbindung',
    title: 'Automatischer Reconnect',
    status: 'ready',
    text: 'Nach einem Kick oder Abbruch verbindet der Client von selbst neu, mit wachsender Wartezeit.',
  },
  {
    key: 'anti-kick',
    group: 'Verbindung',
    title: 'Kick-Schutz',
    status: 'ready',
    text: 'KeepAlive, Ping/Pong, Teleport-Bestätigung, Resource-Packs, Chat-Quittungen, Respawn und Server-Transfer – alles im Protokoll, ohne Gezappel.',
  },
  {
    key: 'transfer',
    group: 'Verbindung',
    title: 'Server-Transfer folgen',
    status: 'ready',
    text: 'Schickt der Server den Bot weiter, folgt der Client dem neuen Ziel.',
  },
  {
    key: 'multi-server',
    group: 'Verbindung',
    title: 'Mehrere Server',
    status: 'ready',
    text: 'Beliebig viele Serverprofile, dieselben Konten dürfen auf mehreren gleichzeitig laufen.',
  },
  {
    key: 'chat-read',
    group: 'Chat',
    title: 'Chat mitlesen',
    status: 'ready',
    text: 'Jede Nachricht landet live im Panel, mit Farben und Formatierung des Servers.',
  },
  {
    key: 'chat-send',
    group: 'Chat',
    title: 'Chat schreiben',
    status: 'ready',
    text: 'Nachrichten und Befehle an ein Konto oder an alle ausgewählten gleichzeitig.',
  },
  {
    key: 'spam',
    group: 'Chat',
    title: 'Wiederholte Nachrichten',
    status: 'ready',
    text: 'Nachrichten und Befehle im Zeittakt, jederzeit änderbar ohne Neustart des Bots.',
  },
  {
    key: 'join-commands',
    group: 'Chat',
    title: 'Befehle beim Beitritt',
    status: 'ready',
    text: 'Beim Betreten des Servers laufen die hinterlegten Befehle, z. B. /server survival.',
  },
  {
    key: 'macros',
    group: 'Automatik',
    title: 'Macros',
    status: 'ready',
    text: 'Auslöser (Beitritt, Zeittakt, Chatzeile, Tod, Abbruch) und eine Kette von Schritten.',
  },
  {
    key: 'anti-afk',
    group: 'Automatik',
    title: 'Anti-AFK-Aktionen',
    status: 'movement',
    text: 'Umsehen, springen und ein Stück laufen gegen den Inaktivitäts-Kick. Der Befehl-Takt (/ping) läuft auch ohne Bewegung.',
  },
  {
    key: 'movement',
    group: 'Bewegung',
    title: 'Laufen, springen, umsehen',
    status: 'movement',
    text: 'Gehen in vier Richtungen, Blickrichtung setzen, springen, fallen – mit der Bewegungs-Bauform des Clients.',
  },
  {
    key: 'home-route',
    group: 'Bewegung',
    title: 'Heimatposition und Route',
    status: 'movement',
    text: 'Position merken, Weg aufzeichnen und nach jedem Beitritt automatisch dorthin zurücklaufen.',
  },
  {
    key: 'sneak',
    group: 'Bewegung',
    title: 'Schleichen',
    status: 'missing',
    text: 'Der Client kennt keinen Schleich-Zustand.',
  },
  {
    key: 'inventory',
    group: 'Spiel',
    title: 'Inventar',
    status: 'missing',
    text: 'Der Client öffnet keine Container und klickt keine Felder an – er spricht das Fenster-Protokoll nicht.',
  },
  {
    key: 'pov',
    group: 'Spiel',
    title: 'Live-Ansicht (POV)',
    status: 'missing',
    text: 'Für ein Bild bräuchte der Client Blöcke und Entitäten im Speicher; er hält bewusst nichts davon vor.',
  },
  {
    key: 'scoreboard',
    group: 'Spiel',
    title: 'Scoreboard / Tab-Liste',
    status: 'missing',
    text: 'Der Client wertet weder Scoreboard- noch Spielerlisten-Pakete aus.',
  },
  {
    key: 'accounts-microsoft',
    group: 'Konten',
    title: 'Microsoft-Konten',
    status: 'ready',
    text: 'Anmeldung über den Gerätecode – das Passwort sieht das Panel nie, gespeichert wird nur der Token des Clients.',
  },
  {
    key: 'accounts-offline',
    group: 'Konten',
    title: 'Offline-/Cracked-Konten',
    status: 'missing',
    text: 'Der Client meldet sich immer bei Microsoft an; einen Offline-Modus gibt es nicht.',
  },
  {
    key: 'accounts-bedrock',
    group: 'Konten',
    title: 'Bedrock-Konten',
    status: 'missing',
    text: 'Der Client spricht nur das Java-Protokoll.',
  },
  {
    key: 'proxies',
    group: 'Netzwerk',
    title: 'Proxys je Konto',
    status: 'missing',
    text: 'Der Client verbindet immer direkt; SOCKS5/HTTP-Proxys kennt er nicht. Im Panel lassen sich Proxys schon hinterlegen und zuordnen.',
  },
  {
    key: 'fakehost',
    group: 'Netzwerk',
    title: 'Fake-Host im Handshake',
    status: 'missing',
    text: 'Der Handshake trägt immer die echte Zieladresse.',
  },
  {
    key: 'world-change',
    group: 'Automatik',
    title: 'Befehle bei Weltwechsel',
    status: 'missing',
    text: 'Der Client unterscheidet den Wechsel zwischen Unterservern bewusst nicht vom laufenden Betrieb und meldet ihn nicht nach außen.',
  },
  {
    key: 'credits',
    group: 'Panel',
    title: 'Abrechnung über Guthaben',
    status: 'ready',
    text: 'Kein Abo: Guthaben aufladen, im Minutentakt wird nur bezahlt, was wirklich läuft.',
  },
  {
    key: 'mobile',
    group: 'Panel',
    title: 'Vom Handy aus',
    status: 'ready',
    text: 'Das Dashboard ist für kleine Bildschirme gebaut – starten, stoppen, chatten unterwegs.',
  },
  {
    key: 'discord',
    group: 'Panel',
    title: 'Discord-Benachrichtigungen',
    status: 'ready',
    text: 'Webhook hinterlegen und bei Abbruch, Fehler oder knappem Guthaben eine Nachricht bekommen.',
  },
  {
    key: 'downloads',
    group: 'Panel',
    title: 'Client zum Mitnehmen',
    status: 'ready',
    text: 'Dieselben Dateien wie im Panel gibt es als Download für Windows und Linux.',
  },
];

export const byStatus = (status) => FEATURES.filter((feature) => feature.status === status);

export const groups = () => {
  const map = new Map();
  for (const feature of FEATURES) {
    if (!map.has(feature.group)) map.set(feature.group, []);
    map.get(feature.group).push(feature);
  }
  return [...map].map(([group, items]) => ({ group, items }));
};
