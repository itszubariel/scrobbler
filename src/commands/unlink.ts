import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";
import { invalidateUserCache } from "../cache.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
} = pkg;

import type { Command } from "../index.ts";

export const unlinkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Disconnect your Last.fm account"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const discordId = interaction.user.id;

    const user = await prisma.user.findUnique({ where: { discordId } });

    if (!user?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} You don't have a Last.fm account linked.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const username = user.lastfmUsername;

    await prisma.user.update({
      where: { discordId },
      data: { lastfmUsername: null },
    });

    // Invalidate all user caches
    await invalidateUserCache(discordId);

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.accept} Unlinked **${username}** from your account.`,
      ),
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
