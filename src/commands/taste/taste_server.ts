import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { cmdMention } from "../../utils.js";
import { uploadToSupabase } from "../../uploadToSupabase.js";
import {
  fetchTasteData,
  buildTasteCanvas,
  buildTasteServerContainer,
  PERIOD_LABELS_TASTE,
  TASTE_PAGE_SIZE,
  isBlockedTag,
} from "./taste_helpers.js";

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = pkg;

const TTL_MS = 15 * 60 * 1000;

export async function fetchServerTasteData(
  guildId: string,
  period: string,
  apiKey: string
): Promise<{ tag: string; pct: number }[] | null> {
  const server = await prisma.server.findUnique({
    where: { guildId },
    include: { members: { include: { user: true } } },
  });

  const linkedMembers = server?.members.filter(m => m.user.lastfmUsername) ?? [];
  if (linkedMembers.length === 0) return null;

  const memberGenres = await Promise.all(
    linkedMembers.map(m => fetchTasteData(m.user.lastfmUsername!, period, apiKey))
  );

  const tagWeights = new Map<string, number>();
  for (const genres of memberGenres) {
    if (!genres) continue;
    for (const { tag, pct } of genres) {
      tagWeights.set(tag, (tagWeights.get(tag) ?? 0) + pct);
    }
  }

  const sorted = [...tagWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
  if (sorted.length === 0) return null;

  const total = sorted.reduce((sum, [, w]) => sum + w, 0);
  return sorted.map(([tag, weight]) => ({ tag, pct: Math.round((weight / total) * 100) }));
}

export async function executeTasteServer(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;

  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} This command only works in servers.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const period = interaction.options.getString("period") ?? "overall";
  const periodLabel = PERIOD_LABELS_TASTE[period] ?? "All time";
  const guildName = interaction.guild.name;

  const server = await prisma.server.findUnique({
    where: { guildId: interaction.guildId },
    include: { members: { include: { user: true } } },
  });

  const linkedMembers = server?.members.filter(m => m.user.lastfmUsername) ?? [];
  if (linkedMembers.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} No members have linked their Last.fm yet. Use ${cmdMention('link')} to get started.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const allGenres = await fetchServerTasteData(interaction.guildId, period, apiKey);
  if (!allGenres) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't determine genre data for this server.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const totalPages = Math.ceil(allGenres.length / TASTE_PAGE_SIZE);
  const title = `${guildName}'s Taste Profile`;

  const buffers = await Promise.all(
    Array.from({ length: totalPages }, (_, i) => buildTasteCanvas(allGenres, title, periodLabel, i))
  );
  const urls = await Promise.all(
    buffers.map((buf, i) => uploadToSupabase(buf, 'taste-cache', `server_${interaction.guildId}_${period}_${i}.png`))
  );

  await (prisma as any).tasteServerCache.upsert({
    where: { guildId_period: { guildId: interaction.guildId, period } },
    create: { guildId: interaction.guildId, period, urls, totalPages, expiresAt: new Date(Date.now() + TTL_MS) },
    update: { urls, totalPages, expiresAt: new Date(Date.now() + TTL_MS) },
  });

  const memberCount = linkedMembers.length;
  await (prisma as any).tasteServerCache.upsert({
    where: { guildId_period: { guildId: interaction.guildId, period } },
    create: { guildId: interaction.guildId, period, urls, totalPages, memberCount, expiresAt: new Date(Date.now() + TTL_MS) },
    update: { urls, totalPages, memberCount, expiresAt: new Date(Date.now() + TTL_MS) },
  });

  const container = buildTasteServerContainer(allGenres, null, guildName, periodLabel, 0, interaction.guildId, period, urls[0]!, memberCount);
  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
