// Was das Panel kann – in der Sprache eines Kunden, nicht in der eines Entwicklers.
//
// Diese Liste füllt die Seite /features. Zwei Dinge stehen an einem Eintrag:
//
//   need     welche Fähigkeit die Client-Datei dafür mitbringen muss (binaries.js liest sie aus
//            `--help`). Fehlt sie auf diesem Server, fällt der Eintrag weg – dann steht dort auch
//            kein Versprechen, das gerade niemand einlösen kann.
//   premium  ob es einen bezahlten Serverplatz braucht. Das steht als Etikett dahinter.
//   tag      ein genaueres Etikett, wenn "bezahlter Platz" zu grob wäre: 'ultra' heißt, dass es
//            im Ultra-Tarif steckt und sich auf Premium dazubuchen lässt.
//
// Absichtlich steht hier nirgends, *wie* etwas gemacht ist: keine Protokollnamen, keine
// Dateigrößen, keine Begründungen für Dinge, die es nicht gibt. Wer einen AFK-Bot sucht, will
// wissen, was er bekommt.

const LIST = [
  {
    key: 'always-online',
    group: 'connection',
    de: {
      title: 'Rund um die Uhr online',
      text: 'Der Bot bleibt auf dem Server, während dein eigener Rechner aus ist.',
    },
    en: {
      title: 'Online around the clock',
      text: 'The bot stays on the server while your own computer is switched off.',
    },
  },
  {
    key: 'reconnect',
    group: 'connection',
    de: {
      title: 'Klarer Sitzungsabschluss',
      text: 'Ein Kick oder gewöhnlicher Verbindungsabbruch beendet den Client mit sichtbarem Fehler. Nur ein vom Server angeordneter Wechsel auf einen Unterserver wird direkt befolgt.',
    },
    en: {
      title: 'A clear end to a session',
      text: 'A kick or ordinary disconnect ends the client with a visible error. Only a sub-server transfer explicitly ordered by the server is followed immediately.',
    },
  },
  {
    key: 'transfer',
    group: 'connection',
    de: {
      title: 'Folgt dem Unterserver',
      text: 'Schickt dich das Netzwerk auf einen anderen Unterserver, geht der Bot mit.',
    },
    en: {
      title: 'Follows sub-server switches',
      text: 'If the network moves you to another sub-server, the bot goes along.',
    },
  },
  {
    key: 'multi-server',
    group: 'connection',
    de: {
      title: 'Mehrere Server',
      text: 'Leg so viele Serverplätze an, wie du brauchst. Dasselbe Konto darf auf mehreren sitzen.',
    },
    en: {
      title: 'More than one server',
      text: 'Add as many server slots as you need. The same account may sit on several of them.',
    },
  },
  {
    key: 'versions',
    group: 'connection',
    de: {
      title: 'Version je Server',
      text: 'Für jeden Server wählst du die Minecraft-Version aus, mit der er läuft.',
    },
    en: {
      title: 'A version per server',
      text: 'For each server you choose the Minecraft version it runs on.',
    },
  },

  {
    key: 'chat-read',
    group: 'chat',
    de: { title: 'Chat mitlesen', text: 'Alles, was auf dem Server gesagt wird, steht live im Panel.' },
    en: { title: 'Read the chat', text: 'Everything said on the server appears in the panel as it happens.' },
  },
  {
    key: 'chat-send',
    group: 'chat',
    de: {
      title: 'Chat schreiben',
      text: 'Nachrichten und Befehle von einem Konto oder von allen ausgewählten gleichzeitig.',
    },
    en: {
      title: 'Write in the chat',
      text: 'Messages and commands from one account or from all the selected ones at once.',
    },
  },
  {
    key: 'join-commands',
    group: 'chat',
    de: { title: 'Befehle beim Beitritt', text: 'Beim Betreten laufen die Befehle, die du hinterlegt hast.' },
    en: { title: 'Commands on joining', text: 'When the bot joins, the commands you stored are sent.' },
  },
  {
    key: 'spam',
    group: 'chat',
    de: {
      title: 'Wiederholte Nachrichten',
      text: 'Eine Nachricht oder einen Befehl alle paar Minuten senden lassen. Ändern geht ohne Neustart.',
    },
    en: {
      title: 'Repeating messages',
      text: 'Have a message or command sent every few minutes. Changing it needs no restart.',
    },
  },

  {
    key: 'macros',
    group: 'automation',
    de: {
      title: 'Macros',
      text: 'Ein Macro startet beim Beitritt, im Zeittakt oder wenn eine bestimmte Zeile im Chat auftaucht, und arbeitet dann deine Schritte ab.',
    },
    en: {
      title: 'Macros',
      text: 'A macro starts on joining, on a timer or when a certain line appears in the chat, and then works through your steps.',
    },
  },
  {
    key: 'world-change',
    group: 'automation',
    de: {
      title: 'Auf Weltwechsel reagieren',
      text: 'Wechselt der Bot die Welt oder den Unterserver, kann daran ein eigenes Macro hängen.',
    },
    en: {
      title: 'React to a world change',
      text: 'When the bot changes world or sub-server, a macro of its own can run.',
    },
  },
  {
    key: 'anti-afk',
    group: 'automation',
    need: 'antiafk',
    premium: true,
    de: {
      title: 'Anti-AFK-Bewegung',
      text: 'Kleine Bewegungen in Abständen, für Server, die prüfen, ob wirklich jemand da ist.',
    },
    en: {
      title: 'Anti-AFK movement',
      text: 'Small movements at intervals, for servers that check whether someone is really there.',
    },
  },

  {
    key: 'movement',
    group: 'game',
    need: 'movement',
    premium: true,
    de: { title: 'Laufen und umsehen', text: 'Gehen, springen und die Blickrichtung setzen.' },
    en: { title: 'Walk and look around', text: 'Walk, jump and set where the bot looks.' },
  },
  {
    key: 'home-route',
    group: 'game',
    need: 'movement',
    premium: true,
    de: {
      title: 'Heimatposition',
      text: 'Der Bot merkt sich eine Stelle und läuft nach jedem Beitritt dorthin zurück.',
    },
    en: {
      title: 'Home position',
      text: 'The bot remembers a spot and walks back there after every join.',
    },
  },
  {
    key: 'sneak',
    group: 'game',
    need: 'sneak',
    premium: true,
    de: {
      title: 'Schleichen, sprinten, benutzen',
      text: 'Geduckt bleiben, sprinten, den Arm schwingen, einen Gegenstand benutzen, ein Feld der Schnellleiste wählen.',
    },
    en: {
      title: 'Sneak, sprint, use',
      text: 'Stay crouched, sprint, swing your arm, use an item, pick a hotbar slot.',
    },
  },
  {
    key: 'scoreboard',
    group: 'game',
    need: 'board',
    premium: true,
    de: {
      title: 'Scoreboard',
      text: 'Die Seitenleiste des Servers im Panel – mit denselben Farben und derselben Anordnung wie im Spiel. In jedem bezahlten Tarif enthalten.',
    },
    en: {
      title: 'Scoreboard',
      text: 'The server sidebar in the panel – same colours, same layout as in the game. Part of every paid plan.',
    },
  },
  {
    key: 'menu',
    group: 'game',
    need: 'menu',
    premium: true,
    tag: 'ultra',
    de: {
      title: 'Menüs bedienen',
      text: 'Öffnet der Server ein Menü, siehst du es mit seinen Gegenständen und klickst ein Feld an. Name und Beschreibung stehen beim Überfahren dabei. Im Ultra-Tarif enthalten, auf Premium dazubuchbar.',
    },
    en: {
      title: 'Use menus',
      text: 'When the server opens a menu you see it with its items and can click a slot. Name and description show up when you hover. Part of Ultra, bookable on Premium.',
    },
  },
  {
    key: 'pov',
    group: 'game',
    // Kein `need`: was als "kommt später" ausgeschildert ist, darf dastehen, bevor der Client es
    // kann. Es verspricht ja nichts für heute.
    premium: true,
    tag: 'soon',
    de: {
      title: 'Live-Ansicht',
      text: 'Sehen, was der Bot sieht. Wird je Konto und Serverplatz einzeln gebucht und steckt in keinem Tarif – auch nicht in Ultra.',
    },
    en: {
      title: 'Live view',
      text: 'See what the bot sees. Booked per account and server slot, and part of no plan – not even Ultra.',
    },
  },

  {
    key: 'accounts-microsoft',
    group: 'accounts',
    de: {
      title: 'Microsoft-Konten',
      text: 'Anmeldung läuft über Microsoft. Dein Passwort gibst du dort ein, nicht bei uns.',
    },
    en: {
      title: 'Microsoft accounts',
      text: 'Signing in goes through Microsoft. You enter your password there, not here.',
    },
  },
  {
    key: 'accounts-offline',
    group: 'accounts',
    need: 'offline',
    premium: true,
    de: { title: 'Offline-Konten', text: 'Für Server, die ohne Mojang-Anmeldung laufen.' },
    en: { title: 'Offline accounts', text: 'For servers that run without a Mojang sign-in.' },
  },
  {
    key: 'proxies',
    group: 'accounts',
    need: 'proxy',
    premium: true,
    de: {
      title: 'Eigene Ausgangsadresse',
      text: 'Auf Anfrage teilen wir einem Bot eine eigene Adresse zu, damit mehrere Konten auf denselben Server passen.',
    },
    en: {
      title: 'Own outgoing address',
      text: 'On request we give a bot an address of its own, so more than one account fits on the same server.',
    },
  },

  {
    key: 'credits',
    group: 'panel',
    de: {
      title: 'Guthaben statt Vertrag',
      text: 'Du lädst Guthaben auf und gibst es für Serverplätze aus. Von einer Karte wird nichts abgebucht.',
    },
    en: {
      title: 'Credits instead of a contract',
      text: 'You top up credits and spend them on server slots. Nothing is debited from a card.',
    },
  },
  {
    key: 'tickets',
    group: 'panel',
    de: { title: 'Support im Panel', text: 'Fragen und Anfragen laufen als Ticket, mit Verlauf und Antworten an einer Stelle.' },
    en: { title: 'Support in the panel', text: 'Questions and requests run as tickets, with the history in one place.' },
  },
  {
    key: 'discord',
    group: 'panel',
    de: { title: 'Discord-Meldungen', text: 'Lass dir sagen, wenn ein Bot rausfliegt oder das Guthaben knapp wird.' },
    en: { title: 'Discord notices', text: 'Get told when a bot drops out or your credits are running low.' },
  },
  {
    key: 'mobile',
    group: 'panel',
    de: { title: 'Auch am Handy', text: 'Starten, stoppen und chatten geht genauso vom Telefon aus.' },
    en: { title: 'On the phone too', text: 'Starting, stopping and chatting work from a phone just as well.' },
  },
];

export const GROUPS = {
  connection: { de: 'Verbindung', en: 'Connection' },
  chat: { de: 'Chat', en: 'Chat' },
  automation: { de: 'Automatik', en: 'Automation' },
  game: { de: 'Im Spiel', en: 'In the game' },
  accounts: { de: 'Konten', en: 'Accounts' },
  panel: { de: 'Panel', en: 'Panel' },
};

/**
 * Die Feature-Liste für eine Sprache. `caps` sind die Fähigkeiten der Client-Dateien, die gerade
 * auf diesem Server liegen – was keine davon kann, taucht nicht auf.
 */
export function features(caps = {}, lang = 'de') {
  const key = lang === 'en' ? 'en' : 'de';
  return LIST.filter((feature) => !feature.need || caps[feature.need]).map((feature) => ({
    key: feature.key,
    group: feature.group,
    group_label: GROUPS[feature.group][key],
    premium: Boolean(feature.premium),
    tag: feature.tag || null,
    title: feature[key].title,
    text: feature[key].text,
  }));
}
