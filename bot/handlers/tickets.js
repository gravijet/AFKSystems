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
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const COLORS = { info: 0x206cfe, ok: 0x00bb7f, warn: 0xfcbb00, bad: 0xfb2c36 };

const STATUS_LABEL = {
  open: 'offen',
  waiting: 'wartet',
  answered: 'beantwortet',
  closed: 'geschlossen',
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
      console.warn('[tickets] Ticket-Kanal nicht gefunden:', channelId);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setAuthor({ name: this.config.brand, iconURL: this.config.logo })
      .setTitle('Support')
      .setDescription(
        [
          'Ein Ticket geht hier genauso wie im Panel – und ist danach an beiden Stellen dasselbe.',
          '',
          'Wähle unten die Kategorie. Es öffnet sich ein Kanal, den nur du und das Team sehen.',
          '',
          `Dein Discord-Konto muss dafür mit deinem ${this.config.brand}-Konto verknüpft sein:`,
          `${this.config.link_url}`,
        ].join('\n')
      )
      .setThumbnail(this.config.logo);

    const menu = new StringSelectMenuBuilder()
      .setCustomId('ticket:new')
      .setPlaceholder('Worum geht es?')
      .addOptions(
        this.config.categories.map((entry) => ({ label: entry.label, value: entry.key }))
      );

    const existing = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const own = existing?.find(
      (message) => message.author.id === this.bot.client.user.id && message.embeds.length
    );
    const payload = { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
    if (own) await own.edit(payload).catch(() => channel.send(payload));
    else await channel.send(payload);
  }

  // ------------------------------------------------------------ Discord → Panel

  /** Auswahl im Ticket-Kanal: Formular zeigen. */
  async onSelect(interaction) {
    const category = interaction.values[0];
    const linked = await this.bot.panel.call(`/users/${interaction.user.id}`).catch(() => null);
    if (!linked?.linked) return this.tellUnlinked(interaction);

    const modal = new ModalBuilder()
      .setCustomId(`ticket:create:${category}`)
      .setTitle('Ticket aufmachen')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('subject')
            .setLabel('Worum geht es?')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(120)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('body')
            .setLabel('Beschreib es kurz')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(3000)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
  }

  async tellUnlinked(interaction) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.warn)
          .setTitle('Konto noch nicht verknüpft')
          .setDescription(
            [
              `Ein Ticket gehört zu einem ${this.config.brand}-Konto – sonst weiß das Team nicht,`,
              'um welchen Serverplatz es geht.',
              '',
              `Verknüpfen dauert einen Klick: ${this.config.link_url}`,
              '',
              'Danach hier einfach noch einmal auswählen.',
            ].join('\n')
          )
          .setThumbnail(this.config.logo),
      ],
    });
  }

  /** Formular abgeschickt: Ticket im Panel anlegen, Kanal hier aufmachen. */
  async onCreate(interaction, category) {
    await interaction.deferReply({ ephemeral: true });
    const subject = interaction.fields.getTextInputValue('subject');
    const body = interaction.fields.getTextInputValue('body');

    let ticket;
    try {
      const result = await this.bot.panel.call('/tickets', {
        method: 'POST',
        body: { discord_id: interaction.user.id, subject, category, body },
      });
      ticket = result.ticket;
    } catch (error) {
      return interaction.editReply(`Das ging schief: ${error.message}`);
    }

    const channel = await this.openChannel(ticket, interaction.user.id);
    await interaction.editReply(
      channel ? `Ticket #${ticket.id} ist offen: <#${channel.id}>` : `Ticket #${ticket.id} ist offen.`
    );
  }

  /** Einen Kanal für ein Ticket anlegen und im Panel vermerken. */
  async openChannel(ticket, discordId = null) {
    const guild = await this.bot.guild();
    if (!guild) return null;
    const parent = this.config.ticket_category || null;
    const staffRoles = [this.config.roles.team, this.config.roles.admin, this.config.roles.mod].filter(Boolean);

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
      console.warn('[tickets] Kanal ließ sich nicht anlegen:', error.message);
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
        { name: 'Von', value: ticket.owner?.username || '–', inline: true },
        { name: 'Kategorie', value: this.categoryLabel(ticket.category), inline: true },
        { name: 'Zustand', value: STATUS_LABEL[ticket.status] || ticket.status, inline: true }
      )
      .setFooter({ text: 'Was hier steht, steht auch im Panel.', iconURL: this.config.logo });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:close:${ticket.id}`)
        .setLabel('Schließen')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setURL(ticket.url).setLabel('Im Panel öffnen').setStyle(ButtonStyle.Link)
    );

    const message = await channel.send({ embeds: [embed], components: [buttons] });
    this.mine.add(message.id);
    await message.pin().catch(() => {});

    // Die erste Nachricht des Kunden steht schon im Panel – hier gehört sie auch hin.
    const full = await this.bot.panel.call(`/tickets/${ticket.id}`).catch(() => null);
    for (const entry of full?.messages || []) await this.relayToDiscord(channel, entry, ticket);
    return channel;
  }

  categoryLabel(key) {
    return this.config.categories.find((entry) => entry.key === key)?.label || key;
  }

  /** Eine Nachricht in Discord posten, die aus dem Panel kam. */
  async relayToDiscord(channel, entry, ticket) {
    if (entry.discord_id) return; // die kam von hier
    const embed = new EmbedBuilder()
      .setColor(entry.role === 'staff' ? COLORS.ok : entry.role === 'system' ? COLORS.warn : COLORS.info)
      .setDescription(String(entry.body).slice(0, 4000))
      .setTimestamp(new Date(entry.created_at));
    if (entry.role === 'system') embed.setAuthor({ name: 'System' });
    else {
      embed.setAuthor({
        name: `${entry.author || 'Kunde'}${entry.role === 'staff' ? ' · Team' : ''}`,
        iconURL: this.config.logo,
      });
    }
    const message = await channel.send({ embeds: [embed] }).catch(() => null);
    if (message) this.mine.add(message.id);
  }

  /** Eine gewöhnliche Nachricht in einem Ticket-Kanal: ab damit ins Panel. */
  async onMessage(message) {
    if (message.author.bot || this.mine.has(message.id)) return;
    const match = /^ticket-(\d+)$/.exec(message.channel.name || '');
    if (!match) return;
    const id = Number(match[1]);

    const content = [message.content, ...message.attachments.map((file) => file.url)]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
    if (!content) return;

    try {
      await this.bot.panel.call(`/tickets/${id}/messages`, {
        method: 'POST',
        body: {
          discord_id: message.id,
          discord_user_id: message.author.id,
          author_name: message.member?.displayName || message.author.username,
          body: content,
        },
      });
      await message.react('✅').catch(() => {});
    } catch (error) {
      // Wer nicht verknüpft ist, soll wissen warum – und nicht ins Leere schreiben.
      await message.reply(`Das kam nicht im Panel an: ${error.message}`).catch(() => {});
      await message.react('⚠️').catch(() => {});
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
      await interaction.editReply('Ticket geschlossen. Eine Antwort macht es wieder auf.');
    } catch (error) {
      await interaction.editReply(`Das ging schief: ${error.message}`);
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
    await this.relayToDiscord(channel, {
      role: event.role,
      author: event.author,
      body: event.body,
      created_at: event.created_at,
      discord_id: null,
    });
    if (event.reopened) {
      await channel.send({ content: 'Das Ticket wurde durch eine Antwort wieder geöffnet.' });
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
          .setDescription(`Zustand: **${STATUS_LABEL[event.status] || event.status}**`),
      ],
    });
    // Geschlossen heißt hier: der Kanal wird archiviert, nicht gelöscht. Der Verlauf bleibt an
    // beiden Stellen lesbar, und eine Antwort macht das Ticket ohnehin wieder auf.
    if (closed) await channel.setName(`geschlossen-${event.ticket_id}`).catch(() => {});
    else await channel.setName(`ticket-${event.ticket_id}`).catch(() => {});
  }

  async channelOf(ticketId) {
    const full = await this.bot.panel.call(`/tickets/${ticketId}`).catch(() => null);
    const channelId = full?.ticket?.channel_id;
    if (!channelId) return null;
    const channel = await this.bot.client.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  }
}
