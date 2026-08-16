// Rollen.
//
// Welche Rolle wem zusteht, entscheidet vollständig das Panel – hier wird nur ausgeführt.
// Angefasst wird ausschließlich, was in den Einstellungen als verwaltete Rolle steht. Alles
//     andere – Farben, Selbstbedienungsrollen, was auch immer – bleibt unberührt. Ohne diese
//     Grenze nähme der erste vollständige Abgleich jedem alles weg, was er sich ausgesucht hat.

export class Roles {
  constructor(bot) {
    this.bot = bot;
    // Wenn eine Rollen-ID in den Einstellungen ersetzt wird, muss die bisherige Rolle beim
    // nächsten erfolgreichen Abgleich noch als verwaltet gelten, damit sie entfernt werden kann.
    this.retiredIds = new Set();
  }

  get config() {
    return this.bot.config;
  }

  requiredGuildId() {
    return String(this.config.free_guild_id || this.config.guild_id || '');
  }

  /** Die aktuell im Panel hinterlegten Rollen. */
  configuredIds() {
    return new Set((this.config.managed_roles || []).filter(Boolean).map(String));
  }

  /** Die Rollen, die der Bot verwalten darf – inklusive gerade ersetzter IDs. */
  managedIds() {
    return new Set([...this.configuredIds(), ...this.retiredIds]);
  }

  retire(ids) {
    for (const id of ids || []) {
      if (id) this.retiredIds.add(String(id));
    }
  }

  clearRetired() {
    this.retiredIds.clear();
  }

  /** Was ein Mitglied haben soll. Admin/Moderator → Team ist bereits im Panel berechnet. */
  async targetFor(member, supplied = undefined) {
    const wanted = new Set();

    let linked = supplied;
    if (linked === undefined) {
      // Ein nicht verknüpftes Konto ist eine gültige Antwort und darf verwaltete Rollen verlieren.
      // Ein nicht erreichbares Panel ist dagegen keine Aussage über Berechtigungen.
      linked = await this.bot.panel.call(`/users/${member.id}`).catch(() => undefined);
    }
    if (linked === undefined) return null;
    if (linked?.linked && !linked.blocked) {
      for (const id of linked.roles || []) wanted.add(String(id));
    }
    return wanted;
  }

  /** Ein Mitglied abgleichen. Gibt zurück, was sich geändert hat. */
  async sync(member, supplied = undefined) {
    if (!member || member.user.bot) return null;
    const managed = this.managedIds();
    if (!managed.size) return null;

    const wanted = await this.targetFor(member, supplied);
    if (!wanted) return null;
    const has = new Set([...member.roles.cache.keys()].filter((id) => managed.has(String(id))));

    const add = [...wanted].filter((id) => !has.has(id));
    const remove = [...has].filter((id) => !wanted.has(String(id)));
    if (!add.length && !remove.length) return null;

    try {
      if (add.length) await member.roles.add(add, 'AFKSystems account role sync');
      if (remove.length) await member.roles.remove(remove, 'AFKSystems account role sync');
    } catch (error) {
      // Fehlende Rechte oder eine Rolle über der des Bots – beides gehört ins Protokoll und
      // nicht in einen Absturz.
      console.warn(`[roles] ${member.user.tag}: ${error.message}`);
      return null;
    }
    return { member: member.user.tag, add, remove };
  }

