// Tickets in beide Richtungen.
//
// Ein Ticket ist **ein** Vorgang, egal wo er anfängt:
//
//   Panel → Discord   Wer im Panel ein Ticket aufmacht, bekommt hier einen Kanal. Jede Antwort
//                     landet dort, jeder Zustandswechsel auch.
//   Discord → Panel   Wer hier schreibt, schreibt ins Ticket. Wer hier schließt, schließt es dort.
//
// Nur verknüpfte Konten dürfen ein Ticket aufmachen: Ohne Verknüpfung wüsste niemand, wessen
// Serverplatz gemeint ist, und der Kanal wäre eine Sackgasse. Der Bot sagt das auch so und
// verlinkt die Stelle, an der man es in Ordnung bringt.

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const COLORS = { info: 0x206cfe, ok: 0x00bb7f, warn: 0xfcbb00, bad: 0xfb2c36 };
const ARCHIVE_CATEGORY_ID = '000000000000000000';
const ARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Wie groß eine Datei sein darf, die der Bot in einen Kanal hängt.
 *
 * Das entscheidet Discord, nicht wir: ein Server ohne Boosts nimmt 10 MB, mit Boost-Stufe 2 sind
 * es 50 MB und mit Stufe 3 hundert. Ein Anhang aus dem Panel darf 20 MB haben – passt er hier
 * nicht hinein, kommt statt der Datei ein Link ins Panel. Das ist ehrlicher als ein Fehler im
 * Protokoll, den der Kunde nie zu sehen bekommt.
 */
const UPLOAD_LIMIT = [10, 10, 50, 100].map((mb) => mb * 1024 * 1024);
const uploadLimit = (guild) => UPLOAD_LIMIT[guild?.premiumTier || 0] ?? UPLOAD_LIMIT[0];

/** Eine Größe, wie sie ein Mensch liest. */
const humanSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const STATUS_LABEL = {
  open: 'open',
  waiting: 'waiting',
  answered: 'answered',
  closed: 'closed',
};

export class Tickets {
  constructor(bot) {
    this.bot = bot;
    /** Nachrichten, die der Bot selbst geschrieben hat – damit sie nicht zurück ins Panel laufen. */
    this.mine = new Set();
  }

  get config() {
    return this.bot.config;
  }

  // ------------------------------------------------------------ Einrichtung

