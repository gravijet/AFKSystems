// Rollen.
//
// Welche Rolle wem zusteht, entscheidet das Panel – hier wird nur ausgeführt. Zwei Regeln kommen
// dazu, weil sie in Discord zu Hause sind und nicht in der Datenbank:
//
//   * Wer **Admin** oder **Discord-Mod** ist, bekommt zusätzlich die Team-Rolle.
//   * Angefasst wird ausschließlich, was in den Einstellungen als verwaltete Rolle steht. Alles
//     andere – Farben, Selbstbedienungsrollen, was auch immer – bleibt unberührt. Ohne diese
//     Grenze nähme der erste vollständige Abgleich jedem alles weg, was er sich ausgesucht hat.

export class Roles {
  constructor(bot) {
    this.bot = bot;
  }

  get config() {
    return this.bot.config;
  }

  /** Die Rollen, die der Bot verwalten darf – inklusive Team. */
  managedIds() {
    const roles = this.config.roles || {};
    return new Set(
      [...(this.config.managed_roles || []), roles.team].filter(Boolean).map(String)
    );
  }

  /** Was ein Mitglied haben soll: was das Panel sagt, plus Team, wenn Admin oder Mod. */
  async targetFor(member) {
    const roles = this.config.roles || {};
    const wanted = new Set();

    const linked = await this.bot.panel.call(`/users/${member.id}`).catch(() => null);
    if (linked?.linked && !linked.blocked) {
      for (const id of linked.roles || []) wanted.add(String(id));
    }

    // Team folgt aus Admin oder Mod – das steht in Discord und wird auch dort gelesen.
    const staff = [roles.admin, roles.mod].filter(Boolean);
    if (roles.team && staff.some((id) => member.roles.cache.has(id))) wanted.add(String(roles.team));

    return wanted;
  }

  /** Ein Mitglied abgleichen. Gibt zurück, was sich geändert hat. */
  async sync(member) {
    if (!member || member.user.bot) return null;
    const managed = this.managedIds();
    if (!managed.size) return null;

    const wanted = await this.targetFor(member);
    const has = new Set([...member.roles.cache.keys()].filter((id) => managed.has(String(id))));

    const add = [...wanted].filter((id) => !has.has(id));
    const remove = [...has].filter((id) => !wanted.has(String(id)));
    if (!add.length && !remove.length) return null;

    try {
      if (add.length) await member.roles.add(add, 'AFKSystems: Tarif oder Verknüpfung');
      if (remove.length) await member.roles.remove(remove, 'AFKSystems: Tarif oder Verknüpfung');
    } catch (error) {
      // Fehlende Rechte oder eine Rolle über der des Bots – beides gehört ins Protokoll und
      // nicht in einen Absturz.
      console.warn(`[rollen] ${member.user.tag}: ${error.message}`);
      return null;
    }
    return { member: member.user.tag, add, remove };
  }

  /** Alle Mitglieder auf einmal. Läuft beim Start und danach stündlich. */
  async syncAll() {
    const guild = await this.bot.guild();
    if (!guild) return 0;
    const members = await guild.members.fetch().catch(() => null);
    if (!members) return 0;

    let changed = 0;
    for (const member of members.values()) {
      const result = await this.sync(member);
      if (result) {
        changed += 1;
        console.log(
          `[rollen] ${result.member}: +${result.add.length} −${result.remove.length}`
        );
      }
      // Discord mag keine Salve aus hundert Rollenänderungen in einer Sekunde.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return changed;
  }

  /** Ein einzelnes Konto, wenn das Panel meldet, dass sich dort etwas geändert hat. */
  async syncOne(discordId) {
    const guild = await this.bot.guild();
    const member = await guild?.members.fetch(String(discordId)).catch(() => null);
    return member ? this.sync(member) : null;
  }
}
