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

import { config } from './config.js';

export const GROUPS = [
  {
    key: 'money',
    icon: 'wallet',
    de: { title: 'Guthaben und Tarife', text: 'Was ein Konto geschenkt bekommt, ab wann gewarnt wird, wie viele Plätze gratis sind.' },
    en: { title: 'Credits and plans', text: 'What an account gets for free, when it is warned, how many slots are free.' },
  },
  {
    key: 'payments',
    icon: 'wallet',
    de: {
      title: 'Bezahlen mit Tebex',
      text: `Tebex wickelt Karte, PayPal und die übrigen Zahlarten ab und kümmert sich um die Umsatzsteuer – AFKSystems fasst nie Geld an. Guthaben entsteht ausschließlich über den Webhook: trage im Tebex-Panel unter Developers → Webhooks diese Adresse ein: ${config.publicUrl}/api/tebex/webhook`,
    },
    en: {
      title: 'Paying with Tebex',
      text: `Tebex handles cards, PayPal and the rest, and takes care of VAT – AFKSystems never touches the money. Credits are only ever created by the webhook: in the Tebex panel under Developers → Webhooks, add this address: ${config.publicUrl}/api/tebex/webhook`,
    },
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
    key: 'linkedroles',
    icon: 'external',
    de: {
      title: 'Discord Linked Roles',
      text: 'Bedingungen, die Discord selbst prüft. Der Betreiber wählt hier, was es gibt und woraus der Wert kommt; in Discord hängt er unter Servereinstellungen → Rollen → Links eine Rolle daran. Die Verifizierungsadresse der Anwendung ist die Adresse unten.',
    },
    en: {
      title: 'Discord linked roles',
      text: 'Requirements Discord checks itself. Here you choose which ones exist and where their value comes from; in Discord you attach a role to them under Server Settings → Roles → Links. The application\'s verification URL is the address below.',
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
    icon: 'shield',
    de: {
      title: 'Rechtstexte',
      text: 'Datenschutz und Nutzungsbedingungen. Ohne eigenen Text gilt die ausführliche Vorgabe aus dem System.',
    },
    en: {
      title: 'Legal texts',
      text: 'Privacy and terms. The complete system default is used when no custom text is stored.',
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

  // ---------------------------------------------------------------- Bezahlen (Tebex)
  {
    key: 'tebex_enabled',
    group: 'payments',
    type: 'switch',
    de: {
      label: 'Bezahlen mit Tebex',
      help: 'Aus heißt: im Panel steht die Zahlart nicht zur Auswahl. Gutschein, Überweisung und Aufbuchen durch den Admin bleiben davon unberührt.',
    },
    en: {
      label: 'Paying with Tebex',
      help: 'Off means the method is not offered in the panel. Vouchers, bank transfer and admin top-ups are unaffected.',
    },
  },
  {
    key: 'tebex_mode',
    group: 'payments',
    type: 'select',
    options: [
      { value: 'checkout', de: 'Checkout-API (Preise kommen von hier)', en: 'Checkout API (prices come from here)' },
      { value: 'headless', de: 'Headless-API (Pakete liegen im Tebex-Store)', en: 'Headless API (packages live in the Tebex store)' },
    ],
    de: {
      label: 'Weg',
      help: 'Checkout-API: der Warenkorb wird hier gebaut, die Aufladepakete dieses Panels bestimmen Namen und Preis – Tebex muss sie für dein Konto freischalten. Headless-API: die Pakete liegen fertig im Tebex-Webstore, hier steht je Aufladepaket nur noch die Paket-ID. Der Headless-Weg braucht keine Freischaltung.',
    },
    en: {
      label: 'Method',
      help: 'Checkout API: the basket is built here and this panel\'s top-up packages set name and price – Tebex has to enable it for your account. Headless API: the packages live in the Tebex webstore and each top-up package only carries its package id. The headless route needs no approval.',
    },
  },
  {
    key: 'tebex_project_id',
    group: 'payments',
    type: 'text',
    de: { label: 'Projekt-ID (Checkout)', help: 'Steht in creator.tebex.io unter Developers → API Keys. Nur für den Checkout-Weg.' },
    en: { label: 'Project ID (checkout)', help: 'Found at creator.tebex.io under Developers → API Keys. Checkout route only.' },
  },
  {
    key: 'tebex_private_key',
    group: 'payments',
    type: 'password',
    secret: true,
    de: {
      label: 'Privater Schlüssel (Checkout)',
      help: 'Derselbe Ort wie die Projekt-ID. Er darf nirgends sonst stehen – wer ihn hat, kann in deinem Namen kassieren.',
    },
    en: {
      label: 'Private key (checkout)',
      help: 'Same place as the project ID. It must live nowhere else – whoever has it can take payments in your name.',
    },
  },
  {
    key: 'tebex_store_token',
    group: 'payments',
    type: 'text',
    de: { label: 'Store-Token (Headless)', help: 'Der öffentliche Token des Webstores. Nur für den Headless-Weg.' },
    en: { label: 'Store token (headless)', help: 'The public token of the webstore. Headless route only.' },
  },
  {
    key: 'tebex_webhook_secret',
    group: 'payments',
    type: 'password',
    secret: true,
    de: {
      label: 'Webhook-Geheimnis',
      help: 'Steht im Tebex-Panel neben dem Endpunkt. Ohne dieses Geheimnis nimmt AFKSystems keine einzige Zahlungsmeldung an – auch keine echte.',
    },
    en: {
      label: 'Webhook secret',
      help: 'Shown next to the endpoint in the Tebex panel. Without it AFKSystems accepts no payment notification at all – not even a real one.',
    },
  },
  {
    key: 'tebex_store_url',
    group: 'payments',
    type: 'text',
    de: { label: 'Adresse des Stores', help: 'Optional. Steht im Panel als Link neben der Zahlart.' },
    en: { label: 'Store address', help: 'Optional. Shown next to the payment method as a link.' },
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
    de: { label: 'Absenderadresse', help: 'Was im Postfach des Kunden als Absender steht.', placeholder: 'user@example.invalid' },
    en: { label: 'From address', help: 'What appears as the sender in the customer inbox.', placeholder: 'user@example.invalid' },
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
    de: {
      label: 'Geheimnis Panel ↔ Bot',
      help: 'Mindestens 24 Zeichen, zufällig (z. B. `openssl rand -base64 36`). Es steht hier und in der .env des Bots als PANEL_SECRET. Dahinter liegt alles, was der Bot darf – ein kurzes Passwort ist hier keines.',
    },
    en: {
      label: 'Panel ↔ bot secret',
      help: 'At least 24 random characters (e.g. `openssl rand -base64 36`). It lives here and in the bot .env as PANEL_SECRET. Everything the bot may do sits behind it – a short password is no password here.',
    },
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
      placeholder: '000000000000000000',
    },
    en: {
      label: 'Required guild for the Free plan',
      help: 'The Free slot runs only while the linked Discord account is a member of this guild.',
      placeholder: '000000000000000000',
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
    de: { label: 'Administrator (Linked Role)', help: 'Discord vergibt diese Linked Role für Panel-Administratoren. Nur sie bearbeiten Tickets.' },
    en: { label: 'Administrator (Linked Role)', help: 'Discord grants this linked role to panel administrators. Only they handle tickets.' },
  },
  {
    key: 'discord_role_mod',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Discord Moderator (Linked Role)', help: 'Discord vergibt diese Linked Role, wenn Moderator im Benutzerprofil gesetzt ist.' },
    en: { label: 'Discord Moderator (Linked Role)', help: 'Discord grants this linked role when the moderator flag is set in the user profile.' },
  },

  // ---------------------------------------------------------------- Linked Roles
  // Eine Liste aus Objekten wie die Aufladepakete – und wie diese mit eigenem Editor, weil ein
  // Textfeld hier nur eine Zeile "[object Object]" ergäbe. Was drinsteht, prüft linked-roles.js.
  {
    key: 'discord_role_metadata',
    group: 'linkedroles',
    type: 'linkedroles',
    de: {
      label: 'Bedingungen',
      help: 'Höchstens fünf. Der Name steht in Discord als Bedingung im Rollen-Dialog, die Beschreibung als Zeile darunter. Nach dem Speichern meldet der Bot sie bei Discord an.',
    },
    en: {
      label: 'Requirements',
      help: 'At most five. The name appears in Discord as the condition in the role dialog, the description as the line below it. After saving, the bot registers them with Discord.',
    },
  },
  {
    key: 'discord_role_team',
    group: 'discordroles',
    type: 'text',
    de: { label: 'Team', help: 'Normale Rolle; der Bot vergibt sie automatisch an Admins und Discord-Mods.' },
    en: { label: 'Team', help: 'Normal role; the bot gives it to admins and Discord moderators automatically.' },
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
    key: 'content_protection',
    group: 'ops',
    type: 'switch',
    de: {
      label: 'Dateien schützen',
      help: 'CSS und JavaScript lassen sich nicht einzeln aufrufen und liegen in keinem fremden Zwischenspeicher; Website-Kopierer kommen nicht ans Dashboard. Am Verhalten der Seite ändert das nichts – Markieren und Rechtsklick bleiben frei.',
    },
    en: {
      label: 'Protect files',
      help: 'CSS and JavaScript cannot be fetched on their own and stay out of foreign caches; website copiers do not get into the dashboard. This changes nothing about how the page behaves – selecting and right-click stay available.',
    },
  },
  {
    key: 'content_lock_ui',
    group: 'ops',
    type: 'switch',
    de: {
      label: 'Bedienung sperren',
      help: 'Zusätzlich Rechtsklick, Markieren, Ziehen und Drucken sperren; offene Entwicklerwerkzeuge blenden den Inhalt aus. Eingabefelder, Codes, Adressen und Chatzeilen bleiben auch dann kopierbar. Aus (Vorgabe) heißt: eine ganz normale Seite.',
    },
    en: {
      label: 'Lock interaction',
      help: 'Additionally block right-click, selecting, dragging and printing; open developer tools hide the content. Input fields, codes, addresses and chat lines stay copyable even then. Off (the default) means: an ordinary web page.',
    },
  },
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
    key: 'legal_privacy',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Datenschutz (Deutsch)', help: 'Leer lassen, um die Systemvorgabe zu verwenden.' },
    en: { label: 'Privacy (German)', help: 'Leave empty to use the system default.' },
  },
  {
    key: 'legal_privacy_en',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Datenschutz (Englisch)', help: 'Leer lassen, um die englische Systemvorgabe zu verwenden.' },
    en: { label: 'Privacy (English)', help: 'Leave empty to use the English system default.' },
  },
  {
    key: 'legal_terms',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Nutzungsbedingungen (Deutsch)', help: 'Leer lassen, um die Systemvorgabe zu verwenden.' },
    en: { label: 'Terms (German)', help: 'Leave empty to use the system default.' },
  },
  {
    key: 'legal_terms_en',
    group: 'legal',
    type: 'textarea',
    de: { label: 'Nutzungsbedingungen (Englisch)', help: 'Leer lassen, um die englische Systemvorgabe zu verwenden.' },
    en: { label: 'Terms (English)', help: 'Leave empty to use the English system default.' },
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
      // Auswahlfelder tragen ihre Möglichkeiten mit – sonst müsste das Panel sie kennen, und die
      // Beschreibung wäre wieder an zwei Stellen.
      options: entry.options
        ? entry.options.map((option) => ({ value: option.value, label: option[key] }))
        : null,
      ...entry[key],
    })),
  };
}
