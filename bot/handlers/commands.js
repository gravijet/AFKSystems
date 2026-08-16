// Die Slash-Befehle.
//
// Bewusst wenige: Was der Bot kann, soll man sehen können, ohne eine Liste zu lesen. Alles, was
// mehr als eine Zeile Antwort braucht, gehört ins Panel – dort ist Platz dafür.

import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const COLORS = { info: 0x206cfe, ok: 0x00bb7f, warn: 0xfcbb00 };

export function definitions() {
  return [
    new SlashCommandBuilder()
      .setName('account')
      .setDescription('Shows whether your Discord account is linked and which plan you have.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Opens a support ticket.')
      .addStringOption((option) =>
        option.setName('subject').setDescription('What is this about?').setRequired(true).setMaxLength(120)
      )
      .addStringOption((option) =>
        option.setName('message').setDescription('Describe the issue.').setRequired(true).setMaxLength(3000)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('roles')
      .setDescription('Syncs every member role with the panel. Staff only.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .toJSON(),
  ];
}

export async function handle(bot, interaction) {
  if (interaction.commandName === 'account') return account(bot, interaction);
  if (interaction.commandName === 'ticket') return ticket(bot, interaction);
  if (interaction.commandName === 'roles') return sync(bot, interaction);
}

async function account(bot, interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const linked = await bot.panel.call(`/users/${interaction.user.id}`).catch(() => null);

  if (!linked?.linked) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.warn)
          .setTitle('Account not linked yet')
          .setDescription(
            `Link your account in the panel to receive your Discord roles automatically:\n${bot.config.link_url}`
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
          { name: 'Plan', value: linked.plan || 'Free', inline: true },
          { name: 'Staff', value: linked.staff || linked.moderator ? 'yes' : 'no', inline: true }
        )
        .setFooter({ text: bot.config.panel_url.replace(/^https?:\/\//, ''), iconURL: bot.config.logo }),
    ],
  });
}

async function ticket(bot, interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await bot.panel.call('/tickets', {
      method: 'POST',
      body: {
        discord_id: interaction.user.id,
        subject: interaction.options.getString('subject'),
        body: interaction.options.getString('message'),
        category: 'general',
      },
    });
    const channel = await bot.tickets.openChannel(result.ticket, interaction.user.id);
    await interaction.editReply(
      channel ? `Ticket #${result.ticket.id}: <#${channel.id}>` : `Ticket #${result.ticket.id} is open.`
    );
  } catch (error) {
    await interaction.editReply(`That did not work: ${error.message}`);
  }
}

async function sync(bot, interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const changed = await bot.roles.syncAll();
  await interaction.editReply(
    changed ? `Updated ${changed} member(s).` : 'Everything was already up to date.'
  );
}
