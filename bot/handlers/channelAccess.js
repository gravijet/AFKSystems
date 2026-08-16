// Sichtbarkeit für Discord-Moderatoren.
//
// Discord-Moderatoren bekommen Leserechte in öffentlichen und rollenbasierten Kanälen, nicht
// aber in Administrator- oder rein personenbezogenen Kanälen. Tickets fallen genau in diese
// Ausnahme. Team bleibt unabhängig davon die automatisch vergebene gemeinsame Rolle.

import { OverwriteType, PermissionFlagsBits } from 'discord.js';

export class ChannelAccess {
  constructor(bot) {
    this.bot = bot;
  }

  get config() {
    return this.bot.config;
  }

  /** Ist ein Kanal öffentlich oder für mindestens eine Nicht-Admin-Rolle sichtbar? */
  shouldGrant(channel, guild) {
    if (!channel?.permissionOverwrites || channel.isThread?.()) return false;
    const moderator = String(this.config.roles.mod || '');
    const admin = String(this.config.roles.admin || '');
    const team = String(this.config.roles.team || '');
    if (!moderator) return false;

    // Öffentliche Kanäle sind stets sichtbar.
    if (channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) return true;

    // Eine explizite Nutzerfreigabe genügt bewusst nicht. Erst eine normale Rolle (außer Admin,
    // Team, Moderator und Bot) macht den Kanal zum moderierbaren, rollenbasierten Bereich.
    return [...channel.permissionOverwrites.cache.values()].some(
      (overwrite) =>
        overwrite.type === OverwriteType.Role &&
        overwrite.allow.has(PermissionFlagsBits.ViewChannel) &&
        String(overwrite.id) !== String(guild.roles.everyone.id) &&
        String(overwrite.id) !== moderator &&
        String(overwrite.id) !== team &&
        String(overwrite.id) !== admin &&
        String(overwrite.id) !== String(this.bot.client.user.id)
    );
  }

  /** Discord Moderator explizit hinzufügen, falls der Kanal öffentlich oder rollenbasiert ist. */
  async sync(channel, guild = null) {
    const targetGuild = guild || (await this.bot.guild());
    const moderator = this.config.roles.mod;
    if (!targetGuild || !moderator || String(channel?.guildId || '') !== String(targetGuild.id)) return false;

    const current = channel.permissionOverwrites.cache.get(String(moderator));
    if (!this.shouldGrant(channel, targetGuild)) {
      // Ein zuvor durch den Bot freigegebener Kanal kann später auf Admin oder einzelne Nutzer
      // beschränkt werden. Das explizite Erlaubnisrecht wird dann wieder entfernt.
      if (!current?.allow.has(PermissionFlagsBits.ViewChannel)) return false;
      await channel.permissionOverwrites.edit(
        moderator,
        { ViewChannel: false },
        'AFKSystems: Discord Moderator may not view admin-only or member-only channels'
      );
      return true;
    }

    if (current?.allow.has(PermissionFlagsBits.ViewChannel)) return false;
    await channel.permissionOverwrites.edit(
      moderator,
      { ViewChannel: true },
      'AFKSystems: Discord Moderator may view public and role-based channels'
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
