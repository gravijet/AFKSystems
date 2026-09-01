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
const ARCHIVE_CATEGORY_ID = '1538534010748280852';
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

/**
 * Wer hinter den Zahlen einer Nachricht steckt.
 *
 * Discord verschickt Erwähnungen als IDs: `<@1538…>` ist eine Person, `<#1538…>` ein Kanal,
 * `<@&1538…>` eine Rolle. Im Discord-Client steht daran ein Name, weil der Client den Server
 * kennt. **Das Panel kennt ihn nicht** – dort stand deshalb bisher die nackte Zahl mitten im Satz.
 *
 * Der Bot ist die einzige Stelle, die beides sieht, also löst er es hier auf und schickt die
 * Zuordnung mit. Sie wird an der Nachricht gespeichert und nicht bei jedem Anzeigen neu geholt:
 * Ein Kanal, der später umbenannt oder gelöscht wird, soll den Verlauf nicht rückwirkend ändern –
 * genau wie in Discord selbst.
 *
 * `displayName` vor `username`: Im Ticket-Kanal steht der Servername der Person, und der Verlauf
 * im Panel soll dasselbe sagen wie der Kanal daneben.
 */
export async function resolveMentions(message) {
  const out = {};
  for (const [id, user] of message.mentions?.users ?? []) {
    const member = message.guild?.members?.cache?.get(id);
    out[id] = { type: 'user', name: member?.displayName || user.displayName || user.username };
  }
  for (const [id, role] of message.mentions?.roles ?? []) {
    // `hexColor` ist bei einer Rolle ohne eigene Farbe `#000000` – das ist in Discord "keine
    // Farbe" und nicht "schwarz". Ohne diese Unterscheidung stünde im Panel jede gewöhnliche
    // Rolle in tiefem Schwarz, das auf dunklem Grund niemand mehr liest.
    const color = role.hexColor && role.hexColor !== '#000000' ? role.hexColor : undefined;
    out[id] = { type: 'role', name: role.name, ...(color ? { color } : {}) };
  }
  for (const [id, channel] of message.mentions?.channels ?? []) {
    out[id] = { type: 'channel', name: channel?.name || 'channel' };
  }

  // Die Collections oben sind ein schneller Weg, aber kein vollständiger: Nach einem Neustart
  // ist der Member-Cache leer, bei alten/weitergeleiteten Nachrichten fehlen Kanäle gelegentlich
  // ganz. Die IDs stehen trotzdem zuverlässig im Rohtext. Alles, was noch keinen Namen hat, wird
  // deshalb gezielt über Discord geholt. Pro ID genau ein Aufruf und höchstens fünfzig insgesamt –
  // eine einzelne Nachricht darf den Bot nicht zur API-Schleuder machen.
  const raw = String(message.content || '');
  const wanted = [];
  const take = (regex, type) => {
    for (const match of raw.matchAll(regex)) {
      if (!out[match[1]] && !wanted.some((entry) => entry.id === match[1])) {
        wanted.push({ id: match[1], type });
      }
      if (wanted.length >= 50) return;
    }
  };
  take(/<@!?(\d{15,25})>/g, 'user');
  take(/<@&(\d{15,25})>/g, 'role');
  take(/<#(\d{15,25})>/g, 'channel');

  await Promise.all(
    wanted.slice(0, 50).map(async ({ id, type }) => {
      try {
        if (type === 'user') {
          const member = await message.guild?.members.fetch(id).catch(() => null);
          const user = member?.user || (await message.client?.users.fetch(id).catch(() => null));
          const name = member?.displayName || user?.displayName || user?.globalName || user?.username;
          if (name) out[id] = { type, name };
        } else if (type === 'role') {
          const role = await message.guild?.roles.fetch(id).catch(() => null);
          if (role?.name) {
            const color = role.hexColor && role.hexColor !== '#000000' ? role.hexColor : undefined;
            out[id] = { type, name: role.name, ...(color ? { color } : {}) };
          }
        } else {
          const channel = await message.client?.channels.fetch(id).catch(() => null);
          if (channel?.name) out[id] = { type, name: channel.name };
        }
      } catch {
        // Gelöschte oder für den Bot unsichtbare Ziele bleiben ehrlich unbekannt. Der Fehler einer
        // einzelnen Erwähnung darf die eigentliche Ticketnachricht nie verlieren.
      }
    })
  );
  return out;
}

/** Eine Größe, wie sie ein Mensch liest. */
const humanSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Was der Zustand im Kanal heißt. „open“ liegt beim Team, „answered“ beim Kunden – ein vierter
// Zustand („waiting“) bedeutete dasselbe wie „answered“ und ist weg (siehe server/tickets.js).
const STATUS_LABEL = {
  open: 'open',
  answered: 'answered',
  closed: 'closed',
};

/**
 * Wie viele Kanäle ein Abgleich höchstens nachlegt.
 *
 * Discord begrenzt das Anlegen von Kanälen streng, und discord.js **wartet**, statt abzubrechen.
 * Wer nach dem ersten Botstart fünfzig offene Tickets hat, hätte damit die Warteschlange des Bots
 * für alles andere blockiert – keine gespiegelten Nachrichten, keine Rollen. Der Rest kommt beim
 * nächsten Durchlauf; dass etwas übrig blieb, steht im Protokoll und nicht bloß im Nichts.
 */
const RECONCILE_LIMIT = 5;

export class Tickets {
  constructor(bot) {
    this.bot = bot;
    /** Nachrichten, die der Bot selbst geschrieben hat – damit sie nicht zurück ins Panel laufen. */
    this.mine = new Set();
    /**
     * Tickets, für die gerade ein Kanal entsteht.
     *
     * Ein Ticket kann von zwei Seiten gleichzeitig hier ankommen: als Meldung über die offene
     * Leitung und aus dem Abgleich, der die Lücken füllt. Ohne diese Sperre entstünden dann zwei
     * Kanäle für denselben Vorgang, und im Panel stünde nur einer davon.
     */
    this.opening = new Set();
  }

  /**
   * Eine eigene Nachricht merken – aber nicht für immer.
   *
   * Die Menge wuchs mit jeder gespiegelten Zeile und wurde nie kleiner. Ein Bot läuft Monate; bei
   * ein paar tausend Tickets sind das Hunderttausende IDs, die nur noch Speicher belegen. Zu
   * beantworten ist ohnehin bloß die Frage „habe *ich* das eben geschrieben“, und die stellt sich
   * innerhalb von Sekunden.
   */
  remember(messageId) {
    this.mine.add(messageId);
    if (this.mine.size <= 2000) return;
    // Sets behalten die Einfügereihenfolge: Die ältesten fliegen zuerst.
    for (const id of this.mine) {
      this.mine.delete(id);
      if (this.mine.size <= 1000) break;
    }
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

  /**
   * Dafür sorgen, dass ein Ticket einen Kanal **hat** – und ihn anlegen, wenn nicht.
   *
   * Das ist der Weg für alles, was nicht gerade eben entstanden ist: die Meldung aus dem Panel
   * und der Abgleich beim Start. Vorher hing ein Kanal allein an der Meldung über die offene
   * Leitung. Lief der Bot in dem Moment nicht – Neustart, Umzug, ein Panel, das gerade neu
   * gestartet war –, bekam dieses Ticket nie einen Kanal, und niemand hat es je gemerkt.
   *
   * Steht im Panel ein Kanal, den es in Discord nicht mehr gibt (von Hand gelöscht), wird die
   * Zuordnung gelöst und ein neuer angelegt: Sonst schreibt der Bot bis in alle Ewigkeit gegen
   * eine Kanal-ID, die niemand mehr sieht.
   */
  async ensureChannel(ticketId) {
    const id = Number(ticketId);
    if (this.opening.has(id)) return null;
    const full = await this.bot.panel.call(`/tickets/${id}`).catch(() => null);
    const ticket = full?.ticket;
    // Ein geschlossenes Ticket bekommt keinen Kanal mehr. Sein alter ist entweder im Archiv oder
    // nach sieben Tagen weg – ihn dafür neu anzulegen wäre ein Kanal für einen erledigten Vorgang.
    if (!ticket || ticket.status === 'closed') return null;
    if (ticket.channel_id) {
      const existing = await this.bot.client.channels.fetch(ticket.channel_id).catch(() => null);
      if (existing?.isTextBased()) return existing;
      await this.bot.panel
        .call(`/tickets/${id}`, { method: 'PATCH', body: { channel_id: null } })
        .catch(() => {});
      console.warn(`[tickets] channel of #${id} is gone in Discord – opening a new one`);
    }
    return this.openChannel(ticket, ticket.owner?.discord_id || null);
  }

  /**
   * Einen Kanal für ein Ticket anlegen und im Panel vermerken.
   *
   * Der Riegel davor ist kein Beiwerk: Dasselbe Ticket kommt von zwei Seiten hierher – als
   * Meldung über die offene Leitung und aus dem Abgleich. Ohne ihn stünden für einen Vorgang
   * zwei Kanäle in Discord, und das Panel kennte nur den zuletzt eingetragenen.
   */
  async openChannel(ticket, discordId = null, { ping = false } = {}) {
    if (this.opening.has(Number(ticket.id))) return null;
    this.opening.add(Number(ticket.id));
    try {
      return await this.createChannel(ticket, discordId, { ping });
    } finally {
      this.opening.delete(Number(ticket.id));
    }
  }

  /** Die eigentliche Arbeit – aufgerufen wird `openChannel`, nie das hier. */
  async createChannel(ticket, discordId, { ping }) {
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

    const options = {
      name: `ticket-${ticket.id}`,
      type: ChannelType.GuildText,
      topic: `${ticket.subject} · ${ticket.owner?.display_name || ticket.owner?.username || ''} · ${ticket.url}`,
      permissionOverwrites: overwrites,
    };
    let channel = await guild.channels.create({ ...options, parent }).catch((error) => {
      console.warn(`[tickets] could not create the channel for #${ticket.id} in the category: ${error.message}`);
      return null;
    });
    // Eine Kategorie fasst fünfzig Kanäle, und eine ID aus den Einstellungen kann veraltet sein
    // oder zu einem anderen Server gehören. Beides darf ein Ticket nicht kosten: Lieber steht der
    // Kanal an der falschen Stelle in der Liste, als dass es ihn gar nicht gibt. Wohin er gehört,
    // rückt der nächste Abgleich zurecht, sobald die Kategorie wieder Platz hat.
    if (!channel && parent) {
      channel = await guild.channels.create(options).catch((error) => {
        console.warn(`[tickets] could not create a channel for #${ticket.id}: ${error.message}`);
        return null;
      });
      if (channel) console.warn(`[tickets] #${ticket.id} opened outside the ticket category`);
    }
    if (!channel) return null;

    await this.bot.panel
      .call(`/tickets/${ticket.id}`, { method: 'PATCH', body: { channel_id: channel.id } })
      .catch(() => {});

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setAuthor({ name: this.config.brand, iconURL: this.config.logo })
      .setTitle(`#${ticket.id} · ${ticket.subject}`)
      .setURL(ticket.url)
      .addFields(
        { name: 'From', value: ticket.owner?.display_name || ticket.owner?.username || '–', inline: true },
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
    this.remember(message.id);
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
    if (message) this.remember(message.id);
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
          // Wer hinter den Zahlen steckt. Siehe `resolveMentions` – ohne das steht im Panel
          // `<@1538202840445485134>` statt „@Hugo“.
          mentions: await resolveMentions(message),
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

  /**
   * Im Panel ist ein Ticket entstanden.
   *
   * Ein Ticket aus Discord bringt seinen Kanal schon mit (`onCreate` legt ihn an, bevor diese
   * Meldung ankommt) – hier entstünde sonst ein zweiter. Bleibt er dort aus, etwa weil Discord
   * gerade nicht mitspielte, holt ihn der Abgleich nach.
   */
  async onPanelCreated(event) {
    if (event.source === 'discord') return;
    await this.ensureChannel(event.ticket_id);
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

  /**
   * Im Panel wurde jemand zum Ticket dazugeholt oder herausgenommen.
   *
   * Der Kanal ist Teil des Tickets, also folgt er der Liste der Beteiligten. Ohne das steht
   * jemand im Panel als Beteiligter und sieht den Kanal nicht, in dem das Gespräch läuft.
   */
  async onPanelAccess(event) {
    if (!event.discord_id) return;
    const channel = await this.channelOf(event.ticket_id);
    if (!channel) return;
    if (event.allow) {
      await channel.permissionOverwrites
        .edit(event.discord_id, { ViewChannel: true, SendMessages: true }, 'Added to the ticket')
        .catch((error) => console.warn(`[tickets] could not grant access to #${event.ticket_id}: ${error.message}`));
    } else {
      await channel.permissionOverwrites
        .delete(event.discord_id, 'Removed from the ticket')
        .catch((error) => console.warn(`[tickets] could not revoke access to #${event.ticket_id}: ${error.message}`));
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
    if (closed) await this.archiveChannel(channel, event.ticket_id);
    else await this.reopenChannel(channel, event.ticket_id);
  }

  /**
   * Einen Kanal zurück in den Betrieb holen: Name und Kategorie.
   *
   * **Nur, wenn sich wirklich etwas ändert.** Discord begrenzt das Umbenennen eines Kanals auf
   * zwei Vorgänge in zehn Minuten – und `onPanelMessage` ruft das hier bei *jeder* Antwort auf.
   * Ein lebhaftes Ticket hat die Grenze damit nach der dritten Nachricht erreicht, und weil
   * discord.js daraufhin wartet statt abzubrechen, stand danach die ganze Warteschlange des Bots:
   * keine gespiegelten Nachrichten mehr, keine Rollen, nichts – für alle Tickets gleichzeitig.
   */
  async reopenChannel(channel, ticketId) {
    const name = `ticket-${ticketId}`;
    if (channel.name !== name) await channel.setName(name).catch(() => {});
    const parent = this.config.ticket_category;
    if (parent && String(channel.parentId || '') !== String(parent)) {
      await channel.setParent(parent).catch(() => {});
    }
  }

  /** Ins Archiv verschieben – ebenfalls nur, wenn der Kanal nicht schon dort steht. */
  async archiveChannel(channel, ticketId) {
    const name = `closed-${ticketId}`;
    if (channel.name !== name) await channel.setName(name).catch(() => {});
    if (String(channel.parentId || '') === ARCHIVE_CATEGORY_ID) return;
    // Die Kategorie gehört zur einen AFKSystems-Guild. Auf einer anderen Installation gibt es sie
    // nicht – dann bleibt der Kanal, wo er ist, statt bei jedem geschlossenen Ticket eine
    // Warnung über eine fremde ID ins Protokoll zu schreiben.
    if (!channel.guild?.channels?.cache?.has(ARCHIVE_CATEGORY_ID)) return;
    await channel.setParent(ARCHIVE_CATEGORY_ID).catch((error) =>
      console.warn(`[tickets] could not archive #${ticketId}: ${error.message}`)
    );
  }

  /**
   * Der Abgleich: Jedes laufende Ticket hat einen Kanal, und jeder Kanal steht, wo er hingehört.
   *
   * Beides gehört zusammen, denn beides ist dieselbe Frage – **stimmt Discord noch mit dem
   * Panel überein?** Bisher passte der Abgleich nur Namen und Kategorie an. Ein Ticket ohne Kanal
   * ging leer aus, und einen Kanal bekam es einzig in dem Moment, in dem es entstand: über die
   * offene Leitung zum Panel. War der Bot da nicht verbunden – Neustart, Umzug, ein Panel, das
   * gerade hochkam –, blieb dieses Ticket für immer ohne Kanal. Genau das passiert hier nicht
   * mehr: Was fehlt, wird nachgelegt, beim Start und danach jede Stunde.
   */
  async reconcileChannels() {
    const result = await this.bot.panel.call('/tickets?open=0').catch(() => null);
    const missing = [];
    for (const ticket of result?.tickets || []) {
      if (!ticket.channel_id) {
        if (ticket.status !== 'closed') missing.push(ticket);
        continue;
      }
      const channel = await this.bot.client.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel?.isTextBased()) {
        // Im Panel steht ein Kanal, den es nicht mehr gibt. Für ein laufendes Ticket ist das eine
        // Lücke wie jede andere – `ensureChannel` löst die Zuordnung und legt einen neuen an.
        if (ticket.status !== 'closed') missing.push(ticket);
        continue;
      }
      if (ticket.status === 'closed') await this.archiveChannel(channel, ticket.id);
      else await this.reopenChannel(channel, ticket.id);
    }

    if (!missing.length) return 0;
    const now = missing.slice(0, RECONCILE_LIMIT);
    console.log(`[tickets] ${missing.length} ticket(s) without a channel – opening ${now.length}`);
    if (missing.length > now.length) {
      console.log(`[tickets] ${missing.length - now.length} left for the next round`);
    }
    let opened = 0;
    for (const ticket of now) {
      if (await this.ensureChannel(ticket.id)) opened += 1;
    }
    return opened;
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
