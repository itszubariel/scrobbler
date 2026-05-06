import "dotenv/config";
import {
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
} from "discord.js";
import { E } from "../../emojis.js";
import { fetchStatsData, buildStatsImage } from "./stats.js";
import { cmdMention, pageStr } from "../../utils.js";
import { prisma } from "../../db.js";
import { uploadToSupabase } from "../../uploadToSupabase.js";
import { getCache, setCache } from "../../cache.js";

const PAGE_SIZE = 10;
const TTL_MS = 10 * 60 * 1000;

interface CachedStats {
  imageUrls: string[];
  pageCount: number;
  memberCount: number;
}

export async function executeStatsScrobbles(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;

  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} This command only works in servers.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  // Check cache first
  const cacheKey = `stats_scrobbles_${interaction.guildId}`;
  const cached = await getCache<CachedStats>(cacheKey);

  if (cached && cached.imageUrls && cached.imageUrls.length > 0) {
    // Cache hit - skip all generation and member fetching
    const callerDb = await prisma.user.findUnique({
      where: { discordId: interaction.user.id },
    });
    const callerLfm = callerDb?.lastfmUsername;

    const pageFooter = `-# ${pageStr(0, cached.pageCount)} • ${cached.memberCount} members`;

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${E.graph} Server Scrobble Leaderboard — All time`,
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(cached.imageUrls[0]!),
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(pageFooter))
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(false)
          .setSpacing(SeparatorSpacingSize.Small),
      );

    if (cached.pageCount > 1) {
      const authorId = interaction.user.id;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`stats_prev_0_${authorId}`)
          .setEmoji({
            id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
            name: "scrobbler_prev",
          })
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`stats_next_0_${authorId}`)
          .setEmoji({
            id: E.next.match(/:(\d+)>/)?.[1] ?? "0",
            name: "scrobbler_next",
          })
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false),
      );
      container.addActionRowComponents(row as any);
    }

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const result = await fetchStatsData(interaction.guildId, apiKey);
  if (!result || result.members.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} No members have linked their Last.fm yet! Use ${cmdMention("link")} to get started.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const allMembers = result.members;
  const totalPages = Math.ceil(allMembers.length / PAGE_SIZE);

  const callerDb = await prisma.user.findUnique({
    where: { discordId: interaction.user.id },
  });
  const callerLfm = callerDb?.lastfmUsername;
  const callerRank = callerLfm
    ? allMembers.findIndex((m) => m.username === callerLfm) + 1
    : 0;
  const callerEntry = callerLfm
    ? allMembers.find((m) => m.username === callerLfm)
    : null;
  const footerText =
    callerRank > PAGE_SIZE && callerEntry
      ? `You are **#${callerRank}** with **${callerEntry.scrobbles.toLocaleString()}** scrobbles`
      : "";

  // Render all pages and upload
  const buffers = await Promise.all(
    Array.from({ length: totalPages }, (_, i) =>
      buildStatsImage(allMembers, interaction.guild.name, i),
    ),
  );
  const urls = await Promise.all(
    buffers.map((buf, i) =>
      uploadToSupabase(
        buf,
        "stats-cache",
        `scrobbles_${interaction.guildId}_${i}.png`,
      ),
    ),
  );

  // Save to generic cache
  const cacheData: CachedStats = {
    imageUrls: urls,
    pageCount: totalPages,
    memberCount: allMembers.length,
  };
  await setCache(cacheKey, cacheData, 60);

  const pageFooter = footerText
    ? `-# ${pageStr(0, totalPages)} • ${allMembers.length} members • ${footerText}`
    : `-# ${pageStr(0, totalPages)} • ${allMembers.length} members`;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.graph} Server Scrobble Leaderboard — All time`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(urls[0]!),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(pageFooter))
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(false)
        .setSpacing(SeparatorSpacingSize.Small),
    );

  if (totalPages > 1) {
    const authorId = interaction.user.id;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stats_prev_0_${authorId}`)
        .setEmoji({
          id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
          name: "scrobbler_prev",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`stats_next_0_${authorId}`)
        .setEmoji({
          id: E.next.match(/:(\d+)>/)?.[1] ?? "0",
          name: "scrobbler_next",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false),
    );
    container.addActionRowComponents(row as any);
  }

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
