import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { AttachmentBuilder } from "discord.js";
import { cmdMention } from "../../utils.js";
import {
  fetchTasteData,
  buildTasteCanvas,
  buildTasteContainer,
  PERIOD_LABELS_TASTE,
} from "./taste_helpers.js";

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = pkg;

export async function executeTasteUser(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
  const isOwnProfile = targetDiscordUser.id === interaction.user.id;
  const period = interaction.options.getString("period") ?? "overall";
  const periodLabel = PERIOD_LABELS_TASTE[period] ?? "All time";

  const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordUser.id } });

  if (!dbUser?.lastfmUsername) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isOwnProfile
          ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention('link')} to get started.`
          : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`
      )
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lfmUsername = dbUser.lastfmUsername;
  const allGenres = await fetchTasteData(lfmUsername, period, apiKey);

  if (!allGenres) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't determine genre data for **${lfmUsername}**.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const page = 0;
  const imageBuffer = await buildTasteCanvas(allGenres, `${lfmUsername}'s Taste Profile`, periodLabel, page);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'taste.png' });
  const container = buildTasteContainer(allGenres, attachment, lfmUsername, periodLabel, page, targetDiscordUser.id, period);

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
