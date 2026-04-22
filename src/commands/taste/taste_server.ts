import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { AttachmentBuilder } from "discord.js";
import { cmdMention } from "../../utils.js";
import {
  fetchTasteData,
  buildTasteCanvas,
  buildTasteServerContainer,
  PERIOD_LABELS_TASTE,
  isBlockedTag,
} from "./taste_helpers.js";

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = pkg;

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

  // Fetch each member's taste data in parallel, then aggregate
  const memberGenres = await Promise.all(
    linkedMembers.map(m => fetchTasteData(m.user.lastfmUsername!, period, apiKey))
  );

  // Pool all tag weights across members — each member contributes their pct scores
  const tagWeights = new Map<string, number>();
  for (const genres of memberGenres) {
    if (!genres) continue;
    for (const { tag, pct } of genres) {
      tagWeights.set(tag, (tagWeights.get(tag) ?? 0) + pct);
    }
  }

  const sorted = [...tagWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  if (sorted.length === 0) return null;

  const total = sorted.reduce((sum, [, w]) => sum + w, 0);
  return sorted.map(([tag, weight]) => ({
    tag,
    pct: Math.round((weight / total) * 100),
  }));
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
      new TextDisplayBuilder().setContent(
        `${E.reject} No members have linked their Last.fm yet. Use ${cmdMention('link')} to get started.`
      )
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

  const page = 0;
  const imageBuffer = await buildTasteCanvas(allGenres, `${guildName}'s Taste Profile`, periodLabel, page);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'taste.png' });
  const container = buildTasteServerContainer(allGenres, attachment, guildName, periodLabel, page, interaction.guildId, period);

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