  /** Alle Mitglieder auf einmal. Läuft beim Start und danach stündlich. */
  async syncAll() {
    const guild = await this.bot.guild();
    if (!guild) throw new Error('The configured Discord guild is unavailable.');
    const members = await guild.members.fetch();
    // Fail closed on transport errors. An empty, successful response is authoritative; a failed
    // request must not be interpreted as "nobody has a role".
    const targets = await this.bot.panel.call('/roles');
    const byDiscord = new Map(
      (targets.users || []).map((target) => [String(target.discord_id), { linked: true, ...target }])
    );

    // The required Free-plan guild can be different from the guild used for tickets and roles.
    // Only a successfully fetched full member list is authoritative: a temporary Discord error
    // must never be turned into a mass leave event.
    const requiredGuildId = this.requiredGuildId();
    let requiredMembers = requiredGuildId === String(guild.id) ? members : null;
    if (!requiredMembers && requiredGuildId) {
      const requiredGuild = await this.bot.client.guilds.fetch(requiredGuildId).catch(() => null);
      requiredMembers = await requiredGuild?.members.fetch().catch(() => null);
    }
    if (requiredMembers) {
      await this.bot.panel
        .call('/memberships', {
          method: 'POST',
          body: {
            guild_id: requiredGuildId,
            // Only linked accounts are sent back, so the panel never receives an unrelated
            // Discord member list.
            members: (targets.users || []).map((target) => ({
              discord_id: String(target.discord_id),
              present: requiredMembers.has(String(target.discord_id)),
            })),
          },
        })
        .catch((error) => console.warn('[memberships]', error.message));
    }

    let changed = 0;
    for (const member of members.values()) {
      const result = await this.sync(member, byDiscord.get(member.id) || { linked: false });
      if (result) {
        changed += 1;
        console.log(
          `[roles] ${result.member}: +${result.add.length} −${result.remove.length}`
        );
        // Nur echte Änderungen drosseln. Bei tausenden unveränderten Mitgliedern würde eine
        // Pause pro Person den stündlichen Sicherheitsabgleich sonst unnötig minutenlang ziehen.
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    return changed;
  }

  /** Ein einzelnes Konto, wenn das Panel meldet, dass sich dort etwas geändert hat. */
  async syncOne(discordId) {
    const id = String(discordId);
    const guild = await this.bot.guild();
    const main = guild ? await this.memberPresence(guild, id) : { checked: false, present: false, member: null };
    const result = main.member ? await this.sync(main.member) : null;

    // Das Ereignis kommt unter anderem direkt nach einer OAuth-Verknüpfung. Dadurch wird ein
    // berechtigter Gratis-Platz sofort freigeschaltet, auch wenn der Bot-Token nur im Bot-Dienst
    // liegt und das Panel die Discord-API daher nicht selbst abfragen kann.
    const requiredGuildId = this.requiredGuildId();
    let required = null;
    if (requiredGuildId && guild && String(guild.id) === requiredGuildId) {
      required = main;
    } else if (requiredGuildId) {
      const requiredGuild = await this.bot.client.guilds.fetch(requiredGuildId).catch(() => null);
      if (requiredGuild) required = await this.memberPresence(requiredGuild, id);
    }
    if (required?.checked) await this.membership(id, required.present, requiredGuildId);
    return result;
  }

  /**
   * Ein einzelnes Mitglied sicher prüfen. Nur Discords eindeutiges „Unknown Member“ ist ein
   * bestätigter Austritt; Rate-Limits und Netzfehler lassen den letzten Panelwert unangetastet.
   */
  async memberPresence(guild, discordId) {
    try {
      const member = await guild.members.fetch(String(discordId));
      return { checked: true, present: Boolean(member), member: member || null };
    } catch (error) {
      if (Number(error?.status) === 404 || Number(error?.code) === 10007) {
        return { checked: true, present: false, member: null };
      }
      return { checked: false, present: false, member: null };
    }
  }

  /** Report a single join/leave immediately; the hourly full sync remains the safety net. */
  async membership(discordId, present, guildId = null) {
    const requiredGuildId = this.requiredGuildId();
    if (!requiredGuildId || (guildId && String(guildId) !== requiredGuildId)) return null;
    return this.bot.panel.call('/memberships', {
      method: 'POST',
      body: {
        guild_id: requiredGuildId,
        members: [{ discord_id: String(discordId), present: Boolean(present) }],
      },
    });
  }
}
