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
  // Der Wert eines Ja/Nein-Feldes – nicht die Beschriftung eines Knopfes.
  'common.on': { en: 'Yes', de: 'Ja' },
  'common.back': { en: 'Back', de: 'Zurück' },
  'common.loading': { en: 'Loading …', de: 'Wird geladen …' },
  'common.none': { en: 'None yet.', de: 'Noch nichts.' },
  'common.copied': { en: 'Copied.', de: 'Kopiert.' },
  'common.copy': { en: 'Copy', de: 'Kopieren' },
  'common.open': { en: 'Open', de: 'Öffnen' },
  'common.edit': { en: 'Edit', de: 'Ändern' },
  'common.name': { en: 'Name', de: 'Name' },
  'common.date': { en: 'Date', de: 'Datum' },
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
  'common.remove': { en: 'Remove', de: 'Entfernen' },
  'common.more': { en: 'Read more', de: 'Mehr dazu' },
  'common.order': { en: 'Order', de: 'Reihenfolge' },
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

  'rail.free': { en: 'Free slots per account', de: 'Gratis-Plätze je Konto' },
  'rail.freeNote': {
    en: 'For as long as your linked Discord account is with us.',
    de: 'Solange dein verknüpftes Discord-Konto bei uns ist.',
  },
  'rail.paid': { en: 'Further slots from', de: 'Weitere Plätze ab' },
  'rail.paidNote': {
    en: 'Per 30 days, paid from your credit balance.',
    de: 'Je 30 Tage, bezahlt aus dem Guthaben.',
  },
  'rail.perMonth': { en: 'per 30 days', de: 'je 30 Tage' },
  'rail.uptime': { en: 'The bot runs', de: 'Der Bot läuft' },
  'rail.uptimeValue': { en: 'around the clock', de: 'rund um die Uhr' },
  'rail.uptimeNote': {
    en: 'On our machines. Your own PC can stay off.',
    de: 'Auf unseren Maschinen. Dein PC darf aus bleiben.',
  },
  'rail.versions': { en: 'Minecraft versions', de: 'Minecraft-Versionen' },
  'rail.versionsNote': {
    en: 'Picked per server slot when you create it.',
    de: 'Beim Anlegen je Serverplatz wählbar.',
  },
  'rail.versionsFallback': { en: 'Java Edition', de: 'Java Edition' },

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
  'auth.register.termsBefore': { en: 'I have read the', de: 'Ich habe die' },
  'auth.register.termsAnd': { en: 'and the', de: 'und die' },
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
  'dash.group.panel': { en: 'Dashboard', de: 'Dashboard' },
  'dash.group.service': { en: 'Service and account', de: 'Service und Konto' },
  'dash.serverGroup.control': { en: 'Connection', de: 'Verbindung' },
  'dash.serverGroup.automation': { en: 'Automation', de: 'Automatisierung' },
  'dash.serverGroup.views': { en: 'Views', de: 'Ansichten' },
  'dash.serverGroup.manage': { en: 'Plan and settings', de: 'Tarif und Einstellungen' },
  'dash.accounts': { en: 'Minecraft accounts', de: 'Minecraft-Konten' },
  'dash.accountsShort': { en: 'Accounts', de: 'Konten' },
  'dash.proxies': { en: 'Proxies', de: 'Proxys' },
  'dash.credits': { en: 'Credits', de: 'Guthaben' },
  'dash.tickets': { en: 'Support', de: 'Support' },
  'dash.myTickets': { en: 'My tickets', de: 'Meine Tickets' },
  'dash.settings': { en: 'Settings', de: 'Einstellungen' },
  'dash.admin': { en: 'Administration', de: 'Administration' },
  'dash.logout': { en: 'Log out', de: 'Abmelden' },
  'dash.newServer': { en: 'Add a server', de: 'Server anlegen' },
  'dash.noServers': { en: 'No server yet.', de: 'Noch keiner angelegt.' },
  'dash.collapseNav': { en: 'Collapse navigation', de: 'Navigation einklappen' },
  'dash.expandNav': { en: 'Expand navigation', de: 'Navigation ausklappen' },
  'dash.search': { en: 'Search the panel', de: 'Im Panel suchen' },

  // Der Hinweis, der anstelle des Inhalts steht, solange die Entwicklerwerkzeuge offen sind.
  'shield.note': {
    en: 'The content is hidden while the developer tools are open.\nClose them and everything comes back.',
    de: 'Der Inhalt ist ausgeblendet, solange die Entwicklerwerkzeuge offen sind.\nSchließe sie, dann ist alles wieder da.',
  },
  'dash.noHits': { en: 'Nothing matches that.', de: 'Dazu gibt es hier nichts.' },
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
  'tab.inventory': { en: 'Inventory', de: 'Inventar' },
  'tab.pov': { en: 'Live view', de: 'Live-Ansicht' },
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
  'ov.quick': { en: 'Quick links', de: 'Schnellzugriff' },

  // ---------------------------------------------------------------- Zu erledigen
  // Die Einträge selbst kommen vom Server (server/todos.js) – er weiß, was offen ist, und schreibt
  // es gleich in der Sprache der Anfrage. Hier steht nur der Rahmen darum.
  'todo.title': { en: 'To do', de: 'Zu erledigen' },
  'todo.count': { en: '{n} open', de: '{n} offen' },
  'ov.connectAccount': { en: 'Connect a Minecraft account', de: 'Minecraft-Konto verbinden' },
  'ov.openTicket': { en: 'Ask support', de: 'Support fragen' },
  'ov.clientVersions': { en: 'Minecraft versions', de: 'Minecraft-Versionen' },
  'ov.builds': { en: 'Builds in use', de: 'Genutzte Bauformen' },

  // Die Diagramme der Übersicht.
  'ov.inGameLine': {
    en: '{online} of {n} in game · {accounts} accounts',
    de: '{online} von {n} im Spiel · {accounts} Konten',
  },
  'ov.chart.balance': { en: 'Your balance', de: 'Dein Guthaben' },
  'ov.chart.spend': { en: 'What it costs each month', de: 'Was es im Monat kostet' },
  'ov.chart.uptime': { en: 'How long the bots ran', de: 'Wie lange die Bots liefen' },
  'ov.chart.total': { en: 'all told', de: 'insgesamt' },
  'ov.chart.connections': { en: '{n} connections all told', de: '{n} Verbindungen insgesamt' },
  'ov.chart.noUptime': {
    en: 'No bot has run yet.',
    de: 'Noch ist kein Bot gelaufen.',
  },

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
  'srv.walkHint': { en: 'a few blocks at a time', de: 'ein paar Blöcke auf einmal' },
  'srv.blocks': { en: 'Blocks per step', de: 'Blöcke je Schritt' },
  'srv.jump': { en: 'Jump', de: 'Springen' },
  'srv.pos': { en: 'Where am I?', de: 'Wo bin ich?' },
  'srv.stopWalk': { en: 'Stop', de: 'Anhalten' },
  // Die vier Richtungen sind relativ zur Blickrichtung des Bots und nicht zur Himmelsrichtung –
  // deshalb "vor" und nicht "Norden".
  'srv.dir.forward': { en: 'Forward', de: 'Vor' },
  'srv.dir.back': { en: 'Back', de: 'Zurück' },
  'srv.dir.left': { en: 'Left', de: 'Links' },
  'srv.dir.right': { en: 'Right', de: 'Rechts' },
  'srv.positionMissing': { en: 'No coordinates received.', de: 'Keine Koordinaten empfangen.' },
  'srv.positionLook': { en: 'View: {yaw}° / {pitch}°', de: 'Blick: {yaw}° / {pitch}°' },
  'srv.look': { en: 'Look', de: 'Blickrichtung' },
  'srv.lookHint': { en: 'where the bot faces', de: 'wohin der Bot schaut' },
  // Himmelsrichtungen ausgeschrieben: "E" konnte auf Deutsch auch "Ende" heißen, und die vier
  // Buchstaben nebeneinander sahen aus wie eine Abkürzung, die man kennen muss.
  'srv.compass.n': { en: 'North', de: 'Norden' },
  'srv.compass.e': { en: 'East', de: 'Osten' },
  'srv.compass.s': { en: 'South', de: 'Süden' },
  'srv.compass.w': { en: 'West', de: 'Westen' },
  'srv.turnAround': { en: 'Turn around', de: 'Umdrehen' },
  'srv.lookUp': { en: 'Up', de: 'Nach oben' },
  'srv.lookDown': { en: 'Down', de: 'Nach unten' },
  'srv.lookLevel': { en: 'Level', de: 'Geradeaus' },
  'srv.lookExact': { en: 'Exact angle', de: 'Genauer Winkel' },
  'srv.yaw': { en: 'Yaw (0 south, 180 north)', de: 'Gierwinkel (0 Süden, 180 Norden)' },
  'srv.pitch': { en: 'Pitch (negative looks up)', de: 'Neigung (negativ = nach oben)' },
  'srv.turnTo': { en: 'Turn', de: 'Drehen' },
  'srv.show': { en: 'Show', de: 'Zeigen' },
  'srv.home': { en: 'Home position and route', de: 'Heimatposition und Route' },
  'srv.homeAuto': { en: 'Return home automatically', de: 'Automatisch nach Hause laufen' },
  'srv.homeAutoHint': {
    en: 'after every join, along the route if one is recorded',
    de: 'nach jedem Beitritt, über die Route falls eine aufgezeichnet ist',
  },
  'srv.homeHint': {
    en: 'The bot remembers a spot and walks back there after every join – handy when the server drops you in a lobby.',
    de: 'Der Bot merkt sich eine Stelle und läuft nach jedem Beitritt dorthin zurück – praktisch, wenn der Server dich in die Lobby setzt.',
  },
  'srv.homeSet': { en: 'Remember here', de: 'Hier merken' },
  'srv.homeGo': { en: 'Walk there now', de: 'Jetzt hinlaufen' },
  'srv.homeClear': { en: 'Forget it', de: 'Vergessen' },
  'srv.route': { en: 'Route', de: 'Route' },
  'srv.routeHint': {
    en: 'Is the way home not a straight line? Record, walk it with the buttons above, stop – then the bot takes exactly that way.',
    de: 'Führt der Weg nach Hause nicht geradeaus? Aufzeichnen, die Strecke mit den Knöpfen oben ablaufen, beenden – danach nimmt der Bot genau diesen Weg.',
  },
  'srv.recStart': { en: 'Start recording', de: 'Aufzeichnung starten' },
  'srv.recStop': { en: 'Stop recording', de: 'Aufzeichnung beenden' },
  'srv.routeClear': { en: 'Delete route', de: 'Route löschen' },
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
  'srv.viewDistance': { en: 'View distance (chunks)', de: 'Sichtweite (Chunks)' },
  'srv.viewDistanceHint': {
    en: '0 keeps the client’s default. A standing bot needs nothing here – the live view does: what the server never sent cannot be drawn. More chunks cost memory on the machine.',
    de: '0 lässt die Vorgabe des Clients. Ein stehender Bot braucht hier nichts – die Live-Ansicht schon: Was der Server nie geschickt hat, lässt sich nicht zeichnen. Mehr Chunks kosten Arbeitsspeicher auf der Maschine.',
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
  // Der Hinweis, den `GET /api/proxies` mitschickt. Er stand als deutscher Satz im Quelltext der
  // Route und kam deshalb auch im englischen Panel auf Deutsch zurück.
  'px.hintPaying': {
    en: 'Proxies are assigned by hand. Open a ticket and say which server slot it is for.',
    de: 'Proxys werden von Hand zugeteilt – mach dafür ein Ticket auf und schreib dazu, für welchen Serverplatz.',
  },
  'px.hintFree': {
    en: 'Proxies come with a paid server slot.',
    de: 'Proxys gibt es ab einem bezahlten Serverplatz.',
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
  'bill.card': { en: 'Card, PayPal and more', de: 'Karte, PayPal und mehr' },
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

  // Die Diagramme im Guthaben-Bereich. Jede Überschrift ist eine Frage, die das Bild beantwortet.
  'bill.chart.balance': { en: 'How your balance developed', de: 'Wie sich dein Guthaben entwickelt hat' },
  'bill.chart.days': { en: 'last {n} days', de: 'letzte {n} Tage' },
  'bill.chart.spend': { en: 'What you spent per month', de: 'Was du je Monat ausgegeben hast' },
  'bill.chart.thisMonth': { en: 'this month', de: 'dieser Monat' },
  'bill.chart.spendFoot': { en: '{total} credits in six months', de: '{total} Credits in sechs Monaten' },
  'bill.chart.slots': { en: 'What each server slot costs', de: 'Was jeder Serverplatz kostet' },
  'bill.chart.perMonth': { en: 'per month', de: 'im Monat' },
  'bill.chart.noSlots': {
    en: 'Only the free server slot – it costs nothing.',
    de: 'Nur der Gratis-Serverplatz – der kostet nichts.',
  },

  // ---------------------------------------------------------------- Tickets
  'tk.title': { en: 'Support', de: 'Support' },
  'tk.sub': { en: 'Questions, proxy requests, bug reports', de: 'Fragen, Proxy-Anfragen, Fehlermeldungen' },
  'tk.mySub': { en: 'Only tickets where you are a customer are shown here.', de: 'Hier stehen nur Tickets, bei denen du Kunde bist.' },
  'tk.new': { en: 'New ticket', de: 'Neues Ticket' },
  'tk.subject': { en: 'Subject', de: 'Betreff' },
  'tk.message': { en: 'Message', de: 'Nachricht' },
  'tk.messages': { en: '{n} messages', de: '{n} Nachrichten' },
  'tk.messagesOne': { en: 'one message', de: 'eine Nachricht' },
  'tk.files': { en: 'Attach', de: 'Anhängen' },
  'tk.filesHint': {
    en: 'Screenshots and files up to {max}. They appear in Discord as well.',
    de: 'Screenshots und Dateien bis {max}. Sie erscheinen auch in Discord.',
  },
  'tk.tooBig': { en: '{name} is larger than {max}.', de: '{name} ist größer als {max}.' },
  'tk.tooMany': { en: 'At most ten files per message.', de: 'Höchstens zehn Dateien je Nachricht.' },
  'tk.uploading': { en: 'Uploading {i} of {n} …', de: 'Lade {i} von {n} hoch …' },
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
  // Drei Zustände, und jeder sagt, wer am Zug ist. Ein vierter („Wartet auf dich“) stand hier
  // neben „Beantwortet“ und bedeutete dasselbe – siehe server/tickets.js.
  'tk.status.open': { en: 'Open', de: 'Offen' },
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

  // Was der Webhook meldet. Die Schlüssel sind dieselben wie `EVENTS` in server/notify.js.
  'set.hook.ticket': { en: 'Support', de: 'Support' },
  'set.hook.ticket.what': {
    en: 'A reply to your ticket, a new ticket, a closed one.',
    de: 'Eine Antwort auf dein Ticket, ein neues Ticket, ein geschlossenes.',
  },
  'set.hook.billing': { en: 'Credits', de: 'Guthaben' },
  'set.hook.billing.what': {
    en: 'Money that arrived, and a warning when it runs low.',
    de: 'Angekommenes Geld und eine Warnung, wenn es knapp wird.',
  },
  'set.hook.plan': { en: 'Server slots', de: 'Serverplätze' },
  'set.hook.plan.what': {
    en: 'Renewed, expiring, suspended.',
    de: 'Verlängert, läuft ab, stillgelegt.',
  },
  'set.hook.bot': { en: 'Bots', de: 'Bots' },
  'set.hook.bot.what': {
    en: 'A bot that stopped unexpectedly.',
    de: 'Ein Bot, der unerwartet aufgehört hat.',
  },
  'set.hook.account': { en: 'Minecraft accounts', de: 'Minecraft-Konten' },
  'set.hook.account.what': {
    en: 'An account whose sign-in no longer works.',
    de: 'Ein Konto, dessen Anmeldung nicht mehr geht.',
  },
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

  // ---------------------------------------------------------------- Sprungmarke (Strg+K)
  'pal.title': { en: 'Search', de: 'Suche' },
  'pal.shortcut': { en: 'Ctrl+K', de: 'Strg+K' },
  'pal.placeholder': {
    en: 'Search for a page, user, server, ticket …',
    de: 'Seite, Nutzer, Server, Ticket suchen …',
  },
  'pal.pages': { en: 'Pages', de: 'Seiten' },
  'pal.start': { en: 'Type to search.', de: 'Tippen, um zu suchen.' },
  'pal.empty': { en: 'Nothing found.', de: 'Nichts gefunden.' },
  'pal.move': { en: 'choose', de: 'wählen' },
  'pal.go': { en: 'open', de: 'öffnen' },
  'pal.hint': {
    en: 'Users, servers, accounts, tickets, vouchers, locations, top-ups',
    de: 'Nutzer, Server, Accounts, Tickets, Gutscheine, Standorte, Aufladungen',
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
  'adm.allTickets': { en: 'All tickets', de: 'Alle Tickets' },
  'adm.allTicketsSub': {
    en: 'Support work queue for every customer ticket.',
    de: 'Arbeitswarteschlange für alle Kundentickets.',
  },
  'adm.profiles': { en: 'Server slots', de: 'Serverplätze' },
  'adm.bots': { en: 'Bots', de: 'Bots' },
  'adm.accounts': { en: 'Accounts', de: 'Accounts' },
  'adm.announce': { en: 'Announcement', de: 'Ankündigung' },
  'adm.settings': { en: 'Settings', de: 'Einstellungen' },
  'adm.mails': { en: 'Mail log', de: 'Mail-Protokoll' },
  'adm.client': { en: 'Client', de: 'Client' },
  'adm.mc.title': { en: 'Minecraft resources', de: 'Minecraft-Ressourcen' },
  'adm.mc.lead': {
    en: 'The textured live view reads block models, textures and menu graphics from the original Minecraft client JAR while it renders. We may not ship those files, so one has to be here per protocol version. Without them everything still runs – the live view just stays the coloured voxel view.',
    de: 'Die texturierte Live-Ansicht liest Blockmodelle, Texturen und Menügrafiken beim Zeichnen aus der Original-Client-JAR von Minecraft. Diese Dateien dürfen wir nicht mitliefern, deshalb muss je Protokollversion eine hier liegen. Ohne sie läuft alles weiter – die Live-Ansicht bleibt dann die farbige Voxelansicht.',
  },
  'adm.mc.noVersions': {
    en: 'Sync the client first – then this lists the protocol versions it speaks.',
    de: 'Erst den Client abgleichen – dann steht hier, welche Protokollversionen er spricht.',
  },
  'adm.mc.there': { en: 'there', de: 'da' },
  'adm.mc.missing': { en: 'missing', de: 'fehlt' },
  'adm.mc.upload': { en: 'Upload', de: 'Hochladen' },
  'adm.mc.fetch': { en: 'From Mojang', de: 'Von Mojang' },
  'adm.mc.uploading': { en: 'Uploading {version} …', de: '{version} wird hochgeladen …' },
  'adm.mc.fetching': { en: 'Fetching {version} from Mojang …', de: '{version} wird von Mojang geholt …' },
  'adm.mc.dropAsk': {
    en: 'Delete the resources for {version}? The live view falls back to the voxel view for every slot on that version.',
    de: 'Die Ressourcen für {version} löschen? Die Live-Ansicht fällt auf jedem Platz mit dieser Version auf die Voxelansicht zurück.',
  },
  'adm.mc.where': {
    en: 'The file is the one the official launcher leaves in ~/.minecraft/versions/<version>/<version>.jar – the client JAR, not the server JAR. Locations fetch their own copy from here.',
    de: 'Gebraucht wird die Datei, die der offizielle Launcher unter ~/.minecraft/versions/<version>/<version>.jar ablegt – die Client-JAR, nicht die Server-JAR. Standorte holen sich ihre Kopie von hier.',
  },
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
  // Auswahl und Massenaktionen in den Listen.
  'adm.bulk.all': { en: 'Select all shown', de: 'Alle angezeigten auswählen' },
  'adm.bulk.hint': {
    en: 'Tick rows to act on several at once.',
    de: 'Zeilen anhaken, um mehrere auf einmal zu bearbeiten.',
  },
  'adm.bulk.selected': { en: '{n} selected', de: '{n} ausgewählt' },
  'adm.bulk.clear': { en: 'Clear selection', de: 'Auswahl aufheben' },
  'adm.bulk.ask': { en: '{what} for {n} accounts?', de: '{what} für {n} Konten?' },
  'adm.bulk.done': { en: '{done} done.', de: '{done} erledigt.' },
  'adm.bulk.doneSome': {
    en: '{done} done, {skipped} skipped.',
    de: '{done} erledigt, {skipped} übersprungen.',
  },
  'adm.export': { en: 'CSV', de: 'CSV' },
  'adm.exportHint': {
    en: 'Download this list as a spreadsheet file',
    de: 'Diese Liste als Tabellendatei herunterladen',
  },
  'adm.saved': { en: 'Saved.', de: 'Gespeichert.' },
  'adm.usersLine': { en: '+{new} in 30 days · {active} active today', de: '+{new} in 30 Tagen · {active} heute aktiv' },
  'adm.ticketsWaiting': { en: '{n} waiting for us', de: '{n} warten auf uns' },
  'adm.revenueAll': { en: '{total} all time', de: '{total} insgesamt' },
  'adm.attention': { en: 'Needs a look', de: 'Braucht einen Blick' },

  // Die To-do-Liste des Teams und die Diagramme darunter.
  'adm.todo': { en: 'What the team has to do', de: 'Was das Team zu tun hat' },
  'adm.stats.title': { en: 'How it is going', de: 'Wie es läuft' },
  'adm.stats.revenue': { en: 'Money coming in', de: 'Was hereinkommt' },
  'adm.stats.revenueFoot': {
    en: '{total} all time · {back} refunded',
    de: '{total} insgesamt · {back} zurückerstattet',
  },
  'adm.stats.signups': { en: 'New accounts', de: 'Neue Konten' },
  'adm.stats.signupsFoot': { en: '{total} accounts all told', de: '{total} Konten insgesamt' },
  'adm.stats.spent': { en: 'Credits spent on plans', de: 'Credits für Tarife ausgegeben' },
  'adm.stats.spentFoot': {
    en: '{open} credits are still on customer accounts',
    de: '{open} Credits liegen noch auf Kundenkonten',
  },
  'adm.stats.months': { en: 'Money coming in per month', de: 'Was je Monat hereinkommt' },
  'adm.stats.monthsFoot': { en: 'the last twelve months', de: 'die letzten zwölf Monate' },
  'adm.stats.tickets': { en: 'Tickets opened', de: 'Neue Tickets' },
  'adm.stats.plans': { en: 'Server slots per plan', de: 'Serverplätze je Tarif' },
  'adm.stats.providers': { en: 'Where the money comes from', de: 'Woher das Geld kommt' },
  'adm.stats.uptime': { en: 'Where the hours went', de: 'Wo die Stunden hingingen' },
  'adm.stats.customers': { en: 'Who paid the most', de: 'Wer am meisten bezahlt hat' },
  'adm.stats.customersNote': { en: 'paying accounts', de: 'zahlende Konten' },
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

  // Ein Standort ist eine Maschine. Was sie leistet, steht auf seiner Karte – ein Proxy dagegen
  // ist nur eine Adresse und hat nichts davon.
  'nd.kindLabel': { en: 'Kind', de: 'Art' },
  'nd.kind.local': { en: 'This machine', de: 'Diese Maschine' },
  'nd.kind.agent': { en: 'Own machine', de: 'Eigene Maschine' },
  'nd.kind.egress': { en: 'Address only', de: 'Nur Adresse' },
  'nd.kindHint': {
    en: 'Own machine: the agent runs there and bots use its CPU, memory and disk. Address only: the bots stay on this server and go out through a proxy.',
    de: 'Eigene Maschine: dort läuft der Agent, und die Bots verbrauchen deren CPU, Speicher und Platte. Nur Adresse: die Bots bleiben auf diesem Server und gehen über einen Proxy hinaus.',
  },
  'nd.connected': { en: 'connected', de: 'verbunden' },
  'nd.disconnected': { en: 'not connected', de: 'nicht verbunden' },
  'nd.machine': { en: 'Machine', de: 'Maschine' },
  'nd.viaProxy': { en: 'this server, via proxy', de: 'dieser Server, über Proxy' },
  'nd.noStats': {
    en: 'No report yet. The location sends its load every 15 seconds once the agent is connected.',
    de: 'Noch keine Meldung. Der Standort schickt seine Auslastung alle 15 Sekunden, sobald der Agent verbunden ist.',
  },
  'nd.noResources': {
    en: 'Nothing runs here – this location only supplies an outgoing address.',
    de: 'Hier läuft nichts – dieser Standort liefert nur eine Ausgangsadresse.',
  },
  'nd.ofCores': { en: 'of {n} cores', de: 'von {n} Kernen' },
  'nd.maxCpu': { en: 'CPU limit (%)', de: 'CPU-Grenze (%)' },
  'nd.maxMem': { en: 'Memory limit (%)', de: 'Speichergrenze (%)' },
  'nd.maxHint': {
    en: '0 = no limit. Above the limit the location counts as full and takes no new server slots.',
    de: '0 = keine Grenze. Darüber gilt der Standort als voll und nimmt keine neuen Serverplätze an.',
  },
  'nd.note': { en: 'Note', de: 'Notiz' },
  'nd.proxyHint': {
    en: 'Optional. An outgoing address for every bot on this location.',
    de: 'Optional. Eine Ausgangsadresse für alle Bots dieses Standorts.',
  },
  'nd.setup': { en: 'Set up this location', de: 'Diesen Standort einrichten' },
  'nd.setupHint': {
    en: 'Run this on the new machine, in the folder with install-agent.sh. The full walkthrough is in docs/standorte.md.',
    de: 'Auf der neuen Maschine ausführen, im Ordner mit install-agent.sh. Die ganze Anleitung steht in docs/standorte.md.',
  },
  'nd.newToken': { en: 'New token', de: 'Neues Token' },
  'nd.newTokenWarn': {
    en: 'The location drops out immediately and has to be set up again with the new token. Continue?',
    de: 'Der Standort fliegt sofort heraus und muss mit dem neuen Token neu eingerichtet werden. Weiter?',
  },

  // ---------------------------------------------------------------- Anzeigetafel und Menüs
  'vw.board': { en: 'Scoreboard', de: 'Scoreboard' },

  // ---------------------------------------------------------------- Live-Ansicht
  'pov.title': { en: 'What the bot sees', de: 'Was der Bot sieht' },
  'pov.lead': {
    en: 'The client works the picture out from the world data it has loaded – with the real textures of the game where they are available, otherwise as a coloured voxel view. Walk, look around and click menus straight in the picture.',
    de: 'Der Client rechnet das Bild aus den geladenen Weltdaten – mit den echten Texturen des Spiels, wo sie vorliegen, sonst als farbige Voxelansicht. Laufen, umsehen und Menüs anklicken geht direkt im Bild.',
  },
  'pov.start': { en: 'Start live view', de: 'Live-Ansicht starten' },
  'pov.stop': { en: 'Stop', de: 'Stoppen' },
  'pov.frame': { en: 'Single frame', de: 'Einzelbild' },
  'pov.waiting': { en: 'Waiting for the first frame …', de: 'Warte auf das erste Bild …' },
  'pov.starting': {
    en: 'The textured view is starting …',
    de: 'Die texturierte Ansicht startet …',
  },
  'pov.idle': {
    en: 'The view is not running. Start it – the client only renders while somebody is watching.',
    de: 'Die Ansicht läuft nicht. Starte sie – der Client zeichnet nur, solange jemand zusieht.',
  },
  'pov.stopped': { en: 'View stopped.', de: 'Ansicht gestoppt.' },
  'pov.offline': { en: 'Start the bot first – there is nothing to see yet.', de: 'Erst den Bot starten – noch gibt es nichts zu sehen.' },
  'pov.note': {
    en: 'Minecraft never sends finished pictures. Every frame is rendered from chunk data, block changes and entities, so the view costs the machine noticeably more than a quiet bot – it stops on its own when you leave this tab or close the window.',
    de: 'Minecraft überträgt keine fertigen Bilder. Jedes Bild wird aus Chunk-Daten, Blockänderungen und Entities gerechnet – die Ansicht kostet die Maschine deutlich mehr als ein stiller Bot und hört von selbst auf, wenn du den Reiter verlässt oder das Fenster schließt.',
  },
  'pov.size': { en: 'Picture', de: 'Bild' },
  'pov.size.small': { en: 'Small', de: 'Klein' },
  'pov.size.normal': { en: 'Normal', de: 'Normal' },
  'pov.size.large': { en: 'Large', de: 'Groß' },
  'pov.rate': { en: 'Rate', de: 'Takt' },
  'pov.perSecond': { en: '{n} per second', de: '{n} je Sekunde' },
  'pov.control': { en: 'Steering', de: 'Steuerung' },
  'pov.controlHint': {
    en: 'Click a view, then walk with WASD, turn with the mouse and pick a hotbar slot with 1–9.',
    de: 'Eine Ansicht anklicken, dann mit WASD laufen, mit der Maus drehen und mit 1–9 die Schnellleiste wechseln.',
  },
  'pov.stageLabel': { en: 'Live view of {name}', de: 'Live-Ansicht von {name}' },
  'pov.shot': { en: 'Save picture', de: 'Bild speichern' },
  'pov.full': { en: 'Full screen', de: 'Vollbild' },
  'pov.nothingYet': { en: 'There is no picture yet.', de: 'Es steht noch kein Bild da.' },
  'pov.chunks': { en: 'chunks', de: 'Chunks' },
  'pov.notInGame': { en: 'not in the game yet', de: 'noch nicht im Spiel' },
  'pov.needState': {
    en: 'The bot has not reported a position yet.',
    de: 'Der Bot hat noch keine Position gemeldet.',
  },
  'pov.ownInventory': { en: 'Own inventory', de: 'Eigenes Inventar' },
  'pov.keysTitle': { en: 'Keys and mouse', de: 'Tasten und Maus' },
  'pov.key.walk': { en: 'Walk', de: 'Laufen' },
  'pov.key.turn': { en: 'Turn left / right', de: 'Nach links / rechts drehen' },
  'pov.key.pitch': { en: 'Look up / down', de: 'Nach oben / unten sehen' },
  'pov.key.jump': { en: 'Jump', de: 'Springen' },
  'pov.key.sneak': { en: 'Sneak on / off', de: 'Schleichen an / aus' },
  'pov.key.sprint': { en: 'Sprint on / off', de: 'Sprinten an / aus' },
  'pov.key.hand': { en: 'Hotbar slot 1 to 9', de: 'Schnellleiste 1 bis 9' },
  'pov.key.swing': { en: 'Swing the main hand', de: 'Mit der Haupthand schlagen' },
  'pov.key.use': { en: 'Use the item in hand', de: 'Gegenstand in der Hand benutzen' },
  'pov.key.look': { en: 'Turn the view', de: 'Blick drehen' },
  'pov.key.escape': { en: 'Close the open menu', de: 'Offenes Menü schließen' },
  'pov.key.mouseLeft': { en: 'Left click', de: 'Linksklick' },
  'pov.key.mouseRight': { en: 'Right click', de: 'Rechtsklick' },
  'pov.key.drag': { en: 'Drag', de: 'Ziehen' },

  // ---------------------------------------------------------------- Inventar
  'inv.title': { en: 'What the bot is carrying', de: 'Was der Bot trägt' },
  'inv.lead': {
    en: 'Armour, crafting grid, bag, hotbar and off hand – with the slot numbers the client uses, so a macro can click them.',
    de: 'Rüstung, Werkbank, Tasche, Schnellleiste und Nebenhand – mit den Feldnummern des Clients, damit ein Macro sie anklicken kann.',
  },
  'inv.empty': { en: 'No inventory yet', de: 'Noch kein Inventar' },
  'inv.emptyHint': {
    en: 'The server sends it shortly after joining. Start a bot and it appears here.',
    de: 'Der Server schickt es kurz nach dem Beitritt. Starte einen Bot, dann steht es hier.',
  },
  'inv.waiting': { en: 'Waiting for the server …', de: 'Warte auf den Server …' },
  'inv.armor': { en: 'Armour', de: 'Rüstung' },
  'inv.offhand': { en: 'Off hand', de: 'Nebenhand' },
  'inv.craft': { en: 'Crafting', de: 'Werkbank' },
  'inv.bag': { en: 'Bag', de: 'Tasche' },
  'inv.hotbar': { en: 'Hotbar', de: 'Schnellleiste' },
  'inv.liveSource': {
    en: 'Live from the textured view – click a hotbar slot to hold it.',
    de: 'Live aus der texturierten Ansicht – ein Feld der Schnellleiste anklicken, um es in die Hand zu nehmen.',
  },
  'inv.textSource': { en: 'Read once with :inv', de: 'Einmal mit :inv gelesen' },
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
  'ch.find': { en: 'Search the history', de: 'Im Verlauf suchen' },
  'ch.hits': { en: '{n} of {total}', de: '{n} von {total}' },
  'ch.all': { en: 'Everything', de: 'Alles' },
  'ch.allHint': {
    en: 'Also show the client’s status lines – connecting, kicks, warnings.',
    de: 'Auch die Zustandsmeldungen des Clients zeigen – Verbinden, Kicks, Warnungen.',
  },
  'ch.export': { en: 'Download the history', de: 'Verlauf herunterladen' },
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
    en: 'Sends your current status to Discord so it can grant the linked roles that depend on it.',
    de: 'Schickt deinen aktuellen Stand an Discord, damit es die Linked Roles vergeben kann, die daran hängen.',
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
  // Steht an genau dem Ticket, um das es geht – nicht nur als Zahl in der Seitenleiste.
  'tk.unread': { en: 'New', de: 'Neu' },
  'tk.setStatus': { en: 'Status', de: 'Zustand' },
  'tk.statusHint': {
    en: 'Open is with us, answered is with the customer, closed is done. A new reply reopens it.',
    de: 'Offen liegt bei uns, beantwortet beim Kunden, geschlossen ist erledigt. Eine neue Antwort macht es wieder auf.',
  },
  'tk.mailHint': {
    en: 'No account or no way in? Write to',
    de: 'Kein Konto oder kommst du nicht hinein? Schreib an',
  },
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
  'bill.noPackages': {
    en: 'No top-up packages are set up on this server yet.',
    de: 'Auf diesem Server sind noch keine Aufladepakete eingerichtet.',
  },
  'bill.kind.addon': { en: 'Add-on', de: 'Zusatz' },
  'bill.runsOut': { en: 'runs out {date}', de: 'reicht bis {date}' },
  'bill.covered': { en: 'covered', de: 'gedeckt' },

  // ---------------------------------------------------------------- Admin (neu)
  // ---------------------------------------------------------------- Sicherungen
  'bak.title': { en: 'Backups', de: 'Sicherungen' },
  'bak.now': { en: 'Back up now', de: 'Jetzt sichern' },
  'bak.download': { en: 'Download', de: 'Herunterladen' },
  'bak.size': { en: 'Size', de: 'Größe' },
  'bak.dailyOn': {
    en: 'One backup a day, the last {n} are kept.',
    de: 'Eine Sicherung am Tag, die letzten {n} bleiben liegen.',
  },
  'bak.dailyOff': {
    en: 'Automatic backups are off – see Settings → Operations.',
    de: 'Automatische Sicherungen sind aus – siehe Einstellungen → Betrieb.',
  },
  'bak.dropAsk': { en: 'Delete backup {name}?', de: 'Sicherung {name} löschen?' },
  'bak.restore': {
    en: 'To restore, stop the panel, put the file in place, start it again. There is no button for this on purpose: swapping the database while the panel is working on it does not end well.',
    de: 'Zum Zurückspielen den Dienst anhalten, die Datei an ihren Platz legen, wieder starten. Dafür gibt es bewusst keinen Knopf: Die Datenbank auszutauschen, während das Panel auf ihr arbeitet, geht nicht gut aus.',
  },

  // ---------------------------------------------------------------- Sicherheit
  'adm.security': { en: 'Security', de: 'Sicherheit' },
  'sec.busy': { en: 'Addresses that keep knocking', de: 'Adressen, die immer wieder klopfen' },
  'sec.attempts': { en: 'Recent sign-in attempts', de: 'Letzte Anmeldeversuche' },
  'sec.sessions': { en: 'Open sessions', de: 'Offene Sitzungen' },
  'sec.sessionsFoot': { en: 'across all accounts', de: 'über alle Konten' },
  'sec.blocks': { en: 'Blocked addresses', de: 'Gesperrte Adressen' },
  'sec.blocksFoot': { en: 'in force right now', de: 'gerade in Kraft' },
  'sec.failed48': { en: 'Failed sign-ins', de: 'Fehlgeschlagene Anmeldungen' },
  'sec.failedFoot': { en: 'in 48 hours, from {n} addresses', de: 'in 48 Stunden, von {n} Adressen' },
  'sec.address': { en: 'Address', de: 'Adresse' },
  'sec.tries': { en: 'Attempts', de: 'Versuche' },
  'sec.failedShort': { en: 'Failed', de: 'Daneben' },
  'sec.accounts': { en: 'Accounts tried', de: 'Konten probiert' },
  'sec.tried': { en: 'Typed in', de: 'Eingetippt' },
  'sec.device': { en: 'Device', de: 'Gerät' },
  'sec.since': { en: 'Since', de: 'Seit' },
  'sec.last': { en: 'Last seen', de: 'Zuletzt' },
  'sec.until': { en: 'Until', de: 'Bis' },
  'sec.forever': { en: 'no end', de: 'ohne Frist' },
  'sec.expired': { en: 'expired', de: 'abgelaufen' },
  'sec.you': { en: 'you', de: 'du' },
  'sec.blocked': { en: 'blocked', de: 'gesperrt' },
  'sec.block': { en: 'Block address', de: 'Adresse sperren' },
  'sec.unblock': { en: 'Lift', de: 'Aufheben' },
  'sec.revoke': { en: 'Sign out', de: 'Abmelden' },
  'sec.revokeAsk': {
    en: 'Sign this device out? Whoever is using it has to log in again.',
    de: 'Dieses Gerät abmelden? Wer daran sitzt, muss sich neu anmelden.',
  },
  'sec.ok': { en: 'signed in', de: 'angemeldet' },
  'sec.wrong': { en: 'wrong', de: 'falsch' },
  'sec.blockedAccount': { en: 'account blocked', de: 'Konto gesperrt' },
  'sec.throttled': { en: 'slowed down', de: 'gebremst' },
  'sec.limits': {
    en: 'Blocked after {ip} failures from one address, {account} on one account, within {minutes} minutes',
    de: 'Gebremst ab {ip} Fehlversuchen einer Adresse, {account} an einem Konto, in {minutes} Minuten',
  },
  'sec.cidrHint': {
    en: 'A single address or a whole network, e.g. 203.0.113.0/24',
    de: 'Eine einzelne Adresse oder ein ganzes Netz, etwa 203.0.113.0/24',
  },
  'sec.days': { en: 'Days', de: 'Tage' },
  'sec.daysHint': { en: '0 = until lifted by hand', de: '0 = bis jemand sie aufhebt' },

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
  'adm.stripeState': { en: 'Stripe', de: 'Stripe' },
  'adm.stripeReady': { en: 'set up', de: 'eingerichtet' },
  'adm.stripeKeys': { en: 'switched on, secret key missing', de: 'eingeschaltet, geheimer Schlüssel fehlt' },
  'adm.stripeOff': { en: 'switched off', de: 'ausgeschaltet' },
  'adm.stripeLive': { en: 'live mode', de: 'Echtbetrieb' },
  'adm.stripeTestMode': { en: 'test mode', de: 'Testmodus' },
  'adm.stripeHook': { en: 'Webhook secret', de: 'Webhook-Geheimnis' },
  'adm.stripeSet': { en: 'stored', de: 'hinterlegt' },
  'adm.stripeMissing': { en: 'missing', de: 'fehlt' },
  'adm.stripeTest': { en: 'Check connection', de: 'Verbindung prüfen' },
  'adm.stripeOpen': { en: 'Open the test checkout', de: 'Testkasse öffnen' },
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
  'adm.botReload': { en: 'Reload settings', de: 'Einstellungen neu laden' },
  'adm.botReloading': {
    en: 'The bot is fetching the settings again.',
    de: 'Der Bot holt die Einstellungen erneut.',
  },
  'adm.botRestart': { en: 'Restart bot', de: 'Bot neu starten' },
  'adm.botRestartAsk': {
    en: 'Restart the Discord bot? Tickets and roles pause for a few seconds.',
    de: 'Den Discord-Bot neu starten? Tickets und Rollen pausieren für ein paar Sekunden.',
  },
  'adm.botRestarting': {
    en: 'The bot is shutting down and the service starts it again.',
    de: 'Der Bot fährt herunter, der Dienst startet ihn erneut.',
  },
  'adm.botRestartHint': {
    en: 'Reloading is enough for anything set here. A restart is only needed for a new bot token or a stuck bot – it comes back through its service (Restart=always).',
    de: 'Neu laden genügt für alles, was hier eingestellt wird. Ein Neustart ist nur für einen neuen Bot-Token oder einen hängenden Bot nötig – zurück kommt er über seinen Dienst (Restart=always).',
  },

  'adm.lrAdd': { en: 'Add requirement', de: 'Bedingung hinzufügen' },
  'adm.lrNone': {
    en: 'No requirements. Discord then offers nothing to attach a linked role to.',
    de: 'Keine Bedingungen. Discord bietet dann nichts an, woran eine Linked Role hängen könnte.',
  },
  'adm.lrSource': { en: 'Value from the panel', de: 'Wert aus dem Panel' },
  'adm.lrType': { en: 'Comparison', de: 'Vergleich' },
  'adm.lrKey': { en: 'Key', de: 'Schlüssel' },
  'adm.lrName': { en: 'Name in Discord', de: 'Name in Discord' },
  'adm.lrDesc': { en: 'Description in Discord', de: 'Beschreibung in Discord' },
  'adm.lrVerifyUrl': {
    en: 'Linked Roles verification URL for the Discord Developer Portal',
    de: 'Linked-Roles-Verifizierungsadresse für das Discord Developer Portal',
  },
  'adm.lrVerifyHint': {
    en: 'Developer Portal → your application → OAuth2 → Linked Roles Verification URL. In Discord: Server Settings → Roles → a role → Links.',
    de: 'Developer Portal → deine Anwendung → OAuth2 → Linked Roles Verification URL. In Discord: Servereinstellungen → Rollen → eine Rolle → Links.',
  },
  'adm.secretSet': { en: 'stored', de: 'hinterlegt' },
  'adm.secretUnset': { en: 'not stored', de: 'nicht hinterlegt' },
  'adm.secretKeep': { en: 'Leave empty to keep the stored one.', de: 'Leer lassen behält das gespeicherte.' },
  'adm.secretClear': { en: 'Remove', de: 'Entfernen' },
  'adm.reveal': { en: 'Show while typing', de: 'Beim Tippen zeigen' },
  'adm.testMail': { en: 'Send a test email', de: 'Test-E-Mail schicken' },
  'adm.mailsFailed': { en: '{n} could not be delivered', de: '{n} kamen nicht an' },
  'adm.everything': { en: 'Everything about this customer', de: 'Alles zu diesem Kunden' },
  // Beschriftungen, die vorher `common.edit` ("Ändern") geliehen hatten – über einem Notizfeld
  // und über der Begründung einer Gutschrift stand damit ein Wort, das nichts erklärt.
  'adm.notes': { en: 'Internal notes', de: 'Interne Notizen' },
  'adm.reason': { en: 'Reason', de: 'Grund' },
  'adm.allowance': { en: 'Proxies allowed', de: 'Erlaubte Proxys' },

  // ------------------------------------------------ Der Tarif-Editor
  //
  // Die Beschriftungen der Ja/Nein-Merkmale standen als deutsche Sätze im Quelltext des
  // Admin-Bereichs. Ein englischsprachiger Betreiber bekam damit ein Formular, in dem die halbe
  // Seite in einer Sprache stand, die er nicht bestellt hat.
  'plan.slug': { en: 'Short key', de: 'Kürzel' },
  'plan.blurbDe': { en: 'Description (DE)', de: 'Beschreibung (DE)' },
  'plan.blurbEn': { en: 'Description (EN)', de: 'Beschreibung (EN)' },
  'plan.blurbHint': {
    en: 'One sentence saying who the plan is for. It sits under the name on the pricing page.',
    de: 'Ein Satz, für wen der Tarif gedacht ist. Steht auf der Preisseite unter dem Namen.',
  },
  'plan.featuresDe': { en: 'Bullets on the pricing page (DE)', de: 'Merkmale auf der Preisseite (DE)' },
  'plan.featuresEn': { en: 'Bullets on the pricing page (EN)', de: 'Merkmale auf der Preisseite (EN)' },
  'plan.featuresHint': {
    en: 'One line per bullet. Empty means the list is built from the numbers below.',
    de: 'Eine Zeile je Punkt. Leer lassen heißt: die Liste wird aus den Zahlen unten gebaut.',
  },
  'plan.macros': { en: 'Macros per server slot', de: 'Macros je Serverplatz' },
  'plan.discordRole': { en: 'Discord role', de: 'Discord-Rolle' },
  'plan.discordRoleHint': {
    en: 'Role ID. Empty means the role from the settings.',
    de: 'Rollen-ID. Leer = die Rolle aus den Einstellungen.',
  },
  'plan.flag.free_slot': { en: 'The free slot (exactly one plan)', de: 'Der kostenlose Platz (genau ein Tarif)' },
  'plan.flag.premium': {
    en: 'Premium client: movement, anti-AFK, sneaking',
    de: 'Premium-Client: Bewegung, Anti-AFK, Schleichen',
  },
  'plan.flag.movement': { en: 'The “Movement” tab in the panel', de: 'Reiter „Bewegung“ im Panel' },
  'plan.flag.proxy': { en: 'Own outgoing address on request', de: 'Eigene Ausgangsadresse auf Anfrage' },
  'plan.flag.offline_accounts': { en: 'Offline/cracked accounts allowed', de: 'Offline-/Cracked-Konten erlaubt' },
  'plan.flag.fakehost': {
    en: 'Fake host: the address the bot claims to have connected to',
    de: 'Fake-Host: die Adresse, über die der Bot angeblich hereinkommt',
  },
  'plan.flag.chat_limit_editable': { en: 'Chat history adjustable by the customer', de: 'Chatverlauf selbst einstellbar' },
  'plan.flag.priority_support': { en: 'Support with priority', de: 'Support-Vorrang' },
  'plan.flag.board': { en: 'Scoreboard', de: 'Scoreboard' },
  'plan.flag.menus': { en: 'Use menus', de: 'Menüs bedienen' },
  'plan.flag.pov': { en: 'Live view (POV)', de: 'Live-Ansicht (POV)' },
  'plan.flag.addons': { en: 'Extras bookable', de: 'Zusätze buchbar' },
  'plan.flag.highlight': { en: 'Highlight on the pricing page', de: 'Auf der Preisseite hervorheben' },
  'plan.flag.active': { en: 'Bookable', de: 'Buchbar' },

  'nd.accessLabel': { en: 'Who may use it', de: 'Wer ihn benutzen darf' },
  'nd.usersHint': { en: 'User IDs, comma separated', de: 'Benutzernummern, mit Komma getrennt' },

  // ------------------------------------------------ Der Zusatz-Editor
  'ad.key': { en: 'Short key', de: 'Kürzel' },
  'ad.keyHint': { en: 'a–z, 0–9 and -', de: 'a–z, 0–9 und -' },
  'ad.kind': { en: 'What it does', de: 'Art' },
  'ad.kind.flag': { en: 'Switch a feature on', de: 'Merkmal einschalten' },
  'ad.kind.slot': { en: 'More bots', de: 'Mehr Bots' },
  'ad.flag': { en: 'Which feature', de: 'Welches Merkmal' },
  'ad.amount': { en: 'How much per unit', de: 'Wie viel je Stück' },
  'ad.maxQty': { en: 'At most', de: 'Höchstens' },
  'ad.needCap': { en: 'Needs this client capability', de: 'Braucht diese Client-Fähigkeit' },
  'ad.available': { en: 'Bookable', de: 'Buchbar' },
  'ad.visible': { en: 'Visible', de: 'Sichtbar' },

  // ------------------------------------------------ Gutscheine und Proxys
  'adm.voucherCount': { en: 'How many codes', de: 'Wie viele Codes' },
  'adm.voucherUses': { en: 'Redemptions per code', de: 'Einlösungen je Code' },
  // Auf dem Knopf stand `common.yes` ("Ja, weiter") – die Beschriftung eines Bestätigungsknopfes
  // als Beschriftung der Handlung selbst. Was der Knopf tut, sagt er jetzt.
  'adm.markPaid': { en: 'Mark as paid', de: 'Als bezahlt buchen' },
  'adm.voucherLeft': { en: '{n} left', de: '{n}× übrig' },
  'adm.voucherUsedUp': { en: 'Used up', de: 'Aufgebraucht' },
  // Der Zustand einer Aufladung stand als roher Datenbankwert da ("open", "refunded").
  'adm.topup.open': { en: 'Open', de: 'Offen' },
  'adm.topup.paid': { en: 'Paid', de: 'Bezahlt' },
  'adm.topup.cancelled': { en: 'Withdrawn', de: 'Zurückgezogen' },
  'adm.topup.refunded': { en: 'Refunded', de: 'Zurückerstattet' },
  'adm.proxyKind': { en: 'Type', de: 'Typ' },
  'adm.note': { en: 'Note', de: 'Notiz' },

  // ---------------------------------------------------------------- Website
  'nav.discord': { en: 'Discord', de: 'Discord' },
  'discord.join': { en: 'Join our Discord', de: 'Auf unseren Discord' },

  // Der Gratis-Platz hängt an einer Discord-Mitgliedschaft. Diese Sätze stehen überall dort, wo
  // das gerade der Grund ist, warum etwas nicht läuft – Streifen, Kasten, Dialog.
  'join.joinTitle': { en: 'Your free server slot is waiting', de: 'Dein Gratis-Serverplatz wartet' },
  'join.joinText': {
    en: 'It only runs while your Discord account is a member of our server. One click, and the bots start.',
    de: 'Er läuft nur, solange dein Discord-Konto Mitglied auf unserem Server ist. Ein Klick, und die Bots gehen an.',
  },
  'join.linkTitle': { en: 'Link your Discord account', de: 'Verknüpfe dein Discord-Konto' },
  'join.linkText': {
    en: 'The free server slot needs it – we cannot check a membership without knowing the account.',
    de: 'Der Gratis-Serverplatz braucht sie – ohne das Konto lässt sich keine Mitgliedschaft prüfen.',
  },
  'join.linkAction': { en: 'Link it now', de: 'Jetzt verknüpfen' },
  'join.how': { en: 'How it works', de: 'So geht es' },
  'join.boxTitle': { en: 'One step is missing', de: 'Ein Schritt fehlt noch' },
  'join.boxFree': {
    en: 'The free plan costs nothing, and this is why: your Discord account has to be a member of the {brand} server. Leave it and the slot stops – nothing is deleted, and rejoining starts it again.',
    de: 'Der Gratis-Tarif kostet nichts, und das ist der Grund: Dein Discord-Konto muss Mitglied im {brand}-Server sein. Trittst du aus, hält der Platz an – gelöscht wird nichts, und beim erneuten Beitritt läuft er weiter.',
  },
  'join.dialogTitle': { en: 'Join the Discord first', de: 'Zuerst dem Discord beitreten' },
  'join.dialogText': {
    en: 'The free server slot only runs while a linked Discord account is a member of our server. Join, then create the slot – it takes a moment and then it works right away.',
    de: 'Der Gratis-Serverplatz läuft nur, solange ein verknüpftes Discord-Konto Mitglied auf unserem Server ist. Tritt bei, dann leg den Platz an – das dauert einen Moment und funktioniert danach sofort.',
  },
  'join.anyway': { en: 'Create it anyway', de: 'Trotzdem anlegen' },
  'join.paid': { en: 'Pick a paid plan', de: 'Bezahlten Tarif wählen' },
  'join.checking': {
    en: 'Your membership could not be confirmed just now. The bots start again as soon as it is.',
    de: 'Deine Mitgliedschaft ließ sich gerade nicht bestätigen. Die Bots laufen wieder, sobald sie es ist.',
  },
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
  'legal.privacy.title': { en: 'Privacy notice', de: 'Datenschutzerklärung' },
  'legal.terms.title': { en: 'Terms of use', de: 'Nutzungsbedingungen' },
  // Nur relevant, wenn auch die Systemvorgabe einmal fehlen sollte.
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
  // `Object.hasOwn`, nicht `S[key]`: Viele Aufrufe setzen den Schlüssel aus Daten zusammen
  // (`state.${zustand}`, `tk.status.${status}`). Ein Wert wie `constructor` oder `toString` träfe
  // sonst die Prototypenkette – heraus käme kein Text, sondern eine Funktion. Dieselbe Stelle
  // gibt es im Vorlagen-System des Servers, und dort war genau das schon einmal ein Fehler.
  const entry = Object.hasOwn(S, key) ? S[key] : null;
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
