// Die Slash-Befehle.
//
// Genau einer, und der ist für das Team: **/roles**.
//
// `/ticket` und `/account` gab es einmal und gibt es bewusst nicht mehr. Ein Ticket macht man dort
// auf, wo die Erklärung dazu steht – am Knopf im Support-Kanal; ein Befehl mit zwei Textfeldern
// daneben war ein zweiter Weg zum selben Ziel, den niemand suchen konnte. Und was am Konto steht,
// steht vollständig im Panel: Tarif, Laufzeit, Guthaben, Serverplätze. Eine Kurzfassung davon in
// Discord veraltet, sobald sie geschrieben ist.

import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export function definitions() {
  return [
    new SlashCommandBuilder()
      .setName('roles')
      .setDescription('Syncs every member role with the panel. Staff only.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .toJSON(),
  ];
}

export async function handle(bot, interaction) {
  if (interaction.commandName === 'roles') return sync(bot, interaction);
}

async function sync(bot, interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const changed = await bot.roles.syncAll();
  await interaction.editReply(
    changed ? `Updated ${changed} member(s).` : 'Everything was already up to date.'
  );
}
