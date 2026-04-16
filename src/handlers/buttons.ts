import "dotenv/config";
import pkg from "discord.js";
import pkgPrisma from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MediaGalleryBuilder, MediaGalleryItemBuilder } from "discord.js";
import { E } from "../emojis.js";
import { fetchStatsData, buildStatsImage } from "../commands/stats/stats.js";
import { fetchRecentTracks, buildRecentContainer } from "../commands/recent.js";
import { fetchTasteData, buildTasteCanvas, buildTasteContainer, PERIOD_LABELS_TASTE } from "../commands/taste.js";

const { PrismaClient } = pkgPrisma;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export async function handleButtonInteraction(interaction: any): Promise<void> {
  const { customId, guildId, guild } = interaction;

  // ─── Stats pagination ────────────────────────────────────────────────────────
  if (customId.startsWith('stats_prev_') || customId.startsWith('stats_next_')) {
    await interaction.deferUpdate();
    const parts = customId.split('_');
    const direction = parts[1] as 'prev' | 'next';
    const currentPage = parseInt(parts[2]);
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
    const guildName = guild?.name ?? 'Server';
    const apiKey = process.env.LASTFM_API_KEY!;

    const result = await fetchStatsData(guildId, apiKey);
    if (!result) return;
    const allMembers = result.members;

    const totalPages = Math.ceil(allMembers.length / 10);
    const imageBuffer = await buildStatsImage(allMembers, guildName, newPage);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'stats.png' });

    const container = new ContainerBuilder()
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL('attachment://stats.png')
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Page ${newPage + 1} of ${totalPages} • ${allMembers.length} members`
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stats_prev_${newPage}`)
        .setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(newPage === 0),
      new ButtonBuilder()
        .setCustomId(`stats_next_${newPage}`)
        .setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(newPage >= totalPages - 1),
    );
    container.addActionRowComponents(row as any);
    await interaction.editReply({ files: [attachment], components: [container], flags: 32768 });
    return;
  }

  // ─── Recent tracks pagination ─────────────────────────────────────────────────
  if (customId.startsWith('recent_prev_') || customId.startsWith('recent_next_')) {
    await interaction.deferUpdate();
    const parts = customId.split('_');
    const direction = parts[1] as 'prev' | 'next';
    const currentPage = parseInt(parts[2]);
    const targetDiscordId = parts[3];
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
    const apiKey = process.env.LASTFM_API_KEY!;

    const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
    if (!dbUser?.lastfmUsername) return;
    const rawTracks = await fetchRecentTracks(dbUser.lastfmUsername, apiKey);
    if (!rawTracks) return;
    const container = buildRecentContainer(rawTracks, dbUser.lastfmUsername, targetDiscordId, newPage);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── Taste pagination ─────────────────────────────────────────────────────────
  if (customId.startsWith('taste_prev_') || customId.startsWith('taste_next_')) {
    await interaction.deferUpdate();
    const parts = customId.split('_');
    const direction = parts[1] as 'prev' | 'next';
    const currentPage = parseInt(parts[2]);
    const targetDiscordId = parts[3];
    const period = parts[4] ?? 'overall';  // period key stored directly
    const periodLabel = PERIOD_LABELS_TASTE[period] ?? 'All time';
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
    const apiKey = process.env.LASTFM_API_KEY!;

    const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
    if (!dbUser?.lastfmUsername) return;

    const allGenres = await fetchTasteData(dbUser.lastfmUsername, period, apiKey);
    if (!allGenres) return;

    const imageBuffer = await buildTasteCanvas(allGenres, dbUser.lastfmUsername, periodLabel, newPage);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'taste.png' });
    const container = buildTasteContainer(allGenres, attachment, dbUser.lastfmUsername, periodLabel, newPage, targetDiscordId, period);
    await interaction.editReply({ files: [attachment], components: [container], flags: 32768 });
    return;
  }
}
