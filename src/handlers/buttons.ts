import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MediaGalleryBuilder, MediaGalleryItemBuilder } from "discord.js";
import { E } from "../emojis.js";
import { fetchStatsData, buildStatsImage } from "../commands/stats/stats.js";
import { fetchRecentTracks, buildRecentContainer } from "../commands/recent.js";
import { fetchTasteData, buildTasteCanvas, buildTasteContainer, PERIOD_LABELS_TASTE } from "../commands/taste/taste.js";
import { fetchServerTasteData, executeTasteServer } from "../commands/taste/taste_server.js";
import { buildTasteServerContainer } from "../commands/taste/taste_helpers.js";
import { PERIOD_LABELS_WRAPPED } from "../commands/wrapped.js";

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
    const period = parts[4] ?? 'overall';
    const periodLabel = PERIOD_LABELS_TASTE[period] ?? 'All time';
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
    const apiKey = process.env.LASTFM_API_KEY!;

    const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
    if (!dbUser?.lastfmUsername) return;

    const allGenres = await fetchTasteData(dbUser.lastfmUsername, period, apiKey);
    if (!allGenres) return;

    const imageBuffer = await buildTasteCanvas(allGenres, `${dbUser.lastfmUsername}'s Taste Profile`, periodLabel, newPage);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'taste.png' });
    const container = buildTasteContainer(allGenres, attachment, dbUser.lastfmUsername, periodLabel, newPage, targetDiscordId, period);
    await interaction.editReply({ files: [attachment], components: [container], flags: 32768 });
    return;
  }

  // ─── Taste server pagination ──────────────────────────────────────────────────
  if (customId.startsWith('taste_server_prev_') || customId.startsWith('taste_server_next_')) {
    await interaction.deferUpdate();
    const parts = customId.split('_');
    // format: taste_server_{prev|next}_{page}_{guildId}_{period}
    const direction = parts[2] as 'prev' | 'next';
    const currentPage = parseInt(parts[3]);
    const storedGuildId = parts[4];
    const period = parts[5] ?? 'overall';
    const periodLabel = PERIOD_LABELS_TASTE[period] ?? 'All time';
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
    const apiKey = process.env.LASTFM_API_KEY!;
    const guildName = guild?.name ?? 'Server';

    const allGenres = await fetchServerTasteData(storedGuildId, period, apiKey);
    if (!allGenres) return;

    const imageBuffer = await buildTasteCanvas(allGenres, `${guildName}'s Taste Profile`, periodLabel, newPage);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'taste.png' });
    const container = buildTasteServerContainer(allGenres, attachment, guildName, periodLabel, newPage, storedGuildId, period);
    await interaction.editReply({ files: [attachment], components: [container], flags: 32768 });
    return;
  }

  // ─── Wrapped navigation ───────────────────────────────────────────────────────
  if (customId.startsWith('wrapped_prev_') || customId.startsWith('wrapped_next_')) {
    await interaction.deferUpdate();
    // format: wrapped_{prev|next}_{page}_{targetDiscordId}
    const parts = customId.split('_');
    const direction = parts[1] as 'prev' | 'next';
    const currentPage = parseInt(parts[2]);
    const targetDiscordId = parts[3];
    const TOTAL = 5;
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    // Look up cache
    const cache = await (prisma as any).wrappedCache.findUnique({ where: { discordId: targetDiscordId } });

    if (!cache || new Date(cache.expiresAt) < new Date()) {
      // Expired or missing
      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`This wrapped session has expired. Please run /wrapped again.`)
        );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`wrapped_prev_${newPage}_${targetDiscordId}`)
          .setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' })
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`wrapped_next_${newPage}_${targetDiscordId}`)
          .setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' })
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
      container.addActionRowComponents(row as any);
      await interaction.editReply({ components: [container], flags: 32768 });
      return;
    }

    const imageUrl = cache.urls[newPage - 1];
    if (!imageUrl) return;

    // Look up username + period label for the header
    const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
    const username = dbUser?.lastfmUsername ?? 'Unknown';
    const periodLabel = PERIOD_LABELS_WRAPPED[cache.period] ?? 'Last 7 days';

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${E.listening} ${username}'s Scrobbler Wrapped — ${periodLabel}`)
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl))
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Page ${newPage} of ${TOTAL} • ${periodLabel}`)
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`wrapped_prev_${newPage}_${targetDiscordId}`)
        .setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(newPage === 1),
      new ButtonBuilder()
        .setCustomId(`wrapped_next_${newPage}_${targetDiscordId}`)
        .setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(newPage === TOTAL),
    );
    container.addActionRowComponents(row as any);

    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }
}