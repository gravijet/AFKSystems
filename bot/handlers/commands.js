// Die Slash-Befehle.
//
// Bewusst wenige: Was der Bot kann, soll man sehen können, ohne eine Liste zu lesen. Alles, was
// mehr als eine Zeile Antwort braucht, gehört ins Panel – dort ist Platz dafür.

import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const COLORS = { info: 0x206cfe, ok: 0x00bb7f, warn: 0xfcbb00 };

export function definitions() {
  return [
    new SlashCommandBuilder()
      .setName('konto')
      .setDescription('Zeigt, ob dein Discord-Konto verknüpft ist und welchen Tarif du hast.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Macht ein Support-Ticket auf.')
      .addStringOption((option) =>
        option.setName('betreff').setDescription('Worum geht es?').setRequired(true).setMaxLength(120)
      )
      .addStringOption((option) =>
        option.setName('text').setDescription('Beschreib es kurz.').setRequired(true).setMaxLength(3000)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('rollen')
      .setDescription('Gleicht die Rollen aller Mitglieder mit dem Panel ab. Nur fürs Team.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .toJSON(),
  ];
}

export async function handle(bot, interaction) {
  if (interaction.commandName === 'konto') return account(bot, interaction);
  if (interaction.commandName === 'ticket') return ticket(bot, interaction);
  if (interaction.commandName === 'rollen') return sync(bot, interaction);
}

async function account(bot, interaction) {
  await interaction.deferReply({ ephemeral: true });
  const linked = await bot.panel.call(`/users/${interaction.user.id}`).catch(() => null);

  if (!linked?.linked) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.warn)
          .setTitle('Noch nicht verknüpft')
          .setDescription(
            `Verknüpfe dein Konto im Panel, dann bekommst du hier automatisch deine Rollen:\n${bot.config.link_url}`
          )
          .setThumbnail(bot.config.logo),
      ],
    });
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.ok)
        .setAuthor({ name: bot.config.brand, iconURL: bot.config.logo })
        .setTitle(linked.username)
        .addFields(
          { name: 'Tarif', value: linked.plan || 'Gratis', inline: true },
          { name: 'Team', value: linked.staff ? 'ja' : 'nein', inline: true }
        )
        .setFooter({ text: bot.config.panel_url.replace(/^https?:\/\//, ''), iconURL: bot.config.logo }),
    ],
  });
}

async function ticket(bot, interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await bot.panel.call('/tickets', {
      method: 'POST',
      body: {
        discord_id: interaction.user.id,
        subject: interaction.options.getString('betreff'),
        body: interaction.options.getString('text'),
        category: 'general',
      },
    });
    const channel = await bot.tickets.openChannel(result.ticket, interaction.user.id);
    await interaction.editReply(
      channel ? `Ticket #${result.ticket.id}: <#${channel.id}>` : `Ticket #${result.ticket.id} ist offen.`
    );
  } catch (error) {
    await interaction.editReply(`Das ging schief: ${error.message}`);
  }
}

async function sync(bot, interaction) {
  await interaction.deferReply({ ephemeral: true });
  const changed = await bot.roles.syncAll();
  await interaction.editReply(
    changed ? `${changed} Mitglieder angepasst.` : 'Alles war schon richtig.'
  );
}
