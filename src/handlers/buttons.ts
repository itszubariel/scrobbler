import "dotenv/config";
import { prisma } from "../db.js";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MediaGalleryBuilder, MediaGalleryItemBuilder } from "discord.js";
import { E } from "../emojis.js";
import { cmdMention, pageStr } from "../utils.js";
import { buildRecentContainer } from "../commands/recent.js";
import { PERIOD_LABELS_TASTE } from "../commands/taste/taste.js";
import { PERIOD_LABELS_WRAPPED } from "../commands/wrapped.js";

const EXPIRED_MSG = (cmd: string) => `${E.reject} This session has expired. Please run ${cmdMention(cmd)} again.`;

function urlContainer(imageUrl: string, page: number, totalPages: number, footerText: string, prevId: string, nextId: string) {
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(prevId).setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' }).setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(nextId).setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' }).setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
  );
  container.addActionRowComponents(row as any);
  return container;
}

export async function handleButtonInteraction(interaction: any): Promise<void> {
  const { customId, guildId, guild } = interaction;
  const clickerId = interaction.user.id;

  // ─── Stats scrobbles pagination ────────────────────────────────────────────────
  if (customId.startsWith('stats_prev_') || customId.startsWith('stats_next_')) {
    const parts = customId.split('_');
    const authorId = parts[3];
    if (authorId && clickerId !== authorId) return;
    await interaction.deferUpdate();

    const direction = parts[1] as 'prev' | 'next';
    const currentPage = parseInt(parts[2]);
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    const cache = await (prisma as any).statsScrobblesCache.findUnique({ where: { guildId } });
    if (!cache || new Date(cache.expiresAt) < new Date()) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(EXPIRED_MSG('stats scrobbles')))], flags: 32768 });
      return;
    }

    const { urls, totalPages, footerText, memberCount } = cache;
    const footer = footerText
      ? `-# ${pageStr(newPage, totalPages)} • ${memberCount ?? ''} members • ${footerText}`
      : `-# ${pageStr(newPage, totalPages)} • ${memberCount ?? ''} members`;
    const container = urlContainer(urls[newPage], newPage, totalPages, footer, `stats_prev_${newPage}_${clickerId}`, `stats_next_${newPage}_${clickerId}`);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── Recent tracks pagination ──────────────────────────────────────────────────
  if (customId.startsWith('recent_prev_') || customId.startsWith('recent_next_')) {
    const parts = customId.split('_');
    const direction = parts[1] as 'prev' | 'next';
    const currentPage = parseInt(parts[2]);
    const targetDiscordId = parts[3];
    if (clickerId !== targetDiscordId) return;
    await interaction.deferUpdate();

    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
    const cache = await (prisma as any).recentCache.findUnique({ where: { discordId: targetDiscordId } });
    if (!cache || new Date(cache.expiresAt) < new Date()) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(EXPIRED_MSG('recent')))], flags: 32768 });
      return;
    }

    const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
    if (!dbUser?.lastfmUsername) return;
    const container = buildRecentContainer(cache.tracks as any[], dbUser.lastfmUsername, targetDiscordId, newPage);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── Taste user pagination ─────────────────────────────────────────────────────
  if (customId.startsWith('taste_prev_') || customId.startsWith('taste_next_')) {
    const parts = customId.split('_');
    const direction = parts[1] as 'prev' | 'next';
    const currentPage = parseInt(parts[2]);
    const targetDiscordId = parts[3];
    if (clickerId !== targetDiscordId) return;
    await interaction.deferUpdate();

    const period = parts[4] ?? 'overall';
    const periodLabel = PERIOD_LABELS_TASTE[period] ?? 'All time';
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    const cache = await (prisma as any).tasteUserCache.findUnique({ where: { discordId_period: { discordId: targetDiscordId, period } } });
    if (!cache || new Date(cache.expiresAt) < new Date()) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(EXPIRED_MSG('taste user')))], flags: 32768 });
      return;
    }

    const { urls, totalPages } = cache;
    const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
    const lfmUsername = dbUser?.lastfmUsername ?? 'Unknown';

    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${E.listening} ${lfmUsername}'s Top Genres — ${periodLabel}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(urls[newPage])))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${pageStr(newPage, totalPages)} • ${periodLabel}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`taste_prev_${newPage}_${targetDiscordId}_${period}`).setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' }).setStyle(ButtonStyle.Secondary).setDisabled(newPage === 0),
      new ButtonBuilder().setCustomId(`taste_next_${newPage}_${targetDiscordId}_${period}`).setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' }).setStyle(ButtonStyle.Secondary).setDisabled(newPage >= totalPages - 1),
    );
    container.addActionRowComponents(row as any);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── Taste server pagination ───────────────────────────────────────────────────
  if (customId.startsWith('taste_server_prev_') || customId.startsWith('taste_server_next_')) {
    const parts = customId.split('_');
    const direction = parts[2] as 'prev' | 'next';
    const currentPage = parseInt(parts[3]);
    const storedGuildId = parts[4];
    const period = parts[5] ?? 'overall';
    await interaction.deferUpdate();

    const periodLabel = PERIOD_LABELS_TASTE[period] ?? 'All time';
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    const cache = await (prisma as any).tasteServerCache.findUnique({ where: { guildId_period: { guildId: storedGuildId, period } } });
    if (!cache || new Date(cache.expiresAt) < new Date()) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(EXPIRED_MSG('taste server')))], flags: 32768 });
      return;
    }

    const { urls, totalPages, memberCount } = cache;
    const guildName = guild?.name ?? 'Server';
    const memberStr = memberCount ? ` • ${memberCount} members` : '';

    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${E.listening} ${guildName}'s Top Genres — ${periodLabel}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(urls[newPage])))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${pageStr(newPage, totalPages)}${memberStr} • ${periodLabel}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`taste_server_prev_${newPage}_${storedGuildId}_${period}`).setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' }).setStyle(ButtonStyle.Secondary).setDisabled(newPage === 0),
      new ButtonBuilder().setCustomId(`taste_server_next_${newPage}_${storedGuildId}_${period}`).setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' }).setStyle(ButtonStyle.Secondary).setDisabled(newPage >= totalPages - 1),
    );
    container.addActionRowComponents(row as any);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── Stats artists pagination ──────────────────────────────────────────────────
  if (customId.startsWith('stats_artists_prev_') || customId.startsWith('stats_artists_next_')) {
    const parts = customId.split('_');
    const authorId = parts[4];
    if (authorId && clickerId !== authorId) return;
    await interaction.deferUpdate();

    const direction = parts[2] as 'prev' | 'next';
    const currentPage = parseInt(parts[3]);
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    const cache = await (prisma as any).statsArtistsCache.findUnique({ where: { guildId } });
    if (!cache || new Date(cache.expiresAt) < new Date()) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(EXPIRED_MSG('stats artists')))], flags: 32768 });
      return;
    }

    const { urls, totalPages, memberCount } = cache;
    const container = urlContainer(urls[newPage], newPage, totalPages, `-# ${pageStr(newPage, totalPages)} • ${memberCount} members`, `stats_artists_prev_${newPage}_${clickerId}`, `stats_artists_next_${newPage}_${clickerId}`);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── Stats albums pagination ───────────────────────────────────────────────────
  if (customId.startsWith('stats_albums_prev_') || customId.startsWith('stats_albums_next_')) {
    const parts = customId.split('_');
    const authorId = parts[4];
    if (authorId && clickerId !== authorId) return;
    await interaction.deferUpdate();

    const direction = parts[2] as 'prev' | 'next';
    const currentPage = parseInt(parts[3]);
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    const cache = await (prisma as any).statsAlbumsCache.findUnique({ where: { guildId } });
    if (!cache || new Date(cache.expiresAt) < new Date()) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(EXPIRED_MSG('stats albums')))], flags: 32768 });
      return;
    }

    const { urls, totalPages, memberCount } = cache;
    const container = urlContainer(urls[newPage], newPage, totalPages, `-# ${pageStr(newPage, totalPages)} • ${memberCount} members`, `stats_albums_prev_${newPage}_${clickerId}`, `stats_albums_next_${newPage}_${clickerId}`);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── Stats genres pagination ───────────────────────────────────────────────────
  if (customId.startsWith('stats_genres_prev_') || customId.startsWith('stats_genres_next_')) {
    const parts = customId.split('_');
    const authorId = parts[4];
    if (authorId && clickerId !== authorId) return;
    await interaction.deferUpdate();

    const direction = parts[2] as 'prev' | 'next';
    const currentPage = parseInt(parts[3]);
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    const cache = await (prisma as any).statsGenresCache.findUnique({ where: { guildId } });
    if (!cache || new Date(cache.expiresAt) < new Date()) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(EXPIRED_MSG('stats genres')))], flags: 32768 });
      return;
    }

    const { urls, totalPages, memberCount } = cache;
    const container = urlContainer(urls[newPage], newPage, totalPages, `-# ${pageStr(newPage, totalPages)} • ${memberCount} members`, `stats_genres_prev_${newPage}_${clickerId}`, `stats_genres_next_${newPage}_${clickerId}`);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── WK pagination ────────────────────────────────────────────────────────────
  if (/^wk_(artist|album|track|genre)_(prev|next)_/.test(customId)) {
    const match = customId.match(/^wk_(artist|album|track|genre)_(prev|next)_(\d+)_([^_]+)_(.+)$/);
    if (!match) return;
    const [, type, dir, pageStr, storedGuildId, encodedKey] = match;
    const currentPage = parseInt(pageStr);
    const newPage = dir === 'next' ? currentPage + 1 : currentPage - 1;
    const cacheKey = `${type}:${decodeURIComponent(encodedKey)}`;
    await interaction.deferUpdate();

    const cache = await (prisma as any).wkCache.findUnique({ where: { guildId_key: { guildId: storedGuildId, key: cacheKey } } });
    if (!cache || new Date(cache.expiresAt) < new Date()) {
      await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(EXPIRED_MSG('wk')))], flags: 32768 });
      return;
    }

    const { urls, totalPages, totalListeners } = cache;
    const container = urlContainer(
      urls[newPage], newPage, totalPages,
      `-# ${pageStr(newPage, totalPages)} • ${totalListeners} listener${totalListeners === 1 ? '' : 's'} in this server`,
      `wk_${type}_prev_${newPage}_${storedGuildId}_${encodedKey}`,
      `wk_${type}_next_${newPage}_${storedGuildId}_${encodedKey}`
    );
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }

  // ─── Wrapped navigation ───────────────────────────────────────────────────────
  if (customId.startsWith('wrapped_prev_') || customId.startsWith('wrapped_next_')) {
    const parts = customId.split('_');
    const direction = parts[1] as 'prev' | 'next';
    const currentPage = parseInt(parts[2]);
    const targetDiscordId = parts[3];
    if (clickerId !== targetDiscordId) return;
    await interaction.deferUpdate();

    const TOTAL = 5;
    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    const cache = await (prisma as any).wrappedCache.findUnique({ where: { discordId: targetDiscordId } });

    if (!cache || new Date(cache.expiresAt) < new Date()) {
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`This wrapped session has expired. Please run ${cmdMention('wrapped')} again.`));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`wrapped_prev_${newPage}_${targetDiscordId}`).setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' }).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`wrapped_next_${newPage}_${targetDiscordId}`).setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' }).setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      container.addActionRowComponents(row as any);
      await interaction.editReply({ components: [container], flags: 32768 });
      return;
    }

    const imageUrl = cache.urls[newPage - 1];
    if (!imageUrl) return;

    const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
    const username = dbUser?.lastfmUsername ?? 'Unknown';
    const { PERIOD_LABELS_WRAPPED: PL } = await import('../commands/wrapped.js');
    const periodLabel = PL[cache.period] ?? 'Last 7 days';

    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${E.listening} ${username}'s Scrobbler Wrapped — ${periodLabel}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${newPage} of ${TOTAL} • ${periodLabel}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wrapped_prev_${newPage}_${targetDiscordId}`).setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' }).setStyle(ButtonStyle.Secondary).setDisabled(newPage === 1),
      new ButtonBuilder().setCustomId(`wrapped_next_${newPage}_${targetDiscordId}`).setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' }).setStyle(ButtonStyle.Secondary).setDisabled(newPage === TOTAL),
    );
    container.addActionRowComponents(row as any);
    await interaction.editReply({ components: [container], flags: 32768 });
    return;
  }
}
