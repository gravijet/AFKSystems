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
import { Client, Events, GatewayIntentBits, MessageFlags, Partials, REST, Routes } from 'discord.js';
import { Panel } from './panel.js';
import { Tickets } from './handlers/tickets.js';
import { Roles } from './handlers/roles.js';
import { ChannelAccess } from './handlers/channelAccess.js';
import { registerMetadata } from './handlers/linkedRoles.js';
import * as commands from './handlers/commands.js';

// Jede echte Person erhält beim Beitritt die öffentliche Basisrolle. Die ID ist bewusst hier
// fest, weil sie zur einen AFKSystems-Guild gehört und nicht mit den Panel-Rollen wechselbar ist.
const JOIN_ROLE_ID = '1538202840445485134';

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
    this.channelAccess = new ChannelAccess(this);
  }

  async guild() {
    if (!this.config?.guild_id) return null;
    return this.client.guilds.fetch(this.config.guild_id).catch(() => null);
  }

  // ------------------------------------------------------------ Start

  /**
   * Warten statt aufgeben.
   *
   * Fehlt der Token oder die Server-ID, ist das kein Absturz, sondern ein Zustand: Der Betreiber
   * trägt beides im Panel ein, und der Bot merkt es von selbst. Ein Dienst, der stattdessen alle
   * zehn Sekunden neu startet, füllt nur das Protokoll – und wer den Token einträgt, müsste sich
   * merken, dass er danach noch etwas neu starten muss.
   */
  async start() {
    if (!this.panel.secret) {
      console.error(
        'PANEL_SECRET is missing. Find it under Administration → Settings → Discord.'
      );
      process.exit(1);
    }

    let gemeldet = null;
    for (;;) {
      let fehlt = null;
      try {
        this.config = await this.panel.call('/config');
        const token = process.env.BOT_TOKEN || this.config.token;
        if (!token) {
          fehlt = 'No bot token in the panel (Settings → Discord → Bot token).';
        } else if (!this.config.guild_id) {
          fehlt = 'No guild ID in the panel (Settings → Discord → Guild ID).';
        } else {
          this.wire();
          await this.client.login(token);
          return;
        }
      } catch (error) {
        fehlt = `The panel is unavailable: ${error.message}`;
      }

      // Dieselbe Meldung nicht jede Minute wiederholen – einmal, und dann still warten.
      if (fehlt !== gemeldet) {
        console.warn(`${fehlt} Waiting for configuration – see docs/discord-bot.md.`);
        gemeldet = fehlt;
      }
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }

  wire() {
    this.client.once(Events.ClientReady, () => this.onReady());
    this.client.on(Events.InteractionCreate, (interaction) => this.onInteraction(interaction));
    this.client.on(Events.MessageCreate, (message) =>
      this.tickets.onMessage(message).catch((error) => console.warn('[tickets]', error.message))
    );
    this.client.on(Events.ChannelCreate, (channel) =>
      this.channelAccess.sync(channel).catch((error) => console.warn('[channels]', error.message))
    );
    this.client.on(Events.ChannelUpdate, (_before, after) =>
      this.channelAccess.sync(after).catch((error) => console.warn('[channels]', error.message))
    );
    // Rollen werden nur im Hauptserver verwaltet. Die Free-Mitgliedschaft kann dagegen an einen
    // separat konfigurierten Pflichtserver gebunden sein.
    this.client.on(Events.GuildMemberUpdate, (before, after) => {
      if (
        String(after.guild.id) === String(this.config.guild_id) &&
        before.roles.cache.size !== after.roles.cache.size
      ) {
        this.roles.sync(after).catch(() => {});
      }
    });
    this.client.on(Events.GuildMemberAdd, (member) => {
      this.roles.membership(member.id, true, member.guild.id).catch(() => {});
      if (String(member.guild.id) === String(this.config.guild_id)) {
        if (!member.user.bot) {
          member.roles
            .add(JOIN_ROLE_ID, 'AFKSystems: default role on server join')
            .catch((error) => console.warn(`[roles] could not add join role for ${member.user.tag}: ${error.message}`));
        }
        this.roles.sync(member).catch(() => {});
      }
    });
    this.client.on(Events.GuildMemberRemove, (member) => {
      this.roles.membership(member.id, false, member.guild.id).catch(() => {});
    });

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
    this.panel.on('discord.config', () =>
      this.refreshDiscordConfig().catch((error) => console.warn('[config]', error.message))
    );
  }

  /** Apply role, channel and required-guild changes without restarting the Discord service. */
  async refreshDiscordConfig() {
    const previousIds = this.roles.configuredIds();
    this.config = await this.panel.call('/config');
    const currentIds = this.roles.configuredIds();
    this.roles.retire([...previousIds].filter((id) => !currentIds.has(id)));
    await this.registerCommands();
    await registerMetadata({
      applicationId: this.config.application_id,
      token: this.client.token,
      fields: this.config.role_metadata,
    }).catch((error) => console.warn('[linked roles]', error.message));
    await this.tickets.ensurePanel();
    await this.tickets.enforceStaffAccess();
    this.channelAccess
      .syncAll()
      .then((changed) => console.log(`[channels] Team visibility updated in ${changed} channel(s)`))
      .catch((error) => console.warn('[channels]', error.message));
    const changed = await this.roles.syncAll();
    // Erst nach einem erfolgreichen Vollabgleich vergessen. Schlägt Discord oder das Panel
    // vorübergehend fehl, werden die alten IDs beim nächsten Stundenabgleich erneut bereinigt.
    this.roles.clearRetired();
    console.log(`[config] refreshed; updated ${changed} member(s)`);
  }

  async onReady() {
    console.log(`[discord] signed in as ${this.client.user.tag}`);
    this.client.user.setActivity(`${this.config.brand} · /account`);

    await this.registerCommands();
    await registerMetadata({
      applicationId: this.config.application_id,
      token: this.client.token,
      fields: this.config.role_metadata,
    }).catch(() => {});

    await this.tickets.ensurePanel().catch((error) => console.warn('[tickets]', error.message));
    await this.tickets.enforceStaffAccess().catch((error) => console.warn('[tickets]', error.message));
    this.channelAccess
      .syncAll()
      .then((changed) => console.log(`[channels] Team visibility updated in ${changed} channel(s)`))
      .catch((error) => console.warn('[channels]', error.message));
    this.panel.connect();

    const changed = await this.roles.syncAll().catch(() => 0);
    console.log(`[roles] initial sync: updated ${changed} member(s)`);

    // Stündlich: Rollen abgleichen (ein Tarif kann auslaufen, ohne dass jemand etwas anklickt)
    // und dem Panel ein Lebenszeichen geben, damit der Admin-Bereich zeigen kann, dass es läuft.
    setInterval(() => this.roles.syncAll().catch(() => {}), 60 * 60 * 1000).unref();
    // Geschlossene Kanäle bleiben eine Woche als Archiv sichtbar und werden danach entfernt.
    setInterval(() => this.tickets.cleanupArchived().catch((error) => console.warn('[tickets]', error.message)), 60 * 60 * 1000).unref();
    await this.tickets.cleanupArchived().catch((error) => console.warn('[tickets]', error.message));
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
      console.log('[discord] commands registered');
    } catch (error) {
      console.warn('[discord] could not register commands:', error.message);
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
      console.warn('[interaction]', error.message);
      const content = `That did not work: ${error.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }
}

const bot = new Bot();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('Shutting down ...');
    bot.panel.close();
    bot.client.destroy();
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason) => console.warn('[unhandled]', reason?.message || reason));

bot.start();
