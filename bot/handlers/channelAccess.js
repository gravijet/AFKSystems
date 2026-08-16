// Sichtbarkeit für das AFKSystems-Team.
//
// Team bekommt Leserechte in öffentlichen und rollenbasierten Bereichen, nicht aber in
// Administrator- oder rein personenbezogenen Kanälen. Dadurch sieht ein Discord-Moderator nach
// der automatischen Team-Rolle überall mit, wo auch eine gewöhnliche Serverrolle mitliest, ohne
// private Gespräche oder Tickets zu öffnen.

import { OverwriteType, PermissionFlagsBits } from 'discord.js';

export class ChannelAccess {
  constructor(bot) {
    this.bot = bot;
  }

  get config() {
    return this.bot.config;
  }

  /** Ist ein Kanal öffentlich oder für mindestens eine gewöhnliche Rolle sichtbar? */
  shouldGrant(channel, guild) {
    if (!channel?.permissionOverwrites || channel.isThread?.()) return false;
    const team = String(this.config.roles.team || '');
    const admin = String(this.config.roles.admin || '');
    if (!team) return false;

    // Ein Kanal, den @everyone sehen darf, gehört immer zum moderierbaren Bereich.
    if (channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) return true;

    // Bei privaten Kanälen zählt eine zugelassene normale Rolle. Team selbst und die Bot-Rolle
    // sind kein Auslöser – sonst würde ein einmal gesetztes Recht sich selbst erhalten.
    return [...channel.permissionOverwrites.cache.values()].some(
      (overwrite) =>
        overwrite.type === OverwriteType.Role &&
        overwrite.allow.has(PermissionFlagsBits.ViewChannel) &&
        String(overwrite.id) !== String(guild.roles.everyone.id) &&
        String(overwrite.id) !== team &&
        String(overwrite.id) !== admin &&
        String(overwrite.id) !== String(this.bot.client.user.id)
    );
  }

  /** Team explizit hinzufügen, falls die Zugangsregel es erlaubt. */
  async sync(channel, guild = null) {
    const targetGuild = guild || (await this.bot.guild());
    const team = this.config.roles.team;
    if (!targetGuild || !team || String(channel?.guildId || '') !== String(targetGuild.id)) return false;
    if (!this.shouldGrant(channel, targetGuild)) return false;

    const current = channel.permissionOverwrites.cache.get(String(team));
    if (current?.allow.has(PermissionFlagsBits.ViewChannel)) return false;
    await channel.permissionOverwrites.edit(
      team,
      { ViewChannel: true },
      'AFKSystems: Team may view public and role-based channels'
    );
    return true;
  }

  /** Beim Start sowie nach Konfigurationsänderungen alle vorhandenen Kanäle angleichen. */
  async syncAll() {
    const guild = await this.bot.guild();
    if (!guild || !this.config.roles.team) return 0;
    const channels = await guild.channels.fetch();
    let changed = 0;
    for (const channel of channels.values()) {
      if (!channel) continue;
      try {
        if (await this.sync(channel, guild)) changed += 1;
      } catch (error) {
        console.warn(`[channels] ${channel.name || channel.id}: ${error.message}`);
      }
    }
    return changed;
  }
}
