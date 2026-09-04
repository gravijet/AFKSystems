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
  'common.draftSaved': { en: 'Draft saved on this device', de: 'Entwurf auf diesem Gerät gespeichert' },
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
  // "Noch nichts." ist der leere Zustand einer **Liste** – ein ganzer Satz mit Punkt. Als
  // Beschriftung eines Feldes oder eines Auswahleintrags war er falsch: In einem Aufklappmenü
  // stand damit "Noch nichts." für "kein Proxy", obwohl es welche gab.
  'common.none': { en: 'None yet.', de: 'Noch nichts.' },
  /** Kein Wert ausgewählt – die Beschriftung eines Eintrags, kein Satz. */
  'common.nothing': { en: 'None', de: 'Keiner' },
  /** Der Wert steht nicht fest. */
  'common.unknown': { en: 'Unknown', de: 'Unbekannt' },
  'common.copied': { en: 'Copied.', de: 'Kopiert.' },
  'common.copy': { en: 'Copy', de: 'Kopieren' },
  'common.open': { en: 'Open', de: 'Öffnen' },
  'common.off': { en: 'Off', de: 'Aus' },
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
  'common.next': { en: 'Next', de: 'Weiter' },
  'common.order': { en: 'Order', de: 'Reihenfolge' },
  'common.days': { en: 'days', de: 'Tage' },
  'common.appearance': { en: 'Appearance', de: 'Aussehen' },
  'common.light': { en: 'Light', de: 'Hell' },
  'common.dark': { en: 'Dark', de: 'Dunkel' },
  'common.system': { en: 'Match system', de: 'Wie das System' },
  'common.language': { en: 'Language', de: 'Sprache' },
  'common.switchLanguage': { en: 'Switch to {language}', de: 'Zu {language} wechseln' },
  'common.optional': { en: 'optional', de: 'optional' },
  'common.remove': { en: 'Remove', de: 'Entfernen' },
  'common.more': { en: 'Read more', de: 'Mehr dazu' },
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

  // Der zweite Schritt der Anmeldung. `lead` steht da, solange die Adresse noch nicht bekannt ist
  // (der Server schickt sie halb verdeckt mit); `leadTo` ersetzt ihn, sobald sie da ist.
  'auth.code.title': { en: 'Enter your code', de: 'Code eingeben' },
  'auth.code.lead': {
    en: 'We sent a six-digit code to the email address of this account. It is valid for 15 minutes.',
    de: 'Wir haben einen sechsstelligen Code an die E-Mail-Adresse dieses Kontos geschickt. Er gilt 15 Minuten.',
  },
  'auth.code.leadTo': {
    en: 'We sent a six-digit code to {email}. It is valid for 15 minutes.',
    de: 'Wir haben einen sechsstelligen Code an {email} geschickt. Er gilt 15 Minuten.',
  },
  'auth.code.label': { en: 'Code from the email', de: 'Code aus der E-Mail' },
  'auth.code.submit': { en: 'Sign in', de: 'Anmelden' },
  'auth.code.resend': { en: 'Send again', de: 'Noch einmal schicken' },
  'auth.code.resent': { en: 'Sent again', de: 'Noch einmal geschickt' },
  'auth.code.back': { en: 'Back', de: 'Zurück' },

  // Der zweite Faktor aus der Authenticator-App. Anders als beim Anmeldecode steht hier nirgends
  // "wir haben dir geschrieben" – es geht nichts hinaus, und genau das ist der Unterschied.
  'auth.totp.title': { en: 'Two-factor sign-in', de: 'Zwei-Faktor-Anmeldung' },
  'auth.totp.lead': {
    en: 'Enter the six-digit code from your authenticator app.',
    de: 'Gib den sechsstelligen Code aus deiner Authenticator-App ein.',
  },
  'auth.totp.label': { en: 'Code from the app', de: 'Code aus der App' },
  'auth.totp.submit': { en: 'Sign in', de: 'Anmelden' },
  'auth.totp.lost': { en: 'No access to the app?', de: 'Kein Zugriff auf die App?' },
  'auth.totp.useApp': { en: 'Use the app after all', de: 'Doch die App benutzen' },
  'auth.totp.recoveryLabel': { en: 'Recovery code', de: 'Wiederherstellungscode' },
  'auth.totp.recoveryLead': {
    en: 'Enter one of the recovery codes you saved when you set this up. Each one works once.',
    de: 'Gib einen der Wiederherstellungscodes ein, die du beim Einrichten gespeichert hast. Jeder gilt einmal.',
  },
  'auth.totp.resetHint': {
    en: 'Six digits from the app, or one of your recovery codes.',
    de: 'Sechs Ziffern aus der App – oder einer deiner Wiederherstellungscodes.',
  },

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
  'auth.register.passwordHint': { en: '12–256 characters.', de: '12–256 Zeichen.' },
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
  'dash.activity': { en: 'Activity', de: 'Aktivität' },
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
  'tab.schedule': { en: 'Schedule', de: 'Zeitplan' },

  // ---------------------------------------------------------------- Zeitpläne
  'sch.what': {
    en: 'Start and stop bots at fixed times. A bot that comes and goes every evening looks like a player; one that sits online around the clock looks like a bot.',
    de: 'Bots zu festen Zeiten starten und stoppen. Ein Bot, der jeden Abend kommt und geht, sieht aus wie ein Spieler; einer, der rund um die Uhr sitzt, sieht aus wie ein Bot.',
  },
  'sch.timezone': { en: 'Times are in {zone}.', de: 'Die Zeiten gelten in {zone}.' },
  'sch.new': { en: 'New schedule', de: 'Neuer Zeitplan' },
  'sch.edit': { en: 'Edit schedule', de: 'Zeitplan ändern' },
  'sch.none': { en: 'No schedule yet', de: 'Noch kein Zeitplan' },
  'sch.example': {
    en: 'For example: start at 18:00 on weekdays, stop at 23:30.',
    de: 'Zum Beispiel: werktags um 18:00 starten, um 23:30 stoppen.',
  },
  'sch.action': { en: 'Action', de: 'Aktion' },
  'sch.action.start': { en: 'Start', de: 'Starten' },
  'sch.action.stop': { en: 'Stop', de: 'Stoppen' },
  'sch.action.restart': { en: 'Restart', de: 'Neu starten' },
  'sch.time': { en: 'Time', de: 'Uhrzeit' },
  'sch.timeBad': { en: 'That is not a time of day.', de: 'Das ist keine Uhrzeit.' },
  'sch.hour': { en: 'Hour', de: 'Stunde' },
  'sch.minute': { en: 'Minute', de: 'Minute' },
  'sch.account': { en: 'Account', de: 'Konto' },
  'sch.allAccounts': { en: 'all accounts', de: 'alle Konten' },
  'sch.days': { en: 'Weekdays', de: 'Wochentage' },
  'sch.daysHint': {
    en: 'At least one. The day counts for the moment the schedule is due, not for now.',
    de: 'Mindestens einer. Der Tag zählt für den Zeitpunkt des Plans, nicht für jetzt.',
  },
  'sch.daysBad': { en: 'Pick at least one weekday.', de: 'Bitte mindestens einen Wochentag wählen.' },
  'sch.conflict': {
    en: '{n} active schedule(s) will also affect this target then with “{action}”. Check whether that is intentional.',
    de: '{n} aktive(r) Zeitplan/Zeitpläne wirkt/wirken dann ebenfalls mit „{action}“ auf dieses Ziel. Prüfe, ob das beabsichtigt ist.',
  },
  'sch.everyDay': { en: 'every day', de: 'täglich' },
  'sch.note': { en: 'Note', de: 'Notiz' },
  'sch.notePlaceholder': { en: 'What this is for', de: 'Wofür das gut ist' },
  'sch.active': { en: 'Active', de: 'Aktiv' },
  'sch.nextRun': { en: 'Next run {when}', de: 'Läuft wieder am {when}' },
  'sch.lastRun': { en: 'Last run {when} ago', de: 'Zuletzt vor {when} gelaufen' },
  'sch.deleteAsk': { en: 'Delete this schedule?', de: 'Diesen Zeitplan löschen?' },
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
  'ov.startAll': { en: 'Start available', de: 'Verfügbare starten' },
  'ov.start': { en: 'Start', de: 'Starten' },
  'ov.stop': { en: 'Stop', de: 'Stoppen' },
  'ov.started': { en: 'Bot started.', de: 'Bot gestartet.' },
  'ov.stoppedAll': { en: 'All bots stopped.', de: 'Alle Bots gestoppt.' },
  'ov.bulkStarted': { en: 'Start requested for {n} bot(s).', de: 'Start für {n} Bot(s) angefordert.' },
  'ov.bulkStopped': { en: 'Stop requested for {n} bot(s).', de: 'Stopp für {n} Bot(s) angefordert.' },
  'ov.bulkStartFailed': {
    en: '{n} of {total} selected bot(s) could not be started. Check the affected rows.',
    de: '{n} von {total} ausgewählten Bot(s) konnten nicht gestartet werden. Prüfe die betroffenen Zeilen.',
  },
  'ov.bulkStopFailed': {
    en: '{n} of {total} selected bot(s) could not be stopped. Check the affected rows.',
    de: '{n} von {total} ausgewählten Bot(s) konnten nicht gestoppt werden. Prüfe die betroffenen Zeilen.',
  },
  'ov.batchConfirmTitle': { en: 'Confirm bulk action', de: 'Mehrfachaktion bestätigen' },
  'ov.batchStart': { en: 'Start bots', de: 'Bots starten' },
  'ov.batchStop': { en: 'Stop bots', de: 'Bots stoppen' },
  'ov.batchStartAsk': {
    en: 'Start {n} bots now? They will connect to their Minecraft servers at roughly the same time.',
    de: '{n} Bots jetzt starten? Sie verbinden sich ungefähr gleichzeitig mit ihren Minecraft-Servern.',
  },
  'ov.batchStopAsk': {
    en: 'Stop {n} bots now? They will leave their Minecraft servers and automatic restart will be cancelled.',
    de: '{n} Bots jetzt stoppen? Sie verlassen ihre Minecraft-Server, und der automatische Wiederanlauf wird beendet.',
  },
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
  'ov.pov': { en: 'Live views', de: 'Live-Ansichten' },
  'ov.povHint': {
    en: '{n} bot(s) currently streaming a picture',
    de: '{n} Bot(s) senden gerade ein Bild',
  },
  'ov.quick': { en: 'Quick links', de: 'Schnellzugriff' },
  'ov.focus.title': { en: 'Operating status', de: 'Betriebsstatus' },
  'ov.focus.current': { en: 'Nothing needs your attention right now', de: 'Im Moment braucht nichts deine Aufmerksamkeit' },
  'ov.focus.open': { en: '{n} item(s) need attention', de: '{n} Punkt(e) brauchen Aufmerksamkeit' },
  'ov.focus.viewAll': { en: 'View all', de: 'Alle ansehen' },
  'ov.focus.slotPaused': { en: '“{name}” is paused', de: '„{name}“ ist pausiert' },
  'ov.focus.slotPausedText': {
    en: 'Its paid period has ended. Review the plan or add credits to resume it.',
    de: 'Die bezahlte Laufzeit ist vorbei. Prüfe den Tarif oder lade Guthaben auf, um fortzusetzen.',
  },
  'ov.focus.freePaused': { en: '“{name}” needs Discord access', de: '„{name}“ braucht Discord-Zugang' },
  'ov.focus.freePausedText': {
    en: 'This free slot stays paused until its Discord membership can be confirmed.',
    de: 'Dieser Gratis-Platz bleibt pausiert, bis die Discord-Mitgliedschaft bestätigt werden kann.',
  },
  'ov.focus.accountNeedsLogin': { en: '“{name}” needs to sign in again', de: '„{name}“ muss sich erneut anmelden' },
  'ov.focus.accountNeedsLoginText': {
    en: 'Reconnect this Minecraft account before starting it again.',
    de: 'Verbinde dieses Minecraft-Konto erneut, bevor du es wieder startest.',
  },
  'ov.focus.botFailed': { en: '“{name}” could not stay connected', de: '„{name}“ konnte nicht verbunden bleiben' },
  'ov.focus.botFailedText': {
    en: 'Open the server slot to inspect the connection and start it again when ready.',
    de: 'Öffne den Serverplatz, prüfe die Verbindung und starte ihn dann erneut.',
  },
  'ov.focus.balanceLow': { en: 'Your credits will not cover the next month', de: 'Dein Guthaben reicht nicht für den nächsten Monat' },
  'ov.focus.clearTitle': { en: 'Everything is in order', de: 'Alles ist in Ordnung' },
  'ov.focus.clearText': { en: '{online} of {total} bots are in game; no known issue is waiting.', de: '{online} von {total} Bots sind im Spiel; kein bekannter Punkt wartet.' },
  'ov.focus.activity': { en: 'Latest activity', de: 'Neueste Aktivität' },
  'ov.focus.activityEmpty': { en: 'No recent account activity.', de: 'Keine aktuelle Kontoaktivität.' },

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
  'ov.searchBots': { en: 'Search account or server', de: 'Konto oder Server suchen' },
  'ov.filter.all': { en: 'All bots', de: 'Alle Bots' },
  'ov.filter.online': { en: 'In game', de: 'Im Spiel' },
  'ov.filter.attention': { en: 'Needs attention', de: 'Braucht Hilfe' },
  'ov.filter.offline': { en: 'Offline', de: 'Offline' },
  'ov.sort.status': { en: 'Status first', de: 'Zustand zuerst' },
  'ov.sort.account': { en: 'Account name', de: 'Kontoname' },
  'ov.sort.server': { en: 'Server name', de: 'Servername' },
  'ov.selected': { en: '{n} selected', de: '{n} ausgewählt' },
  'ov.startSelected': { en: 'Start selected', de: 'Ausgewählte starten' },
  'ov.stopSelected': { en: 'Stop selected', de: 'Ausgewählte stoppen' },
  'ov.clearSelection': { en: 'Clear selection', de: 'Auswahl aufheben' },
  'ov.noMatches': { en: 'No bot matches these filters.', de: 'Kein Bot passt zu diesen Filtern.' },

  // Der kurze Einstieg auf der Übersicht verschwindet, sobald alle vier echten Schritte stehen.
  'onboard.title': { en: 'Ready in four steps', de: 'In vier Schritten startklar' },
  'onboard.progress': { en: '{n} of 4 complete', de: '{n} von 4 erledigt' },
  'onboard.account': { en: 'Connect Minecraft', de: 'Minecraft verbinden' },
  'onboard.accountText': { en: 'Add the account the bot should use.', de: 'Füge das Konto hinzu, mit dem der Bot laufen soll.' },
  'onboard.server': { en: 'Add a server', de: 'Server anlegen' },
  'onboard.serverText': { en: 'Address, version, and plan live in one server slot.', de: 'Adresse, Version und Tarif stecken in einem Serverplatz.' },
  'onboard.assign': { en: 'Assign the account', de: 'Konto zuordnen' },
  'onboard.assignText': { en: 'Choose which account joins this server.', de: 'Wähle, welches Konto diesem Server beitritt.' },
  'onboard.online': { en: 'Start the first bot', de: 'Ersten Bot starten' },
  'onboard.onlineText': { en: 'Once it reaches the game, the setup is complete.', de: 'Sobald er im Spiel ist, ist die Einrichtung fertig.' },

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
  'acc.summary': { en: 'Account overview', de: 'Kontenübersicht' },
  'acc.total': { en: 'All accounts', de: 'Alle Konten' },
  'acc.ready': { en: 'Ready to start', de: 'Startklar' },
  'acc.needsAttention': { en: 'Need attention', de: 'Handlungsbedarf' },
  'acc.attentionTitle': { en: 'Accounts needing attention', de: 'Konten mit Handlungsbedarf' },
  'acc.attentionText': {
    en: 'Restore each Microsoft account individually. No bot is stopped or reassigned by this step.',
    de: 'Stelle jedes Microsoft-Konto einzeln wieder her. Dabei wird kein Bot gestoppt oder neu zugeordnet.',
  },
  'acc.loginReviewTitle': {
    en: 'Microsoft sign-ins to restore',
    de: 'Microsoft-Anmeldungen wiederherstellen',
  },
  'acc.loginReviewText': {
    en: 'Only accounts with a real sign-in error appear here. Each restore is separate: no account is reassigned and no bot is stopped automatically.',
    de: 'Hier stehen nur Konten mit einem echten Anmeldefehler. Jede Wiederherstellung bleibt einzeln: Es wird kein Konto umgehängt und kein Bot automatisch gestoppt.',
  },
  'acc.waitingToStart': {
    en: '{n} slot(s) waiting to start',
    de: '{n} Platz/Plätze warten auf den Start',
  },
  'acc.unused': { en: 'Not assigned', de: 'Nicht zugeordnet' },
  'acc.search': { en: 'Search accounts or servers', de: 'Konten oder Server suchen' },
  'acc.filter.all': { en: 'All accounts', de: 'Alle Konten' },
  'acc.filter.ready': { en: 'Ready', de: 'Startklar' },
  'acc.filter.attention': { en: 'Need attention', de: 'Handlungsbedarf' },
  'acc.filter.unused': { en: 'Not assigned', de: 'Nicht zugeordnet' },
  'acc.filter.offline': { en: 'Offline accounts', de: 'Offline-Konten' },
  'acc.filter.running': { en: 'Currently active', de: 'Gerade aktiv' },
  'acc.sort.name': { en: 'Name A–Z', de: 'Name A–Z' },
  'acc.sort.usage': { en: 'Most used first', de: 'Häufig genutzt zuerst' },
  'acc.sort.newest': { en: 'Newest first', de: 'Neueste zuerst' },
  'acc.assignedServers': {
    en: 'Assigned to {n} server slot(s)',
    de: '{n} Serverplatz/-plätzen zugeordnet',
  },
  'acc.onlineOn': {
    en: 'Currently in game on {n} server slot(s)',
    de: 'Gerade auf {n} Serverplatz/-plätzen im Spiel',
  },
  'acc.activeOn': {
    en: 'Starting or running on {n} server slot(s)',
    de: 'Startet oder läuft auf {n} Serverplatz/-plätzen',
  },
  'acc.activeNow': { en: 'Currently active', de: 'Gerade aktiv' },
  'acc.activeTitle': { en: 'Live account assignments', de: 'Aktive Konto-Zuordnungen' },
  'acc.activeText': {
    en: 'Each Minecraft account can run on one server slot at a time. Open the live slot to stop or inspect it.',
    de: 'Jedes Minecraft-Konto kann gleichzeitig auf einem Serverplatz laufen. Öffne den aktiven Platz zum Stoppen oder Prüfen.',
  },
  'acc.openServer': { en: 'Open server slot', de: 'Serverplatz öffnen' },
  'acc.assignNow': { en: 'Assign to a server slot', de: 'Jetzt einem Serverplatz zuordnen' },
  'acc.connections': { en: 'Connections so far', de: 'Verbindungen bisher' },
  'acc.connectedSince': { en: 'Added', de: 'Hinzugefügt' },
  'acc.errorHint': {
    en: 'Microsoft rejected the saved sign-in. Sign in again to renew it.',
    de: 'Microsoft hat die gespeicherte Anmeldung abgelehnt. Melde dich erneut an, um sie zu erneuern.',
  },
  'acc.noMatches': { en: 'No account matches', de: 'Kein Konto passt dazu' },
  'acc.noMatchesText': {
    en: 'Change the filter or search for another account or server name.',
    de: 'Ändere den Filter oder suche nach einem anderen Konto- oder Servernamen.',
  },
  'acc.resetFilters': { en: 'Reset filters', de: 'Filter zurücksetzen' },
  'acc.removeImpact': {
    en: '{servers} assigned server slot(s), {online} bot(s) currently in game. Removing stops those bots and removes this account from every listed slot.',
    de: '{servers} zugeordnete Serverplätze, {online} Bot(s) gerade im Spiel. Beim Entfernen werden diese Bots gestoppt und das Konto von allen aufgeführten Plätzen entfernt.',
  },
  'acc.removeUnused': {
    en: 'This account is not assigned to a server slot.',
    de: 'Dieses Konto ist keinem Serverplatz zugeordnet.',
  },
  'acc.ms.title': { en: 'Sign in with Microsoft', de: 'Bei Microsoft anmelden' },
  'acc.ms.renewTitle': { en: 'Restore {name}', de: '{name} wiederherstellen' },
  'acc.ms.renewHint': {
    en: 'Sign in as {name}. A different Microsoft account is added separately and is not assigned automatically.',
    de: 'Melde dich als {name} an. Ein anderes Microsoft-Konto wird getrennt hinzugefügt und nicht automatisch zugeordnet.',
  },
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
  // Warum gerade nichts hinzuzufügen ist. Hier stand "Noch nichts." – ein Satz, der auf die
  // Frage "warum passiert nichts?" nicht antwortet.
  'srv.addNoneLeft': {
    en: 'Every Minecraft account you have is already on this server.',
    de: 'Alle deine Minecraft-Konten sitzen schon auf diesem Server.',
  },
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
  'srv.changePreview': { en: 'Review plan change', de: 'Tarifwechsel prüfen' },
  'srv.previewRefund': { en: 'Credit for unused time: +{credits}', de: 'Gutschrift für Restlaufzeit: +{credits}' },
  'srv.previewCharge': { en: 'New 30-day period: −{credits}', de: 'Neue 30-Tage-Laufzeit: −{credits}' },
  'srv.previewBalance': { en: 'Balance: {before} → {after}', de: 'Guthaben: {before} → {after}' },
  'srv.previewMonthly': { en: 'Monthly from then on: {before} → {after}', de: 'Monatlich danach: {before} → {after}' },
  'srv.previewShortfall': { en: 'Not enough balance: {credits} short.', de: 'Guthaben reicht nicht: {credits} fehlen.' },
  'srv.previewRemoved': { en: 'Will be removed: {items}', de: 'Wird entfernt: {items}' },
  'srv.previewCapacity': { en: 'Bot capacity: {before} → {after}', de: 'Bot-Kapazität: {before} → {after}' },
  'srv.previewLost': { en: 'No longer included: {items}', de: 'Nicht mehr enthalten: {items}' },
  'srv.previewCleared': { en: 'Settings reset: {items}', de: 'Einstellungen zurückgesetzt: {items}' },
  'srv.previewStops': {
    en: 'All {n} running bot(s) on this slot will be stopped because the new capacity is lower.',
    de: 'Alle {n} laufenden Bot(s) auf diesem Platz werden gestoppt, weil die neue Kapazität kleiner ist.',
  },
  'srv.previewUnavailable': { en: 'This plan cannot be selected right now.', de: 'Dieser Tarif kann gerade nicht gewählt werden.' },
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
  'srv.templates': { en: 'Templates', de: 'Vorlagen' },
  'srv.templatesHint': {
    en: 'A template only opens the editor. Review every trigger and step before saving it.',
    de: 'Eine Vorlage öffnet nur den Editor. Prüfe jeden Auslöser und Schritt, bevor du sie speicherst.',
  },
  'srv.templateOpen': { en: 'Review in editor', de: 'Im Editor prüfen' },
  'srv.template.joinAfk': { en: 'Go AFK on join', de: 'Beim Beitreten AFK gehen' },
  'srv.template.joinAfkText': {
    en: 'Starts with one editable /afk chat command after joining.',
    de: 'Startet mit einem bearbeitbaren /afk-Chatbefehl nach dem Beitreten.',
  },
  'srv.template.joinAfkName': { en: 'Go AFK on join', de: 'AFK beim Beitreten' },
  'srv.template.reconnectWait': { en: 'Pause after joining', de: 'Pause nach Beitritt' },
  'srv.template.reconnectWaitText': {
    en: 'Adds a five-second wait; useful as a visible starting point for your own join sequence.',
    de: 'Fügt eine Pause von fünf Sekunden ein – ein sichtbarer Startpunkt für deine eigene Beitrittskette.',
  },
  'srv.template.reconnectWaitName': { en: 'Pause after joining', de: 'Kurze Pause nach Beitritt' },
  'srv.template.chatReply': { en: 'AFK chat reply', de: 'AFK-Chatantwort' },
  'srv.template.chatReplyText': {
    en: 'A rate-limited reply to a matching chat line. Adjust the text and target before use.',
    de: 'Eine begrenzte Antwort auf eine passende Chatzeile. Text und Ziel vor der Nutzung anpassen.',
  },
  'srv.template.chatReplyName': { en: 'AFK reply', de: 'AFK-Antwort' },
  'srv.copyMacro': { en: 'Copy to editor', de: 'In Editor kopieren' },
  'srv.copyName': { en: '{name} (copy)', de: '{name} (Kopie)' },
  'srv.testMacro': { en: 'Test macro', de: 'Macro testen' },
  'srv.testMacroHint': {
    en: 'The selected online bot will run this macro once. Cooldown and chance are ignored for this test.',
    de: 'Der gewählte Bot im Spiel führt dieses Macro einmal aus. Sperrzeit und Wahrscheinlichkeit gelten für diesen Test nicht.',
  },
  'srv.testStarted': { en: 'Macro started on {name}.', de: 'Macro auf {name} gestartet.' },
  'srv.noOnlineAccount': { en: 'No account on this server is currently in the game.', de: 'Auf diesem Server ist gerade kein Konto im Spiel.' },
  'srv.macroActive': { en: 'Macro active', de: 'Macro aktiv' },
  'srv.macroTarget': { en: 'Target: {names}', de: 'Ziel: {names}' },
  'srv.trigger': { en: 'Trigger', de: 'Auslöser' },
  'srv.steps': { en: 'Steps', de: 'Schritte' },
  'srv.stepCount': { en: '{n} of {max} steps', de: '{n} von {max} Schritten' },
  'srv.stepLimit': { en: 'A macro can contain up to {max} steps.', de: 'Ein Macro kann bis zu {max} Schritte enthalten.' },
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
  // ---- Wiederanlauf ------------------------------------------------------------------------
  //
  // Der Text sagt bewusst, **wann nicht** neu gestartet wird. Das ist die Frage, die sonst als
  // Beschwerde ankommt: „Warum ist er aus?“ – weil er nie im Spiel war, und dann ist ein zweiter
  // Versuch nur derselbe erste noch einmal.
  'srv.reconnect': { en: 'Automatic restart', de: 'Wiederanlauf' },
  'srv.reconnectHint': {
    en: 'Applies when the bot was in game and then dropped out — a kick, a server restart, a broken line, or a reboot of the whole machine. If it never got in (wrong address, wrong version, ban, whitelist), it stays off: a second attempt would fail the same way.',
    de: 'Gilt, wenn der Bot im Spiel war und dann rausflog – ein Kick, ein Serverneustart, eine abgerissene Leitung, oder ein Neustart der ganzen Maschine. Kam er nie hinein (falsche Adresse, falsche Version, Bann, Whitelist), bleibt er aus: Ein zweiter Versuch scheiterte genauso.',
  },
  'srv.reconnectOffHint': {
    en: 'The wait doubles with every failed attempt up to that ceiling. After eight attempts in a row the bot stays off and you get a message. Switched off, a kick or a broken connection ends the session and you start it again yourself.',
    de: 'Die Wartezeit verdoppelt sich mit jedem Fehlversuch bis zu dieser Grenze. Nach acht Versuchen hintereinander bleibt der Bot aus, und du bekommst Bescheid. Ausgeschaltet beendet ein Kick oder Verbindungsabbruch die Sitzung, und du startest sie selbst wieder.',
  },
  'srv.retryOf': { en: 'Attempt {n}/{max}', de: 'Versuch {n}/{max}' },
  'srv.povSkipResources': { en: 'Skip texture download for the live view', de: 'Live-Ansicht ohne Texturen laden' },
  'srv.povSkipResourcesHint': {
    en: 'The live view runs without real block textures instead of fetching the ~30 MB Minecraft file (once per account without a file deposited under Administration). Needs a booked live view with a client build from 2.6.0 on.',
    de: 'Die Live-Ansicht läuft ohne echte Blocktexturen, statt sich die rund 30 MB große Minecraft-Datei zu holen (einmal je Konto, wenn unter Administration keine hinterlegt ist). Braucht eine gebuchte Live-Ansicht mit einer Client-Bauform ab 2.6.0.',
  },
  'srv.onlineSince': { en: 'In this state since {at}', de: 'In diesem Zustand seit {at}' },
  'srv.reconnectCount': { en: '{n} reconnect(s)', de: '{n} Neuverbindung(en)' },
  'srv.reconnectCountHint': {
    en: 'Reconnects since you last started or stopped this bot yourself.',
    de: 'Neuverbindungen seit du diesen Bot zuletzt selbst gestartet oder gestoppt hast.',
  },

  // Ereignisverlauf je Bot: nicht nur der aktuelle Zustand, sondern was wirklich passiert ist.
  'srv.eventsTitle': { en: 'History', de: 'Verlauf' },
  'srv.eventsEmpty': { en: 'Nothing recorded yet.', de: 'Noch nichts aufgezeichnet.' },
  'srv.eventsCsv': { en: 'Download as CSV', de: 'Als CSV herunterladen' },
  'srv.eventWorld': { en: 'Changed world', de: 'Welt gewechselt' },
  'srv.eventDeath': { en: 'Died', de: 'Gestorben' },
  'srv.eventDropped': { en: 'Lines dropped', de: 'Zeilen ausgelassen' },
  'srv.eventSnapshot': { en: 'Snapshot saved', de: 'Bild gesichert' },
  'srv.eventSnapshotView': { en: 'View image', de: 'Bild ansehen' },

  // Die neue Client-Fassung. Der Ton ist absichtlich ruhig: Nichts ist kaputt – ein Bot mit der
  // Fassung von letzter Woche tut, was er letzte Woche getan hat. Neu ist nur, dass es etwas
  // Neueres gibt, und dass der Weg dorthin durch einen Neustart führt.
  'srv.clientNew': { en: 'A newer client is ready', de: 'Es liegt ein neuerer Client bereit' },
  'srv.accountElsewhere': {
    en: 'This account is already starting or running on another server slot ({n}).',
    de: 'Dieses Konto startet oder läuft bereits auf einem anderen Serverplatz ({n}).',
  },
  'srv.accountElsewhereHint': {
    en: 'Stop the active session on the listed server slot first.',
    de: 'Stoppe zuerst die aktive Sitzung auf dem aufgeführten Serverplatz.',
  },
  'srv.clientNewCount': {
    en: '{n} running bot(s) still use the file they started with. A restart picks up the new one.',
    de: '{n} laufende(r) Bot(s) benutzen noch die Datei, mit der sie gestartet sind. Ein Neustart holt die neue.',
  },
  'srv.clientNewFromTo': {
    en: '{n} running bot(s) are on {from}, ready to go is {to}. A restart picks it up.',
    de: '{n} laufende(r) Bot(s) sind auf {from}, bereit liegt {to}. Ein Neustart holt sie.',
  },
  'srv.clientUpdate': { en: 'Restart onto the new one', de: 'Auf die neue neu starten' },
  'srv.clientUpdateAsk': {
    en: 'Restart {n} bot(s) now? Each one leaves the server and comes back – on servers with a queue that costs the place in it.',
    de: '{n} Bot(s) jetzt neu starten? Jeder verlässt den Server und kommt wieder – auf Servern mit Warteschlange kostet das den Platz darin.',
  },
  'srv.clientUpdateDone': { en: '{n} bot(s) are restarting.', de: '{n} Bot(s) starten neu.' },
  'srv.clientOld': { en: 'Client {v}', de: 'Client {v}' },
  // Die eigene Notiz und das Kopieren eines Serverplatzes.
  'srv.note': { en: 'Your note', de: 'Deine Notiz' },
  'srv.notePlaceholder': {
    en: 'Why this slot is set up the way it is …',
    de: 'Warum dieser Platz so eingestellt ist, wie er ist …',
  },
  'srv.noteHint': {
    en: 'Only you see this. Nothing here reaches the bot or the Minecraft server.',
    de: 'Das sieht nur du. Nichts davon erreicht den Bot oder den Minecraft-Server.',
  },
  'srv.copyAddress': { en: 'Copy the address', de: 'Adresse kopieren' },
  'srv.copyTitle': { en: 'Copy this slot', de: 'Diesen Platz kopieren' },
  'srv.copy': { en: 'Make a copy', de: 'Kopie anlegen' },
  'srv.copyWhat': {
    en: 'A new slot with the same settings, macros, schedules and repeated messages. The Minecraft accounts do not come along – one account can only be in one game at a time.',
    de: 'Ein neuer Platz mit denselben Einstellungen, Makros, Zeitplänen und wiederkehrenden Nachrichten. Die Minecraft-Konten kommen nicht mit – ein Konto kann nur in einem Spiel gleichzeitig sein.',
  },
  'srv.copyNote': {
    en: 'The copy is a server slot of its own and costs what its plan costs. Booked extras do not come along.',
    de: 'Die Kopie ist ein eigener Serverplatz und kostet, was ihr Tarif kostet. Gebuchte Zusätze kommen nicht mit.',
  },
  'srv.copyScopeHint': {
    en: 'Choose exactly what to carry over. Minecraft accounts and booked extras are never copied.',
    de: 'Wähle genau aus, was übernommen wird. Minecraft-Konten und gebuchte Zusätze werden nie kopiert.',
  },
  'srv.copySettings': { en: 'Server settings ({n} values)', de: 'Servereinstellungen ({n} Werte)' },
  'srv.copyMacros': { en: 'Macros ({n})', de: 'Makros ({n})' },
  'srv.copySpam': { en: 'Repeated messages ({n})', de: 'Wiederkehrende Nachrichten ({n})' },
  'srv.copySchedules': { en: 'Schedules ({n})', de: 'Zeitpläne ({n})' },
  'srv.copied': {
    en: 'Copied: {macros} macro(s), {schedules} schedule(s), {spam} repeated message(s).',
    de: 'Kopiert: {macros} Makro(s), {schedules} Zeitplan/Zeitpläne, {spam} wiederkehrende Nachricht(en).',
  },

  // Der Zielserver. Die Texte sagen ausdrücklich „dein Minecraft-Server“ und nicht „der Server“ –
  // im Panel heißt „Server“ sonst der Serverplatz, und die Verwechslung wäre genau dort am
  // teuersten, wo jemand einen Fehler sucht.
  'srv.statusCheck': { en: 'Check again', de: 'Noch einmal prüfen' },
  'srv.statusChecking': { en: 'Asking the Minecraft server …', de: 'Der Minecraft-Server wird gefragt …' },
  'srv.statusOnline': { en: 'The Minecraft server is up', de: 'Der Minecraft-Server läuft' },
  'srv.statusOffline': { en: 'The Minecraft server did not answer', de: 'Der Minecraft-Server antwortet nicht' },
  'srv.statusPlayers': { en: '{n} of {max} players', de: '{n} von {max} Spielern' },
  'srv.statusSrv': { en: 'points to {host}', de: 'zeigt auf {host}' },

  'srv.diagnosisTitle': { en: 'Connection diagnosis', de: 'Verbindungsdiagnose' },
  'srv.diagnosisLead': {
    en: 'Bot state, target server, retry and client — in the order to check them.',
    de: 'Bot-Zustand, Zielserver, Wiederanlauf und Client — in der Reihenfolge zum Prüfen.',
  },
  'srv.diagnosisBots': { en: 'Bots', de: 'Bots' },
  'srv.diagnosisBotsOnline': { en: '{online} of {total} online', de: '{online} von {total} online' },
  'srv.diagnosisBotsEmpty': { en: 'No accounts assigned', de: 'Keine Konten zugeordnet' },
  'srv.diagnosisLastState': {
    en: 'Last recorded: {state} · {at}',
    de: 'Zuletzt dokumentiert: {state} · {at}',
  },
  'srv.diagnosisNoState': {
    en: 'No persistent state recorded yet.',
    de: 'Noch kein dauerhafter Zustand dokumentiert.',
  },
  'srv.diagnosisServer': { en: 'Target server', de: 'Zielserver' },
  'srv.diagnosisServerIdle': { en: 'Not checked yet', de: 'Noch nicht geprüft' },
  'srv.diagnosisServerChecked': { en: 'checked {at} ago', de: 'vor {at} geprüft' },
  'srv.diagnosisServerCached': {
    en: 'cached result from {at} ago',
    de: 'zwischengespeichertes Ergebnis von vor {at}',
  },
  'srv.diagnosisRetry': { en: 'Reconnect', de: 'Wiederanlauf' },
  'srv.diagnosisRetryWaiting': {
    en: '{n} bot(s) waiting to retry',
    de: '{n} Bot(s) wartet/warten auf den nächsten Versuch',
  },
  'srv.diagnosisRetryAt': { en: 'next attempt {at}', de: 'nächster Versuch {at}' },
  'srv.diagnosisRetryOn': {
    en: 'Automatic reconnect is ready if a bot drops.',
    de: 'Der automatische Wiederanlauf steht für einen Verbindungsabbruch bereit.',
  },
  'srv.diagnosisRetryOff': {
    en: 'Automatic reconnect is disabled for this slot.',
    de: 'Der automatische Wiederanlauf ist für diesen Platz ausgeschaltet.',
  },
  'srv.diagnosisReady': { en: 'Ready', de: 'Bereit' },
  'srv.diagnosisPaused': { en: 'Paused', de: 'Ausgeschaltet' },
  'srv.diagnosisClient': { en: 'Client', de: 'Client' },
  'srv.diagnosisClientReady': { en: 'New starts use {version}', de: 'Neue Starts nutzen {version}' },
  'srv.diagnosisClientMissing': { en: 'No client build is ready', de: 'Keine Client-Bauform bereit' },
  'srv.diagnosisClientCurrent': {
    en: 'All running bots use the current client.',
    de: 'Alle laufenden Bots nutzen den aktuellen Client.',
  },
  'srv.diagnosisClientOutdated': {
    en: '{n} bot(s) still use an older client.',
    de: '{n} Bot(s) nutzt/nutzen noch einen älteren Client.',
  },

  // Warum der Zielserver nicht geantwortet hat. Die Schlüssel kommen aus `server/mcping.js`; dort
  // steht seit dieser Fassung nur noch, *was* los war, und der Wortlaut hier. Jeder Satz nennt
  // die wahrscheinliche Ursache – „Verbindung abgelehnt“ allein hat noch niemandem geholfen.
  'mcstatus.dns': {
    en: 'There is no such address (DNS). Check it for typos.',
    de: 'Diese Adresse gibt es nicht (DNS). Bitte auf Tippfehler prüfen.',
  },
  'mcstatus.refused': {
    en: 'The address answers, but nothing is listening on that port.',
    de: 'Die Adresse antwortet, aber auf diesem Port lauscht nichts.',
  },
  'mcstatus.timeout': {
    en: 'No answer within five seconds – the server is off, or a firewall sits in between.',
    de: 'Keine Antwort innerhalb von fünf Sekunden – der Server ist aus, oder eine Firewall sitzt dazwischen.',
  },
  'mcstatus.reset': {
    en: 'The server dropped the connection.',
    de: 'Der Server hat die Verbindung abgebrochen.',
  },
  'mcstatus.unreachable': {
    en: 'There is no route to that address.',
    de: 'Zu dieser Adresse führt kein Weg.',
  },
  'mcstatus.closed': {
    en: 'The server closed the connection without a word.',
    de: 'Der Server hat die Verbindung ohne ein Wort geschlossen.',
  },
  'mcstatus.oversize': {
    en: 'The answer was absurdly large and was discarded.',
    de: 'Die Antwort war unsinnig groß und wurde verworfen.',
  },
  'mcstatus.protocol': {
    en: 'The server answered, but not with a Minecraft status.',
    de: 'Der Server hat geantwortet, aber nicht mit einem Minecraft-Status.',
  },
  'mcstatus.malformed': {
    en: 'The server answered with something that is not a Minecraft status.',
    de: 'Der Server hat etwas geantwortet, das kein Minecraft-Status ist.',
  },
  'mcstatus.unknown': {
    en: 'The connection failed for an unknown reason.',
    de: 'Die Verbindung ist aus unbekanntem Grund gescheitert.',
  },

  'srv.clientOldHint': {
    en: 'This bot started with that version. A newer one is on disk.',
    de: 'Mit dieser Fassung ist der Bot gestartet. Auf der Platte liegt eine neuere.',
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
  // ---- Sperrzeit, Wahrscheinlichkeit und Platzhalter ----------------------------------------
  //
  // Die Hinweise nennen den Fall, für den es die Zahl gibt, und nicht ihre Wirkung. „Sperrzeit:
  // wartet zwischen zwei Läufen“ erklärt das Wort; „damit ein Server, der die Zeile im
  // Sekundentakt schickt, nicht deinen Bot rauswirft“ erklärt, warum man sie setzen will.
  'srv.cooldown': { en: 'Cooldown (s)', de: 'Sperrzeit (s)' },
  'srv.cooldownHint': {
    en: '0 = every time. Set it when the server repeats the trigger line often.',
    de: '0 = jedes Mal. Setz sie, wenn der Server die auslösende Zeile oft wiederholt.',
  },
  'srv.cooldownOf': { en: 'at most every {n} s', de: 'höchstens alle {n} s' },
  'srv.chance': { en: 'Probability (%)', de: 'Wahrscheinlichkeit (%)' },
  'srv.chanceHint': {
    en: '100 = always. Below that, the answer stops looking like clockwork.',
    de: '100 = immer. Darunter sieht die Antwort nicht mehr nach Uhrwerk aus.',
  },
  'srv.placeholders': {
    en: 'In any text: {line} is the triggering line, {player} the account, {server} the slot, and {1}…{9} the groups of your regular expression.',
    de: 'In jedem Text: {line} ist die auslösende Zeile, {player} das Konto, {server} der Serverplatz, und {1}…{9} sind die Gruppen deines regulären Ausdrucks.',
  },
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
  'px.assigned': { en: 'Assigned', de: 'Zugewiesen' },
  'px.readyToUse': { en: 'ready to be selected', de: 'direkt auswählbar' },
  'px.limit': { en: 'Your limit', de: 'Dein Limit' },
  'px.forAccount': { en: 'outgoing addresses', de: 'Ausgangsadressen' },
  'px.paidOnly': { en: 'with a paid server slot', de: 'mit bezahltem Serverplatz' },
  'px.available': { en: 'Still available', de: 'Noch verfügbar' },
  'px.requestMore': { en: 'can still be requested', de: 'können noch angefragt werden' },
  'px.limitReached': { en: 'current limit reached', de: 'aktuelles Limit erreicht' },
  'px.noneAssigned': { en: 'none assigned yet', de: 'noch nichts zugewiesen' },
  'px.configureOn': { en: 'Configure per account on:', de: 'Je Konto einrichten unter:' },
  'px.added': { en: 'Assigned on', de: 'Zugewiesen am' },
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
  'bill.renewalForecast': { en: 'Next renewal', de: 'Nächste Verlängerung' },
  'bill.renewalCovered': { en: 'Covered from current balance', de: 'Aus aktuellem Guthaben gedeckt' },
  'bill.renewalGap': { en: 'Short by {credits}', de: 'Es fehlen {credits}' },
  'bill.renewalOff': { en: 'Automatic renewal is off', de: 'Automatische Verlängerung ist aus' },
  'bill.warningTitle': { en: 'Low-balance warning', de: 'Guthabenwarnung' },
  'bill.warningSub': {
    en: 'A personal reminder only; this never starts a payment or changes a plan.',
    de: 'Eine persönliche Erinnerung; sie löst niemals eine Zahlung oder Tarifänderung aus.',
  },
  'bill.warningCustom': { en: 'Use my own warning amount', de: 'Eigene Warnschwelle verwenden' },
  'bill.warningAt': { en: 'Warn me at or below (credits)', de: 'Warnen bei oder unter (Credits)' },
  'bill.warningPersonal': {
    en: 'Your personal warning is {credits}.',
    de: 'Deine persönliche Warnschwelle ist {credits}.',
  },
  'bill.warningRecommended': {
    en: 'Using the current recommended amount: {credits}.',
    de: 'Es gilt der aktuelle empfohlene Betrag: {credits}.',
  },
  'bill.warningBad': {
    en: 'Enter a whole number between 0 and 1,000,000 credits.',
    de: 'Bitte eine ganze Zahl zwischen 0 und 1.000.000 Credits eingeben.',
  },
  'bill.warningSaved': { en: 'Low-balance warning saved.', de: 'Guthabenwarnung gespeichert.' },
  'bill.runwayEyebrow': { en: 'Renewal coverage', de: 'Deckung der Verlängerungen' },
  'bill.runwayGapTitle': { en: '“{name}” is not yet covered', de: '„{name}“ ist noch nicht gedeckt' },
  'bill.runwayGapText': {
    en: 'On {date}, {credits} more are needed for its automatic renewal.',
    de: 'Für die automatische Verlängerung am {date} fehlen noch {credits}.',
  },
  'bill.runwayCovered': {
    en: '{covered} of {total} upcoming renewal(s) covered from today’s balance',
    de: '{covered} von {total} anstehenden Verlängerungen sind mit dem Guthaben von heute gedeckt',
  },
  'bill.runwayNext': { en: 'Next due: {date}', de: 'Nächste Fälligkeit: {date}' },
  'bill.runwaySafeTitle': { en: '{n} upcoming renewal(s) covered', de: '{n} anstehende Verlängerung(en) gedeckt' },
  'bill.runwaySafeText': {
    en: 'The current balance still leaves {credits} after renewals through {date}.',
    de: 'Nach den Verlängerungen bis {date} bleiben aus dem aktuellen Guthaben noch {credits}.',
  },
  'bill.runwayToday': { en: 'Calculated from today’s balance', de: 'Berechnet aus dem Guthaben von heute' },
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
  'bill.referral': { en: 'Refer a friend', de: 'Freunde werben' },
  'bill.referralSub': {
    en: 'You and your friend each get {credits} credits on their first top-up.',
    de: 'Du und dein Freund bekommt je {credits} Credits bei dessen erster Aufladung.',
  },
  'bill.referralLink': { en: 'Your referral link', de: 'Dein Empfehlungslink' },
  'bill.referralStats': {
    en: '{referred} signed up through your link so far, {rewarded} of them topped up and paid out.',
    de: '{referred} haben sich bisher über deinen Link angemeldet, {rewarded} davon haben aufgeladen und ausgezahlt bekommen.',
  },
  'bill.open': { en: 'Open top-ups', de: 'Offene Aufladungen' },
  'bill.history': { en: 'Movements', de: 'Bewegungen' },
  'bill.spend': { en: 'Spent per month', de: 'Ausgaben je Monat' },
  'bill.kind.topup': { en: 'Top-up', de: 'Aufladung' },
  'bill.kind.voucher': { en: 'Voucher', de: 'Gutschein' },
  'bill.kind.plan': { en: 'Server slot', de: 'Serverplatz' },
  'bill.kind.refund': { en: 'Refund', de: 'Gutschrift' },
  'bill.kind.admin': { en: 'By an administrator', de: 'Durch Administrator' },
  'bill.kind.bonus': { en: 'Bonus', de: 'Bonus' },
  'bill.kind.referral': { en: 'Referral', de: 'Empfehlung' },
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
  'tk.diagnostic': { en: 'Include server diagnostic context', de: 'Server-Diagnosekontext anhängen' },
  'tk.diagnosticNone': { en: 'No server context', de: 'Kein Serverkontext' },
  'tk.diagnosticHint': {
    en: 'The exact context is shown for review before sending.',
    de: 'Der genaue Kontext wird vor dem Absenden vollständig zur Prüfung gezeigt.',
  },
  'tk.diagnosticReview': { en: 'Review diagnostic context', de: 'Diagnosekontext prüfen' },
  'tk.diagnosticSend': { en: 'Send with this context', de: 'Mit diesem Kontext senden' },
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
  'tk.assignmentAll': { en: 'Any assignee', de: 'Alle Zuständigkeiten' },
  'tk.assignmentMine': { en: 'Assigned to me', de: 'Mir zugewiesen' },
  'tk.assignmentNone': { en: 'Not assigned', de: 'Nicht zugewiesen' },
  'tk.stale': { en: 'Waiting over 24 h', de: 'Wartet über 24 h' },
  // Drei Zustände, und jeder sagt, wer am Zug ist. Ein vierter („Wartet auf dich“) stand hier
  // neben „Beantwortet“ und bedeutete dasselbe – siehe server/tickets.js.
  'tk.status.open': { en: 'Open', de: 'Offen' },
  'tk.status.answered': { en: 'Answered', de: 'Beantwortet' },
  'tk.status.closed': { en: 'Closed', de: 'Geschlossen' },
  'tk.nextExpected': { en: 'Next expected reply', de: 'Nächste erwartete Antwort' },
  'tk.workflowResponsible': { en: 'Responsible: {who}', de: 'Zuständig: {who}' },
  'tk.workflowSince': { en: 'Since {when}', de: 'Seit {when}' },
  'tk.workflow.open.customer': {
    en: 'Support will review your message and reply next.',
    de: 'Der Support prüft deine Nachricht und antwortet als Nächstes.',
  },
  'tk.workflow.open.staff': {
    en: 'Review the customer message and send the next reply.',
    de: 'Prüfe die Kundennachricht und sende die nächste Antwort.',
  },
  'tk.workflow.answered.customer': {
    en: 'Reply if you need anything else, or close the ticket when everything is settled.',
    de: 'Antworte bei weiteren Fragen oder schließe das Ticket, wenn alles geklärt ist.',
  },
  'tk.workflow.answered.staff': {
    en: 'The customer is expected to reply. Follow up only when new information arrives.',
    de: 'Jetzt wird eine Kundenantwort erwartet. Bearbeite weiter, sobald neue Informationen kommen.',
  },
  'tk.workflow.closed.customer': {
    en: 'No reply is expected. A new message reopens this ticket with its full history.',
    de: 'Es wird keine Antwort erwartet. Eine neue Nachricht öffnet dieses Ticket mit seinem vollständigen Verlauf wieder.',
  },
  'tk.workflow.closed.staff': {
    en: 'No reply is expected. A customer message reopens the ticket automatically.',
    de: 'Es wird keine Antwort erwartet. Eine Kundennachricht öffnet das Ticket automatisch wieder.',
  },
  'tk.workflow.unassigned': { en: 'Support queue', de: 'Support-Warteschlange' },
  'tk.workflow.done': { en: 'Nobody', de: 'Niemand' },
  'tk.staff': { en: 'Team', de: 'Team' },
  'tk.you': { en: 'You', de: 'Du' },
  'tk.internal': { en: 'Internal note', de: 'Interne Notiz' },
  'tk.hours': { en: 'We usually answer {hours}.', de: 'Wir antworten meist {hours}.' },
  'tk.helpTitle': { en: 'Quick help before opening a ticket', de: 'Kurze Hilfe vor dem Ticket' },
  'tk.helpText': {
    en: 'These maintained answers solve common account, billing and server-rule questions. They open separately so your ticket draft stays where it is.',
    de: 'Diese gepflegten Antworten lösen häufige Fragen zu Konto, Guthaben und Serverregeln. Sie öffnen getrennt, damit ein Ticketentwurf liegen bleibt.',
  },
  'tk.helpOpen': { en: 'Open answer', de: 'Antwort öffnen' },

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
  // Zwölf, nicht acht. Hier stand acht, das Eingabefeld verlangte zwölf und `checkPasswordPair()`
  // auch – wer neun Zeichen eintippte, bekam eine Absage für eine Regel, die nirgends stand.
  'set.passwordHint': {
    en: 'At least 12 characters. All other sessions are signed out.',
    de: 'Mindestens 12 Zeichen. Alle anderen Sitzungen werden abgemeldet.',
  },
  'set.passwordOk': { en: 'Password changed.', de: 'Passwort geändert.' },
  'set.sessions': { en: 'Sessions', de: 'Sitzungen' },
  'set.logoutAll': { en: 'Sign out on all devices', de: 'Auf allen Geräten abmelden' },
  'set.logoutAllAsk': {
    en: 'Sign out everywhere? You will have to log in again.',
    de: 'Überall abmelden? Du musst dich danach neu anmelden.',
  },

  'set.tokens': { en: 'API access', de: 'API-Zugang' },
  'set.tokensSub': {
    en: 'A token for your own scripts – check bot status, start or stop bots, without a browser.',
    de: 'Ein Token für eigene Skripte – Bot-Status abfragen, Bots starten oder stoppen, ohne Browser.',
  },
  'set.tokenCreate': { en: 'Create token', de: 'Token erstellen' },
  'set.tokenLabel': { en: 'Label', de: 'Bezeichnung' },
  'set.tokenLabelHint': {
    en: 'So you know later which script this is, e.g. “status page”.',
    de: 'Damit du später weißt, welches Skript das ist, z. B. „Statusseite“.',
  },
  'set.tokenCreatedAt': { en: 'created {when}', de: 'erstellt {when}' },
  'set.tokenLastUsed': { en: 'last used {when}', de: 'zuletzt benutzt {when}' },
  'set.tokenNeverUsed': { en: 'never used', de: 'noch nie benutzt' },
  'set.tokenRevoke': { en: 'Revoke', de: 'Widerrufen' },
  'set.tokenRevokeAsk': {
    en: 'Revoke this token? Any script still using it stops working immediately.',
    de: 'Dieses Token widerrufen? Ein Skript, das es noch benutzt, funktioniert danach sofort nicht mehr.',
  },
  'set.tokenRevoked': { en: 'Token revoked.', de: 'Token widerrufen.' },
  'set.tokenCreated': { en: 'Token created', de: 'Token erstellt' },
  'set.tokenShownOnce': {
    en: 'This value is shown only now. Copy it – it cannot be shown again, only revoked and replaced.',
    de: 'Dieser Wert wird nur jetzt angezeigt. Kopiere ihn – er lässt sich nicht erneut anzeigen, nur widerrufen und ersetzen.',
  },
  'set.tokenValue': { en: 'Token', de: 'Token' },
  'set.tokenAck': {
    en: 'I have copied the token.',
    de: 'Ich habe das Token kopiert.',
  },

  // ---------------------------------------------------------------- Aktivitätszentrale
  'act.title': { en: 'Activity', de: 'Aktivität' },
  'act.sub': {
    en: 'Support replies, credits, server slots, and bots — kept across all your devices',
    de: 'Support-Antworten, Guthaben, Serverplätze und Bots – auf allen Geräten aufgehoben',
  },
  'act.markAll': { en: 'Mark all read', de: 'Alles als gelesen markieren' },
  'act.marked': { en: 'Everything is marked as read.', de: 'Alles ist als gelesen markiert.' },
  'act.clearRead': { en: 'Remove read', de: 'Gelesene entfernen' },
  'act.clearAsk': {
    en: 'Remove all read activity? Unread items stay where they are.',
    de: 'Alle gelesenen Aktivitäten entfernen? Ungelesene bleiben erhalten.',
  },
  'act.cleared': { en: 'Read activity removed.', de: 'Gelesene Aktivitäten entfernt.' },
  'act.search': { en: 'Search activity', de: 'Aktivität durchsuchen' },
  'act.filter': { en: 'Type of activity', de: 'Art der Aktivität' },
  'act.all': { en: 'All activity', de: 'Alle Aktivitäten' },
  'act.unreadOnly': { en: 'Unread only', de: 'Nur ungelesene' },
  'act.count': { en: '{n} of {total}', de: '{n} von {total}' },
  'act.new': { en: 'New', de: 'Neu' },
  'act.empty': { en: 'Quiet so far', de: 'Bisher ist es ruhig' },
  'act.emptyText': {
    en: 'New support replies, payments, renewals, and important bot events will appear here.',
    de: 'Neue Support-Antworten, Zahlungen, Verlängerungen und wichtige Bot-Ereignisse erscheinen hier.',
  },
  'act.emptyFilter': { en: 'Nothing matches', de: 'Nichts passt dazu' },
  'act.emptyFilterText': {
    en: 'Try another type, show read items, or shorten the search.',
    de: 'Wähle eine andere Art, zeige Gelesenes oder kürze die Suche.',
  },
  'act.loadOlder': { en: 'Load older activity', de: 'Ältere Aktivitäten laden' },
  'act.loadingOlder': { en: 'Loading older activity …', de: 'Ältere Aktivitäten werden geladen …' },
  'act.allLoaded': { en: 'You have reached the beginning.', de: 'Du bist am Anfang angekommen.' },
  'act.markUnread': { en: 'Mark as unread', de: 'Als ungelesen markieren' },
  'act.markedUnread': { en: 'Marked as unread.', de: 'Als ungelesen markiert.' },

  // ---------------------------------------------------------------- Sprungmarke (Strg+K)
  'pal.title': { en: 'Search', de: 'Suche' },
  'pal.shortcut': { en: 'Ctrl+K', de: 'Strg+K' },
  'pal.placeholder': {
    en: 'Search for a page, user, server, ticket …',
    de: 'Seite, Nutzer, Server, Ticket suchen …',
  },
  'pal.pages': { en: 'Pages', de: 'Seiten' },
  'pal.quick': { en: 'Quick actions', de: 'Schnellaktionen' },
  'pal.botActions': { en: 'Bot actions', de: 'Bot-Aktionen' },
  'pal.startBot': { en: 'Start “{name}”', de: '„{name}“ starten' },
  'pal.stopBot': { en: 'Stop “{name}”', de: '„{name}“ stoppen' },
  'pal.botStopped': { en: '“{name}” is stopping.', de: '„{name}“ wird gestoppt.' },
  'pal.servers': { en: 'Your servers', de: 'Deine Server' },
  'pal.accounts': { en: 'Your Minecraft accounts', de: 'Deine Minecraft-Konten' },
  'pal.start': { en: 'Type to search.', de: 'Tippen, um zu suchen.' },
  'pal.empty': { en: 'Nothing found.', de: 'Nichts gefunden.' },
  'pal.move': { en: 'choose', de: 'wählen' },
  'pal.go': { en: 'open', de: 'öffnen' },
  'pal.hint': {
    en: 'Users, servers, accounts, tickets, vouchers, locations, top-ups',
    de: 'Nutzer, Server, Accounts, Tickets, Gutscheine, Standorte, Aufladungen',
  },

  // ---------------------------------------------------------------- Tastatur
  'keys.title': { en: 'Keyboard shortcuts', de: 'Tastaturkürzel' },
  'keys.search': { en: 'Search and jump anywhere', de: 'Suchen und überall hinspringen' },
  'keys.sidebar': { en: 'Focus the navigation search', de: 'Navigationssuche fokussieren' },
  'keys.overview': { en: 'Go to overview', de: 'Zur Übersicht' },
  'keys.servers': { en: 'Go to servers', de: 'Zu den Servern' },
  'keys.accounts': { en: 'Go to Minecraft accounts', de: 'Zu den Minecraft-Konten' },
  'keys.credits': { en: 'Go to credits', de: 'Zum Guthaben' },
  'keys.activity': { en: 'Go to activity', de: 'Zur Aktivität' },
  'keys.support': { en: 'Go to support', de: 'Zum Support' },
  'keys.help': { en: 'Show these shortcuts', de: 'Diese Kürzel anzeigen' },

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
  'adm.clientOutdated': {
    en: '{n} of {total} running bots still hold the old client file',
    de: '{n} von {total} laufenden Bots halten noch die alte Client-Datei',
  },
  'adm.clientRollout': { en: 'Restart them all', de: 'Alle neu starten' },
  'adm.clientRolloutAsk': {
    en: 'Restart {n} bot(s) across every account? Each one leaves its Minecraft server and comes back. They are spaced a few seconds apart.',
    de: '{n} Bot(s) über alle Konten hinweg neu starten? Jeder verlässt seinen Minecraft-Server und kommt wieder. Sie starten mit ein paar Sekunden Abstand.',
  },
  'adm.clientRolloutDone': { en: '{n} bot(s) are restarting.', de: '{n} Bot(s) starten neu.' },
  'adm.clientRolloutPlan': { en: 'Staged rollout plan', de: 'Gestaffelter Rollout-Plan' },
  'adm.clientRolloutPlanHint': {
    en: 'This preview is a current snapshot. Restarts are spaced five seconds apart; the last scheduled start is after about {seconds} seconds.',
    de: 'Diese Vorschau ist eine Momentaufnahme. Neustarts liegen fünf Sekunden auseinander; der letzte geplante Start ist nach etwa {seconds} Sekunden.',
  },
  'adm.clientRolloutAfter': { en: 'Scheduled after', de: 'Geplant nach' },
  'adm.clientRolloutAfterValue': { en: '+{seconds} s', de: '+{seconds} s' },
  'adm.mc.title': { en: 'Minecraft resources', de: 'Minecraft-Ressourcen' },
  // Seit Client 2.6.0 ist die Datei keine Pflicht mehr – der Client findet selbst eine. Der Text
  // sagt deshalb nicht mehr „muss“, sondern warum es trotzdem besser ist: Eine Datei hier gilt für
  // alle Kunden dieser Maschine, die Selbsthilfe des Clients landet unter dem Konto **eines**.
  'adm.mc.lead': {
    en: 'The textured live view reads block models, textures and menu graphics from the original Minecraft client JAR while it renders. We may not ship those files. From client 2.6.0 on the client finds one by itself if none is here – but it then stores it under one customer’s account, so every customer with a live view downloads their own 30 MB. A file here is used by all of them.',
    de: 'Die texturierte Live-Ansicht liest Blockmodelle, Texturen und Menügrafiken beim Zeichnen aus der Original-Client-JAR von Minecraft. Diese Dateien dürfen wir nicht mitliefern. Ab Client 2.6.0 sucht sich der Client selbst eine, wenn hier keine liegt – er legt sie dann aber unter dem Konto **eines** Kunden ab, jeder Kunde mit Live-Ansicht lädt sich also seine eigenen 30 MB. Eine Datei hier gilt für alle.',
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
    en: 'Delete the resources for {version}? From client 2.6.0 on every customer on that version then fetches their own copy; on older clients the live view falls back to the voxel view.',
    de: 'Die Ressourcen für {version} löschen? Ab Client 2.6.0 holt sich danach jeder Kunde mit dieser Version seine eigene Kopie; bei älteren Clients fällt die Live-Ansicht auf die Voxelansicht zurück.',
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
  'adm.loginLink': { en: 'Copy one-time login link', de: 'Einmal-Link kopieren' },
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
  'adm.archivedReceipts': { en: 'Receipts of deleted accounts ({n})', de: 'Belege gelöschter Konten ({n})' },
  'adm.archivedReceiptsHint': {
    en: 'Issued receipts stay for the statutory retention period even after the account is gone',
    de: 'Ausgestellte Belege bleiben auch nach dem Konto für die Aufbewahrungsfrist erhalten',
  },
  'adm.saved': { en: 'Saved.', de: 'Gespeichert.' },
  'adm.usersLine': { en: '+{new} in 30 days · {active} active today', de: '+{new} in 30 Tagen · {active} heute aktiv' },
  'adm.ticketsWaiting': { en: '{n} waiting for us', de: '{n} warten auf uns' },
  'adm.revenueAll': { en: '{total} all time', de: '{total} insgesamt' },
  'adm.attention': { en: 'Needs a look', de: 'Braucht einen Blick' },
  'adm.attentionQueue': { en: 'Operations queue', de: 'Betriebs-Warteschlange' },
  'adm.attentionUnassigned': { en: 'Unassigned support tickets', de: 'Nicht zugewiesene Support-Tickets' },
  'adm.attentionStale': { en: 'Tickets waiting over 24 hours', de: 'Tickets warten länger als 24 Stunden' },
  'adm.attentionAccountErrors': { en: 'Accounts requiring reconnect', de: 'Konten brauchen eine neue Anmeldung' },
  'adm.attentionFailedLogins': { en: 'Failed sign-ins today', de: 'Fehlgeschlagene Anmeldungen heute' },
  'adm.attentionDeletions': { en: 'Scheduled account deletions', de: 'Vorgemerkte Kontolöschungen' },
  'adm.attentionExpiring': { en: 'Slots expiring within 7 days', de: 'Serverplätze laufen binnen 7 Tagen ab' },
  'adm.attentionOldest': { en: 'Oldest waiting: {age}', de: 'Älteste Wartezeit: {age}' },
  'adm.filterLeaving': { en: 'Deletion scheduled', de: 'Löschung vorgemerkt' },
  'adm.filterDormant': { en: 'Inactive for 90 days', de: 'Seit 90 Tagen inaktiv' },
  'adm.filterAccountErrors': { en: 'Account errors', de: 'Kontofehler' },

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
  'ad.changePreview': { en: 'Review add-on change', de: 'Zusatzänderung prüfen' },
  'ad.previewCharge': { en: 'Due now: −{credits}', de: 'Jetzt fällig: −{credits}' },
  'ad.previewRefund': { en: 'Returned now: +{credits}', de: 'Jetzt zurück: +{credits}' },
  'ad.previewQty': { en: 'Quantity: {before} → {after}', de: 'Menge: {before} → {after}' },
  'ad.previewMonthly': { en: 'Monthly: {before} → {after}', de: 'Monatlich: {before} → {after}' },
  'ad.previewBlocked.credits': { en: 'Your balance does not cover this change.', de: 'Dein Guthaben deckt diese Änderung nicht.' },
  'ad.previewBlocked.plan': { en: 'Choose a paid plan before booking add-ons.', de: 'Wähle vor Zusatzbuchungen einen bezahlten Tarif.' },
  'ad.previewBlocked.unavailable': { en: 'This add-on is not available right now.', de: 'Dieser Zusatz ist gerade nicht verfügbar.' },
  'ad.previewBlocked.included': { en: 'Your current plan already includes this.', de: 'Dein aktueller Tarif enthält das bereits.' },
  'ad.previewBlocked.inactive': { en: 'Resume this server slot before changing add-ons.', de: 'Setze diesen Serverplatz vor Zusatzänderungen fort.' },
  'ad.previewBlocked.limit': { en: 'This would exceed the allowed quantity.', de: 'Damit würde die erlaubte Menge überschritten.' },

  // ---------------------------------------------------------------- Standorte
  'nd.title': { en: 'Location', de: 'Standort' },
  'nd.sub': {
    en: 'Where this server slot goes out to the internet. Every location has its own address.',
    de: 'Von wo dieser Serverplatz ins Netz geht. Jeder Standort hat seine eigene Adresse.',
  },
  'nd.change': { en: 'Change location', de: 'Standort wechseln' },
  'nd.noneLeft': {
    en: 'There is no other location to move to.',
    de: 'Es gibt keinen anderen Standort, auf den umgezogen werden könnte.',
  },
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
  'nd.maxDisk': { en: 'Disk limit (%)', de: 'Festplattengrenze (%)' },
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
  'pov.compact': { en: 'Compact', de: 'Kompakt' },
  'pov.compactHint': {
    en: 'Smaller stages, so more bots fit on screen at once.',
    de: 'Kleinere Bühnen, damit mehr Bots gleichzeitig auf den Schirm passen.',
  },
  'pov.group': { en: 'Steer together', de: 'Gemeinsam steuern' },
  'pov.groupHint': {
    en: 'Pick several stages, then steer them together with the same keys.',
    de: 'Mehrere Bühnen auswählen und mit denselben Tasten gemeinsam steuern.',
  },
  'pov.stageLabel': { en: 'Live view of {name}', de: 'Live-Ansicht von {name}' },
  'pov.shot': { en: 'Save picture', de: 'Bild speichern' },
  'pov.pip': { en: 'Picture in picture', de: 'Bild-im-Bild' },
  'pov.pipRunning': { en: 'Running in picture-in-picture …', de: 'Läuft im Bild-im-Bild-Fenster …' },
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
  'ch.exportScope': {
    en: 'Download the history from {n} selected account(s)',
    de: 'Verlauf von {n} ausgewählten Konto/Konten herunterladen',
  },
  'ch.markedOnly': { en: 'Marked only', de: 'Nur markierte' },
  'ch.markedHint': {
    en: 'Show only your personal bookmarks on this device.',
    de: 'Zeigt nur deine persönlichen Lesezeichen auf diesem Gerät.',
  },
  'ch.markedCount': { en: '{n} marked', de: '{n} markiert' },
  'ch.mark': { en: 'Mark this line', de: 'Diese Zeile markieren' },
  'ch.unmark': { en: 'Remove mark', de: 'Markierung entfernen' },
  'ch.clearMarks': { en: 'Clear all marks', de: 'Alle Markierungen löschen' },
  'ch.clearMarksAsk': {
    en: 'Clear every personal chat mark on this device?',
    de: 'Alle persönlichen Chatmarkierungen auf diesem Gerät löschen?',
  },
  'ch.exportTitle': { en: 'Export chat history', de: 'Chatverlauf exportieren' },
  'ch.exportLead': {
    en: 'Only the {n} currently selected account(s) are included. Exports contain readable text, never sign-in data.',
    de: 'Nur die aktuell ausgewählten {n} Konto/Konten kommen mit. Exporte enthalten lesbaren Text, niemals Anmeldedaten.',
  },
  'ch.exportFormat': { en: 'Format', de: 'Format' },
  'ch.exportFormat.txt': { en: 'Text file (.txt)', de: 'Textdatei (.txt)' },
  'ch.exportFormat.csv': { en: 'Spreadsheet (.csv)', de: 'Tabellenformat (.csv)' },
  'ch.exportFormat.json': { en: 'Structured data (.json)', de: 'Strukturierte Daten (.json)' },
  'ch.exportFrom': { en: 'From date', de: 'Ab Datum' },
  'ch.exportUntil': { en: 'Until date', de: 'Bis Datum' },
  'ch.exportDateHint': {
    en: 'Leave empty to include the available history.',
    de: 'Leer lassen, um den verfügbaren Verlauf einzuschließen.',
  },
  'ch.exportEvents': {
    en: 'Include connection and client events',
    de: 'Verbindungs- und Clientereignisse einschließen',
  },
  'ch.exportMatches': {
    en: 'Only lines matching the current search: {query}',
    de: 'Nur Zeilen der aktuellen Suche: {query}',
  },
  'ch.exportDownload': { en: 'Download export', de: 'Export herunterladen' },
  'ch.exportDateBad': {
    en: 'Please enter a valid date range.',
    de: 'Bitte einen gültigen Zeitraum eingeben.',
  },
  'ch.historyHint': {
    en: 'Enter sends. Use ↑ and ↓ for recently sent messages.',
    de: 'Enter schickt ab. Mit ↑ und ↓ holst du zuletzt gesendete Nachrichten zurück.',
  },
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
  'set.accountSub': {
    en: 'Your identity and the language used across the account.',
    de: 'Deine Identität und die Sprache, die im ganzen Konto gilt.',
  },
  'set.experience': { en: 'Panel on this device', de: 'Panel auf diesem Gerät' },
  'set.experienceSub': {
    en: 'Make the workspace fit this screen. These choices stay on this device.',
    de: 'Passe den Arbeitsbereich an diesen Bildschirm an. Diese Auswahl bleibt auf diesem Gerät.',
  },
  'set.theme': { en: 'Colour scheme', de: 'Farbschema' },
  'set.density': { en: 'Spacing', de: 'Abstände' },
  'set.density.comfortable': { en: 'Comfortable', de: 'Bequem' },
  'set.density.compact': { en: 'Compact', de: 'Kompakt' },
  'set.motion': { en: 'Motion', de: 'Bewegung' },
  'set.motion.system': { en: 'Match system', de: 'Wie das System' },
  'set.motion.reduced': { en: 'Reduced', de: 'Reduziert' },
  'set.startPage': { en: 'When opening the panel', de: 'Beim Öffnen des Panels' },
  'set.start.overview': { en: 'Show the overview', de: 'Übersicht zeigen' },
  'set.start.last': { en: 'Continue where I left off', de: 'Dort weitermachen, wo ich war' },
  'set.dashboardOrder': { en: 'Overview order', de: 'Reihenfolge der Übersicht' },
  'set.dashboardOrderSub': {
    en: 'Put the areas you use most at the top. This is saved on this device.',
    de: 'Lege die Bereiche, die du am häufigsten brauchst, nach oben. Die Reihenfolge bleibt auf diesem Gerät.',
  },
  'set.dashboard.focus': { en: 'Operating status', de: 'Betriebsstatus' },
  'set.dashboard.analytics': { en: 'Credits and figures', de: 'Guthaben und Kennzahlen' },
  'set.dashboard.bots': { en: 'Bot control', de: 'Bot-Steuerung' },
  'set.dashboard.pov': { en: 'Live views', de: 'Live-Ansichten' },
  'set.dashboard.quick': { en: 'Quick access', de: 'Schnellzugriff' },
  'set.dashboardMoveUp': { en: 'Move {name} up', de: '{name} nach oben verschieben' },
  'set.dashboardMoveDown': { en: 'Move {name} down', de: '{name} nach unten verschieben' },
  'set.dashboardReset': { en: 'Restore standard order', de: 'Standardreihenfolge wiederherstellen' },
  'set.up': { en: 'Up', de: 'Hoch' },
  'set.down': { en: 'Down', de: 'Runter' },
  'set.shortcuts': { en: 'View keyboard shortcuts', de: 'Tastaturkürzel ansehen' },
  'set.deviceSaved': { en: 'Saved on this device.', de: 'Auf diesem Gerät gespeichert.' },
  'set.dangerZone': { en: 'Account', de: 'Konto' },
  'set.thisDevice': { en: 'this device', de: 'dieses Gerät' },
  'set.welcome': { en: 'Welcome! Your account is ready.', de: 'Willkommen! Dein Konto steht.' },
  'set.linkOk': { en: 'Account linked.', de: 'Konto verknüpft.' },

  // ---------------------------------------------------------------- Einstellungen: die Reiter
  //
  // Die Einstellungen sind gewachsen: Konto, persönliche Daten, Rechnungsadresse, Nachrichten,
  // Sicherheit, Darstellung, eigene Daten. Alles untereinander wäre eine Seite, auf der man
  // scrollt, bis man findet – deshalb Reiter, dieselben wie beim Serverplatz.
  'set.tab.account': { en: 'Account', de: 'Konto' },
  'set.tab.personal': { en: 'Personal details', de: 'Persönliche Daten' },
  'set.tab.messages': { en: 'Messages', de: 'Nachrichten' },
  'set.tab.security': { en: 'Security', de: 'Sicherheit' },
  'set.tab.display': { en: 'Appearance', de: 'Darstellung' },
  'set.tab.data': { en: 'Your data', de: 'Deine Daten' },

  // ---------------------------------------------------------------- Konto: Name und Adresse
  'set.identity': { en: 'Who you are here', de: 'Wer du hier bist' },
  'set.identitySub': {
    en: 'Your name in the panel and the address we reach you at.',
    de: 'Dein Name im Panel und die Adresse, unter der wir dich erreichen.',
  },
  'set.memberSince': { en: 'Member since', de: 'Dabei seit' },
  'set.changeUsername': { en: 'Change username', de: 'Benutzernamen ändern' },
  'set.usernameNote': {
    en: 'Your username is your unique sign-in name. Conversations use your full or linked display name. It can be changed once every 30 days.',
    de: 'Dein Benutzername ist der eindeutige Anmeldename. In Gesprächen steht dein vollständiger oder verknüpfter Anzeigename. Er lässt sich alle 30 Tage ändern.',
  },
  'set.avatarSource': { en: 'Profile picture', de: 'Profilbild' },
  'set.avatarAuto': { en: 'Automatic (recommended)', de: 'Automatisch (empfohlen)' },
  'set.avatarInitials': { en: 'Initials only', de: 'Nur Initialen' },
  'set.avatarHint': {
    en: 'Automatic prefers Discord, then Google and Gravatar. You can pin or disable a source here.',
    de: 'Automatisch nimmt zuerst Discord, dann Google und Gravatar. Hier kannst du eine Quelle festlegen oder Bilder abschalten.',
  },
  'set.avatarSaved': { en: 'Profile picture changed.', de: 'Profilbild geändert.' },
  'set.usernameOk': { en: 'Username changed.', de: 'Benutzername geändert.' },
  'set.usernameNext': {
    en: 'Changeable again on {date}.',
    de: 'Wieder änderbar am {date}.',
  },
  'set.changeEmail': { en: 'Change email address', de: 'E-Mail-Adresse ändern' },
  'set.emailNote': {
    en: 'The new address has to confirm the change. Until then the current one stays in charge – so a typo cannot lock you out.',
    de: 'Die neue Adresse muss die Änderung bestätigen. Bis dahin bleibt die jetzige in Kraft – ein Tippfehler sperrt dich also nicht aus.',
  },
  'set.emailNew': { en: 'New email address', de: 'Neue E-Mail-Adresse' },
  'set.emailPassword': { en: 'Your password', de: 'Dein Passwort' },
  'set.emailPasswordHint': {
    en: 'The email address is the way back into your account. That is why we ask for the password here.',
    de: 'Über die E-Mail-Adresse kommt man ins Konto zurück. Deshalb fragen wir hier nach dem Passwort.',
  },
  'set.emailSent': {
    en: 'Check {email} – the link there switches the address.',
    de: 'Sieh in {email} nach – der Link dort schaltet die Adresse um.',
  },
  'set.emailPending': {
    en: 'Waiting for {email} to confirm.',
    de: 'Wartet auf die Bestätigung von {email}.',
  },
  'set.emailCancel': { en: 'Withdraw', de: 'Zurückziehen' },
  'set.emailCancelled': { en: 'Withdrawn.', de: 'Zurückgezogen.' },
  'set.emailUnverified': { en: 'not confirmed', de: 'nicht bestätigt' },
  'auth.verify.mailMoved': {
    en: 'Done – this account now uses {email}.',
    de: 'Erledigt – dieses Konto läuft jetzt auf {email}.',
  },

  // ---------------------------------------------------------------- Persönliche Daten
  'set.personal': { en: 'Personal details', de: 'Persönliche Daten' },
  'set.personalSub': {
    en: 'Only used for receipts and for reaching you. Nothing here is public.',
    de: 'Wird nur für Belege und zum Erreichen gebraucht. Nichts davon ist öffentlich.',
  },
  'set.fullName': { en: 'Full name', de: 'Vollständiger Name' },
  'set.fullNameHint': {
    en: 'Shown in tickets, emails and the panel, and used on receipts. Not the same as the username.',
    de: 'Steht in Tickets, E-Mails und im Panel sowie auf Belegen. Nicht dasselbe wie der Benutzername.',
  },
  'set.phone': { en: 'Phone', de: 'Telefon' },
  'set.phoneHint': {
    en: 'Optional. We only call if a ticket cannot be answered in writing.',
    de: 'Optional. Wir rufen nur an, wenn ein Ticket sich schriftlich nicht klären lässt.',
  },
  'set.timezone': { en: 'Time zone', de: 'Zeitzone' },
  'set.timezoneHint': {
    en: 'Decides when a schedule fires and which day a receipt carries.',
    de: 'Entscheidet, wann ein Zeitplan zuschlägt und welches Datum auf einem Beleg steht.',
  },
  'set.timezoneDetect': { en: 'Use this device', de: 'Die dieses Geräts' },
  'set.timezoneServer': {
    en: 'Not set – the server uses {zone}',
    de: 'Nicht gesetzt – der Server rechnet in {zone}',
  },
  'set.billing': { en: 'Billing address', de: 'Rechnungsadresse' },
  'set.billingSub': {
    en: 'What every receipt is made out to. Change it whenever you like – receipts already issued keep the address they were issued with.',
    de: 'Auf wen jeder Beleg ausgestellt wird. Jederzeit änderbar – schon ausgestellte Belege behalten die Anschrift, mit der sie ausgestellt wurden.',
  },
  'set.company': { en: 'Company', de: 'Firma' },
  'set.companyHint': {
    en: 'Filled in means the receipt is made out to the company.',
    de: 'Ausgefüllt heißt: Der Beleg läuft auf die Firma.',
  },
  'set.vatId': { en: 'VAT ID', de: 'USt-IdNr.' },
  'set.vatIdHint': {
    en: 'For businesses inside the EU. We print it, we do not check it.',
    de: 'Für Firmen innerhalb der EU. Wir drucken sie, wir prüfen sie nicht.',
  },
  'set.street': { en: 'Street and number', de: 'Straße und Nummer' },
  'set.street2': { en: 'Address line 2', de: 'Adresszusatz' },
  'set.street2Hint': { en: 'Care of, floor, apartment.', de: 'c/o, Stock, Wohnung.' },
  'set.postalCode': { en: 'Postcode', de: 'PLZ' },
  'set.city': { en: 'City', de: 'Ort' },
  'set.region': { en: 'State or province', de: 'Bundesland/Region' },
  'set.country': { en: 'Country', de: 'Land' },
  'set.countryPick': { en: 'Please choose', de: 'Bitte wählen' },
  'set.billingEmail': { en: 'Receipts to', de: 'Belege an' },
  'set.billingEmailHint': {
    en: 'Leave empty to use the account address.',
    de: 'Leer lassen heißt: an die Adresse des Kontos.',
  },
  'set.addressPreview': { en: 'On the receipt', de: 'So steht es auf dem Beleg' },
  'set.addressEmpty': {
    en: 'No address yet – receipts will only carry your account name.',
    de: 'Noch keine Anschrift – auf Belegen steht dann nur dein Kontoname.',
  },
  'set.saved': { en: 'Saved.', de: 'Gespeichert.' },

  // ---------------------------------------------------------------- Sitzungen
  'set.sessionsSub': {
    en: 'Every device that is signed in right now. Anything you do not recognise belongs out.',
    de: 'Jedes Gerät, das gerade angemeldet ist. Was du nicht kennst, gehört hier raus.',
  },
  'set.sessionCurrent': { en: 'this device', de: 'dieses Gerät' },
  'set.sessionEnd': { en: 'Sign out', de: 'Abmelden' },
  'set.sessionEnded': { en: 'That device is signed out.', de: 'Dieses Gerät ist abgemeldet.' },
  'set.sessionSince': { en: 'since {when}', de: 'seit {when}' },
  'set.signIns': { en: 'Recent sign-ins', de: 'Letzte Anmeldungen' },
  'set.signInsSub': {
    en: 'Successful and failed attempts on this account. A failed one from an address you know is usually just a typo.',
    de: 'Gelungene und gescheiterte Versuche an diesem Konto. Ein gescheiterter von einer bekannten Adresse ist meistens nur ein Vertipper.',
  },
  'set.signInOk': { en: 'signed in', de: 'angemeldet' },
  'set.signInFailed': { en: 'wrong password', de: 'falsches Passwort' },
  'set.signInBlocked': { en: 'blocked', de: 'gesperrt' },
  'set.signInThrottled': { en: 'too many attempts', de: 'zu viele Versuche' },
  'set.signInCodeOk': { en: 'signed in with a code', de: 'mit Code angemeldet' },
  'set.signInCodeWrong': {
    en: 'wrong code – the password was right',
    de: 'falscher Code – das Passwort stimmte',
  },
  'set.signInsNone': { en: 'Nothing recorded yet.', de: 'Bisher nichts aufgezeichnet.' },

  // ---------------------------------------------------------------- Anmeldecode
  //
  // Der Wortlaut hier verspricht bewusst keine „Zwei-Faktor-Anmeldung“: Der Code geht über
  // dieselbe E-Mail-Adresse, über die auch „Passwort vergessen“ läuft. Was er wirklich leistet –
  // ein gestohlenes Passwort allein reicht nicht mehr – steht dafür so da, dass man es glauben
  // kann. Der Grund dafür steht ausführlich in server/logincode.js.
  'set.loginCode': { en: 'Sign-in code', de: 'Anmeldecode' },
  'set.loginCodeSub': {
    en: 'A stolen password alone should not be enough. It is not a second factor: the code goes to the same address that “Forgot password” uses.',
    de: 'Ein gestohlenes Passwort allein soll nicht reichen. Ein zweiter Faktor ist es nicht: Der Code geht an dieselbe Adresse wie „Passwort vergessen“.',
  },
  'set.loginCodeAsk': {
    en: 'Ask for a code from a new browser',
    de: 'Bei einem neuen Browser nach einem Code fragen',
  },
  'set.loginCodeWhat': {
    en: 'Signing in from a browser we have not seen before then needs a six-digit code from your email. Known browsers are not asked again.',
    de: 'Eine Anmeldung aus einem Browser, den wir noch nicht kennen, braucht dann sechs Ziffern aus deiner E-Mail. Bekannte Browser werden nicht noch einmal gefragt.',
  },
  'set.loginCodeOffAsk': {
    en: 'Turn the sign-in code off? From then on the password alone is enough to get into this account, from any device.',
    de: 'Den Anmeldecode abschalten? Ab dann genügt das Passwort allein, um von jedem Gerät in dieses Konto zu kommen.',
  },
  'set.loginCodeNoMail': {
    en: 'This panel has no outgoing mail set up, so no code can be sent. The switch takes effect as soon as it is.',
    de: 'Auf diesem Panel ist kein Postausgang eingerichtet, es kann also kein Code verschickt werden. Der Schalter wirkt, sobald es einen gibt.',
  },
  // Zwei-Faktor-Anmeldung. Die Texte grenzen sie ausdrücklich vom Anmeldecode darüber ab: Beide
  // fragen sechs Ziffern ab, und wer den Unterschied nicht kennt, hält das eine für das andere.
  'adm.totpOn': { en: 'two-factor', de: 'Zwei-Faktor' },
  'set.totp': { en: 'Two-factor sign-in', de: 'Zwei-Faktor-Anmeldung' },
  'set.totpSub': {
    en: 'A code from an app on your phone, on top of the password.',
    de: 'Ein Code aus einer App auf deinem Telefon, zusätzlich zum Passwort.',
  },
  'set.totpWhat': {
    en: 'Every sign-in then needs a six-digit code from your authenticator app – and so does resetting the password. Unlike the sign-in code above, it does not travel through your mailbox: whoever gets into your email still does not get into this account.',
    de: 'Jede Anmeldung braucht dann einen sechsstelligen Code aus deiner Authenticator-App – und das Zurücksetzen des Passworts ebenso. Anders als der Anmeldecode darüber geht er nicht durch dein Postfach: Wer in deine E-Mails kommt, kommt damit noch lange nicht in dieses Konto.',
  },
  'set.totpStart': { en: 'Set up', de: 'Einrichten' },
  'set.totpPasswordWhy': {
    en: 'Your password once more – switching this on is not something a borrowed session should be able to do.',
    de: 'Noch einmal dein Passwort – das Einschalten soll nichts sein, was eine geliehene Sitzung nebenbei erledigt.',
  },
  'set.totpScan': {
    en: 'Scan this with your authenticator app – Google Authenticator, Aegis, 1Password, whichever you use.',
    de: 'Scanne das mit deiner Authenticator-App – Google Authenticator, Aegis, 1Password, was du eben benutzt.',
  },
  'set.totpSecret': { en: 'Or enter this by hand', de: 'Oder von Hand eintragen' },
  'set.totpSecretHint': {
    en: 'For when the app runs on the same device as this panel and there is no camera to point.',
    de: 'Für den Fall, dass die App auf demselben Gerät läuft wie dieses Panel und es nichts abzufotografieren gibt.',
  },
  'set.totpFirstCode': { en: 'The code the app shows now', de: 'Der Code, den die App jetzt zeigt' },
  'set.totpTurnOn': { en: 'Switch on', de: 'Einschalten' },
  'set.totpOnNow': { en: 'Two-factor sign-in is on.', de: 'Die Zwei-Faktor-Anmeldung ist an.' },
  'set.totpOnSince': { en: 'Switched on since {when}.', de: 'Eingeschaltet seit {when}.' },
  'set.totpRecoveryTitle': { en: 'Your recovery codes', de: 'Deine Wiederherstellungscodes' },
  'set.totpRecoveryWhat': {
    en: 'These are shown once. Keep them somewhere that is not your phone – they are the way back into this account if the phone is gone. Each one works exactly once.',
    de: 'Diese Liste gibt es genau einmal. Bewahre sie irgendwo auf, das nicht dein Telefon ist – sie ist der Weg zurück ins Konto, wenn das Telefon weg ist. Jeder Code gilt genau einmal.',
  },
  'set.totpRecoverySave': { en: 'Download', de: 'Herunterladen' },
  'set.totpRecoveryFile': {
    en: 'AFKSystems recovery codes. Each one works once.',
    de: 'AFKSystems-Wiederherstellungscodes. Jeder gilt einmal.',
  },
  'set.totpRecoveryAck': {
    en: 'I have saved these codes somewhere safe.',
    de: 'Ich habe diese Codes sicher gespeichert.',
  },
  'set.totpRecoveryLeft': {
    en: '{n} of {total} recovery codes are still unused.',
    de: '{n} von {total} Wiederherstellungscodes sind noch unbenutzt.',
  },
  'set.totpRecoveryUsed': {
    en: 'You signed in with a recovery code. {n} are left.',
    de: 'Du hast dich mit einem Wiederherstellungscode angemeldet. Es sind noch {n} übrig.',
  },
  'set.totpNewCodes': { en: 'New recovery codes', de: 'Neue Wiederherstellungscodes' },
  'set.totpNewCodesWhat': {
    en: 'The old ones stop working right away, including the ones you never used.',
    de: 'Die alten gelten ab sofort nicht mehr – auch die, die du nie benutzt hast.',
  },
  'set.totpOff': { en: 'Switch off', de: 'Abschalten' },
  'set.totpOffWhat': {
    en: 'Afterwards the password alone gets into this account again. Your {n} remaining recovery codes are deleted with it.',
    de: 'Danach kommt das Passwort allein wieder in dieses Konto. Deine {n} übrigen Wiederherstellungscodes werden mit gelöscht.',
  },
  'set.totpOffNow': { en: 'Two-factor sign-in is off.', de: 'Die Zwei-Faktor-Anmeldung ist aus.' },

  'set.loginCodeSuperseded': {
    en: 'Two-factor sign-in is on, so this code is not asked for any more – the app code already covers what it does. The setting stays here for the day you switch two-factor off again.',
    de: 'Die Zwei-Faktor-Anmeldung ist an, deshalb wird dieser Code nicht mehr abgefragt – der Code aus der App leistet dasselbe und mehr. Die Einstellung bleibt für den Tag stehen, an dem die Zwei-Faktor-Anmeldung wieder ausgeht.',
  },

  'set.devices': { en: 'Known browsers', de: 'Bekannte Browser' },
  'set.devicesSub': {
    en: 'These get in without a code. Signing out does not remove one – forgetting it does.',
    de: 'Diese kommen ohne Code herein. Abmelden entfernt keinen davon – vergessen schon.',
  },
  'set.deviceCurrent': { en: 'this browser', de: 'dieser Browser' },
  // Wenn sich aus der Browserkennung nichts herauslesen lässt. Hier stand `common.none` – und
  // das heißt "Noch nichts.": In einer Liste, die gerade einen Eintrag zeigt, ist das nicht nur
  // der falsche Satz, sondern das Gegenteil dessen, was dasteht.
  'set.deviceUnknown': { en: 'Unknown device', de: 'Unbekanntes Gerät' },
  'set.deviceLastSeen': { en: 'last here {when}', de: 'zuletzt hier {when}' },
  'set.deviceForget': { en: 'Forget', de: 'Vergessen' },
  'set.deviceForgotten': {
    en: 'Forgotten. The next sign-in from it needs a code.',
    de: 'Vergessen. Die nächste Anmeldung von dort braucht einen Code.',
  },
  'set.devicesForgetAll': { en: 'Forget all others', de: 'Alle anderen vergessen' },
  'set.devicesForgetAllAsk': {
    en: 'Forget every browser except this one? Each of them needs a code again on the next sign-in.',
    de: 'Jeden Browser außer diesem vergessen? Jeder von ihnen braucht bei der nächsten Anmeldung wieder einen Code.',
  },
  'common.disable': { en: 'Turn off', de: 'Abschalten' },

  // ---------------------------------------------------------------- Eigene Daten
  'set.dataTitle': { en: 'Your data', de: 'Deine Daten' },
  'set.dataSub': {
    en: 'Everything this panel knows about you – to take with you, or to get rid of.',
    de: 'Alles, was dieses Panel über dich weiß – zum Mitnehmen oder zum Loswerden.',
  },
  'set.export': { en: 'Download my data', de: 'Meine Daten herunterladen' },
  'set.exportWhat': {
    en: 'One file with your account, server slots, Minecraft accounts, bookings, top-ups, tickets and messages. Readable JSON, nothing left out.',
    de: 'Eine Datei mit Konto, Serverplätzen, Minecraft-Konten, Buchungen, Aufladungen, Tickets und Nachrichten. Lesbares JSON, ohne Auslassungen.',
  },
  'set.deleteTitle': { en: 'Delete account', de: 'Konto löschen' },
  'set.deleteWhat': {
    en: 'Server slots, Minecraft accounts, tickets and any remaining credits go with it. We keep the deletion on hold for {days} days – one click brings everything back.',
    de: 'Serverplätze, Minecraft-Konten, Tickets und übriges Guthaben gehen mit. Wir halten die Löschung {days} Tage zurück – ein Klick holt alles zurück.',
  },
  'set.deleteAsk': { en: 'Delete this account', de: 'Dieses Konto löschen' },
  'set.deleteConfirmWord': { en: 'DELETE', de: 'LÖSCHEN' },
  'set.deleteConfirmHint': {
    en: 'Type {word} to confirm.',
    de: 'Tippe {word}, um zu bestätigen.',
  },
  'set.deleteCredits': {
    en: 'There are still {credits} credits on this account. They will not be paid out.',
    de: 'Auf diesem Konto liegen noch {credits} Credits. Sie werden nicht ausgezahlt.',
  },
  'set.deletePending': {
    en: 'This account will be deleted on {date}. Until then nothing is lost and the bots stay off.',
    de: 'Dieses Konto wird am {date} gelöscht. Bis dahin ist nichts verloren, und die Bots bleiben aus.',
  },
  'set.deleteCancel': { en: 'Keep my account', de: 'Konto behalten' },
  'set.deleteCancelled': { en: 'Your account stays.', de: 'Dein Konto bleibt.' },
  'set.deleteScheduled': {
    en: 'Noted. Everything stays until {date}.',
    de: 'Notiert. Bis zum {date} bleibt alles stehen.',
  },
  'set.deleteAdmin': {
    en: 'An administrator cannot delete their own account here – someone has to stay who can let others in.',
    de: 'Ein Administrator kann sein eigenes Konto hier nicht löschen – jemand muss bleiben, der andere hereinlässt.',
  },

  // ---------------------------------------------------------------- Persönliche Serveransicht
  'srv.favorite': { en: 'Favourite server', de: 'Favorisierter Server' },
  'srv.favoriteAdd': { en: 'Add to favourites', de: 'Zu Favoriten hinzufügen' },
  'srv.favoriteRemove': { en: 'Remove from favourites', de: 'Aus Favoriten entfernen' },
  'srv.search': { en: 'Search servers', de: 'Server durchsuchen' },
  'srv.filter.all': { en: 'All servers', de: 'Alle Server' },
  'srv.filter.online': { en: 'Running', de: 'Läuft' },
  'srv.filter.attention': { en: 'Needs attention', de: 'Braucht Hilfe' },
  'srv.view.cards': { en: 'Card view', de: 'Kartenansicht' },
  'srv.view.list': { en: 'List view', de: 'Listenansicht' },
  'srv.noMatches': { en: 'No server matches these filters.', de: 'Kein Server passt zu diesen Filtern.' },

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
  // Eine Erwähnung aus Discord, zu der es keinen Namen (mehr) gibt: das Konto ist weg, der Kanal
  // gelöscht, oder die Nachricht kam an, bevor der Bot mitschickte, wer gemeint war.
  'tk.unknownMention': { en: 'unknown', de: 'unbekannt' },
  'tk.spoilerShow': { en: 'Spoiler – click to show', de: 'Spoiler – zum Anzeigen klicken' },
  'tk.addPerson': { en: 'Add someone', de: 'Jemanden dazuholen' },
  'tk.addNoneLeft': {
    en: 'Everyone who could be added is already on this ticket.',
    de: 'Alle, die dazukommen könnten, sind schon an diesem Ticket.',
  },
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
  'tk.loadOlder': { en: 'Load earlier messages', de: 'Ältere Nachrichten laden' },
  'tk.discordTitle': { en: 'Ask in Discord', de: 'Im Discord fragen' },
  'tk.discordText': {
    en: 'Other players are often faster than we are – and there is no waiting for a reply.',
    de: 'Andere Spieler sind oft schneller als wir – und du wartest auf keine Antwort.',
  },
  'tk.system': { en: 'System', de: 'System' },
  'tk.writeHint': { en: 'Enter sends, Shift+Enter is a new line.', de: 'Enter schickt ab, Shift+Enter macht eine neue Zeile.' },
  'tk.draftSaved': {
    en: '{n} characters · draft saved on this device',
    de: '{n} Zeichen · Entwurf auf diesem Gerät gespeichert',
  },
  'tk.priorityShort': { en: 'Priority', de: 'Dringlichkeit' },

  // ---------------------------------------------------------------- Zeilen im Verlauf
  //
  // Was ohne Zutun eines Menschen im Ticket steht: dazugeholt, wieder geöffnet, hochgestuft,
  // geschlossen, übernommen. In der Datenbank steht dazu ein englischer Satz – er geht so in den
  // Discord-Kanal und bleibt der Wortlaut des Vorgangs. Gezeigt wird hier die Sprache des Lesers.
  'tk.sys.added': { en: '{who} was added to the ticket.', de: '{who} wurde dazugeholt.' },
  'tk.sys.removed': { en: '{who} was removed from the ticket.', de: '{who} wurde entfernt.' },
  'tk.sys.reopened': {
    en: 'A new reply reopened the ticket.',
    de: 'Eine neue Antwort hat das Ticket wieder geöffnet.',
  },
  'tk.sys.priority': {
    en: 'Priority changed from {from} to {to}.',
    de: 'Dringlichkeit von {from} auf {to} geändert.',
  },
  'tk.sys.status.closed': { en: '{who} closed the ticket.', de: '{who} hat das Ticket geschlossen.' },
  'tk.sys.status.open': {
    en: '{who} set the ticket back to open.',
    de: '{who} hat das Ticket wieder auf offen gesetzt.',
  },
  'tk.sys.status.answered': {
    en: '{who} marked the ticket as answered.',
    de: '{who} hat das Ticket als beantwortet markiert.',
  },
  'tk.sys.took': { en: '{who} took the ticket.', de: '{who} hat das Ticket übernommen.' },
  'tk.sys.assigned': { en: '{by} assigned the ticket to {who}.', de: '{by} hat das Ticket an {who} gegeben.' },
  'tk.sys.unassigned': { en: '{by} removed the assignment.', de: '{by} hat die Zuweisung aufgehoben.' },

  // ---------------------------------------------------------------- Lesebestätigungen
  //
  // Ein Haken heißt zugestellt, zwei heißen gelesen. Der Text daneben sagt dasselbe in Worten:
  // Ein Symbol allein ist für jeden unlesbar, der es nicht sieht.
  'tk.delivered': { en: 'Delivered', de: 'Zugestellt' },
  'tk.seenBySupport': { en: 'Read by support · {time}', de: 'Vom Support gelesen · {time}' },
  'tk.seenBy': { en: 'Read by {who}', de: 'Gelesen von {who}' },
  'tk.seenShort': { en: 'The customer has read this', de: 'Der Kunde hat das gelesen' },
  'tk.notSeenYet': { en: 'Not read yet', de: 'Noch nicht gelesen' },
  'tk.stillOpenFor': { en: 'not yet: {who}', de: 'noch nicht: {who}' },
  'tk.readTitle': { en: 'Read receipts', de: 'Gelesen' },
  'tk.neverOpened': { en: 'never opened', de: 'nie geöffnet' },
  'tk.newSince': { en: 'New since your last visit', de: 'Neu seit deinem letzten Besuch' },

  // ---------------------------------------------------------------- Kennzahlen am Ticket
  'tk.firstReply': { en: 'First reply after', de: 'Erste Antwort nach' },
  'tk.noReplyYet': { en: 'no reply yet', de: 'noch keine Antwort' },
  'tk.lastActivity': { en: 'Last activity', de: 'Letzte Bewegung' },
  'tk.waitingSince': { en: 'Waiting for us since', de: 'Wartet auf uns seit' },
  'tk.closedAt': { en: 'Closed', de: 'Geschlossen' },
  'tk.reopenedTimes': { en: 'Reopened', de: 'Wieder geöffnet' },
  'tk.neverAnswered': { en: 'Never answered', de: 'Nie beantwortet' },
  'tk.onlySubjectShort': { en: 'Subject only', de: 'Nur ein Betreff' },
  'tk.customer': { en: 'Customer', de: 'Kunde' },
  'tk.takeIt': { en: 'Take this ticket', de: 'Ticket übernehmen' },
  'tk.assignedToYou': { en: 'Assigned to you', de: 'Dir zugewiesen' },

  // Der Kunde neben dem Gespräch – wen man vor sich hat, bevor man antwortet.
  'tk.ctxSince': { en: 'Customer since', de: 'Kunde seit' },
  'tk.ctxCredits': { en: 'Credits', de: 'Guthaben' },
  'tk.ctxTickets': { en: 'Tickets so far', de: 'Tickets bisher' },
  'tk.ctxOpenOf': { en: '({n} open)', de: '({n} offen)' },
  'tk.ctxSlots': { en: 'Server slots', de: 'Serverplätze' },
  'tk.ctxLastTopup': { en: 'Last top-up', de: 'Letzte Aufladung' },
  'tk.ctxLocalTime': { en: 'Local time', de: 'Ortszeit' },
  'tk.mailUnverified': { en: 'Email unconfirmed', de: 'E-Mail unbestätigt' },

  // ---------------------------------------------------------------- Die Warteschlange des Teams
  'tk.tileWaiting': { en: 'Waiting for us', de: 'Wartet auf uns' },
  'tk.tileUnanswered': { en: 'Never answered', de: 'Nie beantwortet' },
  'tk.tileStale': { en: 'Quiet over 24 h', de: 'Über 24 h still' },
  'tk.tileUrgent': { en: 'High or urgent', de: 'Hoch oder dringend' },
  'tk.tileUnassigned': { en: 'Not assigned', de: 'Nicht zugewiesen' },
  'tk.tileMine': { en: 'Yours', de: 'Deine' },
  'tk.tileFirstReply': { en: 'First reply (30 d median)', de: 'Erste Antwort (Median 30 T)' },
  'tk.unansweredOnly': { en: 'Never answered', de: 'Nie beantwortet' },
  'tk.sort.queue': { en: 'Queue order', de: 'Warteschlange' },
  'tk.sort.waiting': { en: 'Longest waiting first', de: 'Längste Wartezeit zuerst' },
  'tk.sort.newest': { en: 'Newest first', de: 'Neueste zuerst' },
  'tk.sort.priority': { en: 'By priority', de: 'Nach Dringlichkeit' },
  'tk.noneHere': {
    en: 'Nothing matches these filters.',
    de: 'Zu diesen Filtern steht nichts an.',
  },
  'tk.selectAll': { en: 'Select all {n}', de: 'Alle {n} auswählen' },
  'tk.pickOne': { en: 'Select ticket #{id}', de: 'Ticket #{id} auswählen' },
  'tk.picked': { en: '{n} selected', de: '{n} ausgewählt' },
  'tk.bulkTakeIt': { en: 'Assign to me', de: 'Mir zuweisen' },
  'tk.bulkUnassign': { en: 'Unassign', de: 'Zuweisung aufheben' },
  'tk.bulkUrgent': { en: 'Mark urgent', de: 'Auf dringend' },
  'tk.bulkClose': { en: 'Close', de: 'Schließen' },
  'tk.bulkCloseAsk': {
    en: 'Close {n} tickets? Everyone on them gets a notification.',
    de: '{n} Tickets schließen? Alle Beteiligten bekommen eine Nachricht.',
  },
  'tk.bulkDone': { en: '{n} tickets updated.', de: '{n} Tickets geändert.' },

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

  // ---------------------------------------------------------------- Belege
  'bill.receipts': { en: 'Receipts', de: 'Belege' },
  'bill.receiptsSub': {
    en: 'One per payment, with a number that never changes.',
    de: 'Einer je Zahlung, mit einer Nummer, die sich nie wieder ändert.',
  },
  'bill.receiptNo': { en: 'Number', de: 'Nummer' },
  'bill.amount': { en: 'Amount', de: 'Betrag' },
  'bill.receiptOpen': { en: 'Open receipt', de: 'Beleg öffnen' },
  'bill.receiptPrint': { en: 'Print or save as PDF', de: 'Drucken oder als PDF sichern' },
  'bill.receiptDownload': { en: 'Download receipt', de: 'Beleg herunterladen' },
  'bill.receiptSearch': { en: 'Search receipt number', de: 'Belegnummer suchen' },
  'bill.receiptFilter.all': { en: 'All receipts', de: 'Alle Belege' },
  'bill.receiptFilter.paid': { en: 'Paid', de: 'Bezahlt' },
  'bill.receiptFilter.refunded': { en: 'Refunded', de: 'Erstattet' },
  'bill.noReceiptMatches': { en: 'No receipt matches this filter.', de: 'Kein Beleg passt zu diesem Filter.' },

  // ---------------------------------------------------------------- Admin (neu)
  // ---------------------------------------------------------------- Textbausteine und Rundmail
  'adm.templates': { en: 'Canned replies', de: 'Textbausteine' },
  'tmpl.lead': {
    en: 'Ready-to-send replies in German and English. In a ticket, one click sends the customer\'s language.',
    de: 'Versandfertige Antworten auf Deutsch und Englisch. Im Ticket verschickt ein Klick die Sprache des Kunden.',
  },
  'tmpl.titleDe': { en: 'Subject (German)', de: 'Titel (deutsch)' },
  'tmpl.titleEn': { en: 'Subject (English)', de: 'Titel (englisch)' },
  'tmpl.bodyDe': { en: 'Text (German)', de: 'Text (deutsch)' },
  'tmpl.bodyEn': { en: 'Text (English)', de: 'Text (englisch)' },
  'tmpl.uses': { en: 'Used', de: 'Benutzt' },
  'tmpl.category': { en: 'Area', de: 'Bereich' },
  'tmpl.placeholders': {
    en: '{name}, {ticket} and {subject} are filled in when the text is inserted.',
    de: '{name}, {ticket} und {subject} werden beim Einfügen ersetzt.',
  },
  'tmpl.insert': { en: 'Canned reply', de: 'Textbaustein' },
  'tmpl.insertHint': {
    en: 'The customer language is selected automatically and the reply is sent with one click.',
    de: 'Die Kundensprache wird automatisch gewählt und die Antwort mit einem Klick verschickt.',
  },
  'tmpl.none': { en: 'No canned replies yet.', de: 'Noch keine Textbausteine.' },
  'tmpl.sent': { en: 'Canned reply sent.', de: 'Schnellantwort gesendet.' },

  'bc.title': { en: 'Round mail', de: 'Rundmail' },
  'bc.lead': {
    en: 'One message to a chosen group. Whoever unsubscribed from announcements does not get it – that is the point, not a limitation.',
    de: 'Eine Nachricht an einen ausgewählten Kreis. Wer Ankündigungen abbestellt hat, bekommt sie nicht – das ist der Sinn und keine Einschränkung.',
  },
  'bc.segment': { en: 'Recipients', de: 'Empfängerkreis' },
  'bc.send': { en: 'Send', de: 'Verschicken' },
  'bc.bothLangs': {
    en: 'Everyone gets it in their own language. Leave the English fields empty to use the German text for both.',
    de: 'Jeder bekommt sie in seiner Sprache. Bleiben die englischen Felder leer, gilt der deutsche Text für beide.',
  },
  'bc.ask': { en: 'Send to: {who}?', de: 'An {who} verschicken?' },
  'bc.done': { en: 'Sent {sent}, skipped {skipped}.', de: '{sent} verschickt, {skipped} übersprungen.' },
  'bc.tested': { en: 'Test message is on its way to you.', de: 'Die Probe ist zu dir unterwegs.' },

  // ---------------------------------------------------------------- Betrieb
  'adm.ops': { en: 'Operations', de: 'Betrieb' },
  'ops.running': { en: 'Bots running', de: 'Laufende Bots' },
  'ops.runningFoot': { en: '{n} online in the game', de: '{n} im Spiel online' },
  'ops.nodesFoot': { en: 'of {n} locations', de: 'von {n} Standorten' },
  'ops.slots': { en: 'Server slots busy', de: 'Belegte Serverplätze' },
  'ops.slotsFoot': { en: 'with at least one bot', de: 'mit mindestens einem Bot' },
  'ops.errors': { en: 'With an error', de: 'Mit einem Fehler' },
  'ops.errorsFoot': { en: 'last message of the client', de: 'letzte Meldung des Clients' },
  'ops.uptime': { en: 'Up for', de: 'Läuft seit' },
  'ops.node': { en: 'Location', de: 'Standort' },
  'ops.here': { en: 'this machine', de: 'diese Maschine' },
  'ops.onlyRunning': { en: 'Only what is running', de: 'Nur was läuft' },
  'ops.jobs': { en: 'Recurring jobs', de: 'Wiederkehrende Aufgaben' },
  'ops.every': { en: 'Every', de: 'Alle' },
  'ops.last': { en: 'Last run', de: 'Zuletzt' },
  'ops.took': { en: 'Took', de: 'Dauer' },
  'ops.never': { en: 'not since the start', de: 'seit dem Start nicht' },
  'ops.runNow': { en: 'Run now', de: 'Jetzt laufen' },
  'ops.ranIn': { en: 'Done in {ms} ms.', de: 'In {ms} ms erledigt.' },
  'ops.seconds': { en: '{n} s', de: '{n} s' },
  'ops.minutes': { en: '{n} min', de: '{n} min' },
  'ops.hours': { en: '{n} h', de: '{n} h' },
  'ops.attention': { en: 'Needs attention', de: 'Braucht Aufmerksamkeit' },
  'ops.attentionNone': { en: 'No current operational warning needs an action.', de: 'Aktuell verlangt keine Betriebswarnung eine Aktion.' },
  'ops.alert.nodeOffline': { en: 'Location “{name}” is offline', de: 'Standort „{name}“ ist nicht erreichbar' },
  'ops.alert.nodeFull': { en: 'Location “{name}” has reached a limit', de: 'Standort „{name}“ hat eine Grenze erreicht' },
  'ops.alert.clientError': { en: 'Client release is not ready', de: 'Die Client-Fassung ist nicht bereit' },
  'ops.alert.clientOutdated': { en: '{n} running bot(s) use an older client', de: '{n} laufende Bot(s) nutzen einen älteren Client' },
  'ops.alert.jobFailed': { en: 'Background job “{name}” failed', de: 'Hintergrundjob „{name}“ ist fehlgeschlagen' },
  'ops.alert.proxyUnused': { en: 'Assigned proxy “{name}” is unused', de: 'Zugewiesener Proxy „{name}“ wird nicht genutzt' },
  'ops.alert.nodeHint': { en: 'Check connection and agent status.', de: 'Verbindung und Agent-Status prüfen.' },
  'ops.alert.nodeFullHint': { en: 'Review capacity before assigning more server slots.', de: 'Vor weiteren Serverplätzen die Kapazität prüfen.' },
  'ops.alert.clientHint': { en: 'Open client management for the exact release state.', de: 'In der Client-Verwaltung den genauen Release-Stand prüfen.' },
  'ops.alert.clientOutdatedHint': { en: 'Review the rollout before restarting affected bots.', de: 'Vor Neustarts den Rollout prüfen.' },
  'ops.alert.jobHint': { en: 'Open Operations to inspect and retry the job.', de: 'Im Betrieb prüfen und den Job gezielt erneut starten.' },
  'ops.alert.proxyHint': { en: 'Review the assignment; no account currently uses it.', de: 'Zuordnung prüfen; aktuell nutzt kein Konto ihn.' },
  'adm.accountQueue': { en: '{n} account(s) need a login review', de: '{n} Konto/Konten brauchen eine Anmeldeprüfung' },
  'adm.accountQueueHint': {
    en: 'Open the owner or affected server slot to coordinate a new login. This list never reconnects accounts or moves bots automatically.',
    de: 'Öffne Eigentümer oder betroffenen Serverplatz, um eine neue Anmeldung abzustimmen. Diese Liste verbindet keine Konten neu und verschiebt keine Bots automatisch.',
  },
  'adm.accountQueueNone': { en: 'No active Minecraft account currently reports a login error.', de: 'Kein aktives Minecraft-Konto meldet aktuell einen Anmeldefehler.' },
  'adm.openOwner': { en: 'Open owner', de: 'Eigentümer öffnen' },
  'adm.accountFilterAll': { en: 'All accounts', de: 'Alle Konten' },
  'adm.accountFilterLogin': { en: 'Needs login review', de: 'Anmeldung prüfen' },
  'adm.accountFilterRunning': { en: 'Running now', de: 'Läuft gerade' },
  'adm.accountFilterCount': { en: '{n} shown', de: '{n} angezeigt' },

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
  'sec.codeOk': { en: 'code accepted', de: 'Code angenommen' },
  'sec.codeWrong': { en: 'wrong code', de: 'falscher Code' },
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
  'adm.announceLink': { en: 'Link (optional)', de: 'Link (optional)' },
  'adm.refund': { en: 'Refund', de: 'Erstatten' },
  'adm.refundAmount': { en: 'Amount in cents (0 = all of it)', de: 'Betrag in Cent (0 = alles)' },
  'adm.refundHint': { en: 'The whole payment is {full}.', de: 'Die ganze Zahlung sind {full}.' },
  'adm.refundAsked': { en: 'Customer asked for it', de: 'Kunde hat darum gebeten' },
  'adm.refundDouble': { en: 'Paid twice', de: 'Doppelt bezahlt' },
  'adm.refundFraud': { en: 'Fraud', de: 'Betrug' },
  'adm.refundDone': {
    en: 'Stripe is refunding. The credits come back as soon as Stripe reports it.',
    de: 'Stripe erstattet. Die Credits kommen zurück, sobald Stripe es meldet.',
  },
  'adm.refundPartial': {
    en: 'Stripe is refunding part of it. A partial refund takes no credits back – that stays your decision.',
    de: 'Stripe erstattet einen Teil. Eine Teilerstattung nimmt keine Credits zurück – das bleibt deine Entscheidung.',
  },
  'adm.noMail': {
    en: 'No SMTP server is set up – nothing can go out.',
    de: 'Es ist kein SMTP-Server hinterlegt – es kann nichts hinausgehen.',
  },
  'adm.cpu': { en: 'CPU', de: 'CPU' },
  'adm.ram': { en: 'Memory', de: 'Arbeitsspeicher' },
  'adm.disk': { en: 'Disk', de: 'Festplatte' },
  'adm.machine': { en: 'Machine', de: 'Maschine' },
  'adm.leavingOn': {
    en: 'This account is scheduled for deletion on {date}.',
    de: 'Dieses Konto wird am {date} gelöscht.',
  },

  // ---------------------------------------------------------------- Systemmeldungen
  'adm.systemHook': { en: 'System messages', de: 'Systemmeldungen' },
  'adm.systemHookWhat': {
    en: 'The state of the machine as a Discord message: load, locations, backups, failed tasks and payments that do not add up. No tickets – those live in the panel and in their own channel.',
    de: 'Der Zustand der Anlage als Discord-Nachricht: Auslastung, Standorte, Sicherungen, gescheiterte Aufgaben und Zahlungen, die nicht zusammenpassen. Keine Tickets – die stehen im Panel und in ihrem eigenen Kanal.',
  },
  'adm.systemHookEvery': { en: 'Full report', de: 'Vollständiger Bericht' },
  'adm.systemHookHours': { en: 'every {n} h', de: 'alle {n} h' },
  'adm.systemHookAlertsOnly': { en: 'alerts only', de: 'nur Warnungen' },
  'adm.systemHookMissing': {
    en: 'No webhook is set – alerts stay in here.',
    de: 'Es ist kein Webhook hinterlegt – Warnungen bleiben hier stehen.',
  },
  'adm.systemAlerts': { en: 'What stands out right now', de: 'Was gerade auffällt' },
  'adm.systemAlertsNone': { en: 'Nothing. Everything is within its limits.', de: 'Nichts. Alles im Rahmen.' },
  'adm.systemSendNow': { en: 'Send report now', de: 'Bericht jetzt schicken' },
  'adm.systemSent': { en: 'Report sent.', de: 'Bericht ist raus.' },
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

  // ------------------------------------------------ Die Kundenseite der Verwaltung
  //
  // Alles hier beantwortet eine Frage, die im Support tatsächlich gestellt wird – und die vorher
  // nur mit einem Griff in die Datenbank zu beantworten war.
  'adm.access': { en: 'Access to this account', de: 'Zugang zu diesem Konto' },
  'adm.accessSub': {
    en: 'Second factor, open devices and the last attempts – side by side, because only the comparison answers the question.',
    de: 'Zweiter Faktor, offene Geräte und die letzten Versuche – nebeneinander, weil erst der Vergleich die Frage beantwortet.',
  },
  'adm.sessions': { en: 'Signed-in devices', de: 'Angemeldete Geräte' },
  'adm.sessionsSub': {
    en: 'Where this account is open right now.',
    de: 'Wo dieses Konto gerade offen ist.',
  },
  'adm.sessionEnd': { en: 'Sign out', de: 'Abmelden' },
  'adm.sessionEndAsk': {
    en: 'Sign this device out? The other devices of this account stay signed in.',
    de: 'Dieses Gerät abmelden? Die übrigen Geräte dieses Kontos bleiben angemeldet.',
  },
  'adm.signIns': { en: 'Sign-in attempts', de: 'Anmeldeversuche' },
  'adm.signInsSub': {
    en: 'The answer to “I cannot get in”: whether the attempts arrive at all, and what they fail on.',
    de: 'Die Antwort auf „ich komme nicht hinein“: ob die Versuche überhaupt ankommen und woran sie scheitern.',
  },
  'adm.totp': { en: 'Two-factor sign-in', de: 'Zwei-Faktor-Anmeldung' },
  'adm.totpSince': { en: 'Set up {when}', de: 'Eingerichtet {when}' },
  'adm.totpRecovery': {
    en: '{left} of {total} recovery codes left',
    de: 'Noch {left} von {total} Wiederherstellungscodes',
  },
  'adm.totpOff': { en: 'This account has no second factor.', de: 'Dieses Konto hat keinen zweiten Faktor.' },
  'adm.totpReset': { en: 'Remove second factor', de: 'Zweiten Faktor abnehmen' },
  'adm.totpResetAsk': {
    en: 'Remove the second factor from this account? The password alone gets in afterwards, the customer is told by email, and the step is logged.',
    de: 'Den zweiten Faktor dieses Kontos abnehmen? Danach genügt das Passwort allein, der Kunde bekommt eine E-Mail, und der Vorgang steht im Protokoll.',
  },
  'adm.userMails': { en: 'Mail to this account', de: 'Post an dieses Konto' },
  'adm.userAudit': { en: 'Recent entries in the log', de: 'Letzte Einträge im Protokoll' },
  'adm.auditAll': { en: 'Show the whole log', de: 'Ganzes Protokoll' },
  'adm.cancelDeletion': { en: 'Take back the deletion', de: 'Löschung zurücknehmen' },
  'adm.cancelDeletionAsk': {
    en: 'Take the scheduled deletion back? Everything stays as it is and the bots come back on their own.',
    de: 'Die angemeldete Löschung zurücknehmen? Es bleibt alles stehen, und die Bots kommen von selbst wieder.',
  },

  // ------------------------------------------------ Die Serverplatzseite der Verwaltung
  'adm.botStart': { en: 'Start this bot', de: 'Diesen Bot starten' },
  'adm.botStop': { en: 'Stop this bot', de: 'Diesen Bot stoppen' },
  'adm.botRestart': { en: 'Restart this bot', de: 'Diesen Bot neu starten' },
  'adm.clientRunning': { en: 'Client {version}', de: 'Client {version}' },
  'adm.clientOutdated': {
    en: 'Older file – {version} is on disk',
    de: 'Ältere Datei – auf der Platte liegt {version}',
  },
  'adm.rolloutHere': { en: 'Move these bots to the new client', de: 'Diese Bots auf den neuen Client heben' },
  'adm.rolloutHereAsk': {
    en: '{n} bot(s) on this slot still run an older client file. Restart them one after another? Each one leaves the game for a moment.',
    de: '{n} Bot(s) dieses Platzes laufen noch mit einer älteren Client-Datei. Nacheinander neu starten? Jeder ist dabei kurz aus dem Spiel.',
  },
  'adm.rolloutDone': { en: '{n} bot(s) are restarting.', de: '{n} Bot(s) starten neu.' },
  'adm.sendTo': { en: 'To', de: 'An' },
  'adm.sendAll': { en: 'every account', de: 'alle Konten' },
  'adm.connection': { en: 'Connection', de: 'Verbindung' },
  'adm.connectionSub': { en: 'also while suspended', de: 'auch im gesperrten Zustand' },
  'adm.connectionRestart': {
    en: 'Running bots keep the old address until they restart.',
    de: 'Laufende Bots behalten die alte Adresse, bis sie neu starten.',
  },
  'adm.proxyDirect': { en: 'no own proxy – over the location', de: 'kein eigener Proxy – über den Standort' },
  'adm.retryIn': { en: 'retry {n} in {sec}s', de: 'Versuch {n} in {sec}s' },

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

  'offline.title': { en: 'No connection', de: 'Keine Verbindung' },
  'offline.body': {
    en: 'The panel needs a connection to show live data. Try again once you are back online.',
    de: 'Das Panel braucht eine Verbindung, um Live-Daten zu zeigen. Versuch es erneut, sobald du wieder online bist.',
  },
  'offline.retry': { en: 'Try again', de: 'Erneut versuchen' },
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
