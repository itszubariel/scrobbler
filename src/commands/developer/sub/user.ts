import { MessageFlags, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import { prisma } from "../../../db.js";

export async function executeDevUser(interaction: any): Promise<void> {
  const target = interaction.options.getUser('user', true);
  const dbUser = await prisma.user.findUnique({
    where: { discordId: target.id },
    include: { servers: { include: { server: true } } },
  });

  if (!dbUser) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`❌ No DB record for <@${target.id}>`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [
    `### 👤 User — ${target.username}`,
    `**DB ID:** ${dbUser.id}`,
    `**Discord ID:** ${dbUser.discordId}`,
    `**Last.fm:** ${dbUser.lastfmUsername ?? '—'}`,
    `**Session key:** ${dbUser.sessionKey ? '✅ set' : '❌ not set'}`,
    `**Servers:** ${dbUser.servers.map(s => s.server.name).join(', ') || '—'}`,
    `**Created:** ${dbUser.createdAt.toISOString()}`,
  ].join('\n');

  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
