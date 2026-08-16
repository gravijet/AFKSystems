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
  'nav.faq': { en: 'Questions', de: 'Fragen' },
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
  'common.forever': { en: 'forever', de: 'dauerhaft' },
  'common.paidSlot': { en: 'Paid server slot', de: 'Bezahlter Serverplatz' },
  'common.created': { en: 'Added', de: 'Hinzugefügt' },

  // ---------------------------------------------------------------- Öffentliche Seiten
  //
  // Startseite, Funktionen, Preise, Fragen. Bewusst nüchtern: was der Dienst tut, was er kostet,
  // was er nicht verspricht. Wie etwas technisch gelöst ist, steht hier nirgends – das interessiert
  // niemanden, der einen Server sucht, und veraltet außerdem.

  'meta.title': {
    en: 'AFKSystems – keep your Minecraft account online',
    de: 'AFKSystems – Minecraft-Konten online halten',
  },
  'meta.description': {
    en: 'We run Minecraft AFK bots on our servers. One server slot is free with an active AFKSystems Discord membership; further slots are paid in credits.',
    de: 'Wir betreiben Minecraft-AFK-Bots auf unseren Servern. Ein Serverplatz ist mit aktiver AFKSystems-Discord-Mitgliedschaft gratis; weitere kosten Credits.',
  },
  'meta.features.description': {
    en: 'What AFKSystems can do: staying connected, chat and commands, macros, several accounts on one server.',
    de: 'Was AFKSystems kann: verbunden bleiben, Chat und Befehle, Macros, mehrere Konten auf einem Server.',
  },
  'meta.pricing.description': {
    en: 'One server slot is free while your linked Discord account is in AFKSystems. Further slots are paid from your credit balance for 30 days.',
    de: 'Ein Serverplatz ist gratis, solange dein verknüpftes Discord-Konto bei AFKSystems ist. Weitere werden für 30 Tage aus dem Guthaben bezahlt.',
  },
  'meta.faq.description': {
    en: 'Answers about staying online, signing in with Microsoft, credits and what happens when they run out.',
    de: 'Antworten zu Dauerbetrieb, Anmeldung mit Microsoft, Guthaben und was passiert, wenn es aufgebraucht ist.',
  },

  'hero.title.a': { en: 'Your accounts stay', de: 'Deine Konten bleiben' },
  'hero.title.mark': { en: 'online', de: 'online' },
  'hero.title.b': { en: ' while your PC is off.', de: ', auch wenn dein PC aus ist.' },
  'hero.lead': {
    en: 'The bots run on our machines. You connect a Minecraft account, add a server and press start. Chat, commands and macros are all handled in the panel.',
    de: 'Die Bots laufen auf unseren Maschinen. Du verbindest ein Minecraft-Konto, legst einen Server an und drückst Start. Chat, Befehle und Macros laufen im Panel.',
  },
  'hero.cta': { en: 'Create a free account', de: 'Kostenloses Konto anlegen' },
  'hero.cta2': { en: 'View plans', de: 'Preise ansehen' },
  'hero.note': {
    en: 'The first server slot costs nothing while your linked Discord account is in AFKSystems.',
    de: 'Der erste Serverplatz kostet nichts, solange dein verknüpftes Discord-Konto bei AFKSystems ist.',
  },
  'home.preview.label': { en: 'AFKSystems panel preview', de: 'Vorschau des AFKSystems-Panels' },
  'home.preview.live': { en: 'Online', de: 'Online' },
  'home.preview.server': { en: 'Your server', de: 'Dein Server' },
  'home.preview.connected': { en: 'Both accounts connected', de: 'Beide Konten verbunden' },
  'home.preview.chat': { en: 'Chat is available in the panel', de: 'Chat ist im Panel verfügbar' },
  'home.preview.antiafk': { en: 'Anti-AFK is active', de: 'Anti-AFK ist aktiv' },
  'home.preview.control': { en: 'Chat', de: 'Chat' },
  'home.preview.movement': { en: 'Movement', de: 'Bewegung' },

  'rail.free': { en: 'Free slots per account', de: 'Gratis-Plätze je Konto' },
  'rail.paid': { en: 'Further slots from', de: 'Weitere Plätze ab' },
  'rail.perMonth': { en: 'per 30 days', de: 'je 30 Tage' },
  'rail.month': { en: 'Billing period', de: 'Abrechnung je' },
  'rail.monthValue': { en: '30 days', de: '30 Tage' },
  'rail.reconnect': { en: 'After a disconnect', de: 'Nach einem Abbruch' },
  'rail.reconnectValue': { en: 'stops safely', de: 'stoppt sicher' },

  'home.what.title': { en: 'What you can do with it', de: 'Was du damit machen kannst' },
  'home.what.lead': {
    en: 'The short version. The full list is on the features page.',
    de: 'Die kurze Fassung. Die vollständige Liste steht auf der Funktionsseite.',
  },
  'home.what.1.title': { en: 'Stay connected', de: 'Verbunden bleiben' },
  'home.what.1.text': {
    en: 'Your account holds its place on the server. A kick or broken connection ends that session visibly, so it never reconnects unnoticed.',
    de: 'Dein Konto hält seinen Platz auf dem Server. Ein Kick oder Verbindungsabbruch beendet die Sitzung sichtbar – ohne unbemerkten Neuversuch.',
  },
  'home.what.2.title': { en: 'Chat and commands', de: 'Chat und Befehle' },
  'home.what.2.text': {
    en: 'Read the server chat in the panel and write back. Commands can run when the bot joins or on a timer.',
    de: 'Den Serverchat im Panel mitlesen und zurückschreiben. Befehle laufen beim Beitritt oder im Zeittakt.',
  },
  'home.what.3.title': { en: 'Several servers', de: 'Mehrere Server' },
  'home.what.3.text': {
    en: 'One account on more than one server, or several accounts on one. How many is up to the plan.',
    de: 'Ein Konto auf mehreren Servern oder mehrere Konten auf einem. Wie viele, sagt der Tarif.',
  },
  'home.what.4.title': { en: 'From the browser', de: 'Aus dem Browser' },
  'home.what.4.text': {
    en: 'The panel works on the desktop and on the phone. There is nothing to install.',
    de: 'Das Panel läuft am Rechner und am Handy. Zu installieren gibt es nichts.',
  },
  'home.what.link': { en: 'All features', de: 'Alle Funktionen' },

  'home.price.title': { en: 'What it costs', de: 'Was es kostet' },
  'home.price.lead': {
    en: 'The first server slot is free. Every further one is paid from your credit balance for 30 days at a time and can be stopped whenever you like.',
    de: 'Der erste Serverplatz ist gratis. Jeder weitere wird für jeweils 30 Tage aus dem Guthaben bezahlt und lässt sich jederzeit beenden.',
  },
  'home.price.link': { en: 'All plans and prices', de: 'Alle Tarife und Preise' },

  // ------------------------------------------------ Funktionen
  'features.title': { en: 'What AFKSystems can do', de: 'Was AFKSystems kann' },
  'features.lead': {
    en: 'Everything listed here works today. What needs a paid server slot is marked.',
    de: 'Alles, was hier steht, funktioniert heute. Was einen bezahlten Serverplatz braucht, ist gekennzeichnet.',
  },
  'features.premium': { en: 'Paid slot', de: 'Bezahlter Platz' },
  'features.ultra': { en: 'Ultra or add-on', de: 'Ultra oder Zusatz' },
  'features.soon': { en: 'Coming later', de: 'Kommt später' },

  // ------------------------------------------------ Preise
  'pricing.title': { en: 'Plans and prices', de: 'Tarife und Preise' },
  'pricing.lead': {
    en: 'Paid per server slot for 30 days, out of your credit balance. One credit is one cent, so 100 credits are one euro.',
    de: 'Bezahlt wird je Serverplatz für 30 Tage, aus dem Guthaben. Ein Credit ist ein Cent, 100 Credits sind ein Euro.',
  },
  'pricing.slot': { en: 'Slot', de: 'Platz' },
  'pricing.slot1': {
    en: 'One bot, chat, commands and macros while your linked Discord account remains a member.',
    de: 'Ein Bot, Chat, Befehle und Macros, solange dein verknüpftes Discord-Konto Mitglied bleibt.',
  },
  'pricing.slot2': {
    en: 'One plan per server, paid every 30 days.',
    de: 'Je Server ein Tarif, alle 30 Tage bezahlt.',
  },
  'pricing.from': { en: 'from', de: 'ab' },
  'pricing.onRequest': { en: 'on request', de: 'auf Anfrage' },
  'pricing.offlineAccounts': { en: 'Offline accounts', de: 'Offline-Konten' },
  'pricing.perServer': { en: 'per server / 30 days', de: 'je Server / 30 Tage' },
  'pricing.freeForever': { en: 'with Discord membership', de: 'mit Discord-Mitgliedschaft' },
  'pricing.perMonthEuro': { en: '{amount} credits per 30 days', de: '{amount} Credits je 30 Tage' },
  'pricing.creditsNote': {
    en: 'Paid from credits: 100 credits = 1 €. Nothing is debited from a card on its own.',
    de: 'Bezahlt aus dem Guthaben: 100 Credits = 1 €. Von einer Karte wird nichts von selbst abgebucht.',
  },
  'pricing.everythingIn': { en: 'Everything in {plan}, plus:', de: 'Alles aus {plan}, dazu:' },
  'pricing.addonsTitle': { en: 'Add on what you need', de: 'Dazubuchen, was fehlt' },
  'pricing.addonsLead': {
    en: 'A server slot does not have to jump to the next plan for one more bot. Extras are booked per slot and can be cancelled at any time.',
    de: 'Ein Serverplatz muss nicht auf den nächstgrößeren Tarif springen, nur weil ein Bot mehr gebraucht wird. Zusätze gelten je Platz und lassen sich jederzeit abbestellen.',
  },
  'pricing.bots': { en: 'bots at once on this server', de: 'Bots gleichzeitig auf diesem Server' },
  'pricing.bot': { en: 'bot on this server', de: 'Bot auf diesem Server' },
  'pricing.premiumClient': { en: 'Movement, anti-AFK, sneaking', de: 'Bewegung, Anti-AFK, Schleichen' },
  'pricing.board': { en: 'Scoreboard as in the game', de: 'Scoreboard wie im Spiel' },
  'pricing.menus': { en: 'Open and use menus', de: 'Menüs öffnen und bedienen' },
  'pricing.macros': { en: '{n} macros per server', de: '{n} Macros je Server' },
  'pricing.addonHint': { en: 'bookable as an add-on', de: 'als Zusatz buchbar' },
  'pricing.slimClient': { en: 'Connect, chat, commands, macros', de: 'Verbinden, Chat, Befehle, Macros' },
  'pricing.chatHistory': { en: 'lines of chat history', de: 'Zeilen Chatverlauf' },
  'pricing.proxyOnRequest': { en: 'Own outgoing address on request', de: 'Eigene Ausgangsadresse auf Anfrage' },
  'pricing.prioritySupport': { en: 'Support with priority', de: 'Support mit Vorrang' },
  'pricing.choose': { en: 'Get started', de: 'Loslegen' },
  'pricing.topup.title': { en: 'Topping up credits', de: 'Guthaben aufladen' },
  'pricing.topup.lead': {
    en: 'Bigger packages carry a bonus. Credits do not expire, and they are only spent when you create or renew a paid slot.',
    de: 'Größere Pakete haben Bonus. Guthaben verfällt nicht und wird nur ausgegeben, wenn du einen bezahlten Platz anlegst oder verlängerst.',
  },
  'pricing.topup.bonus': { en: 'bonus', de: 'Bonus' },

  'pricing.rules.title': { en: 'How the billing works', de: 'Wie abgerechnet wird' },
  'pricing.rules.1.q': { en: 'How is a month counted?', de: 'Wie wird ein Monat gerechnet?' },
  'pricing.rules.1.a': {
    en: 'A month is 30 days, counted from the moment a slot is paid for. Not by calendar month.',
    de: 'Ein Monat sind 30 Tage, gezählt ab dem Moment, in dem ein Platz bezahlt wird. Nicht nach Kalendermonat.',
  },
  'pricing.rules.2.q': { en: 'What is a credit?', de: 'Was ist ein Credit?' },
  'pricing.rules.2.a': {
    en: 'One credit is one cent, so 100 credits are one euro. Credits are always whole numbers and they do not expire.',
    de: 'Ein Credit ist ein Cent, 100 Credits sind ein Euro. Credits sind immer ganze Zahlen und verfallen nicht.',
  },
  'pricing.rules.3.q': { en: 'Can I change the plan of a server?', de: 'Kann ich den Tarif eines Servers wechseln?' },
  'pricing.rules.3.a': {
    en: 'Yes, at any time. The unused part of the running month is credited back to you and the new plan is charged in full.',
    de: 'Ja, jederzeit. Der ungenutzte Teil des laufenden Monats wird dir gutgeschrieben, der neue Tarif voll berechnet.',
  },
  'pricing.rules.4.q': { en: 'How do I pay?', de: 'Wie bezahle ich?' },
  'pricing.rules.4.a': {
    en: 'You top up credits once and spend them from there. Which payment methods are open is shown in the panel under Credits.',
    de: 'Du lädst Guthaben auf und gibst es von dort aus. Welche Zahlungswege offen sind, steht im Panel unter Guthaben.',
  },

  // ------------------------------------------------ Ablauf
  'how.title': { en: 'From account to running bot', de: 'Vom Konto zum laufenden Bot' },
  'how.1.title': { en: 'Create an account', de: 'Konto anlegen' },
  'how.1.text': {
    en: 'Email address, username, password. The free server slot is there right away.',
    de: 'E-Mail-Adresse, Benutzername, Passwort. Der Gratis-Serverplatz ist sofort da.',
  },
  'how.2.title': { en: 'Connect Minecraft', de: 'Minecraft verbinden' },
  'how.2.text': {
    en: 'The panel shows a link to Microsoft with your code already in it. You confirm there once.',
    de: 'Das Panel zeigt einen Link zu Microsoft, der Code steht schon darin. Dort bestätigst du einmal.',
  },
  'how.3.title': { en: 'Add a server and start', de: 'Server anlegen und starten' },
  'how.3.text': {
    en: 'Enter the address, choose the version, press start. From then on the bot looks after itself.',
    de: 'Adresse eintragen, Version wählen, Start drücken. Ab da kümmert sich der Bot um sich selbst.',
  },

  // ------------------------------------------------ Fragen
  'faq.title': { en: 'Questions and answers', de: 'Fragen und Antworten' },
  'faq.lead': {
    en: 'The things people ask before they sign up.',
    de: 'Was vor der Anmeldung meistens gefragt wird.',
  },
  'faq.1.q': { en: 'Does my computer have to stay on?', de: 'Muss mein Rechner laufen?' },
  'faq.1.a': {
    en: 'No. The bots run on our servers. You can close the panel and switch your computer off, and the chat is still there when you come back.',
    de: 'Nein. Die Bots laufen auf unseren Servern. Du kannst das Panel schließen und den Rechner ausschalten. Der Chat ist noch da, wenn du wiederkommst.',
  },
  'faq.2.q': { en: 'Is my Minecraft account safe?', de: 'Ist mein Minecraft-Konto sicher?' },
  'faq.2.a': {
    en: 'You sign in at Microsoft, in a window of theirs. We never get to see your password, and you can disconnect the account in the panel again at any time.',
    de: 'Angemeldet wird bei Microsoft, in deren eigenem Fenster. Dein Passwort bekommen wir nie zu sehen, und du kannst das Konto im Panel jederzeit wieder trennen.',
  },
  'faq.3.q': { en: 'What does it cost?', de: 'Was kostet das?' },
  'faq.3.a': {
    en: 'The first server slot is free while your linked Discord account remains in the AFKSystems server. Every further one is paid from your credit balance for 30 days.',
    de: 'Der erste Serverplatz ist gratis, solange dein verknüpftes Discord-Konto im AFKSystems-Server bleibt. Jeder weitere wird für 30 Tage aus dem Guthaben bezahlt.',
  },
  'faq.4.q': { en: 'What happens when my credits run out?', de: 'Was passiert, wenn mein Guthaben leer ist?' },
  'faq.4.a': {
    en: 'The slot simply stops renewing: the bots stop, nothing is deleted, and your balance never goes below zero. Top up and carry on.',
    de: 'Der Platz verlängert sich einfach nicht mehr: Die Bots stoppen, gelöscht wird nichts, und unter null geht das Guthaben nie. Aufladen und weitermachen.',
  },
  'faq.5.q': { en: 'Am I allowed to do this on any server?', de: 'Ist das auf jedem Server erlaubt?' },
  'faq.5.a': {
    en: 'That is up to each server. Read its rules first. If a server does not want AFK bots, we cannot change that.',
    de: 'Das entscheidet jeder Server selbst. Lies erst dessen Regeln. Will ein Server keine AFK-Bots, können wir daran nichts ändern.',
  },
  'faq.6.q': { en: 'How many bots can I run?', de: 'Wie viele Bots kann ich laufen lassen?' },
  'faq.6.a': {
    en: 'One on the free slot. On a paid slot it depends on the plan, and the number is listed with each one.',
    de: 'Auf dem Gratis-Platz einen. Auf einem bezahlten hängt es vom Tarif ab, die Zahl steht bei jedem dabei.',
  },
  'faq.7.q': { en: 'Do I have to cancel anything?', de: 'Muss ich irgendetwas kündigen?' },
  'faq.7.a': {
    en: 'No. Nothing is debited from a card; you spend credits you have topped up yourself. Switch the renewal off for a slot and it ends when its 30 days are over.',
    de: 'Nein. Von einer Karte wird nichts abgebucht, du gibst Guthaben aus, das du selbst aufgeladen hast. Schalte die Verlängerung eines Platzes aus, dann endet er mit seinen 30 Tagen.',
  },
  'faq.more.title': { en: 'Something still open?', de: 'Noch etwas offen?' },
  'faq.more.lead': {
    en: 'Create an account and open a ticket in the panel. That is where we answer.',
    de: 'Leg ein Konto an und mach im Panel ein Ticket auf. Dort antworten wir.',
  },

  'cta.title': { en: 'Start with the free slot', de: 'Fang mit dem Gratis-Platz an' },
  'cta.lead': {
    en: 'Link Discord and stay in the AFKSystems server to keep the free slot active.',
    de: 'Verknüpfe Discord und bleib im AFKSystems-Server, damit der Gratis-Platz aktiv bleibt.',
  },
  'cta.have': { en: 'I already have an account', de: 'Ich habe schon ein Konto' },

  'footer.about': {
    en: 'Minecraft AFK hosting. Credits instead of a contract.',
    de: 'Minecraft-AFK-Hosting. Guthaben statt Vertrag.',
  },
  'footer.panel': { en: 'Panel', de: 'Panel' },
  'footer.topics': { en: 'Product', de: 'Angebot' },
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
  'auth.login.google': { en: 'Continue with Google', de: 'Weiter mit Google' },
  'auth.register.discord': { en: 'Sign up with Discord', de: 'Mit Discord registrieren' },
  'auth.register.google': { en: 'Sign up with Google', de: 'Mit Google registrieren' },
  'auth.or': { en: 'or', de: 'oder' },
  'auth.working': { en: 'One moment …', de: 'Einen Moment …' },

  'auth.register.title': { en: 'Create account', de: 'Konto anlegen' },
  'auth.register.lead': {
    en: 'One server slot is free with an active AFKSystems Discord membership. No payment details needed.',
    de: 'Ein Serverplatz ist mit aktiver AFKSystems-Discord-Mitgliedschaft gratis. Zahlungsdaten brauchst du nicht.',
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
  'dash.accountsShort': { en: 'Accounts', de: 'Konten' },
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
  'tab.board': { en: 'Scoreboard', de: 'Scoreboard' },
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
  'acc.suspended': { en: 'Suspended', de: 'Suspendiert' },
  'acc.suspendedHint': {
    en: 'This Minecraft account was suspended by an administrator.',
    de: 'Dieses Minecraft-Konto wurde von einem Administrator suspendiert.',
  },
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
  // Der Link enthält den Code schon – abtippen muss ihn niemand, und deshalb steht er auch
  // nirgends mehr im Fenster.
  'acc.ms.step': {
    en: 'Confirm in the window that opens. This one finishes on its own.',
    de: 'Im Fenster, das aufgeht, bestätigen. Dieses hier macht den Rest allein.',
  },
  'acc.ms.open': { en: 'Open link', de: 'Link öffnen' },
  'acc.ms.waiting': { en: 'Waiting for your confirmation …', de: 'Warte auf deine Bestätigung …' },
  'acc.ms.done': { en: 'Connected: {name}', de: 'Verbunden: {name}' },
  'acc.ms.expired': { en: 'The code expired. Start again.', de: 'Der Code ist abgelaufen. Nochmal starten.' },

  // ---------------------------------------------------------------- Serverplatz
  'srv.new': { en: 'Add a server', de: 'Server anlegen' },
  'srv.name': { en: 'Name', de: 'Name' },
  'srv.address': { en: 'Server address', de: 'Serveradresse' },
  'srv.addressHint': { en: 'For example gravijet.net or 1.2.3.4:25565', de: 'Zum Beispiel gravijet.net oder 1.2.3.4:25565' },
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
  'srv.chatEmpty': { en: 'No messages yet.', de: 'Noch keine Nachrichten.' },
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
  'srv.unavailable': { en: 'Unavailable', de: 'Nicht verfügbar' },
  'srv.commandFailed': { en: 'The command could not be sent.', de: 'Der Befehl konnte nicht gesendet werden.' },
  'srv.freeDiscordTitle': { en: 'Free slot paused', de: 'Gratis-Platz pausiert' },
  'srv.freeDiscordAction': {
    en: 'Link or check Discord in settings.',
    de: 'Discord in den Einstellungen verknüpfen oder prüfen.',
  },
  'srv.freeDiscord.not-configured': {
    en: 'The Discord membership check is not configured.',
    de: 'Die Prüfung der Discord-Mitgliedschaft ist nicht eingerichtet.',
  },
  'srv.freeDiscord.discord-link': {
    en: 'Link your Discord account to use the free slot.',
    de: 'Verknüpfe dein Discord-Konto, um den Gratis-Platz zu nutzen.',
  },
  'srv.freeDiscord.discord-check': {
    en: 'Your Discord membership has not been confirmed recently.',
    de: 'Deine Discord-Mitgliedschaft wurde zuletzt nicht bestätigt.',
  },
  'srv.freeDiscord.discord-join': {
    en: 'Join the AFKSystems Discord server to use the free slot.',
    de: 'Tritt dem AFKSystems-Discord-Server bei, um den Gratis-Platz zu nutzen.',
  },
  'srv.restartNeeded': {
    en: 'Running bots pick this up on their next start.',
    de: 'Laufende Bots übernehmen das erst beim nächsten Start.',
  },
  'srv.disconnectStops': {
    en: 'A kick or broken connection ends the client. Start it again from the panel when you want to reconnect.',
    de: 'Ein Kick oder Verbindungsabbruch beendet den Client. Für eine neue Verbindung startest du ihn bewusst im Panel erneut.',
  },
  'srv.walk': { en: 'Walk', de: 'Gehen' },
  'srv.blocks': { en: 'Blocks per step', de: 'Blöcke je Schritt' },
  'srv.jump': { en: 'Jump', de: 'Springen' },
  'srv.pos': { en: 'Where am I?', de: 'Wo bin ich?' },
  'srv.positionMissing': { en: 'No coordinates received.', de: 'Keine Koordinaten empfangen.' },
  'srv.positionLook': { en: 'View: {yaw}° / {pitch}°', de: 'Blick: {yaw}° / {pitch}°' },
  'srv.look': { en: 'Look', de: 'Blickrichtung' },
  'srv.lookHint': {
    en: 'Yaw as in the F3 screen: 0 south, 90 west, −90 east, 180 north. Negative pitch looks up.',
    de: 'Yaw wie im F3-Bildschirm: 0 Süden, 90 Westen, −90 Osten, 180 Norden. Pitch negativ heißt nach oben.',
  },
  'srv.home': { en: 'Home position', de: 'Heimatposition' },
  'srv.homeAuto': { en: 'Return home automatically', de: 'Automatisch nach Hause laufen' },
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
  'srv.sneak': { en: 'Sneak', de: 'Schleichen' },
  'srv.sprint': { en: 'Sprint', de: 'Sprinten' },
  'srv.sneakAlways': { en: 'Stay crouched permanently', de: 'Dauerhaft geduckt bleiben' },
  'srv.swing': { en: 'Swing arm', de: 'Arm schwingen' },
  'srv.use': { en: 'Use item', de: 'Benutzen' },
  'srv.hand': { en: 'Pick slot', de: 'Feld wählen' },
  'srv.slot': { en: 'Slot', de: 'Feld' },
  'srv.antiafk': { en: 'Anti-AFK movement', de: 'Anti-AFK-Bewegung' },
  'srv.antiafkHint': {
    en: 'Small, restrained movements against plugins that look for real activity. 0 turns it off.',
    de: 'Kleine, zurückhaltende Bewegungen gegen Plugins, die auf echte Aktivität prüfen. 0 schaltet es aus.',
  },
  'srv.boardHint': {
    en: 'The client asks the server for its current sidebar and shows it below.',
    de: 'Der Client fragt die aktuelle Seitenleiste ab und zeigt sie unten an.',
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
  'srv.macroHint': {
    en: 'A macro has one trigger and a chain of steps that run in order. Plain chat chains on join go to the client itself; everything else is timed by the panel so changes take effect at once.',
    de: 'Ein Macro hat einen Auslöser und eine Kette von Schritten, die der Reihe nach laufen. Reine Chat-Ketten beim Beitritt übernimmt der Client selbst – alles andere taktet das Panel, damit Änderungen sofort greifen.',
  },
  'srv.macroExample': {
    en: 'A typical first one: send /afk on join, or fire a command every five minutes.',
    de: 'Typischer Anfang: beim Beitritt /afk senden, oder alle fünf Minuten einen Befehl absetzen.',
  },
  'srv.intervalSec': { en: 'Every … seconds', de: 'Alle … Sekunden' },
  'srv.chatContains': { en: 'Chat line contains', de: 'Chatzeile enthält' },
  'srv.chatContainsHint': {
    en: 'Upper and lower case do not matter.',
    de: 'Groß- und Kleinschreibung spielt keine Rolle.',
  },
  'srv.chatRegex': { en: 'Or a regular expression', de: 'Oder ein regulärer Ausdruck' },
  'srv.chatRegexHint': {
    en: 'Only needed for patterns that “contains” cannot express.',
    de: 'Nur nötig für Muster, die sich mit „enthält“ nicht ausdrücken lassen.',
  },
  'srv.waitBefore': { en: 'Wait before (seconds)', de: 'Vorher warten (Sekunden)' },
  'srv.behaviour': { en: 'Behaviour', de: 'Verhalten' },
  'srv.joinDelay': { en: 'Wait after joining (seconds)', de: 'Wartezeit nach dem Beitritt (Sekunden)' },
  'srv.autoReconnect': { en: 'Reconnect automatically after a drop', de: 'Nach einem Abbruch automatisch neu verbinden' },
  'srv.firstWait': { en: 'First wait (s)', de: 'Erste Wartezeit (s)' },
  'srv.maxWait': { en: 'Upper limit (s)', de: 'Obergrenze (s)' },
  'srv.chatDelay': { en: 'Minimum gap between messages (ms)', de: 'Mindestabstand zweier Nachrichten (ms)' },
  'srv.useMovement': { en: 'Use the movement build', de: 'Bewegungs-Bauform verwenden' },
  'srv.onCooldown': { en: 'Cooldown between macro triggers (s)', de: 'Sperrzeit zwischen Macro-Auslösern (s)' },
  'srv.onCooldownHint': {
    en: 'How long the same trigger stays quiet after it fired once.',
    de: 'Wie lange derselbe Auslöser Ruhe gibt, nachdem er einmal ausgelöst hat.',
  },
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
  'px.kind': { en: 'Type', de: 'Typ' },
  'px.host': { en: 'Address', de: 'Adresse' },
  'px.mine': { en: 'Assigned to you', de: 'Dir zugeteilt' },
  'px.none': { en: 'None assigned yet.', de: 'Noch keiner zugeteilt.' },
  'px.allowance': { en: 'You may use up to {n}.', de: 'Du darfst bis zu {n} nutzen.' },
  'px.unsupported': {
    en: 'Proxies cannot be used on this server at the moment.',
    de: 'Proxys lassen sich auf diesem Server gerade nicht nutzen.',
  },
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
  'tk.priority': { en: 'Priority', de: 'Priorität' },
  'tk.priority.low': { en: 'Low', de: 'Niedrig' },
  'tk.priority.normal': { en: 'Normal', de: 'Normal' },
  'tk.priority.high': { en: 'High', de: 'Hoch' },
  'tk.priority.urgent': { en: 'Urgent', de: 'Dringend' },
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
  'set.webhookSent': { en: 'Test message sent.', de: 'Testnachricht ist raus.' },
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
  // Die Gruppen der Seitenleiste im Admin-Bereich.
  'adm.group.work': { en: 'Day-to-day', de: 'Tagesgeschäft' },
  'adm.group.money': { en: 'Plans and money', de: 'Tarife und Geld' },
  'adm.group.platform': { en: 'Platform', de: 'Plattform' },
  'adm.group.logs': { en: 'Logs and health', de: 'Protokolle und Zustand' },
  'adm.packCent': { en: 'Amount in cents', de: 'Betrag in Cent' },
  'adm.packLabel': { en: 'Label', de: 'Beschriftung' },
  'adm.overview': { en: 'Overview', de: 'Übersicht' },
  'adm.users': { en: 'Users', de: 'Nutzer' },
  'adm.plans': { en: 'Plans', de: 'Tarife' },
  'adm.vouchers': { en: 'Vouchers', de: 'Gutscheine' },
  'adm.topups': { en: 'Top-ups', de: 'Aufladungen' },
  'adm.proxies': { en: 'Proxies', de: 'Proxys' },
  'adm.tickets': { en: 'Tickets', de: 'Tickets' },
  'adm.profiles': { en: 'Server slots', de: 'Serverplätze' },
  'adm.bots': { en: 'Bots', de: 'Bots' },
  'adm.accounts': { en: 'Accounts', de: 'Accounts' },
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
  'adm.paying': { en: 'Paying', de: 'Zahlend' },
  'adm.premium': { en: 'Premium', de: 'Premium' },
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
  'adm.usersLine': { en: '+{new} in 30 days · {active} active today', de: '+{new} in 30 Tagen · {active} heute aktiv' },
  'adm.unread': { en: '{n} unread', de: '{n} ungelesen' },
  'adm.revenueAll': { en: '{total} all time', de: '{total} insgesamt' },
  'adm.attention': { en: 'Needs a look', de: 'Braucht einen Blick' },
  'adm.attentionLine': {
    en: '{blocked} blocked · {unverified} unconfirmed',
    de: '{blocked} gesperrt · {unverified} unbestätigt',
  },

  // ---------------------------------------------------------------- Zusätze
  //
  // Ein Zusatz hängt am Serverplatz: ein Bot mehr, die Anzeigetafel, später die Live-Ansicht.
  // Der Tarif bleibt, wie er ist – bezahlt wird nur, was wirklich dazukommt.
  'ad.title': { en: 'Add-ons', de: 'Zusätze' },
  'ad.sub': {
    en: 'Extras for this server slot. Booked now, charged for the rest of the month; from the next renewal they are part of the monthly price.',
    de: 'Erweiterungen für diesen Serverplatz. Sofort gebucht, anteilig für den Rest des Monats bezahlt – ab der nächsten Verlängerung stecken sie im Monatspreis.',
  },
  'ad.book': { en: 'Book', de: 'Buchen' },
  'ad.cancel': { en: 'Cancel', de: 'Abbestellen' },
  'ad.booked': { en: 'Booked', de: 'Gebucht' },
  'ad.included': { en: 'Already in your plan', de: 'Im Tarif enthalten' },
  'ad.soon': { en: 'Coming later', de: 'Kommt später' },
  'ad.soonHint': {
    en: 'Announced, not bookable yet. It appears here the moment it works.',
    de: 'Angekündigt, aber noch nicht buchbar. Er taucht hier auf, sobald er läuft.',
  },
  'ad.perMonth': { en: 'per month', de: 'im Monat' },
  'ad.nowOnly': { en: 'now only {credits}', de: 'jetzt nur {credits}' },
  'ad.restOfMonth': { en: 'for the {n} days left this period', de: 'für die restlichen {n} Tage' },
  'ad.freePlan': {
    en: 'The free server slot takes no add-ons. Pick a paid plan first, then everything here is available.',
    de: 'Der kostenlose Serverplatz nimmt keine Zusätze. Wähle zuerst einen bezahlten Tarif – danach steht hier alles offen.',
  },
  'ad.qty': { en: 'How many', de: 'Wie viele' },
  'ad.monthlyAfter': { en: 'Monthly from now on', de: 'Monatlich ab jetzt' },
  'ad.confirmBuy': {
    en: 'Book {qty} × “{name}” for {credits} credits?',
    de: '{qty} × „{name}“ für {credits} Credits buchen?',
  },
  'ad.confirmDrop': {
    en: 'Cancel “{name}”? The unused rest comes back as credits.',
    de: '„{name}“ abbestellen? Der nicht verbrauchte Rest kommt aufs Guthaben zurück.',
  },

  // ---------------------------------------------------------------- Standorte
  'nd.title': { en: 'Location', de: 'Standort' },
  'nd.sub': {
    en: 'Where this server slot goes out to the internet. Every location has its own address.',
    de: 'Von wo dieser Serverplatz ins Netz geht. Jeder Standort hat seine eigene Adresse.',
  },
  'nd.change': { en: 'Change location', de: 'Standort wechseln' },
  'nd.changeHint': {
    en: 'Running bots restart – the address is set when they start.',
    de: 'Laufende Bots starten neu – die Adresse steht beim Start fest.',
  },
  'nd.full': { en: 'full', de: 'voll' },
  'nd.main': { en: 'Main location', de: 'Haupt-Standort' },
  'nd.access.all': { en: 'Everyone', de: 'Alle' },
  'nd.access.listed': { en: 'Only listed users', de: 'Nur ausgewählte Nutzer' },
  'nd.access.admin': { en: 'Administrators only', de: 'Nur Administratoren' },

  // ---------------------------------------------------------------- Anzeigetafel und Menüs
  'vw.board': { en: 'Scoreboard', de: 'Scoreboard' },
  'vw.menu': { en: 'Menu', de: 'Menü' },
  'vw.fetch': { en: 'Fetch', de: 'Abrufen' },
  'vw.empty': { en: 'The server is not showing one right now.', de: 'Der Server zeigt gerade keine an.' },
  'vw.emptyMenu': { en: 'No menu is open.', de: 'Gerade ist kein Menü offen.' },
  'vw.hint': {
    en: 'The scoreboard is read once when you ask for it – it is not a live feed.',
    de: 'Das Scoreboard wird bei jeder Abfrage einmal gelesen – es läuft nicht live mit.',
  },
  'vw.slots': { en: '{n} slots', de: '{n} Felder' },
  'vw.clickSlot': { en: 'Click a slot to use it.', de: 'Klick ein Feld an, um es zu benutzen.' },
  'vw.menuBlind': {
    en: 'Names, counts and colors come from the server. Hover or focus an item to load its lore.',
    de: 'Namen, Anzahl und Farben kommen vom Server. Fahre über ein Item oder fokussiere es, um die Lore zu laden.',
  },
  'vw.stale': { en: 'from {time}', de: 'von {time}' },
  'vw.needBoard': {
    en: 'The scoreboard is included in every paid plan.',
    de: 'Das Scoreboard ist in jedem bezahlten Tarif enthalten.',
  },
  'vw.needMenu': {
    en: 'Menus are part of Ultra. On Premium you can add them as an extra.',
    de: 'Menüs gehören zu Ultra. Auf Premium lassen sie sich als Zusatz dazubuchen.',
  },
  'vw.toAddons': { en: 'Go to add-ons', de: 'Zu den Zusätzen' },

  // ---------------------------------------------------------------- Chat
  'ch.sent': { en: 'Sent', de: 'Gesendet' },
  'ch.autoscroll': { en: 'Scroll along', de: 'Mitscrollen' },
  'ch.autoscrollHint': {
    en: 'Jump to the newest line automatically.',
    de: 'Springt von selbst zur neuesten Zeile.',
  },
  'ch.heardBy': { en: 'heard by {n}', de: 'von {n} gehört' },
  'ch.onlyOne': { en: 'only {name}', de: 'nur {name}' },
  'ch.clear': { en: 'Clear view', de: 'Ansicht leeren' },
  'ch.connected': { en: 'Live', de: 'Live' },
  'ch.reconnecting': { en: 'Reconnecting …', de: 'Verbinde neu …' },

  // ---------------------------------------------------------------- Einstellungen (neu)
  'set.security': { en: 'Security', de: 'Sicherheit' },
  'set.securitySub': {
    en: 'Your password, your devices, and every message we have sent you.',
    de: 'Dein Passwort, deine Geräte und jede Nachricht, die wir dir geschickt haben.',
  },
  'set.linked': { en: 'Linked accounts', de: 'Verknüpfte Konten' },
  'set.linkedSub': {
    en: 'Sign in with one click and get your Discord roles automatically. We never see a password.',
    de: 'Mit einem Klick anmelden und die Discord-Rollen automatisch bekommen. Ein Passwort sehen wir dabei nie.',
  },
  'set.notify': { en: 'Messages', de: 'Nachrichten' },
  'set.notifySub': {
    en: 'Which emails you want. Security messages always arrive – they are what tells you when something is wrong with your account.',
    de: 'Welche E-Mails du bekommen willst. Sicherheitsnachrichten kommen immer – sie sind das, was dich warnt, wenn mit deinem Konto etwas nicht stimmt.',
  },
  'set.mailsTitle': { en: 'Messages we sent you', de: 'Nachrichten an dich' },
  'set.mailsSub': {
    en: 'Everything we sent to your address. Got a mail that is not in this list? Then it was not from us.',
    de: 'Alles, was an deine Adresse ging. Eine Mail bekommen, die hier nicht steht? Dann war sie nicht von uns.',
  },
  'set.mailsNone': { en: 'Nothing sent yet.', de: 'Bisher nichts verschickt.' },
  'set.mailFailed': { en: 'could not be delivered', de: 'kam nicht an' },
  'set.link': { en: 'Link', de: 'Verknüpfen' },
  'set.unlink': { en: 'Unlink', de: 'Trennen' },
  'set.linkedAs': { en: 'Linked as {name}', de: 'Verknüpft als {name}' },
  'set.notLinked': { en: 'Not linked', de: 'Nicht verknüpft' },
  'set.providerOff': { en: 'Not set up on this server.', de: 'Auf diesem Server nicht eingerichtet.' },
  'set.discordWhat': {
    en: 'Roles for your plan, tickets in Discord, and signing in with one click.',
    de: 'Rollen für deinen Tarif, Tickets in Discord und Anmelden mit einem Klick.',
  },
  'set.googleWhat': { en: 'Sign in with one click.', de: 'Anmelden mit einem Klick.' },
  'set.verifyRoles': { en: 'Refresh Discord roles', de: 'Discord-Rollen auffrischen' },
  'set.verifyRolesHint': {
    en: 'Refreshes the Administrator or Discord Moderator linked-role status.',
    de: 'Aktualisiert den Linked-Role-Status für Administrator oder Discord-Moderator.',
  },
  'set.freeDiscordOk': {
    en: 'AFKSystems membership confirmed — the free slot can run.',
    de: 'AFKSystems-Mitgliedschaft bestätigt – der Gratis-Platz kann laufen.',
  },
  'set.freeDiscordMissing': {
    en: 'Membership not confirmed — the free slot is stopped.',
    de: 'Mitgliedschaft nicht bestätigt – der Gratis-Platz ist gestoppt.',
  },
  'set.freeDiscordLink': {
    en: 'The free slot needs a linked Discord account in the AFKSystems server.',
    de: 'Der Gratis-Platz braucht ein verknüpftes Discord-Konto im AFKSystems-Server.',
  },
  'set.webhookWhat': {
    en: 'A private Discord channel of yours that gets a message when a bot drops out or credits run low.',
    de: 'Ein eigener Discord-Kanal, in den eine Nachricht kommt, wenn ein Bot rausfliegt oder das Guthaben knapp wird.',
  },
  'set.appearance': { en: 'Appearance and language', de: 'Aussehen und Sprache' },
  'set.dangerZone': { en: 'Account', de: 'Konto' },
  'set.thisDevice': { en: 'this device', de: 'dieses Gerät' },
  'set.welcome': { en: 'Welcome! Your account is ready.', de: 'Willkommen! Dein Konto steht.' },
  'set.linkOk': { en: 'Account linked.', de: 'Konto verknüpft.' },

  // ---------------------------------------------------------------- Tickets (neu)
  'tk.reopen': { en: 'Reopen', de: 'Wieder öffnen' },
  'tk.reopenHint': {
    en: 'Just write a reply – that reopens the ticket and keeps the history.',
    de: 'Schreib einfach eine Antwort – das macht das Ticket wieder auf, und der Verlauf bleibt.',
  },
  'tk.closedNote': {
    en: 'This ticket is closed. A reply opens it again.',
    de: 'Dieses Ticket ist geschlossen. Eine Antwort macht es wieder auf.',
  },
  'tk.people': { en: 'People on this ticket', de: 'Beteiligte' },
  'tk.addPerson': { en: 'Add someone', de: 'Jemanden dazuholen' },
  'tk.removePerson': { en: 'Remove', de: 'Entfernen' },
  'tk.author': { en: 'Author', de: 'Ersteller' },
  'tk.typing': { en: '{name} is writing …', de: '{name} schreibt …' },
  'tk.typingMany': { en: 'Several people are writing …', de: 'Mehrere schreiben …' },
  'tk.viaDiscord': { en: 'via Discord', de: 'über Discord' },
  'tk.inDiscord': { en: 'Also open in Discord', de: 'Läuft auch in Discord' },
  'tk.setStatus': { en: 'Status', de: 'Zustand' },
  'tk.assign': { en: 'Handled by', de: 'Bearbeitet von' },
  'tk.unassigned': { en: 'nobody yet', de: 'noch niemand' },
  'tk.internalNote': { en: 'Internal note', de: 'Interne Notiz' },
  'tk.internalHint': { en: 'Only the team sees this.', de: 'Das sieht nur das Team.' },
  'tk.newFor': { en: 'New ticket for a customer', de: 'Ticket für einen Kunden' },
  'tk.onlySubject': {
    en: 'No text yet – only the subject. Write below to add something.',
    de: 'Noch kein Text – nur der Betreff. Schreib unten, wenn du etwas ergänzen willst.',
  },
  'tk.discordTitle': { en: 'Ask in Discord', de: 'Im Discord fragen' },
  'tk.discordText': {
    en: 'Other players are often faster than we are – and there is no waiting for a reply.',
    de: 'Andere Spieler sind oft schneller als wir – und du wartest auf keine Antwort.',
  },
  'tk.system': { en: 'System', de: 'System' },
  'tk.writeHint': { en: 'Enter sends, Shift+Enter is a new line.', de: 'Enter schickt ab, Shift+Enter macht eine neue Zeile.' },
  'tk.priorityShort': { en: 'Priority', de: 'Dringlichkeit' },

  // ---------------------------------------------------------------- Guthaben (neu)
  'bill.topUpBig': { en: 'Top up credits', de: 'Guthaben aufladen' },
  'bill.topUpLead': {
    en: 'Pick an amount. Bigger packages carry a bonus, and credits never expire.',
    de: 'Betrag wählen. Größere Pakete haben einen Bonus, und Guthaben verfällt nicht.',
  },
  'bill.bonus': { en: 'bonus', de: 'Bonus' },
  'bill.mostPopular': { en: 'most taken', de: 'am häufigsten' },
  'bill.movements': { en: 'Movements', de: 'Bewegungen' },
  'bill.movementsSub': { en: 'Every change to your balance.', de: 'Jede Änderung an deinem Guthaben.' },
  'bill.showAll': { en: 'Show all', de: 'Alle anzeigen' },
  'bill.kind.addon': { en: 'Add-on', de: 'Zusatz' },
  'bill.runsOut': { en: 'runs out {date}', de: 'reicht bis {date}' },
  'bill.covered': { en: 'covered', de: 'gedeckt' },

  // ---------------------------------------------------------------- Admin (neu)
  'adm.nodes': { en: 'Locations', de: 'Standorte' },
  'adm.addons': { en: 'Add-ons', de: 'Zusätze' },
  'adm.system': { en: 'System', de: 'System' },
  'adm.servers': { en: 'Servers', de: 'Server' },
  'adm.console': { en: 'Console', de: 'Konsole' },
  'adm.lock': { en: 'Suspend server', de: 'Server suspendieren' },
  'adm.unlock': { en: 'Resume server', de: 'Server fortsetzen' },
  'adm.lockReason': { en: 'Reason for suspension', de: 'Grund der Suspendierung' },
  'adm.locked': { en: 'Server suspended', de: 'Server suspendiert' },
  'adm.serverSuspended': { en: 'Server suspended', de: 'Server suspendiert' },
  'adm.billingSuspended': { en: 'Billing suspended', de: 'Abrechnung ausgesetzt' },
  'adm.suspendBilling': { en: 'Suspend billing', de: 'Abrechnung aussetzen' },
  'adm.resumeBilling': { en: 'Resume billing', de: 'Abrechnung fortsetzen' },
  'adm.discordRoles': { en: 'Discord roles', de: 'Discord-Rollen' },
  'adm.rolesSynced': {
    en: 'Calculated for the linked Discord account',
    de: 'Für das verknüpfte Discord-Konto berechnet',
  },
  'adm.rolesNeedLink': {
    en: 'Waiting for a linked Discord account',
    de: 'Wartet auf ein verknüpftes Discord-Konto',
  },
  'adm.assigned': { en: 'Assigned', de: 'Zugewiesen' },
  'adm.automatic': { en: 'Automatic', de: 'Automatisch' },
  'adm.notAssigned': { en: 'Not assigned', de: 'Nicht zugewiesen' },
  'adm.suspendAccount': { en: 'Suspend account', de: 'Account suspendieren' },
  'adm.resumeAccount': { en: 'Resume account', de: 'Account fortsetzen' },
  'adm.resumeAccountAsk': { en: 'Resume “{name}”?', de: '„{name}“ fortsetzen?' },
  'adm.suspendReason': { en: 'Reason for suspension', de: 'Grund der Suspendierung' },

  'role.customer': { en: 'Customer', de: 'Customer' },
  'role.customer.hint': {
    en: 'Automatic for every linked panel account.',
    de: 'Automatisch für jedes verknüpfte Panel-Konto.',
  },
  'role.premium': { en: 'Premium', de: 'Premium' },
  'role.premium.hint': {
    en: 'Automatic while a paid Premium slot is active.',
    de: 'Automatisch, solange ein bezahlter Premium-Platz aktiv ist.',
  },
  'role.ultra': { en: 'Ultra', de: 'Ultra' },
  'role.ultra.hint': {
    en: 'Automatic while an Ultra slot is active.',
    de: 'Automatisch, solange ein Ultra-Platz aktiv ist.',
  },
  'role.partner': { en: 'Partner', de: 'Partner' },
  'role.partner.hint': {
    en: 'Managed manually in the panel and synced as a regular role.',
    de: 'Im Panel vergeben und als normale Rolle synchronisiert.',
  },
  'role.vip': { en: 'VIP', de: 'VIP' },
  'role.vip.hint': {
    en: 'Managed manually in the panel and synced as a regular role.',
    de: 'Im Panel vergeben und als normale Rolle synchronisiert.',
  },
  'role.administrator': { en: 'Administrator', de: 'Administrator' },
  'role.administrator.hint': {
    en: 'Panel administrator; published as a Discord linked role.',
    de: 'Panel-Administrator; wird als Discord Linked Role veröffentlicht.',
  },
  'role.moderator': { en: 'Discord Moderator', de: 'Discord-Moderator' },
  'role.moderator.hint': {
    en: 'Set in the panel; published as a Discord linked role.',
    de: 'Im Panel gesetzt; wird als Discord Linked Role veröffentlicht.',
  },
  'role.team': { en: 'Team', de: 'Team' },
  'role.team.hint': {
    en: 'Added automatically for administrators and Discord moderators.',
    de: 'Wird Administratoren und Discord-Moderatoren automatisch hinzugefügt.',
  },
  'adm.sendMail': { en: 'Send an email', de: 'E-Mail schicken' },
  'adm.openTicket': { en: 'Open a ticket for them', de: 'Ticket für diesen Kunden' },
  'adm.mailForce': { en: 'Send even if unsubscribed', de: 'Auch senden, wenn abbestellt' },
  'adm.mailSent': { en: 'Sent.', de: 'Verschickt.' },
  'adm.announceMail': { en: 'Send as email', de: 'Als E-Mail verschicken' },
  'adm.announceTest': { en: 'Send to me only', de: 'Nur an mich' },
  'adm.announceSent': { en: 'Sent to {n} people.', de: 'An {n} Personen verschickt.' },
  'adm.announceAgain': { en: 'Already sent – send again?', de: 'Schon verschickt – noch einmal?' },
  'adm.cpu': { en: 'CPU', de: 'CPU' },
  'adm.ram': { en: 'Memory', de: 'Arbeitsspeicher' },
  'adm.disk': { en: 'Disk', de: 'Festplatte' },
  'adm.machine': { en: 'Machine', de: 'Maschine' },
  'adm.ofThat': { en: 'of that AFKSystems', de: 'davon AFKSystems' },
  'adm.cores': { en: '{n} cores', de: '{n} Kerne' },
  'adm.load': { en: 'Load', de: 'Last' },
  'adm.uptime': { en: 'Machine up for', de: 'Maschine läuft seit' },
  'adm.uptimePanel': { en: 'Panel up for', de: 'Panel läuft seit' },
  'adm.logs': { en: 'Bot logs', de: 'Bot-Protokolle' },
  'adm.perServer': { en: 'Per server', de: 'Je Server' },
  'adm.botProc': { en: 'bot processes', de: 'Bot-Prozesse' },
  'adm.detail': { en: 'Details', de: 'Einzelheiten' },
  'adm.noDetail': { en: 'nothing further', de: 'nichts weiter' },
  'adm.who': { en: 'Who', de: 'Wer' },
  'adm.what': { en: 'What', de: 'Was' },
  'adm.when': { en: 'When', de: 'Wann' },
  'adm.botStatus': { en: 'Discord bot', de: 'Discord-Bot' },
  'adm.botConnected': { en: 'connected', de: 'verbunden' },
  'adm.botAway': { en: 'not connected', de: 'nicht verbunden' },
  'adm.secretSet': { en: 'stored', de: 'hinterlegt' },
  'adm.secretUnset': { en: 'not stored', de: 'nicht hinterlegt' },
  'adm.secretKeep': { en: 'Leave empty to keep the stored one.', de: 'Leer lassen behält das gespeicherte.' },
  'adm.secretClear': { en: 'Remove', de: 'Entfernen' },
  'adm.reveal': { en: 'Show while typing', de: 'Beim Tippen zeigen' },
  'adm.testMail': { en: 'Send a test email', de: 'Test-E-Mail schicken' },
  'adm.mailsFailed': { en: '{n} could not be delivered', de: '{n} kamen nicht an' },
  'adm.everything': { en: 'Everything about this customer', de: 'Alles zu diesem Kunden' },

  // ---------------------------------------------------------------- Website
  'nav.discord': { en: 'Discord', de: 'Discord' },
  'discord.join': { en: 'Join our Discord', de: 'Auf unseren Discord' },
  'discord.lead': {
    en: 'Questions, status, and the people who run this. Tickets work there too – linked to the panel.',
    de: 'Fragen, Störungen und die Leute dahinter. Tickets gehen auch dort – synchron mit dem Panel.',
  },
  'rules.title': { en: 'Server rules are yours to keep', de: 'Für die Regeln deines Servers bist du zuständig' },
  'rules.text': {
    en: 'Many Minecraft servers do not allow AFK bots. Whether yours does is written in its rules, and checking is on you. If an account of yours gets banned, muted or removed by a server, that is between you and that server – AFKSystems takes no responsibility for it and cannot get the account back.',
    de: 'Viele Minecraft-Server erlauben keine AFK-Bots. Ob deiner das tut, steht in seinen Regeln – nachlesen musst du selbst. Wird eines deiner Konten von einem Server gebannt, stummgeschaltet oder entfernt, ist das eine Sache zwischen dir und diesem Server: AFKSystems übernimmt dafür keine Verantwortung und kann das Konto nicht zurückholen.',
  },
  'rules.short': {
    en: 'Check your server rules first – bans are between you and that server.',
    de: 'Prüf zuerst die Regeln deines Servers – ein Bann ist deine Sache mit diesem Server.',
  },

  // ---------------------------------------------------------------- Rechtliches
  'legal.imprint.title': { en: 'Imprint', de: 'Impressum' },
  'legal.privacy.title': { en: 'Privacy notice', de: 'Datenschutzerklärung' },
  'legal.terms.title': { en: 'Terms of use', de: 'Nutzungsbedingungen' },
  // Solange im Admin-Bereich unter "Recht" nichts hinterlegt ist, steht hier ein Hinweis. Je Seite
  // ein eigener: auf der Datenschutz- und der AGB-Seite stand vorher, ein Impressum sei Pflicht.
  'legal.placeholder.imprint': {
    en: 'This page still has to be filled in by the operator. Under German law an imprint is mandatory – it must be complete before the service is offered publicly.',
    de: 'Diese Seite muss der Betreiber noch ausfüllen. Ein Impressum ist in Deutschland Pflicht – es muss vollständig sein, bevor der Dienst öffentlich angeboten wird.',
  },
  'legal.placeholder.privacy': {
    en: 'This page still has to be filled in by the operator. A privacy notice is mandatory as soon as personal data is processed – and this service processes it.',
    de: 'Diese Seite muss der Betreiber noch ausfüllen. Eine Datenschutzerklärung ist Pflicht, sobald personenbezogene Daten verarbeitet werden – und das tut dieser Dienst.',
  },
  'legal.placeholder.terms': {
    en: 'This page still has to be filled in by the operator. Until then no terms of use have been agreed.',
    de: 'Diese Seite muss der Betreiber noch ausfüllen. Bis dahin sind keine Nutzungsbedingungen vereinbart.',
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
