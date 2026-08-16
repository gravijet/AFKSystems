// Sichtbarkeit für Discord-Moderatoren.
//
// Discord-Moderatoren bekommen Leserechte in allen Kanälen, mit einer klaren Ausnahme:
// Kanäle, die ausschließlich der Admin-Rolle zugänglich sind. Tickets fallen genau in diese
// Ausnahme. Team bleibt unabhängig davon die automatisch vergebene gemeinsame Rolle.

import { OverwriteType, PermissionFlagsBits } from 'discord.js';

export class ChannelAccess {
  constructor(bot) {
    this.bot = bot;
  }

  get config() {
    return this.bot.config;
  }

  /** Ist ein Kanal nicht ausschließlich für Administratoren bestimmt? */
  shouldGrant(channel, guild) {
    if (!channel?.permissionOverwrites || channel.isThread?.()) return false;
    const moderator = String(this.config.roles.mod || '');
    const admin = String(this.config.roles.admin || '');
    const team = String(this.config.roles.team || '');
    if (!moderator) return false;

    // Öffentliche Kanäle sind nie admin-only.
    if (channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) return true;

    const allowedRoles = [...channel.permissionOverwrites.cache.values()].filter(
      (overwrite) =>
        overwrite.type === OverwriteType.Role &&
        overwrite.allow.has(PermissionFlagsBits.ViewChannel) &&
        String(overwrite.id) !== String(guild.roles.everyone.id) &&
        String(overwrite.id) !== moderator &&
        String(overwrite.id) !== team &&
        String(overwrite.id) !== String(this.bot.client.user.id)
    );
    // Nur die Admin-Rolle (plus der Bot selbst) darf hinein: Mod bleibt draußen. Gibt es keine
    // Rollenfreigabe oder zusätzlich eine andere Rolle, erhält der Moderator dagegen Zugang.
    return !(allowedRoles.length === 1 && String(allowedRoles[0].id) === admin);
  }

  /** Discord Moderator explizit hinzufügen, falls der Kanal nicht admin-only ist. */
  async sync(channel, guild = null) {
    const targetGuild = guild || (await this.bot.guild());
    const moderator = this.config.roles.mod;
    if (!targetGuild || !moderator || String(channel?.guildId || '') !== String(targetGuild.id)) return false;
    if (!this.shouldGrant(channel, targetGuild)) return false;

    const current = channel.permissionOverwrites.cache.get(String(moderator));
    if (current?.allow.has(PermissionFlagsBits.ViewChannel)) return false;
    await channel.permissionOverwrites.edit(
      moderator,
      { ViewChannel: true },
      'AFKSystems: Discord Moderator may view every non-admin channel'
    );
    return true;
  }

  /** Beim Start sowie nach Konfigurationsänderungen alle vorhandenen Kanäle angleichen. */
  async syncAll() {
    const guild = await this.bot.guild();
    if (!guild || !this.config.roles.mod) return 0;
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