  /** Die Nachricht mit dem Knopf im Ticket-Kanal. Sie wird ersetzt, nicht doppelt gepostet. */
  async ensurePanel() {
    const channelId = this.config.ticket_channel;
    if (!channelId) return;
    const channel = await this.bot.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      console.warn('[tickets] ticket panel channel not found:', channelId);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setAuthor({ name: this.config.brand, iconURL: this.config.logo })
      .setTitle('Support')
      .setDescription(
        [
          'A ticket opened here is the same ticket you see in the panel.',
          '',
          'Press the button, write a subject and describe the issue. A private channel opens for',
          'you and the team; screenshots and files can go in there as well.',
          '',
          `Your Discord account needs to be linked to your ${this.config.brand} account:`,
          `${this.config.link_url}`,
        ].join('\n')
      )
      .setThumbnail(this.config.logo);

    // Ein Knopf, keine Auswahlliste: Es gibt nichts mehr zu wählen. Wer Hilfe braucht, schreibt
    // hin, worum es geht – die Schubfächer davor hat niemand vermisst.
    const button = new ButtonBuilder()
      .setCustomId('ticket:new')
      .setLabel('Open a ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary);

    const existing = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const own = existing?.find(
      (message) => message.author.id === this.bot.client.user.id && message.embeds.length
    );
    const payload = { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
    if (own) await own.edit(payload).catch(() => channel.send(payload));
    else await channel.send(payload);
  }

  // ------------------------------------------------------------ Discord → Panel

  /** Knopf im Ticket-Kanal: Formular zeigen. */
  async onOpen(interaction) {
    const linked = await this.bot.panel.call(`/users/${interaction.user.id}`).catch(() => null);
    if (!linked?.linked) return this.tellUnlinked(interaction);

    const modal = new ModalBuilder()
      .setCustomId('ticket:create')
      .setTitle('Open a ticket')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('subject')
            .setLabel('What is this about?')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(120)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('body')
            .setLabel('Describe the issue')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(3000)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
  }

  async tellUnlinked(interaction) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.warn)
          .setTitle('Account not linked yet')
          .setDescription(
            [
              `A ticket belongs to a ${this.config.brand} account so the team can identify`,
              'the affected server slot.',
              '',
              `Linking takes one click: ${this.config.link_url}`,
              '',
              'Then press the button here again.',
            ].join('\n')
          )
          .setThumbnail(this.config.logo),
      ],
    });
  }

  /** Formular abgeschickt: Ticket im Panel anlegen, Kanal hier aufmachen. */
  async onCreate(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const subject = interaction.fields.getTextInputValue('subject');
    const body = interaction.fields.getTextInputValue('body');

    let ticket;
    try {
      const result = await this.bot.panel.call('/tickets', {
        method: 'POST',
        body: { discord_id: interaction.user.id, subject, body },
      });
      ticket = result.ticket;
    } catch (error) {
      return interaction.editReply(`That did not work: ${error.message}`);
    }

    // Hier angelegt, hier angesprochen: Wer den Knopf gedrückt hat, wird im neuen Kanal erwähnt
    // und findet ihn dadurch in der Kanalliste wieder. Ein Ticket aus dem Panel bekommt diese
    // Erwähnung bewusst nicht – dort sitzt niemand in Discord und wartet darauf.
    const channel = await this.openChannel(ticket, interaction.user.id, { ping: true });
    await interaction.editReply(
      channel ? `Ticket #${ticket.id} is open: <#${channel.id}>` : `Ticket #${ticket.id} is open.`
    );
  }

  /** Einen Kanal für ein Ticket anlegen und im Panel vermerken. */
  async openChannel(ticket, discordId = null, { ping = false } = {}) {
    const guild = await this.bot.guild();
    if (!guild) return null;
    const parent = this.config.ticket_category || null;
    // Tickets werden ausschließlich von Panel-Administratoren bearbeitet. Team und Discord-
    // Moderatoren bekommen deshalb bewusst keine Kanalrechte.
    const staffRoles = [this.config.roles.admin].filter(Boolean);

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: this.bot.client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
      },
      ...staffRoles.map((id) => ({
        id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      })),
    ];
    // Jeder Beteiligte darf hinein – auch wer erst später dazugeholt wurde.
    for (const person of ticket.participants || []) {
      if (person.discord_id) {
        overwrites.push({
          id: person.discord_id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        });
      }
    }
    if (discordId && !overwrites.some((entry) => entry.id === discordId)) {
      overwrites.push({
        id: discordId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }

    let channel;
    try {
      channel = await guild.channels.create({
        name: `ticket-${ticket.id}`,
        type: ChannelType.GuildText,
        parent,
        topic: `${ticket.subject} · ${ticket.owner?.username || ''} · ${ticket.url}`,
        permissionOverwrites: overwrites,
      });
    } catch (error) {
      console.warn('[tickets] could not create channel:', error.message);
      return null;
    }

    await this.bot.panel
      .call(`/tickets/${ticket.id}`, { method: 'PATCH', body: { channel_id: channel.id } })
      .catch(() => {});

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setAuthor({ name: this.config.brand, iconURL: this.config.logo })
      .setTitle(`#${ticket.id} · ${ticket.subject}`)
      .setURL(ticket.url)
      .addFields(
        { name: 'From', value: ticket.owner?.username || '–', inline: true },
        { name: 'Status', value: STATUS_LABEL[ticket.status] || ticket.status, inline: true }
      )
      .setFooter({
        text: 'Messages and files here are synced with the panel.',
        iconURL: this.config.logo,
      });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:close:${ticket.id}`)
        .setLabel('Close ticket')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setURL(ticket.url).setLabel('Open in panel').setStyle(ButtonStyle.Link)
    );

    const message = await channel.send({
      // Nur bei einem hier aufgemachten Ticket. Die Erwähnung steht am Kopf des Kanals, damit
      // Discord ihn hervorhebt – ohne sie geht ein neuer Kanal in der Liste unter.
      content: ping && discordId ? `<@${discordId}>` : undefined,
      embeds: [embed],
      components: [buttons],
    });
    this.mine.add(message.id);
    await message.pin().catch(() => {});

    // Die erste Nachricht des Kunden steht schon im Panel – hier gehört sie auch hin.
    const full = await this.bot.panel.call(`/tickets/${ticket.id}`).catch(() => null);
    for (const entry of full?.messages || []) await this.relayToDiscord(channel, entry, ticket);
    return channel;
  }

  /**
   * Eine Nachricht in Discord posten, die aus dem Panel kam – samt ihrer Anhänge.
   *
   * Die Dateien holt der Bot beim Panel ab und hängt sie hier als echte Anhänge an: ein Bild soll
   * im Kanal ein Bild sein und kein Link, den erst jemand anklickt. Nur was Discord zu groß ist,
   * wird als Link auf das Panel angekündigt.
   */
  async relayToDiscord(channel, entry, ticket) {
    if (entry.discord_id) return; // die kam von hier
    const body = String(entry.body || '').slice(0, 4000);
    const embed = new EmbedBuilder()
      .setColor(entry.role === 'staff' ? COLORS.ok : entry.role === 'system' ? COLORS.warn : COLORS.info)
      .setTimestamp(new Date(entry.created_at));
    if (entry.role === 'system') embed.setAuthor({ name: 'System' });
    else {
      embed.setAuthor({
        name: `${entry.author || 'Customer'}${entry.role === 'staff' ? ' · Team' : ''}`,
        iconURL: this.config.logo,
      });
    }

    const { attachments, tooBig } = await this.fetchFiles(channel, entry, ticket);
    const lines = [body];
    if (tooBig.length) {
      lines.push(
        '',
        ...tooBig.map(
          (file) => `📎 **${file.name}** (${humanSize(file.size)}) – too large for Discord: ${ticket?.url || ''}`
        )
      );
    }
    const text = lines.join('\n').trim();
    // Ein Beitrag ohne Text und ohne Datei wäre eine leere Nachricht – die nimmt Discord nicht an.
    if (!text && !attachments.length) return;
    embed.setDescription(text || '*(attachment)*');

    const message = await channel.send({ embeds: [embed], files: attachments }).catch((error) => {
      console.warn('[tickets] could not relay message:', error.message);
      return null;
    });
    if (message) this.mine.add(message.id);
  }

  /** Die Anhänge einer Panel-Nachricht holen. Zu große bleiben als Hinweis übrig. */
  async fetchFiles(channel, entry, ticket) {
    const attachments = [];
    const tooBig = [];
    const limit = uploadLimit(channel.guild);
    for (const file of entry.files || []) {
      if (file.size > limit) {
        tooBig.push(file);
        continue;
      }
      const bytes = await this.bot.panel
        .download(`/tickets/${ticket?.id ?? entry.ticket_id}/files/${file.id}`)
        .catch((error) => {
          console.warn(`[tickets] attachment ${file.id}: ${error.message}`);
          return null;
        });
      if (bytes) attachments.push(new AttachmentBuilder(bytes, { name: file.name }));
    }
    return { attachments, tooBig };
  }

  /**
   * Eine gewöhnliche Nachricht in einem Ticket-Kanal: ab damit ins Panel – mit ihren Anhängen.
   *
   * Die Dateien werden **nicht** als Adresse durchgereicht: Discords Anhang-Adressen laufen ab,
   * und ein Ticket, in dem nach zwei Wochen ein toter Link steht, hat den Screenshot verloren.
   * Der Bot meldet nur, was es gibt, und das Panel holt es sich und behält es.
   */
  async onMessage(message) {
    if (message.author.bot || this.mine.has(message.id)) return;
    // `geschlossen-*` keeps channels created before the English Discord migration working.
    // New and renamed channels are always English.
    const match = /^(?:ticket|closed|geschlossen)-(\d+)$/.exec(message.channel.name || '');
    if (!match) return;
    const id = Number(match[1]);

    const content = String(message.content || '').slice(0, 4000);
    const files = [...message.attachments.values()].map((file) => ({
      name: file.name,
      url: file.url,
      size: file.size,
    }));
    if (!content && !files.length) return;

    try {
      const result = await this.bot.panel.call(`/tickets/${id}/messages`, {
        method: 'POST',
        body: {
          discord_id: message.id,
          discord_user_id: message.author.id,
          author_name: message.member?.displayName || message.author.username,
          body: content,
          attachments: files,
        },
      });
      // Keine Reaktion auf übernommene Nachrichten. Der Bot hat früher jede Zeile eines
      // Ticket-Kanals mit einem grünen Haken versehen – bei einem Gespräch aus dreissig
      // Nachrichten steht dann unter jeder einzelnen ein Häkchen, und der Kanal ist zugemüllt.
      // Dass eine Nachricht angekommen ist, ist der Normalfall und braucht keine Bestätigung;
      // gemeldet wird nur noch, was **nicht** geklappt hat, und das als lesbare Antwort.
      //
      // Ein Anhang, der nicht übernommen werden konnte (zu groß, Adresse tot), darf nicht still
      // verschwinden: sonst glaubt der Kunde, das Team habe sein Bild.
      for (const note of result?.failed || []) {
        await message.reply(`This attachment did not make it into the panel – ${note}`).catch(() => {});
      }
    } catch (error) {
      // Wer nicht verknüpft ist, soll wissen warum – und nicht ins Leere schreiben. Die Antwort
      // sagt alles; eine zusätzliche Reaktion wäre dieselbe Nachricht ein zweites Mal.
      await message.reply(`This was not saved in the panel: ${error.message}`).catch(() => {});
    }
  }

  /** Knopf "Schließen" im Kanal. */
  async onClose(interaction, id) {
    await interaction.deferReply();
    try {
      await this.bot.panel.call(`/tickets/${id}/status`, {
        method: 'POST',
        body: { status: 'closed', discord_id: interaction.user.id },
      });
      await interaction.editReply('Ticket closed. A new reply will reopen it.');
    } catch (error) {
      await interaction.editReply(`That did not work: ${error.message}`);
    }
  }

  // ------------------------------------------------------------ Panel → Discord

  /** Im Panel ist ein Ticket entstanden. */
  async onPanelCreated(event) {
    if (event.source === 'discord') return; // den Kanal gibt es schon
    const full = await this.bot.panel.call(`/tickets/${event.ticket_id}`).catch(() => null);
    if (!full?.ticket || full.ticket.channel_id) return;
    const discordId = full.ticket.owner?.discord_id || null;
    await this.openChannel(full.ticket, discordId);
  }

  /** Im Panel wurde geschrieben. */
  async onPanelMessage(event) {
    if (event.internal) return; // interne Notizen bleiben intern
    const channel = await this.channelOf(event.ticket_id);
    if (!channel) return;
    await this.relayToDiscord(
      channel,
      {
        role: event.role,
        author: event.author,
        body: event.body,
        files: event.files || [],
        created_at: event.created_at,
        // Eine Discord-Nachricht wurde schon als Original im Kanal geschrieben. Nur echte
        // Panel-Nachrichten bekommen zusätzlich ein lesbares Embed in Discord.
        discord_id: event.discord_id || null,
      },
      { id: event.ticket_id, url: this.ticketUrl(event.ticket_id) }
    );
    if (event.status && event.status !== 'closed') await this.reopenChannel(channel, event.ticket_id);
    if (event.reopened) {
      await channel.send({ content: 'The ticket was reopened by a new reply.' });
    }
  }

  /** Im Panel hat sich der Zustand geändert. */
  async onPanelStatus(event) {
    const channel = await this.channelOf(event.ticket_id);
    if (!channel) return;
    const closed = event.status === 'closed';
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(closed ? COLORS.warn : COLORS.ok)
          .setDescription(`Status: **${STATUS_LABEL[event.status] || event.status}**`),
      ],
    });
    // Geschlossene Tickets landen eine Woche sichtbar im Discord-Archiv. Bei einer neuen Antwort
    // wird der Kanal zurück in die aktive Kategorie verschoben.
    if (closed) {
      await channel.setName(`closed-${event.ticket_id}`).catch(() => {});
      await channel.setParent(ARCHIVE_CATEGORY_ID).catch((error) =>
        console.warn(`[tickets] could not archive #${event.ticket_id}: ${error.message}`)
      );
    } else {
      await this.reopenChannel(channel, event.ticket_id);
    }
  }

  async reopenChannel(channel, ticketId) {
    await channel.setName(`ticket-${ticketId}`).catch(() => {});
    if (this.config.ticket_category) await channel.setParent(this.config.ticket_category).catch(() => {});
  }

  /**
   * Alte Kanäle haben bereits einen Verlauf; sie brauchen keinen zweiten Kanal. Beim Start
   * werden deshalb nur Name und Kategorie an den gespeicherten Ticketstatus angepasst.
   */
  async reconcileChannels() {
    const result = await this.bot.panel.call('/tickets?open=0').catch(() => null);
    for (const ticket of result?.tickets || []) {
      if (!ticket.channel_id) continue;
      const channel = await this.bot.client.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel?.isTextBased()) continue;
      if (ticket.status === 'closed') {
        if (channel.name !== `closed-${ticket.id}`) await channel.setName(`closed-${ticket.id}`).catch(() => {});
        if (channel.parentId !== ARCHIVE_CATEGORY_ID) {
          await channel.setParent(ARCHIVE_CATEGORY_ID).catch((error) =>
            console.warn(`[tickets] could not archive #${ticket.id}: ${error.message}`)
          );
        }
      } else if (channel.name !== `ticket-${ticket.id}` || channel.parentId !== this.config.ticket_category) {
        await this.reopenChannel(channel, ticket.id);
      }
    }
  }

  /** Entfernt Team-/Mod-Rechte aus bestehenden Kanälen, ohne Kundenzugänge anzutasten. */
  async enforceStaffAccess() {
    const result = await this.bot.panel.call('/tickets?open=0').catch(() => null);
    for (const ticket of result?.tickets || []) {
      if (!ticket.channel_id) continue;
      const channel = await this.bot.client.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const admin = this.config.roles.admin;
      if (admin) {
        await channel.permissionOverwrites
          .edit(admin, { ViewChannel: true, SendMessages: true }, 'Only administrators may handle tickets')
          .catch(() => {});
      }
      for (const roleId of [this.config.roles.team, this.config.roles.mod].filter(Boolean)) {
        await channel.permissionOverwrites.delete(roleId, 'Only administrators may handle tickets').catch(() => {});
      }
    }
  }

  /** Löscht archivierte Discord-Kanäle sieben Tage nach dem Schließen und löst die Zuordnung. */
  async cleanupArchived() {
    const result = await this.bot.panel.call('/tickets?open=0').catch(() => null);
    const threshold = Date.now() - ARCHIVE_RETENTION_MS;
    for (const ticket of result?.tickets || []) {
      // Alte Tickets hatten noch kein `closed_at`. Ihr letzter Änderungszeitpunkt ist die beste
      // verfügbare Schließzeit; ohne den Rückfall würde ein alter Kanal beim ersten Botstart
      // sofort gelöscht, selbst wenn er eben erst ins Archiv verschoben wurde.
      const closedAt = Number(ticket.closed_at || ticket.updated_at || 0);
      if (ticket.status !== 'closed' || !ticket.channel_id || closedAt > threshold) continue;
      const channel = await this.bot.client.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) await channel.delete('Archived AFKSystems ticket expired after seven days').catch(() => null);
      await this.bot.panel
        .call(`/tickets/${ticket.id}`, { method: 'PATCH', body: { channel_id: null } })
        .catch(() => {});
    }
  }

  /** Die Adresse eines Tickets im Panel – für Hinweise, wenn eine Datei hier nicht hineinpasst. */
  ticketUrl(ticketId) {
    return `${String(this.config.panel_url || '').replace(/\/+$/, '')}/en/app#/tickets/${ticketId}`;
  }

  async channelOf(ticketId) {
    const full = await this.bot.panel.call(`/tickets/${ticketId}`).catch(() => null);
    const channelId = full?.ticket?.channel_id;
    if (!channelId) return null;
    const channel = await this.bot.client.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  }
}
