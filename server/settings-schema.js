// Was in den Einstellungen steht – und was es bedeutet.
//
// Diese Datei ist die einzige Beschreibung der Einstellungen: Gruppe, Beschriftung, Erklärung,
// Art des Feldes. Der Admin-Bereich baut daraus sein Formular, und dieselbe Beschreibung prüft
// beim Speichern, was hereinkommt. Vorher stand beides an zwei Stellen – eine Liste im Frontend
// mit den Schlüsselnamen als Beschriftung ("smtp_pass" als Überschrift), und eine Menge Namen im
// Backend, die niemand mit der ersten abgeglichen hat.
//
// `secret: true` heißt: der Wert verlässt den Server nie. Das Panel bekommt nur "gesetzt" oder
// "nicht gesetzt" und schickt beim Speichern entweder einen neuen Wert oder gar nichts.

export const GROUPS = [
  {
    key: 'money',
    icon: 'wallet',
    de: { title: 'Guthaben und Tarife', text: 'Was ein Konto geschenkt bekommt, ab wann gewarnt wird, wie viele Plätze gratis sind.' },
    en: { title: 'Credits and plans', text: 'What an account gets for free, when it is warned, how many slots are free.' },
  },
  {
    key: 'signup',
    icon: 'users',
    de: { title: 'Registrierung', text: 'Wer sich anmelden darf und was dabei verlangt wird.' },
    en: { title: 'Sign-up', text: 'Who may register and what is required.' },
  },
  {
    key: 'mail',
    icon: 'message',
    de: {
      title: 'E-Mail-Versand',
      text: 'Ohne SMTP verschickt AFKSystems keine Nachrichten: keine Bestätigung, kein "Passwort vergessen", keine Belege. Die Zugangsdaten stehen nur hier und werden nie zurück an den Browser geschickt.',
    },
    en: {
      title: 'Email delivery',
      text: 'Without SMTP no messages go out: no confirmations, no password resets, no receipts. The credentials live here only and are never sent back to the browser.',
    },
  },
  {
    key: 'mailkinds',
    icon: 'ticket',
    de: {
      title: 'Welche E-Mails es gibt',
      text: 'Hier schaltest du eine Sorte für alle ab. Was davon jemand persönlich bekommen will, stellt er selbst in seinen Einstellungen ein.',
    },
    en: {
      title: 'Which emails exist',
      text: 'Switch a kind off for everyone here. Which of them someone personally wants is their own setting.',
    },
  },
  {
    key: 'discord',
    icon: 'message',
    de: {
      title: 'Discord',
      text: 'Anmelden mit Discord, Meldungen ans Team und der Bot, der Tickets und Rollen abgleicht.',
    },
    en: {
      title: 'Discord',
      text: 'Signing in with Discord, notices to the team, and the bot that syncs tickets and roles.',
    },
  },
  {
    key: 'discordroles',
    icon: 'shield',
    de: {
      title: 'Discord-Rollen',
      text: 'Welche Rolle wer bekommt. Die IDs findest du in Discord mit Rechtsklick auf die Rolle → ID kopieren (Entwicklermodus muss an sein). Der Bot fasst ausschließlich diese Rollen an.',
    },
    en: {
      title: 'Discord roles',
      text: 'Who gets which role. Right-click a role in Discord → Copy ID (developer mode must be on). The bot only ever touches these roles.',
    },
  },
  {
    key: 'google',
    icon: 'globe',
    de: { title: 'Google', text: 'Anmelden und Verknüpfen über ein Google-Konto. Die Anleitung steht in docs/google-anmeldung.md.' },
    en: { title: 'Google', text: 'Signing in and linking with a Google account. The walkthrough is in docs/google-anmeldung.md.' },
  },
  {
    key: 'ops',
    icon: 'server',
    de: { title: 'Betrieb', text: 'Wartung, Grenzen und Erreichbarkeit.' },
    en: { title: 'Operations', text: 'Maintenance, limits and availability.' },
  },
  {
    key: 'legal',
    icon: 'info',
    de: {
      title: 'Rechtstexte',
      text: 'Impressum, Datenschutz und Nutzungsbedingungen. Leer heißt: die Seite sagt, dass der Text noch fehlt – sie ist dann trotzdem erreichbar.',
    },
    en: {
      title: 'Legal texts',
      text: 'Imprint, privacy and terms. Empty means the page says the text is still missing – it stays reachable either way.',
    },
  },
];

