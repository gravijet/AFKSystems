// Der AFKSystems-Bot für Discord.
//
// Er hat keine eigene Datenbank und keine eigene Konfiguration: Server-ID, Kanäle, Rollen und
// sogar sein Discord-Token holt er sich beim Start aus dem Panel. In seiner .env steht nur, wo
// das Panel steht und wie er sich dort ausweist – damit lässt er sich woanders hinstellen
// (Featherpanel, ein anderer Rechner), ohne dass irgendwo zwei Wahrheiten entstehen.
//
// Was er tut:
//   * Tickets in beide Richtungen (handlers/tickets.js)
//   * Rollen nach Tarif und Verknüpfung (handlers/roles.js)
//   * Discords Linked Roles anmelden (handlers/linkedRoles.js)
//   * drei Slash-Befehle (handlers/commands.js)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Events, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { Panel } from './panel.js';
import { Tickets } from './handlers/tickets.js';
import { Roles } from './handlers/roles.js';
import { registerMetadata } from './handlers/linkedRoles.js';
import * as commands from './handlers/commands.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Die .env neben dieser Datei lesen – dasselbe schlichte Format wie im Panel. */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnv();

class Bot {
  constructor() {
    this.panel = new Panel({
      url: process.env.PANEL_URL || 'http://127.0.0.1:3010',
      secret: process.env.PANEL_SECRET || '',
    });
    this.config = null;
    this.client = new Client({
      // Nur, was gebraucht wird. `MessageContent` ist im Developer Portal zu erlauben – ohne ihn
      // kämen Nachrichten aus Ticket-Kanälen leer im Panel an.
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
    this.tickets = new Tickets(this);
    this.roles = new Roles(this);
  }

  async guild() {
    if (!this.config?.guild_id) return null;
    return this.client.guilds.fetch(this.config.guild_id).catch(() => null);
  }

  // ------------------------------------------------------------ Start

  async start() {
    if (!this.panel.secret) {
      console.error(
        'PANEL_SECRET fehlt. Es steht im Panel unter Administration → Einstellungen → Discord.'
      );
      process.exit(1);
    }

    try {
      this.config = await this.panel.call('/config');
    } catch (error) {
      console.error(`Das Panel antwortet nicht: ${error.message}`);
      process.exit(1);
    }

    const token = process.env.BOT_TOKEN || this.config.token;
    if (!token) {
      console.error(
        'Kein Bot-Token. Trag ihn im Panel unter Einstellungen → Discord ein oder setze BOT_TOKEN.'
      );
      process.exit(1);
    }
    if (!this.config.guild_id) {
      console.error('Keine Server-ID im Panel hinterlegt (Einstellungen → Discord).');
      process.exit(1);
    }

    this.wire();
    await this.client.login(token);
  }

  wire() {
    this.client.once(Events.ClientReady, () => this.onReady());
    this.client.on(Events.InteractionCreate, (interaction) => this.onInteraction(interaction));
    this.client.on(Events.MessageCreate, (message) =>
      this.tickets.onMessage(message).catch((error) => console.warn('[tickets]', error.message))
    );
    // Rollen in Discord geändert: vielleicht ist daraus gerade ein Team-Mitglied geworden.
    this.client.on(Events.GuildMemberUpdate, (before, after) => {
      if (before.roles.cache.size !== after.roles.cache.size) {
        this.roles.sync(after).catch(() => {});
      }
    });
    this.client.on(Events.GuildMemberAdd, (member) => this.roles.sync(member).catch(() => {}));

    // Was im Panel passiert, kommt über die offene Leitung herein.
    this.panel.on('ticket.created', (event) =>
      this.tickets.onPanelCreated(event).catch((error) => console.warn('[tickets]', error.message))
    );
    this.panel.on('ticket.message', (event) =>
      this.tickets.onPanelMessage(event).catch((error) => console.warn('[tickets]', error.message))
    );
    this.panel.on('ticket.status', (event) =>
      this.tickets.onPanelStatus(event).catch((error) => console.warn('[tickets]', error.message))
    );
    this.panel.on('roles.changed', (event) =>
      this.roles.syncOne(event.discord_id).catch(() => {})
    );
  }

  async onReady() {
    console.log(`[discord] angemeldet als ${this.client.user.tag}`);
    this.client.user.setActivity(`${this.config.brand} · /konto`);

    await this.registerCommands();
    await registerMetadata({
      applicationId: this.config.application_id,
      token: this.client.token,
      fields: this.config.role_metadata,
    }).catch(() => {});

    await this.tickets.ensurePanel().catch((error) => console.warn('[tickets]', error.message));
    this.panel.connect();

    const changed = await this.roles.syncAll().catch(() => 0);
    console.log(`[rollen] erster Abgleich: ${changed} Mitglieder angepasst`);

    // Stündlich: Rollen abgleichen (ein Tarif kann auslaufen, ohne dass jemand etwas anklickt)
    // und dem Panel ein Lebenszeichen geben, damit der Admin-Bereich zeigen kann, dass es läuft.
    setInterval(() => this.roles.syncAll().catch(() => {}), 60 * 60 * 1000).unref();
    const beat = () =>
      this.panel
        .call('/heartbeat', {
          method: 'POST',
          body: { tag: this.client.user.tag, guilds: this.client.guilds.cache.size },
        })
        .catch(() => {});
    beat();
    setInterval(beat, 60_000).unref();
  }

  async registerCommands() {
    try {
      const rest = new REST().setToken(this.client.token);
      // Auf den Server statt global: dort sind sie sofort da, global dauert es bis zu einer Stunde.
      await rest.put(
        Routes.applicationGuildCommands(this.client.user.id, this.config.guild_id),
        { body: commands.definitions() }
      );
      console.log('[discord] Befehle angemeldet');
    } catch (error) {
      console.warn('[discord] Befehle ließen sich nicht anmelden:', error.message);
    }
  }

  async onInteraction(interaction) {
    try {
      if (interaction.isChatInputCommand()) return await commands.handle(this, interaction);
      if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:new') {
        return await this.tickets.onSelect(interaction);
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:create:')) {
        return await this.tickets.onCreate(interaction, interaction.customId.split(':')[2]);
      }
      if (interaction.isButton() && interaction.customId.startsWith('ticket:close:')) {
        return await this.tickets.onClose(interaction, interaction.customId.split(':')[2]);
      }
    } catch (error) {
      console.warn('[interaktion]', error.message);
      const reply = { content: `Das ging schief: ${error.message}`, ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  }
}

const bot = new Bot();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('Beende ...');
    bot.panel.close();
    bot.client.destroy();
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason) => console.warn('[unbehandelt]', reason?.message || reason));

bot.start();
