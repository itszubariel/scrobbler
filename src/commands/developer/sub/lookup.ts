import { MessageFlags, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import { prisma } from "../../../db.js";

export async function executeDevLookup(interaction: any): Promise<void> {
  const username = interaction.options.getString("username", true);
  const dbUser = await prisma.user.findFirst({
    where: { lastfmUsername: { equals: username, mode: "insensitive" } },
    include: { servers: { include: { server: true } } },
  });

  if (!dbUser) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `❌ No user found with Last.fm username **${username}**`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const lines = [
    `### 🔎 Lookup — ${username}`,
    `**Discord:** <@${dbUser.discordId}> (${dbUser.username})`,
    `**DB ID:** ${dbUser.id}`,
    `**Session key:** ${dbUser.sessionKey ? "✅ set" : "❌ not set"}`,
    `**Servers:** ${dbUser.servers.map((s) => s.server.name).join(", ") || "—"}`,
    `**Created:** ${dbUser.createdAt.toISOString()}`,
  ].join("\n");

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines),
  );
  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