/**
 * Ein Eintrag:
 *   key      Schlüssel in der Tabelle `settings`
 *   group    zu welcher Gruppe er gehört
 *   type     number | switch | text | password | textarea | packages
 *   de/en    { label, help, placeholder }
 *   min/max  bei Zahlen
 *   secret   true = kommt nie im Klartext zurück
 */
export const SETTINGS = [
  // ---------------------------------------------------------------- Guthaben
  {
    key: 'free_slots',
    group: 'money',
    type: 'number',
    min: 0,
    max: 100,
    de: { label: 'Kostenlose Serverplätze je Konto', help: 'Wie viele Plätze jemand haben darf, ohne zu zahlen. 0 schaltet den Gratis-Platz ab.' },
    en: { label: 'Free server slots per account', help: 'How many slots someone may have without paying. 0 switches the free slot off.' },
  },
  {
    key: 'signup_bonus',
    group: 'money',
    type: 'number',
    min: 0,
    max: 100_000,
    de: { label: 'Startguthaben', help: 'Credits, die ein neues Konto geschenkt bekommt. 1 Credit = 1 Cent.' },
    en: { label: 'Sign-up bonus', help: 'Credits a new account starts with. 1 credit = 1 cent.' },
  },
  {
    key: 'low_balance',
    group: 'money',
    type: 'number',
    min: 0,
    max: 100_000,
    de: { label: 'Warnschwelle', help: 'Ab diesem Guthaben warnt das Panel und schickt eine Nachricht.' },
    en: { label: 'Low-balance warning', help: 'Below this balance the panel warns and sends a message.' },
  },
  {
    key: 'renew_warn_days',
    group: 'money',
    type: 'number',
    min: 1,
    max: 30,
    de: { label: 'Vorwarnzeit in Tagen', help: 'So viele Tage vor einer Verlängerung, für die das Guthaben nicht reicht, gibt es Bescheid.' },
    en: { label: 'Warning lead time in days', help: 'How many days before a renewal the balance cannot cover, a notice goes out.' },
  },
  {
    key: 'packages',
    group: 'money',
    type: 'packages',
    de: { label: 'Aufladepakete', help: 'Betrag in Cent, dafür so viele Credits. Alles über dem Betrag ist Bonus und wird auf der Preisseite als solcher ausgewiesen.' },
    en: { label: 'Top-up packages', help: 'Amount in cents, for that many credits. Anything above the amount is a bonus and is shown as one on the pricing page.' },
  },

  // ---------------------------------------------------------------- Registrierung
  {
    key: 'registration_open',
    group: 'signup',
    type: 'switch',
    de: { label: 'Registrierung offen', help: 'Aus heißt: niemand kann ein neues Konto anlegen. Bestehende Konten sind nicht betroffen.' },
    en: { label: 'Registration open', help: 'Off means nobody can create a new account. Existing accounts are unaffected.' },
  },
  {
    key: 'email_verify',
    group: 'signup',
    type: 'switch',
    needs: 'smtp_host',
    de: { label: 'E-Mail-Adresse bestätigen lassen', help: 'Neue Konten müssen erst auf einen Link klicken. Geht nur mit eingerichtetem SMTP.' },
    en: { label: 'Require email confirmation', help: 'New accounts have to click a link first. Needs SMTP set up.' },
  },
  {
    key: 'max_bots_per_user',
    group: 'signup',
    type: 'number',
    min: 1,
    max: 500,
    de: { label: 'Bots je Konto', help: 'Obergrenze über alle Serverplätze eines Kontos hinweg.' },
    en: { label: 'Bots per account', help: 'Upper limit across all server slots of one account.' },
  },

  // ---------------------------------------------------------------- SMTP
  {
    key: 'smtp_host',
    group: 'mail',
    type: 'text',
    de: { label: 'Server', help: 'Zum Beispiel smtp.eigene-domain.de.', placeholder: 'smtp.example.com' },
    en: { label: 'Host', help: 'For example smtp.your-domain.com.', placeholder: 'smtp.example.com' },
  },
  {
    key: 'smtp_port',
    group: 'mail',
    type: 'number',
    min: 1,
    max: 65535,
    de: { label: 'Port', help: '587 für STARTTLS, 465 für TLS ab dem ersten Byte.' },
    en: { label: 'Port', help: '587 for STARTTLS, 465 for TLS from the first byte.' },
  },
  {
    key: 'smtp_secure',
    group: 'mail',
    type: 'switch',
    de: { label: 'TLS ab Verbindungsaufbau', help: 'An bei Port 465, aus bei 587.' },
    en: { label: 'TLS from the start', help: 'On for port 465, off for 587.' },
  },
  {
    key: 'smtp_user',
    group: 'mail',
    type: 'text',
    de: { label: 'Benutzername', help: 'Meist die volle Adresse.' },
    en: { label: 'Username', help: 'Usually the full address.' },
  },
  {
    key: 'smtp_pass',
    group: 'mail',
    type: 'password',
    secret: true,
    de: {
      label: 'Passwort',
      help: 'Wird verdeckt eingegeben und nie wieder angezeigt – auch nicht dir. Leer lassen behält das gespeicherte.',
    },
    en: {
      label: 'Password',
      help: 'Entered masked and never shown again, not even to you. Leaving it empty keeps the stored one.',
    },
  },
  {
    key: 'smtp_from',
    group: 'mail',
    type: 'text',
    de: { label: 'Absenderadresse', help: 'Was im Postfach des Kunden als Absender steht.', placeholder: 'noreply@example.com' },
    en: { label: 'From address', help: 'What appears as the sender in the customer inbox.', placeholder: 'noreply@example.com' },
  },
  {
    key: 'smtp_from_name',
    group: 'mail',
    type: 'text',
    de: { label: 'Absendername', help: 'Ohne Angabe steht dort der Markenname.', placeholder: 'AFKSystems' },
    en: { label: 'From name', help: 'Without this the brand name is used.', placeholder: 'AFKSystems' },
  },

  // ---------------------------------------------------------------- Sorten
  {
    key: 'mail_security',
    group: 'mailkinds',
    type: 'switch',
    de: { label: 'Sicherheit', help: 'Anmeldung von einem neuen Gerät, geändertes Passwort, neue Verknüpfung. Kunden können diese Sorte nicht abbestellen.' },
    en: { label: 'Security', help: 'Sign-in from a new device, changed password, new link. Customers cannot opt out of these.' },
  },
  {
    key: 'mail_topup',
    group: 'mailkinds',
    type: 'switch',
    de: { label: 'Guthaben', help: 'Aufladung gutgeschrieben, Guthaben wird knapp.' },
    en: { label: 'Credits', help: 'Top-up credited, balance running low.' },
  },
  {
    key: 'mail_renewal',
    group: 'mailkinds',
    type: 'switch',
    de: { label: 'Serverplätze', help: 'Verlängerung, baldiges Ablaufen, Stilllegung.' },
    en: { label: 'Server slots', help: 'Renewal, expiring soon, suspension.' },
  },
  {
    key: 'mail_ticket',
    group: 'mailkinds',
    type: 'switch',
    de: { label: 'Support', help: 'Neues Ticket, Antwort, geschlossenes Ticket.' },
    en: { label: 'Support', help: 'New ticket, reply, closed ticket.' },
  },
  {
    key: 'mail_announcement',
    group: 'mailkinds',
    type: 'switch',
    de: { label: 'Ankündigungen', help: 'Erlaubt, eine Ankündigung als E-Mail an alle zu schicken.' },
    en: { label: 'Announcements', help: 'Allows sending an announcement to everyone as an email.' },
  },

  // ---------------------------------------------------------------- Discord
  {
    key: 'discord_client_id',
    group: 'discord',
    type: 'text',
    de: { label: 'Anwendungs-ID', help: 'Discord Developer Portal → Deine Anwendung → General Information → Application ID.' },
    en: { label: 'Application ID', help: 'Discord Developer Portal → your application → General Information → Application ID.' },
  },
  {
    key: 'discord_client_secret',
    group: 'discord',
    type: 'password',
    secret: true,
    de: { label: 'Client Secret', help: 'OAuth2 → Client Secret. Wird verdeckt eingegeben und nie wieder angezeigt.' },
    en: { label: 'Client secret', help: 'OAuth2 → Client Secret. Entered masked and never shown again.' },
  },
  {
    key: 'discord_login',
    group: 'discord',
    type: 'switch',
    needs: 'discord_client_id',
    de: { label: 'Anmelden mit Discord', help: 'Erlaubt Anmelden und Registrieren über Discord. Die E-Mail-Adresse kommt dabei von Discord.' },
    en: { label: 'Sign in with Discord', help: 'Allows signing in and registering through Discord. The email address comes from Discord.' },
  },
  {
    key: 'discord_invite',
    group: 'discord',
    type: 'text',
    de: { label: 'Einladungslink', help: 'Steht auf der Website und im Panel. Leer heißt: der Link taucht nirgends auf.', placeholder: 'https://discord.gg/…' },
    en: { label: 'Invite link', help: 'Shown on the website and in the panel. Empty means the link appears nowhere.', placeholder: 'https://discord.gg/…' },
  },
  {
    key: 'discord_staff_webhook',
    group: 'discord',
    type: 'password',
    secret: true,
    de: { label: 'Webhook fürs Team', help: 'Neue Tickets und Antworten landen in diesem Kanal. Ein Webhook ist so gut wie ein Passwort – deshalb verdeckt.' },
    en: { label: 'Staff webhook', help: 'New tickets and replies land in that channel. A webhook is as good as a password, hence masked.' },
  },
  {
    key: 'discord_bot_token',
    group: 'discord',
    type: 'password',
    secret: true,
    de: { label: 'Bot-Token', help: 'Discord Developer Portal → Bot → Reset Token. Der Bot liest ihn beim Start aus dem Panel.' },
    en: { label: 'Bot token', help: 'Discord Developer Portal → Bot → Reset Token. The bot reads it from the panel on start.' },
  },
  {
    key: 'discord_bot_secret',
    group: 'discord',
    type: 'password',
    secret: true,
    de: { label: 'Geheimnis Panel ↔ Bot', help: 'Ein selbst ausgedachtes langes Passwort. Es steht hier und in der .env des Bots; ohne es spricht das Panel nicht mit ihm.' },
    en: { label: 'Panel ↔ bot secret', help: 'A long password you choose. It lives here and in the bot .env; without it the panel does not talk to the bot.' },
  },
  {
    key: 'discord_guild_id',
    group: 'discord',
    type: 'text',
    de: { label: 'Server-ID', help: 'Rechtsklick auf das Server-Symbol → ID kopieren.' },
    en: { label: 'Guild ID', help: 'Right-click the server icon → Copy ID.' },
  },
  {
    key: 'free_discord_guild_id',
    group: 'discord',
    type: 'text',
    de: {
      label: 'Pflichtserver für den Gratis-Tarif',
      help: 'Der Gratis-Platz läuft nur, solange das verknüpfte Discord-Konto Mitglied dieses Servers ist.',
      placeholder: '1538202840445485126',
    },
    en: {
      label: 'Required guild for the Free plan',
      help: 'The Free slot runs only while the linked Discord account is a member of this guild.',
      placeholder: '1538202840445485126',
    },
  },
  {
    key: 'free_discord_check_minutes',
    group: 'discord',
    type: 'number',
    min: 5,
    max: 1440,
    de: {
      label: 'Mitgliedschaft höchstens so alt (Minuten)',
      help: 'Ohne frischen Nachweis stoppt der Gratis-Platz. Der Bot gleicht stündlich und bei Beitritt/Austritt ab.',
    },
    en: {
      label: 'Maximum membership age (minutes)',
      help: 'Without a fresh check the Free slot stops. The bot syncs hourly and on joins/leaves.',
    },
  },
  {
    key: 'discord_ticket_channel',
    group: 'discord',
    type: 'text',
    de: { label: 'Kanal für den Ticket-Knopf', help: 'Dort stellt der Bot die Nachricht mit dem Knopf "Ticket aufmachen" hin.' },
    en: { label: 'Ticket panel channel', help: 'The bot posts the “Open a ticket” message there.' },
  },
  {
    key: 'discord_ticket_category',
    group: 'discord',
    type: 'text',
    de: { label: 'Kategorie für Ticket-Kanäle', help: 'Unter dieser Kategorie legt der Bot je Ticket einen Kanal an.' },
    en: { label: 'Ticket category', help: 'The bot creates one channel per ticket under this category.' },
  },

  // ---------------------------------------------------------------- Rollen
  {
    key: 'discord_role_customer',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Customer', help: 'Bekommt jeder, der sein AFKSystems-Konto mit Discord verknüpft hat.' },
    en: { label: 'Customer', help: 'Everyone who linked their AFKSystems account with Discord gets this.' },
  },
  {
    key: 'discord_role_premium',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Premium', help: 'Für Kunden mit einem laufenden bezahlten Tarif. Lässt sich je Tarif überschreiben.' },
    en: { label: 'Premium', help: 'For customers with a running paid plan. Can be overridden per plan.' },
  },
  {
    key: 'discord_role_ultra',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Ultra', help: 'Für Kunden mit dem Ultra-Tarif.' },
    en: { label: 'Ultra', help: 'For customers on the Ultra plan.' },
  },
  {
    key: 'discord_role_partner',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Partner', help: 'Wird im Benutzerprofil von einem Administrator vergeben und anschließend synchronisiert.' },
    en: { label: 'Partner', help: 'Assigned by an administrator in the user profile and then synced.' },
  },
  {
    key: 'discord_role_vip',
    group: 'discordroles',
    type: 'text',
    de: { label: 'VIP', help: 'Wird im Benutzerprofil von einem Administrator vergeben und anschließend synchronisiert.' },
    en: { label: 'VIP', help: 'Assigned by an administrator in the user profile and then synced.' },
  },
  {
    key: 'discord_role_admin',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Administrator (Linked Role)', help: 'Diese Linked Role wird nicht direkt synchronisiert. Ihre ID gibt dem Admin Zugriff auf Ticket-Kanäle.' },
    en: { label: 'Administrator (Linked Role)', help: 'This Linked Role is not synced directly. Its ID grants administrators access to ticket channels.' },
  },
  {
    key: 'discord_role_mod',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Discord Moderator (Linked Role)', help: 'Diese Linked Role wird nicht direkt synchronisiert. Moderator wird im Benutzerprofil gesetzt.' },
    en: { label: 'Discord Moderator (Linked Role)', help: 'This Linked Role is not synced directly. Moderator status is set in the user profile.' },
  },
  {
    key: 'discord_role_team',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Team', help: 'Wird vom Bot vergeben, sobald jemand Admin oder Discord-Mod ist.' },
    en: { label: 'Team', help: 'Given by the bot as soon as someone is admin or discord mod.' },
  },

  // ---------------------------------------------------------------- Google
  {
    key: 'google_client_id',
    group: 'google',
    type: 'text',
    de: { label: 'Client-ID', help: 'Google Cloud Console → APIs & Dienste → Anmeldedaten → OAuth-Client-ID.', placeholder: '…apps.googleusercontent.com' },
    en: { label: 'Client ID', help: 'Google Cloud Console → APIs & Services → Credentials → OAuth client ID.', placeholder: '…apps.googleusercontent.com' },
  },
  {
    key: 'google_client_secret',
    group: 'google',
    type: 'password',
    secret: true,
    de: { label: 'Client Secret', help: 'Aus derselben Maske. Verdeckt und nie wieder angezeigt.' },
    en: { label: 'Client secret', help: 'From the same screen. Masked and never shown again.' },
  },
  {
    key: 'google_login',
    group: 'google',
    type: 'switch',
    needs: 'google_client_id',
    de: { label: 'Anmelden mit Google', help: 'Erlaubt Anmelden und Registrieren über Google.' },
    en: { label: 'Sign in with Google', help: 'Allows signing in and registering through Google.' },
  },

  // ---------------------------------------------------------------- Betrieb
  {
    key: 'maintenance',
    group: 'ops',
    type: 'switch',
    de: { label: 'Wartungsmodus', help: 'Die Website zeigt eine Notiz statt der Seiten. Administratoren kommen weiter durch, laufende Bots bleiben an.' },
    en: { label: 'Maintenance mode', help: 'The website shows a note instead of the pages. Administrators still get through, running bots stay up.' },
  },
  {
    key: 'maintenance_text',
    group: 'ops',
    type: 'textarea',
    de: { label: 'Wartungstext', help: 'Was Besucher währenddessen lesen.' },
    en: { label: 'Maintenance text', help: 'What visitors read in the meantime.' },
  },
  {
    key: 'support_hours',
    group: 'ops',
    type: 'text',
    de: { label: 'Support-Zeiten', help: 'Steht über dem Ticket-Formular. Leer heißt: es steht nichts da.', placeholder: 'Mo–Fr 10–20 Uhr' },
    en: { label: 'Support hours', help: 'Shown above the ticket form. Empty means nothing is shown.', placeholder: 'Mon–Fri 10:00–20:00' },
  },

  // ---------------------------------------------------------------- Recht
  {
    key: 'legal_imprint',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Impressum (Deutsch)', help: '' },
    en: { label: 'Imprint (German)', help: '' },
  },
  {
    key: 'legal_imprint_en',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Impressum (Englisch)', help: 'Leer heißt: es steht der deutsche Text da.' },
    en: { label: 'Imprint (English)', help: 'Empty means the German text is shown.' },
  },
  {
    key: 'legal_privacy',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Datenschutz (Deutsch)', help: '' },
    en: { label: 'Privacy (German)', help: '' },
  },
  {
    key: 'legal_privacy_en',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Datenschutz (Englisch)', help: '' },
    en: { label: 'Privacy (English)', help: '' },
  },
  {
    key: 'legal_terms',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Nutzungsbedingungen (Deutsch)', help: '' },
    en: { label: 'Terms (German)', help: '' },
  },
  {
    key: 'legal_terms_en',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Nutzungsbedingungen (Englisch)', help: '' },
    en: { label: 'Terms (English)', help: '' },
  },
];

export const byKey = Object.fromEntries(SETTINGS.map((entry) => [entry.key, entry]));

/** Die Beschreibung in einer Sprache – so geht sie an den Browser. */
export function schemaFor(lang = 'de') {
  const key = lang === 'en' ? 'en' : 'de';
  return {
    groups: GROUPS.map((group) => ({ key: group.key, icon: group.icon, ...group[key] })),
    settings: SETTINGS.map((entry) => ({
      key: entry.key,
      group: entry.group,
      type: entry.type,
      secret: Boolean(entry.secret),
      needs: entry.needs || null,
      min: entry.min,
      max: entry.max,
      ...entry[key],
    })),
  };
}
