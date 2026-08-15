// Alle sichtbaren Texte, an einer Stelle, in zwei Sprachen.
//
// Diese Datei wird von **beiden Seiten** benutzt: der Server rendert daraus die festen Seiten
// (Startseite, Anmeldung, Rechtliches) unter /en/… und /de/…, der Browser das Dashboard. Deshalb
// steht hier reines ESM ohne Browser-Aufrufe – Node kann sie genauso importieren.
//
// Englisch ist die Hauptsprache. Wer nichts eingestellt hat, bekommt die Sprache seines Browsers.

export const LANGS = ['en', 'de'];
export const DEFAULT_LANG = 'en';

export const LANG_NAMES = { en: 'English', de: 'Deutsch' };

export const S = {
  // ---------------------------------------------------------------- Allgemein
  'brand.tagline': {
    en: 'Minecraft AFK hosting',
    de: 'Minecraft-AFK-Hosting',
  },
  'nav.features': { en: 'Features', de: 'Funktionen' },
  'nav.pricing': { en: 'Pricing', de: 'Preise' },
  'nav.how': { en: 'How it works', de: 'So geht’s' },
  'nav.versions': { en: 'Versions', de: 'Versionen' },
  'nav.faq': { en: 'FAQ', de: 'Fragen' },
  'nav.login': { en: 'Log in', de: 'Anmelden' },
  'nav.register': { en: 'Create account', de: 'Konto anlegen' },
  'nav.dashboard': { en: 'Dashboard', de: 'Dashboard' },
  'nav.menu': { en: 'Menu', de: 'Menü' },
  'nav.skip': { en: 'Skip to content', de: 'Zum Inhalt springen' },

  'common.save': { en: 'Save', de: 'Speichern' },
  'common.cancel': { en: 'Cancel', de: 'Abbrechen' },
  'common.delete': { en: 'Delete', de: 'Löschen' },
  'common.create': { en: 'Create', de: 'Anlegen' },
  'common.close': { en: 'Close', de: 'Schließen' },
  'common.confirm': { en: 'Please confirm', de: 'Bitte bestätigen' },
  'common.yes': { en: 'Yes, go ahead', de: 'Ja, weiter' },
  'common.back': { en: 'Back', de: 'Zurück' },
  'common.loading': { en: 'Loading …', de: 'Wird geladen …' },
  'common.none': { en: 'None yet.', de: 'Noch nichts.' },
  'common.copied': { en: 'Copied.', de: 'Kopiert.' },
  'common.copy': { en: 'Copy', de: 'Kopieren' },
  'common.open': { en: 'Open', de: 'Öffnen' },
  'common.edit': { en: 'Edit', de: 'Ändern' },
  'common.name': { en: 'Name', de: 'Name' },
  'common.status': { en: 'Status', de: 'Zustand' },
  'common.credits': { en: 'Credits', de: 'Credits' },
  // Kleingeschrieben, wenn es mitten im Satz steht – im Englischen ist "Credits" dort falsch.
  'common.creditsInline': { en: 'credits', de: 'Credits' },
  'common.month': { en: 'month', de: 'Monat' },
  'common.perMonth': { en: '/ month', de: '/ Monat' },
  'common.free': { en: 'Free', de: 'Gratis' },
  'common.retry': { en: 'Reload', de: 'Neu laden' },
  'common.error': { en: 'That went wrong', de: 'Das ging schief' },
  'common.search': { en: 'Search', de: 'Suchen' },
  'common.all': { en: 'All', de: 'Alle' },
  'common.never': { en: 'never', de: 'nie' },
  'common.days': { en: 'days', de: 'Tage' },
  'common.appearance': { en: 'Appearance', de: 'Aussehen' },
  'common.light': { en: 'Light', de: 'Hell' },
  'common.dark': { en: 'Dark', de: 'Dunkel' },
  'common.system': { en: 'Match system', de: 'Wie das System' },
  'common.language': { en: 'Language', de: 'Sprache' },
  'common.optional': { en: 'optional', de: 'optional' },

  // ---------------------------------------------------------------- Startseite
  'meta.title': {
    en: 'AFKSystems – keep your Minecraft account online, 24/7',
    de: 'AFKSystems – dein Minecraft-Konto bleibt online, rund um die Uhr',
  },
  'meta.description': {
    en: 'Stay connected to any Minecraft server without leaving your own machine running. Read and write chat, run commands on a timer, start and stop bots from anywhere. One server slot free, the rest paid monthly in credits.',
    de: 'Auf jedem Minecraft-Server verbunden bleiben, ohne den eigenen Rechner laufen zu lassen. Chat mitlesen und schreiben, Befehle im Takt, Bots von überall starten und stoppen. Ein Serverplatz gratis, alles Weitere monatlich in Credits.',
  },

  'hero.eyebrow': { en: 'Machine off. Bot stays in.', de: 'Rechner aus. Bot bleibt drin.' },
  'hero.title.a': { en: 'Your account stays', de: 'Dein Konto bleibt' },
  'hero.title.mark': { en: 'online', de: 'online' },
  'hero.title.b': { en: 'even when you are not.', de: 'auch wenn du es nicht bist.' },
  'hero.lead': {
    en: 'AFKSystems keeps your Minecraft accounts connected to any server. Read and write chat, fire commands on a timer, start and stop bots – from your phone, your laptop, anywhere.',
    de: 'AFKSystems hält deine Minecraft-Konten auf jedem Server verbunden. Chat mitlesen und schreiben, Befehle im Takt senden, Bots starten und stoppen – vom Handy, vom Laptop, von überall.',
  },
  'hero.cta': { en: 'Start free', de: 'Kostenlos starten' },
  'hero.cta2': { en: 'See how it works', de: 'Wie es funktioniert' },
  'hero.note': {
    en: 'Sign in through Microsoft – your password goes to Microsoft, never to us.',
    de: 'Anmeldung über Microsoft – dein Passwort sieht nur Microsoft, nie wir.',
  },
  'hero.strip.title': { en: 'One server slot, one month', de: 'Ein Serverplatz, ein Monat' },
  'hero.strip.slot': { en: 'Slot 01 · free', de: 'Platz 01 · gratis' },
  'hero.strip.legend': {
    en: 'Thirty rows of twenty-four blocks: every hour of a month, with the current hour lit.',
    de: 'Dreißig Reihen zu vierundzwanzig Blöcken: jede Stunde eines Monats, die laufende hell.',
  },
  'hero.strip.hours': { en: 'hours', de: 'Stunden' },
  'hero.strip.now': { en: 'right now', de: 'gerade jetzt' },

  'rail.free': { en: 'Free server slot', de: 'Gratis-Serverplatz' },
  'rail.credit': { en: 'One credit', de: 'Ein Credit' },
  'rail.month': { en: 'One month', de: 'Ein Monat' },
  'rail.reconnect': { en: 'Reconnect', de: 'Neuverbindung' },
  'rail.reconnectValue': { en: 'automatic', de: 'automatisch' },

  'features.eyebrow': { en: 'Features', de: 'Funktionen' },
  'features.title': {
    en: 'Everything an AFK bot needs day to day',
    de: 'Alles, was ein AFK-Bot im Alltag braucht',
  },
  'features.lead': {
    en: 'The client speaks the Minecraft protocol itself and does exactly what a waiting vanilla client does – no twitching that stands out. What it can do, you steer from here.',
    de: 'Der Client spricht das Minecraft-Protokoll selbst und tut genau das, was ein wartender Vanilla-Client tut – kein Gezappel, das auffällt. Was er kann, steuerst du von hier.',
  },
  'features.legend.ready': { en: 'Included everywhere', de: 'Überall dabei' },
  'features.legend.premium': { en: 'With a paid server slot', de: 'Mit bezahltem Serverplatz' },
  'features.legend.soon': { en: 'Coming soon', de: 'Kommt noch' },
  'features.legend.no': { en: 'Deliberately not offered', de: 'Bewusst nicht dabei' },
  'features.legend.missing': { en: 'Client can’t do it yet', de: 'Kann der Client noch nicht' },

  'pricing.eyebrow': { en: 'Plans', de: 'Tarife' },
  'pricing.title': { en: 'One server is free. Always.', de: 'Ein Server ist gratis. Immer.' },
  'pricing.lead': {
    en: 'Pay per server slot, per month – a month is always 30 days here. One credit is one cent, so 100 credits are one euro. No contract, no notice period: stop renewing and the slot simply goes quiet.',
    de: 'Bezahlt wird je Serverplatz und Monat – ein Monat sind hier immer 30 Tage. Ein Credit ist ein Cent, 100 Credits sind ein Euro. Kein Vertrag, keine Kündigungsfrist: Verlängerung aus, und der Platz wird still.',
  },
  'pricing.everyPlan': { en: 'In every plan', de: 'In jedem Tarif' },
  'pricing.slot': { en: 'Slot', de: 'Platz' },
  'pricing.slot1': {
    en: 'Your first server. One bot, chat, commands, macros.',
    de: 'Dein erster Server. Ein Bot, Chat, Befehle, Macros.',
  },
  'pricing.slot2': {
    en: 'Every further server runs on a plan – with the premium client.',
    de: 'Jeder weitere Server läuft auf einem Tarif – mit dem Premium-Client.',
  },
  'pricing.from': { en: 'from', de: 'ab' },
  'pricing.onRequest': { en: 'on request', de: 'auf Anfrage' },
  'pricing.offlineAccounts': { en: 'Offline / cracked accounts', de: 'Offline-/Cracked-Konten' },
  'pricing.fakehost': { en: 'Fake host in the handshake', de: 'Fake-Host im Handshake' },
  'pricing.perServer': { en: 'credits per slot / 30 days', de: 'Credits je Platz / 30 Tage' },
  'pricing.freeForever': { en: 'credits, forever', de: 'Credits, dauerhaft' },
  'pricing.perMonthEuro': { en: '{amount} per month', de: '{amount} im Monat' },
  'pricing.forever': { en: 'forever', de: 'dauerhaft' },
  'pricing.bots': { en: 'bots at once on this server', de: 'Bots gleichzeitig auf diesem Server' },
  'pricing.bot': { en: 'bot on this server', de: 'Bot auf diesem Server' },
  'pricing.premiumClient': { en: 'Premium client', de: 'Premium-Client' },
  'pricing.slimClient': { en: 'Slim client', de: 'Schlanker Client' },
  'pricing.chatHistory': { en: 'lines of chat history', de: 'Zeilen Chatverlauf' },
  'pricing.proxyOnRequest': { en: 'Proxies on request', de: 'Proxys auf Anfrage' },
  'pricing.prioritySupport': { en: 'Support with priority', de: 'Support mit Vorrang' },
  'pricing.topup.title': { en: 'Topping up credits', de: 'Guthaben aufladen' },
  'pricing.topup.lead': {
    en: 'One credit is one cent. Bigger packages carry a bonus, and credits never expire.',
    de: 'Ein Credit ist ein Cent. Größere Pakete haben Bonus, und Guthaben verfällt nicht.',
  },
  'pricing.topup.bonus': { en: 'bonus', de: 'Bonus' },
  'pricing.choose': { en: 'Get started', de: 'Loslegen' },

  'how.eyebrow': { en: 'Three steps', de: 'In drei Schritten' },
  'how.title': { en: 'From account to running bot', de: 'Vom Konto zum laufenden Bot' },
  'how.lead': {
    en: 'The order never changes, so here it is as a sequence rather than a wall of tiles.',
    de: 'Der Weg ist immer derselbe – deshalb als Reihenfolge, nicht als Kachelwand.',
  },
  'how.1.title': { en: 'Create your account', de: 'Konto anlegen' },
  'how.1.text': {
    en: 'Email, username, password. Your first server slot is free and stays free.',
    de: 'E-Mail, Benutzername, Passwort. Der erste Serverplatz ist gratis und bleibt es.',
  },
  'how.2.title': { en: 'Connect Minecraft', de: 'Minecraft-Konto verbinden' },
  'how.2.text': {
    en: 'The panel shows you a Microsoft code and a link that already carries it. Confirm once at Microsoft – your password stays with Microsoft.',
    de: 'Das Panel zeigt dir einen Microsoft-Code und einen Link, in dem er schon drinsteht. Einmal bei Microsoft bestätigen – dein Passwort bleibt bei Microsoft.',
  },
  'how.3.title': { en: 'Add a server and start', de: 'Server anlegen und starten' },
  'how.3.text': {
    en: 'Enter the address, pick a version, press start. From then on the bot reconnects on its own – after a kick, a restart, or a reboot of our machine.',
    de: 'Adresse eintragen, Version wählen, Start drücken. Ab da verbindet der Bot sich selbst neu – nach Kick, Neustart oder Reboot unserer Maschine.',
  },

  'versions.eyebrow': { en: 'Versions', de: 'Versionen' },
  'versions.title': { en: 'Which servers work', de: 'Welche Server gehen' },
  'versions.lead': {
    en: 'This list is read out of the client running on this very server, so it is never stale.',
    de: 'Diese Liste kommt aus dem Client auf genau diesem Server – sie ist also nie veraltet.',
  },

  'faq.eyebrow': { en: 'Common questions', de: 'Häufige Fragen' },
  'faq.title': { en: 'Answered briefly', de: 'Kurz beantwortet' },
  'faq.1.q': { en: 'Does my computer have to stay on?', de: 'Muss mein Rechner laufen?' },
  'faq.1.a': {
    en: 'No. The bots run on our server. Switch your machine off and the bot stays connected – and the chat is still there when you come back.',
    de: 'Nein. Die Bots laufen auf unserem Server. Du schaltest deinen Rechner aus, der Bot bleibt verbunden – und der Chat ist noch da, wenn du wiederkommst.',
  },
  'faq.2.q': { en: 'How safe is signing in with Microsoft?', de: 'Wie sicher ist die Anmeldung mit Microsoft?' },
  'faq.2.a': {
    en: 'It uses Microsoft’s device code flow: you get a code, enter it at Microsoft and confirm there. Your password is never sent to us. Only the token the client uses to prove it may act as your account is stored.',
    de: 'Über den Gerätecode-Ablauf von Microsoft: Du bekommst einen Code, gibst ihn bei Microsoft ein und bestätigst dort. Dein Passwort wird nie an uns übertragen. Gespeichert wird nur der Token, mit dem der Client beweist, dass er dein Konto sein darf.',
  },
  'faq.3.q': { en: 'How does billing work?', de: 'Wie wird abgerechnet?' },
  'faq.3.a': {
    en: 'Per server slot, per 30 days, paid from your credit balance. The first slot costs nothing. When a paid slot expires and there are not enough credits, it goes quiet – the bots stop, nothing is deleted, and nothing ever goes into the red.',
    de: 'Je Serverplatz und 30 Tage, bezahlt aus dem Guthaben. Der erste Platz kostet nichts. Läuft ein bezahlter Platz ab und es fehlt Guthaben, wird er still – die Bots stoppen, gelöscht wird nichts, und ins Minus geht es nie.',
  },
  'faq.4.q': { en: 'How do I get credits?', de: 'Wie komme ich an Guthaben?' },
  'faq.4.a': {
    en: 'Top up yourself with the payment methods on offer, redeem a voucher code, or have an administrator credit your account directly.',
    de: 'Selbst aufladen über die angebotenen Zahlungswege, einen Gutscheincode einlösen – oder ein Administrator bucht dir Guthaben direkt auf.',
  },
  'faq.5.q': { en: 'Will I get banned?', de: 'Werde ich gebannt?' },
  'faq.5.a': {
    en: 'Whether an AFK bot is allowed is the server’s call. The client behaves like a waiting vanilla client: it answers KeepAlive, confirms teleports, and sends no movement that could not happen in the game. Still: read your server’s rules first.',
    de: 'Ob ein AFK-Bot erlaubt ist, entscheidet der jeweilige Server. Der Client verhält sich wie ein wartender Vanilla-Client: Er beantwortet KeepAlive, bestätigt Teleports und schickt keine Bewegung, die es im Spiel nicht gäbe. Trotzdem: Erst die Regeln deines Servers lesen.',
  },
  'faq.6.q': { en: 'What is the difference between the plans?', de: 'Was unterscheidet die Tarife?' },
  'faq.6.a': {
    en: 'The free slot runs the slim client: it connects, holds the line, reads and writes chat, and runs commands. Paid slots run the premium client, which additionally moves, sneaks, reads the scoreboard and tab list, clicks menus, and can go through a proxy.',
    de: 'Der Gratis-Platz nutzt den schlanken Client: verbinden, drinbleiben, Chat lesen und schreiben, Befehle senden. Bezahlte Plätze nutzen den Premium-Client – er bewegt sich zusätzlich, schleicht, liest Anzeigetafel und Tab-Liste, klickt Menüs an und kann über einen Proxy gehen.',
  },

  'cta.title': { en: 'Ready? Create your account.', de: 'Bereit? Dann leg dein Konto an.' },
  'cta.lead': {
    en: 'One server slot is free forever. You do not need payment details for it.',
    de: 'Ein Serverplatz ist dauerhaft gratis. Zahlungsdaten brauchst du dafür nicht.',
  },
  'cta.have': { en: 'I already have one', de: 'Ich habe schon eins' },

  'footer.about': {
    en: 'Minecraft AFK hosting from Germany. Credits instead of contracts.',
    de: 'Minecraft-AFK-Hosting aus Deutschland. Guthaben statt Vertrag.',
  },
  'footer.panel': { en: 'Panel', de: 'Panel' },
  'footer.topics': { en: 'Topics', de: 'Themen' },
  'footer.legal': { en: 'Legal', de: 'Rechtliches' },
  'footer.imprint': { en: 'Imprint', de: 'Impressum' },
  'footer.privacy': { en: 'Privacy', de: 'Datenschutz' },
  'footer.terms': { en: 'Terms', de: 'Nutzungsbedingungen' },
  'footer.support': { en: 'Support', de: 'Support' },
  'footer.disclaimer': {
    en: 'Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.',
    de: 'Kein offizielles Minecraft-Angebot. Nicht von Mojang oder Microsoft geprüft oder unterstützt.',
  },

  // ---------------------------------------------------------------- Anmeldung
  'auth.login.title': { en: 'Log in', de: 'Anmelden' },
  'auth.login.lead': {
    en: 'Welcome back. Your bots kept running.',
    de: 'Willkommen zurück. Deine Bots sind weitergelaufen.',
  },
  'auth.login.identifier': { en: 'Email or username', de: 'E-Mail oder Benutzername' },
  'auth.login.password': { en: 'Password', de: 'Passwort' },
  'auth.login.submit': { en: 'Log in', de: 'Anmelden' },
  'auth.login.noAccount': { en: 'No account yet?', de: 'Noch kein Konto?' },
  'auth.login.forgot': { en: 'Forgot your password?', de: 'Passwort vergessen?' },
  'auth.login.discord': { en: 'Continue with Discord', de: 'Weiter mit Discord' },
  'auth.or': { en: 'or', de: 'oder' },
  'auth.working': { en: 'One moment …', de: 'Einen Moment …' },

  'auth.register.title': { en: 'Create account', de: 'Konto anlegen' },
  'auth.register.lead': {
    en: 'One server slot is free forever. No payment details needed.',
    de: 'Ein Serverplatz ist dauerhaft gratis. Zahlungsdaten brauchst du nicht.',
  },
  'auth.register.email': { en: 'Email address', de: 'E-Mail-Adresse' },
  'auth.register.username': { en: 'Username', de: 'Benutzername' },
  'auth.register.usernameHint': {
    en: '3–24 characters: letters, digits, dot, underscore, hyphen.',
    de: '3–24 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich.',
  },
  'auth.register.password': { en: 'Password', de: 'Passwort' },
  'auth.register.passwordHint': { en: 'At least 8 characters.', de: 'Mindestens 8 Zeichen.' },
  'auth.register.password2': { en: 'Repeat password', de: 'Passwort wiederholen' },
  'auth.register.mismatch': {
    en: 'The two passwords are not the same.',
    de: 'Die beiden Passwörter sind nicht gleich.',
  },
  'auth.register.terms': {
    en: 'I have read the terms and the privacy notice.',
    de: 'Ich habe die Nutzungsbedingungen und die Datenschutzerklärung gelesen.',
  },
  'auth.register.submit': { en: 'Create account', de: 'Konto anlegen' },
  'auth.register.have': { en: 'Already have an account?', de: 'Schon ein Konto?' },
  'auth.register.closed': {
    en: 'Registration is closed at the moment.',
    de: 'Die Registrierung ist gerade geschlossen.',
  },
  'auth.register.checkMail.title': { en: 'Check your inbox', de: 'Sieh in dein Postfach' },
  'auth.register.checkMail.text': {
    en: 'We sent a confirmation link to {email}. Open it and you are in.',
    de: 'Wir haben einen Bestätigungslink an {email} geschickt. Einmal öffnen, dann bist du drin.',
  },
  'auth.register.resend': { en: 'Send again', de: 'Nochmal schicken' },

  'auth.forgot.title': { en: 'Forgot password', de: 'Passwort vergessen' },
  'auth.forgot.lead': {
    en: 'Enter your address and we send you a link to set a new password.',
    de: 'Adresse eintragen, und wir schicken dir einen Link für ein neues Passwort.',
  },
  'auth.forgot.submit': { en: 'Send link', de: 'Link schicken' },
  'auth.forgot.done': {
    en: 'If that address belongs to an account, a link is on its way.',
    de: 'Gehört die Adresse zu einem Konto, ist der Link unterwegs.',
  },
  'auth.forgot.off': {
    en: 'Password reset by email is not set up on this server. Please open a ticket or contact the operator.',
    de: 'Das Zurücksetzen per E-Mail ist auf diesem Server nicht eingerichtet. Bitte ein Ticket aufmachen oder den Betreiber anschreiben.',
  },

  'auth.reset.title': { en: 'Set a new password', de: 'Neues Passwort setzen' },
  'auth.reset.submit': { en: 'Save password', de: 'Passwort speichern' },
  'auth.reset.done': { en: 'Done. You can log in now.', de: 'Fertig. Du kannst dich jetzt anmelden.' },
  'auth.reset.bad': {
    en: 'This link is no longer valid. Ask for a new one.',
    de: 'Dieser Link gilt nicht mehr. Fordere einen neuen an.',
  },

  'auth.verify.title': { en: 'Email address', de: 'E-Mail-Adresse' },
  'auth.verify.ok': { en: 'Confirmed. Welcome aboard.', de: 'Bestätigt. Willkommen an Bord.' },
  'auth.verify.bad': {
    en: 'This link is no longer valid. Log in and request a new one.',
    de: 'Dieser Link gilt nicht mehr. Melde dich an und fordere einen neuen an.',
  },
  'auth.verify.toDashboard': { en: 'To the dashboard', de: 'Zum Dashboard' },
  'auth.verify.pending.title': { en: 'One more step', de: 'Noch ein Schritt' },
  'auth.verify.pending.text': {
    en: 'Confirm your email address to use the panel. We sent the link to {email}.',
    de: 'Bestätige deine E-Mail-Adresse, um das Panel zu nutzen. Der Link ging an {email}.',
  },

  // ---------------------------------------------------------------- Dashboard
  'dash.overview': { en: 'Overview', de: 'Übersicht' },
  'dash.servers': { en: 'Servers', de: 'Server' },
  'dash.accounts': { en: 'Minecraft accounts', de: 'Minecraft-Konten' },
  'dash.proxies': { en: 'Proxies', de: 'Proxys' },
  'dash.credits': { en: 'Credits', de: 'Guthaben' },
  'dash.tickets': { en: 'Support', de: 'Support' },
  'dash.settings': { en: 'Settings', de: 'Einstellungen' },
  'dash.admin': { en: 'Administration', de: 'Administration' },
  'dash.logout': { en: 'Log out', de: 'Abmelden' },
  'dash.newServer': { en: 'Add a server', de: 'Server anlegen' },
  'dash.noServers': { en: 'No server yet.', de: 'Noch keiner angelegt.' },
  'dash.live': { en: 'Live connection', de: 'Live verbunden' },
  'dash.offline': { en: 'Connection to the panel lost', de: 'Verbindung zum Panel unterbrochen' },
  'dash.hello': { en: 'Hello, {name}', de: 'Hallo, {name}' },
  'dash.balanceHint': { en: '{n} paid slot(s) · {cost} credits / month', de: '{n} bezahlte(r) Platz/Plätze · {cost} Credits / Monat' },
  'dash.balanceFree': { en: 'free slot only – no cost', de: 'nur der Gratis-Platz – kostet nichts' },

  'state.online': { en: 'Online', de: 'Online' },
  'state.auth': { en: 'Sign-in needed', de: 'Anmeldung nötig' },
  'state.starting': { en: 'Starting', de: 'Startet' },
  'state.connecting': { en: 'Connecting', de: 'Verbindet' },
  'state.reconnecting': { en: 'Retrying', de: 'Neuer Versuch' },
  'state.disconnected': { en: 'Disconnected', de: 'Getrennt' },
  'state.stopping': { en: 'Stopping', de: 'Stoppt' },
  'state.offline': { en: 'Offline', de: 'Offline' },
  'state.error': { en: 'Error', de: 'Fehler' },

  'tab.connect': { en: 'Connect', de: 'Verbinden' },
  'tab.chat': { en: 'Chat', de: 'Chat' },
  'tab.movement': { en: 'Movement', de: 'Bewegung' },
  'tab.board': { en: 'Scoreboard', de: 'Anzeigetafel' },
  'tab.menu': { en: 'Menus', de: 'Menüs' },
  'tab.proxies': { en: 'Proxies', de: 'Proxys' },
  'tab.macros': { en: 'Macros', de: 'Macros' },
  'tab.plan': { en: 'Plan', de: 'Tarif' },
  'tab.settings': { en: 'Settings', de: 'Einstellungen' },

  'dash.suspended': {
    en: '“{name}” has run out of credits – the bots were stopped.',
    de: '„{name}“ hat kein Guthaben mehr – die Bots wurden gestoppt.',
  },
  'dash.subtitle': { en: 'Everything that matters, at a glance', de: 'Alles Wichtige auf einen Blick' },

  // ---------------------------------------------------------------- Übersicht
  'ov.inGame': { en: 'In the game', de: 'Im Spiel' },
  'ov.ofRunning': { en: 'of {n} running bots', de: 'von {n} laufenden Bots' },
  'ov.monthly': { en: 'Per month', de: 'Im Monat' },
  'ov.slotsPaid': { en: '{n} paid slot(s)', de: '{n} bezahlte(r) Platz/Plätze' },
  'ov.balance': { en: 'Credits', de: 'Guthaben' },
  'ov.monthsLeft': { en: 'about {n} more month(s)', de: 'reicht noch etwa {n} Monat(e)' },
  'ov.monthsPlenty': { en: 'nothing running costs anything', de: 'es läuft nichts, was kostet' },
  'ov.accounts': { en: 'Accounts', de: 'Konten' },
  'ov.serversCount': { en: '{n} server slot(s)', de: '{n} Serverplatz/-plätze' },
  'ov.bots': { en: 'Bots', de: 'Bots' },
  'ov.stopAll': { en: 'Stop all', de: 'Alle stoppen' },
  'ov.start': { en: 'Start', de: 'Starten' },
  'ov.stop': { en: 'Stop', de: 'Stoppen' },
  'ov.started': { en: 'Bot started.', de: 'Bot gestartet.' },
  'ov.stoppedAll': { en: 'All bots stopped.', de: 'Alle Bots gestoppt.' },
  'ov.col.account': { en: 'Account', de: 'Konto' },
  'ov.col.server': { en: 'Server', de: 'Server' },
  'ov.col.uptime': { en: 'Running for', de: 'Läuft seit' },
  'ov.noServer.title': { en: 'No server yet', de: 'Noch kein Server' },
  'ov.noServer.text': {
    en: 'A server slot is one Minecraft server with its settings. Create one, add your accounts, press start.',
    de: 'Ein Serverplatz ist ein Minecraft-Server samt Einstellungen. Anlegen, Konten zuordnen, Start drücken.',
  },
  'ov.noMembers': {
    en: 'No account is assigned to these servers yet.',
    de: 'Diesen Servern ist noch kein Konto zugeordnet.',
  },
  'ov.noCredits': {
    en: 'No credits. Paid server slots stop renewing until you top up.',
    de: 'Kein Guthaben. Bezahlte Serverplätze verlängern sich erst wieder nach dem Aufladen.',
  },
  'ov.lowCredits': {
    en: 'Credits are running low: {credits} left, {cost} due per month.',
    de: 'Das Guthaben wird knapp: noch {credits}, fällig sind {cost} im Monat.',
  },
  'ov.topUp': { en: 'Top up', de: 'Aufladen' },
  'ov.brokenAccounts': {
    en: '{n} account(s) need signing in again: {names}.',
    de: '{n} Konto/Konten brauchen eine neue Anmeldung: {names}.',
  },
  'ov.renewNow': { en: 'Renew now', de: 'Jetzt erneuern' },
  'ov.suspendedNote': {
    en: '{names} – suspended. Resume once there are enough credits.',
    de: '{names} – stillgelegt. Fortsetzen, sobald genug Guthaben da ist.',
  },
  'ov.quick': { en: 'Quick links', de: 'Schnellzugriff' },
  'ov.connectAccount': { en: 'Connect a Minecraft account', de: 'Minecraft-Konto verbinden' },
  'ov.openTicket': { en: 'Ask support', de: 'Support fragen' },
  'ov.client': { en: 'What the client here can do', de: 'Was der Client hier kann' },
  'ov.clientVersions': { en: 'Minecraft versions', de: 'Minecraft-Versionen' },
  'ov.builds': { en: 'Builds in use', de: 'Genutzte Bauformen' },

  // ---------------------------------------------------------------- Konten
  'acc.title': { en: 'Minecraft accounts', de: 'Minecraft-Konten' },
  'acc.sub': {
    en: 'Connected once, usable on every server slot',
    de: 'Einmal verbunden, auf jedem Serverplatz nutzbar',
  },
  'acc.add': { en: 'Connect Microsoft account', de: 'Microsoft-Konto verbinden' },
  'acc.addOffline': { en: 'Add offline account', de: 'Offline-Konto hinzufügen' },
  'acc.offlineName': { en: 'Player name', de: 'Spielername' },
  'acc.offlineHint': {
    en: 'For servers with online-mode=false. 1–16 characters: letters, digits, underscore.',
    de: 'Für Server mit online-mode=false. 1–16 Zeichen: Buchstaben, Ziffern, Unterstrich.',
  },
  'acc.none.title': { en: 'No account connected yet', de: 'Noch kein Konto verbunden' },
  'acc.none.text': {
    en: 'Connect a Microsoft account and the bot can join in its name.',
    de: 'Verbinde ein Microsoft-Konto, dann kann der Bot in seinem Namen beitreten.',
  },
  'acc.ok': { en: 'Ready', de: 'Bereit' },
  'acc.error': { en: 'Sign-in needed', de: 'Anmeldung nötig' },
  'acc.pending': { en: 'Waiting for confirmation', de: 'Wartet auf Bestätigung' },
  'acc.kind.offline': { en: 'Offline', de: 'Offline' },
  'acc.kind.microsoft': { en: 'Microsoft', de: 'Microsoft' },
  'acc.renew': { en: 'Sign in again', de: 'Neu anmelden' },
  'acc.remove': { en: 'Remove account', de: 'Konto entfernen' },
  'acc.removeAsk': {
    en: 'Remove {name}? It is taken off every server slot.',
    de: '{name} entfernen? Es wird von allen Serverplätzen genommen.',
  },
  'acc.usedOn': { en: 'on {n} server slot(s)', de: 'auf {n} Serverplatz/-plätzen' },
  'acc.ms.title': { en: 'Sign in with Microsoft', de: 'Bei Microsoft anmelden' },
  'acc.ms.step': {
    en: 'Open the link – the code is already in it. Confirm there, and this window finishes on its own.',
    de: 'Link öffnen – der Code steht schon drin. Dort bestätigen, dieses Fenster macht den Rest allein.',
  },
  'acc.ms.open': { en: 'Open Microsoft', de: 'Microsoft öffnen' },
  'acc.ms.code': { en: 'Your code', de: 'Dein Code' },
  'acc.ms.waiting': { en: 'Waiting for your confirmation …', de: 'Warte auf deine Bestätigung …' },
  'acc.ms.done': { en: 'Connected: {name}', de: 'Verbunden: {name}' },
  'acc.ms.expired': { en: 'The code expired. Start again.', de: 'Der Code ist abgelaufen. Nochmal starten.' },

  // ---------------------------------------------------------------- Serverplatz
  'srv.new': { en: 'Add a server', de: 'Server anlegen' },
  'srv.name': { en: 'Name', de: 'Name' },
  'srv.address': { en: 'Server address', de: 'Serveradresse' },
  'srv.addressHint': { en: 'For example play.example.net or 192.0.2.1:25565', de: 'Zum Beispiel play.example.net oder 192.0.2.1:25565' },
  'srv.version': { en: 'Minecraft version', de: 'Minecraft-Version' },
  'srv.plan': { en: 'Plan', de: 'Tarif' },
  'srv.planFreeLeft': { en: '{n} free slot(s) left', de: 'noch {n} Gratis-Platz/Plätze' },
  'srv.planNoFree': {
    en: 'Your free slot is taken – a further server runs on a paid plan.',
    de: 'Dein Gratis-Platz ist belegt – ein weiterer Server läuft auf einem bezahlten Tarif.',
  },
  'srv.created': { en: 'Server created.', de: 'Server angelegt.' },
  'srv.deleteAsk': {
    en: 'Delete “{name}”? Bots stop, the unused remainder of the month is refunded.',
    de: '„{name}“ löschen? Bots stoppen, der ungenutzte Rest des Monats wird gutgeschrieben.',
  },
  'srv.startAll': { en: 'Start all', de: 'Alle starten' },
  'srv.stopAll': { en: 'Stop all', de: 'Alle stoppen' },
  'srv.addAccounts': { en: 'Add accounts', de: 'Konten hinzufügen' },
  'srv.noAccounts': { en: 'No account on this server yet.', de: 'Noch kein Konto auf diesem Server.' },
  'srv.pickAccounts': { en: 'Which accounts?', de: 'Welche Konten?' },
  'srv.remove': { en: 'Take off this server', de: 'Von diesem Server nehmen' },
  'srv.suspended': {
    en: 'This slot is suspended – the paid month ran out. Resume it once your balance covers the plan.',
    de: 'Dieser Platz ist stillgelegt – der bezahlte Monat ist abgelaufen. Fortsetzen, sobald das Guthaben reicht.',
  },
  'srv.resume': { en: 'Resume', de: 'Fortsetzen' },
  'srv.daysLeft': { en: '{n} day(s) left', de: 'noch {n} Tag(e)' },
  'srv.renewOn': { en: 'Renews automatically', de: 'Verlängert sich automatisch' },
  'srv.renewOff': { en: 'Ends when the month is over', de: 'Endet mit dem Monat' },
  'srv.changePlan': { en: 'Change plan', de: 'Tarif wechseln' },
  'srv.planChanged': { en: 'Plan changed.', de: 'Tarif gewechselt.' },
  'srv.chatSend': { en: 'Send', de: 'Senden' },
  'srv.chatPlaceholder': { en: 'Message or /command …', de: 'Nachricht oder /Befehl …' },
  'srv.chatAll': { en: 'to every selected account', de: 'an alle ausgewählten Konten' },
  'srv.chatLimit': { en: 'Chat history per bot', de: 'Chatverlauf je Bot' },
  'srv.chatLimitLocked': {
    en: 'The free slot keeps {n} lines. Paid slots can raise it.',
    de: 'Der Gratis-Platz behält {n} Zeilen. Bezahlte Plätze dürfen mehr.',
  },
  'srv.spam': { en: 'Repeating messages', de: 'Wiederholte Nachrichten' },
  'srv.joinCommands': { en: 'Commands on join', de: 'Befehle beim Beitritt' },
  'srv.macros': { en: 'Macros', de: 'Macros' },
  'srv.newMacro': { en: 'New macro', de: 'Neues Macro' },
  'srv.trigger': { en: 'Trigger', de: 'Auslöser' },
  'srv.steps': { en: 'Steps', de: 'Schritte' },
  'srv.premiumOnly': {
    en: 'This needs a paid server slot – it runs the premium client.',
    de: 'Dafür braucht es einen bezahlten Serverplatz – der nutzt den Premium-Client.',
  },
  'srv.proxyFree': {
    en: 'Proxies are for paid server slots. Open a ticket and we will assign one.',
    de: 'Proxys gibt es für bezahlte Serverplätze. Mach ein Ticket auf, dann teilen wir einen zu.',
  },
  'srv.saved': { en: 'Saved.', de: 'Gespeichert.' },
  'srv.restartNeeded': {
    en: 'Running bots pick this up on their next start.',
    de: 'Laufende Bots übernehmen das erst beim nächsten Start.',
  },
  'srv.walk': { en: 'Walk', de: 'Gehen' },
  'srv.blocks': { en: 'Blocks per step', de: 'Blöcke je Schritt' },
  'srv.jump': { en: 'Jump', de: 'Springen' },
  'srv.fall': { en: 'Let fall', de: 'Fallen lassen' },
  'srv.pos': { en: 'Where am I?', de: 'Wo bin ich?' },
  'srv.look': { en: 'Look', de: 'Blickrichtung' },
  'srv.lookHint': {
    en: 'Yaw as in the F3 screen: 0 south, 90 west, −90 east, 180 north. Negative pitch looks up.',
    de: 'Yaw wie im F3-Bildschirm: 0 Süden, 90 Westen, −90 Osten, 180 Norden. Pitch negativ heißt nach oben.',
  },
  'srv.home': { en: 'Home position', de: 'Heimatposition' },
  'srv.homeHint': {
    en: 'The bot remembers a spot and walks back there after every join – handy when the server drops you in a lobby.',
    de: 'Der Bot merkt sich eine Stelle und läuft nach jedem Beitritt dorthin zurück – praktisch, wenn der Server dich in die Lobby setzt.',
  },
  'srv.homeSet': { en: 'Remember here', de: 'Hier merken' },
  'srv.homeGo': { en: 'Walk there now', de: 'Jetzt hinlaufen' },
  'srv.route': { en: 'Route', de: 'Route' },
  'srv.routeHint': {
    en: 'Record, walk the path with the buttons above, stop – the bot takes exactly that way home afterwards.',
    de: 'Aufzeichnen, die Strecke mit den Knöpfen oben ablaufen, beenden – danach nimmt der Bot genau diesen Weg.',
  },
  'srv.recStart': { en: 'Start recording', de: 'Aufzeichnung starten' },
  'srv.recStop': { en: 'Stop recording', de: 'Aufzeichnung beenden' },
  'srv.on': { en: 'On', de: 'An' },
  'srv.off': { en: 'Off', de: 'Aus' },
  'srv.body': { en: 'Body', de: 'Körper' },
  'srv.sneakOn': { en: 'Sneak on', de: 'Schleichen an' },
  'srv.sneakOff': { en: 'Sneak off', de: 'Schleichen aus' },
  'srv.sneakAlways': { en: 'Stay crouched permanently', de: 'Dauerhaft geduckt bleiben' },
  'srv.sprintOn': { en: 'Sprint on', de: 'Sprinten an' },
  'srv.sprintOff': { en: 'Sprint off', de: 'Sprinten aus' },
  'srv.swing': { en: 'Swing arm', de: 'Arm schwingen' },
  'srv.use': { en: 'Use item', de: 'Benutzen' },
  'srv.hand': { en: 'Pick slot', de: 'Feld wählen' },
  'srv.slot': { en: 'Slot', de: 'Feld' },
  'srv.antiafk': { en: 'Anti-AFK movement', de: 'Anti-AFK-Bewegung' },
  'srv.antiafkHint': {
    en: 'Small, restrained movements against plugins that look for real activity. 0 turns it off.',
    de: 'Kleine, zurückhaltende Bewegungen gegen Plugins, die auf echte Aktivität prüfen. 0 schaltet es aus.',
  },
  'srv.tabList': { en: 'Player list', de: 'Spielerliste' },
  'srv.boardHint': {
    en: 'The client asks the server for its current sidebar and player list and prints them below.',
    de: 'Der Client fragt die aktuelle Seitenleiste und die Spielerliste ab und schreibt sie unten hin.',
  },
  'srv.menuOpen': { en: 'Menu open', de: 'Offenes Menü' },
  'srv.menuHint': {
    en: 'When the server opens a menu you see its title and how many slots it has. What sits in the slots is deliberately not read.',
    de: 'Öffnet der Server ein Menü, siehst du Titel und Feldzahl. Was in den Feldern liegt, liest der Client bewusst nicht.',
  },
  'srv.menuClick': { en: 'Click a slot', de: 'Feld anklicken' },
  'srv.menuClose': { en: 'Close menu', de: 'Menü schließen' },
  'srv.button': { en: 'Button', de: 'Taste' },
  'srv.left': { en: 'Left', de: 'Links' },
  'srv.right': { en: 'Right', de: 'Rechts' },
  'srv.answers': { en: 'What the client says', de: 'Antworten des Clients' },
  'srv.macroHint': {
    en: 'A macro has one trigger and a chain of steps that run in order. Plain chat chains on join go to the client itself; everything else is timed by the panel so changes take effect at once.',
    de: 'Ein Macro hat einen Auslöser und eine Kette von Schritten, die der Reihe nach laufen. Reine Chat-Ketten beim Beitritt übernimmt der Client selbst – alles andere taktet das Panel, damit Änderungen sofort greifen.',
  },
  'srv.macroExample': {
    en: 'A typical first one: send /afk on join, or fire a command every five minutes.',
    de: 'Typischer Anfang: beim Beitritt /afk senden, oder alle fünf Minuten einen Befehl absetzen.',
  },
  'srv.chatContains': { en: 'Chat line contains', de: 'Chatzeile enthält' },
  'srv.waitBefore': { en: 'Wait before (seconds)', de: 'Vorher warten (Sekunden)' },
  'srv.behaviour': { en: 'Behaviour', de: 'Verhalten' },
  'srv.network': { en: 'Network', de: 'Netzwerk' },
  'srv.joinDelay': { en: 'Wait after joining (seconds)', de: 'Wartezeit nach dem Beitritt (Sekunden)' },
  'srv.autoReconnect': { en: 'Reconnect automatically after a drop', de: 'Nach einem Abbruch automatisch neu verbinden' },
  'srv.firstWait': { en: 'First wait (s)', de: 'Erste Wartezeit (s)' },
  'srv.maxWait': { en: 'Upper limit (s)', de: 'Obergrenze (s)' },
  'srv.chatDelay': { en: 'Minimum gap between messages (ms)', de: 'Mindestabstand zweier Nachrichten (ms)' },
  'srv.useMovement': { en: 'Use the movement build', de: 'Bewegungs-Bauform verwenden' },
  'srv.fakehostHint': {
    en: 'The address sent in the handshake. The connection still goes to the real target.',
    de: 'Die Adresse im Handshake. Die Verbindung geht trotzdem zum echten Ziel.',
  },
  'srv.onCooldown': { en: 'Cooldown between macro triggers (s)', de: 'Sperrzeit zwischen Macro-Auslösern (s)' },
  'srv.danger': { en: 'Danger zone', de: 'Gefährlicher Bereich' },
  'srv.deleteHint': {
    en: 'Deleting stops every bot here and removes macros, repeats and assignments. The Minecraft accounts themselves stay.',
    de: 'Löschen stoppt alle Bots hier und entfernt Macros, Wiederholungen und Zuordnungen. Die Minecraft-Konten bleiben.',
  },

  // ---------------------------------------------------------------- Proxys
  'px.title': { en: 'Proxies', de: 'Proxys' },
  'px.sub': { en: 'One outgoing address per bot', de: 'Eine eigene Ausgangsadresse je Bot' },
  'px.why': {
    en: 'Many servers count connections per IP address. A proxy gives a bot its own way out, so several accounts can sit on the same server.',
    de: 'Viele Server zählen Verbindungen je IP-Adresse. Ein Proxy gibt einem Bot einen eigenen Weg nach draußen, damit mehrere Konten auf demselben Server sitzen können.',
  },
  'px.freeNote': {
    en: 'Proxies come with a paid server slot. On the free slot they are switched off.',
    de: 'Proxys gehören zu einem bezahlten Serverplatz. Auf dem Gratis-Platz sind sie aus.',
  },
  'px.request': { en: 'Request a proxy', de: 'Proxy anfragen' },
  'px.requestNote': {
    en: 'Tell us how many bots need one and on which server – we assign them by hand so nothing gets over-used.',
    de: 'Schreib, wie viele Bots einen brauchen und auf welchem Server – zugeteilt wird von Hand, damit nichts überlastet.',
  },
  'px.mine': { en: 'Assigned to you', de: 'Dir zugeteilt' },
  'px.none': { en: 'None assigned yet.', de: 'Noch keiner zugeteilt.' },
  'px.allowance': { en: 'You may use up to {n}.', de: 'Du darfst bis zu {n} nutzen.' },
  'px.assignHint': {
    en: 'Pick a proxy per account on the server’s proxy tab.',
    de: 'Welcher Proxy zu welchem Konto gehört, stellst du im Reiter „Proxys“ des Servers ein.',
  },

  // ---------------------------------------------------------------- Guthaben
  'bill.title': { en: 'Credits', de: 'Guthaben' },
  'bill.sub': { en: 'One credit is one cent', de: 'Ein Credit ist ein Cent' },
  'bill.balance': { en: 'Balance', de: 'Guthaben' },
  'bill.monthly': { en: 'Due per month', de: 'Fällig im Monat' },
  'bill.monthsLeft': { en: 'Covers about', de: 'Reicht etwa' },
  'bill.months': { en: '{n} month(s)', de: '{n} Monat(e)' },
  'bill.slots': { en: 'Server slots', de: 'Serverplätze' },
  'bill.slotsLine': { en: '{paid} paid · {free} free', de: '{paid} bezahlt · {free} gratis' },
  'bill.topUp': { en: 'Top up', de: 'Aufladen' },
  'bill.voucher': { en: 'Redeem a voucher', de: 'Gutschein einlösen' },
  'bill.voucherCode': { en: 'Voucher code', de: 'Gutscheincode' },
  'bill.voucherOk': { en: '{n} credits added.', de: '{n} Credits gutgeschrieben.' },
  'bill.method': { en: 'How would you like to pay?', de: 'Wie möchtest du zahlen?' },
  'bill.card': { en: 'Card / Stripe', de: 'Karte / Stripe' },
  'bill.transfer': { en: 'Bank transfer', de: 'Überweisung' },
  'bill.paypal': { en: 'PayPal', de: 'PayPal' },
  'bill.transferNote': {
    en: 'Transfer the amount with this reference. Credits appear once we see the money.',
    de: 'Überweise den Betrag mit diesem Verwendungszweck. Die Credits kommen, sobald das Geld da ist.',
  },
  'bill.reference': { en: 'Reference', de: 'Verwendungszweck' },
  'bill.open': { en: 'Open top-ups', de: 'Offene Aufladungen' },
  'bill.history': { en: 'Movements', de: 'Bewegungen' },
  'bill.spend': { en: 'Spent per month', de: 'Ausgaben je Monat' },
  'bill.kind.topup': { en: 'Top-up', de: 'Aufladung' },
  'bill.kind.voucher': { en: 'Voucher', de: 'Gutschein' },
  'bill.kind.plan': { en: 'Server slot', de: 'Serverplatz' },
  'bill.kind.refund': { en: 'Refund', de: 'Gutschrift' },
  'bill.kind.admin': { en: 'By an administrator', de: 'Durch Administrator' },
  'bill.kind.bonus': { en: 'Bonus', de: 'Bonus' },
  'bill.noHistory': { en: 'Nothing booked yet.', de: 'Noch nichts gebucht.' },

  // ---------------------------------------------------------------- Tickets
  'tk.title': { en: 'Support', de: 'Support' },
  'tk.sub': { en: 'Questions, proxy requests, bug reports', de: 'Fragen, Proxy-Anfragen, Fehlermeldungen' },
  'tk.new': { en: 'New ticket', de: 'Neues Ticket' },
  'tk.subject': { en: 'Subject', de: 'Betreff' },
  'tk.category': { en: 'Topic', de: 'Thema' },
  'tk.message': { en: 'Message', de: 'Nachricht' },
  'tk.reply': { en: 'Reply', de: 'Antworten' },
  'tk.send': { en: 'Send', de: 'Abschicken' },
  'tk.close': { en: 'Close ticket', de: 'Ticket schließen' },
  'tk.none': { en: 'No tickets yet.', de: 'Noch keine Tickets.' },
  'tk.created': { en: 'Ticket opened.', de: 'Ticket ist offen.' },
  'tk.status.open': { en: 'Open', de: 'Offen' },
  'tk.status.waiting': { en: 'Waiting for you', de: 'Wartet auf dich' },
  'tk.status.answered': { en: 'Answered', de: 'Beantwortet' },
  'tk.status.closed': { en: 'Closed', de: 'Geschlossen' },
  'tk.staff': { en: 'Support', de: 'Support' },
  'tk.you': { en: 'You', de: 'Du' },
  'tk.internal': { en: 'Internal note', de: 'Interne Notiz' },
  'tk.hours': { en: 'We usually answer {hours}.', de: 'Wir antworten meist {hours}.' },

  // ---------------------------------------------------------------- Einstellungen
  'set.title': { en: 'Settings', de: 'Einstellungen' },
  'set.sub': { en: 'Your account in this panel', de: 'Dein Konto in diesem Panel' },
  'set.account': { en: 'Account', de: 'Konto' },
  'set.role': { en: 'Role', de: 'Rolle' },
  'set.role.admin': { en: 'Administrator', de: 'Administrator' },
  'set.role.user': { en: 'User', de: 'Nutzer' },
  'set.language': { en: 'Language', de: 'Sprache' },
  'set.languageHint': {
    en: 'Saved on your account, so it follows you to every device.',
    de: 'Wird am Konto gespeichert und gilt damit auf jedem Gerät.',
  },
  'set.discord': { en: 'Discord', de: 'Discord' },
  'set.discordLink': { en: 'Link Discord account', de: 'Discord-Konto verknüpfen' },
  'set.discordUnlink': { en: 'Unlink', de: 'Verknüpfung lösen' },
  'set.discordLinked': { en: 'Linked as {name}', de: 'Verknüpft als {name}' },
  'set.discordOff': {
    en: 'The operator has not set up Discord linking.',
    de: 'Der Betreiber hat die Discord-Verknüpfung nicht eingerichtet.',
  },
  'set.webhook': { en: 'Discord notifications', de: 'Discord-Benachrichtigungen' },
  'set.webhookHint': {
    en: 'Paste a webhook of your Discord server and the panel reports dropped bots, account trouble and low credits. At most one message per topic every ten minutes.',
    de: 'Trage einen Webhook deines Discord-Servers ein, dann meldet das Panel Abbrüche, Kontoprobleme und knappes Guthaben. Höchstens eine Nachricht je Thema alle zehn Minuten.',
  },
  'set.webhookTest': { en: 'Send a test message', de: 'Testnachricht schicken' },
  'set.password': { en: 'Change password', de: 'Passwort ändern' },
  'set.passwordOld': { en: 'Current password', de: 'Aktuelles Passwort' },
  'set.passwordNew': { en: 'New password', de: 'Neues Passwort' },
  'set.passwordNew2': { en: 'Repeat new password', de: 'Neues Passwort wiederholen' },
  'set.passwordHint': {
    en: 'At least 8 characters. All other sessions are signed out.',
    de: 'Mindestens 8 Zeichen. Alle anderen Sitzungen werden abgemeldet.',
  },
  'set.passwordOk': { en: 'Password changed.', de: 'Passwort geändert.' },
  'set.sessions': { en: 'Sessions', de: 'Sitzungen' },
  'set.logoutAll': { en: 'Sign out on all devices', de: 'Auf allen Geräten abmelden' },
  'set.logoutAllAsk': {
    en: 'Sign out everywhere? You will have to log in again.',
    de: 'Überall abmelden? Du musst dich danach neu anmelden.',
  },

  // ---------------------------------------------------------------- Administration
  'adm.title': { en: 'Administration', de: 'Administration' },
  'adm.overview': { en: 'Overview', de: 'Übersicht' },
  'adm.users': { en: 'Users', de: 'Nutzer' },
  'adm.plans': { en: 'Plans', de: 'Tarife' },
  'adm.vouchers': { en: 'Vouchers', de: 'Gutscheine' },
  'adm.topups': { en: 'Top-ups', de: 'Aufladungen' },
  'adm.proxies': { en: 'Proxies', de: 'Proxys' },
  'adm.tickets': { en: 'Tickets', de: 'Tickets' },
  'adm.profiles': { en: 'Server slots', de: 'Serverplätze' },
  'adm.bots': { en: 'Bots', de: 'Bots' },
  'adm.announce': { en: 'Announcement', de: 'Ankündigung' },
  'adm.settings': { en: 'Settings', de: 'Einstellungen' },
  'adm.mails': { en: 'Mail log', de: 'Mail-Protokoll' },
  'adm.client': { en: 'Client', de: 'Client' },
  'adm.audit': { en: 'Log', de: 'Protokoll' },
  'adm.ledger': { en: 'Ledger', de: 'Buchungen' },
  'adm.viewingAs': {
    en: 'You are viewing the panel as {user}. {admin} stays signed in underneath.',
    de: 'Du siehst das Panel gerade als {user}. {admin} bleibt darunter angemeldet.',
  },
  'adm.backToAdmin': { en: 'Back to my account', de: 'Zurück zu meinem Konto' },
  'adm.impersonate': { en: 'View as this user', de: 'Als Nutzer ansehen' },
  'adm.addCredits': { en: 'Book credits', de: 'Guthaben buchen' },
  'adm.block': { en: 'Block', de: 'Sperren' },
  'adm.unblock': { en: 'Unblock', de: 'Entsperren' },
  'adm.makeAdmin': { en: 'Make administrator', de: 'Zum Administrator machen' },
  'adm.revokeAdmin': { en: 'Remove administrator', de: 'Administrator entziehen' },
  'adm.setPassword': { en: 'Set a password', de: 'Passwort setzen' },
  'adm.verifyMail': { en: 'Mark email confirmed', de: 'E-Mail als bestätigt markieren' },
  'adm.stopBots': { en: 'Stop all their bots', de: 'Alle Bots stoppen' },
  'adm.logoutUser': { en: 'Sign out everywhere', de: 'Überall abmelden' },
  'adm.newUser': { en: 'New user', de: 'Neuer Nutzer' },
  'adm.saved': { en: 'Saved.', de: 'Gespeichert.' },

  // ---------------------------------------------------------------- Rechtliches
  'legal.imprint.title': { en: 'Imprint', de: 'Impressum' },
  'legal.privacy.title': { en: 'Privacy notice', de: 'Datenschutzerklärung' },
  'legal.terms.title': { en: 'Terms of use', de: 'Nutzungsbedingungen' },
  'legal.placeholder': {
    en: 'This page still has to be filled in by the operator. Under German law an imprint is mandatory – it must be complete before the service is offered publicly.',
    de: 'Diese Seite muss der Betreiber noch ausfüllen. Ein Impressum ist in Deutschland Pflicht – es muss vollständig sein, bevor der Dienst öffentlich angeboten wird.',
  },

  'error.404.title': { en: 'Nothing here', de: 'Hier ist nichts' },
  'error.404.text': {
    en: 'This page does not exist. Perhaps the link is old.',
    de: 'Diese Seite gibt es nicht. Vielleicht ist der Link alt.',
  },
  'error.404.home': { en: 'Back to the start', de: 'Zurück zum Anfang' },
  'error.maintenance.title': { en: 'Back shortly', de: 'Gleich wieder da' },
};

/** Ein Text in einer Sprache, mit {platzhaltern}. */
export function t(key, lang = DEFAULT_LANG, vars = null) {
  const entry = S[key];
  let text = entry ? entry[lang] ?? entry[DEFAULT_LANG] ?? key : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Die beste Sprache aus einem Accept-Language-Kopf oder navigator.languages. */
export function pickLang(candidates) {
  for (const raw of candidates || []) {
    const code = String(raw).slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return DEFAULT_LANG;
}
