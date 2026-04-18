import "dotenv/config";
import pkg from "discord.js";
import { E } from "../../emojis.js";
import { AttachmentBuilder } from "discord.js";
import { fetchStatsData, buildStatsImage } from "./stats.js";
import { cmdMention } from "../../utils.js";
import { prisma } from "../../db.js";

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = pkg;

const PAGE_SIZE = 10;

export async function executeStatsScrobbles(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;

  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} This command only works in servers.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const result = await fetchStatsData(interaction.guildId, apiKey);

  if (!result || result.members.length < 2) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} Not enough members have linked their Last.fm yet! Have more members use ${cmdMention('link')} to get started.`
      )
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const allMembers = result.members;
  const page = 0;
  const totalPages = Math.ceil(allMembers.length / PAGE_SIZE);

  // Find caller's rank
  const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const callerLfm = callerDb?.lastfmUsername;
  const callerRank = callerLfm ? allMembers.findIndex(m => m.username === callerLfm) + 1 : 0;
  const callerEntry = callerLfm ? allMembers.find(m => m.username === callerLfm) : null;
  const callerOnPage = callerRank > 0 && callerRank <= PAGE_SIZE;

  const footerText = callerRank > PAGE_SIZE && callerEntry
    ? `-# Page ${page + 1} of ${totalPages} • ${allMembers.length} members • You are **#${callerRank}** with **${callerEntry.scrobbles.toLocaleString()}** scrobbles`
    : `-# Page ${page + 1} of ${totalPages} • ${allMembers.length} members`;

  const imageBuffer = await buildStatsImage(allMembers, interaction.guild.name, page);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'stats.png' });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.graph} Server Scrobble Leaderboard — All time`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://stats.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerText)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );

  if (totalPages > 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stats_prev_${page}`)
        .setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`stats_next_${page}`)
        .setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false),
    );
    container.addActionRowComponents(row as any);
  }

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
