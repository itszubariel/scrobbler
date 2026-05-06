import "dotenv/config";
import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { cmdMention, pageStr } from "../../utils.js";
import { buildLeaderboardCanvas } from "./canvas.js";
import { uploadToSupabase } from "../../uploadToSupabase.js";
import { getCache, setCache } from "../../cache.js";

const PAGE_SIZE = 10;
const TTL_MS = 10 * 60 * 1000;

interface CachedStats {
  imageUrls: string[];
  pageCount: number;
  memberCount: number;
}

const BLOCKED_TAGS = new Set([
  "seen live",
  "favorites",
  "favourite",
  "favorite",
  "owned",
]);
function isBlockedTag(tag: string, artistNames: Set<string>): boolean {
  const lower = tag.toLowerCase();
  if (BLOCKED_TAGS.has(lower)) return true;
  if (/^\d{4}$/.test(lower)) return true;
  if (artistNames.has(lower)) return true;
  return false;
}

export async function executeStatsGenres(interaction: any): Promise<void> {
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
  const cacheKey = `stats_genres_${interaction.guildId}`;
  const cached = await getCache<CachedStats>(cacheKey);

  if (cached && cached.imageUrls && cached.imageUrls.length > 0) {
    // Cache hit - skip all generation and member fetching
    const callerDb = await prisma.user.findUnique({
      where: { discordId: interaction.user.id },
    });
    const callerLfm = callerDb?.lastfmUsername;

    const footerParts = [
      `${cached.memberCount} members • Unique genres from top 50 artists`,
    ];

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${E.listening} Server Genre Leaderboard — All time`,
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
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# ${pageStr(0, cached.pageCount)} • ${footerParts.join(" • ")}`,
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(false)
          .setSpacing(SeparatorSpacingSize.Small),
      );

    if (cached.pageCount > 1) {
      const authorId = interaction.user.id;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`stats_genres_prev_0_${authorId}`)
          .setEmoji({
            id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
            name: "scrobbler_prev",
          })
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`stats_genres_next_0_${authorId}`)
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

  const server = await prisma.server.findUnique({
    where: { guildId: interaction.guildId },
    include: { members: { include: { user: true } } },
  });

  if (!server) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} This server isn't set up yet.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const linkedMembers = server.members.filter((m) => m.user.lastfmUsername);
  if (linkedMembers.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} No members have linked their Last.fm yet. Use ${cmdMention("link")} to get started.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const memberArtistResults = (await Promise.all(
    linkedMembers.map((m) =>
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(m.user.lastfmUsername!)}&period=overall&limit=50&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ),
  )) as any[];

  const memberGenreCounts = await Promise.all(
    linkedMembers.map(async (m, memberIdx) => {
      const artists: any[] =
        memberArtistResults[memberIdx]?.topartists?.artist ?? [];
      const artistNames = new Set(artists.map((a) => a.name.toLowerCase()));
      const artistInfos = (await Promise.all(
        artists.slice(0, 30).map((a) =>
          fetch(
            `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`,
          )
            .then((r) => r.json())
            .catch(() => null),
        ),
      )) as any[];
      const uniqueGenres = new Set<string>();
      for (const info of artistInfos) {
        const tags: any[] = info?.artist?.tags?.tag ?? [];
        tags.slice(0, 3).forEach((tag: any) => {
          const name = (tag.name as string).toLowerCase();
          if (!isBlockedTag(name, artistNames)) uniqueGenres.add(name);
        });
      }
      return { username: m.user.lastfmUsername!, count: uniqueGenres.size };
    }),
  );

  const allMembers = memberGenreCounts
    .sort((a, b) => b.count - a.count)
    .map((m) => ({ ...m, displayCount: m.count.toLocaleString("en-US") }));
  const totalGenres = allMembers
    .reduce((s, m) => s + m.count, 0)
    .toLocaleString("en-US");

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

  const totalPages = Math.ceil(allMembers.length / PAGE_SIZE);
  const memberCount = allMembers.length;

  const buffers = await Promise.all(
    Array.from({ length: totalPages }, (_, i) =>
      buildLeaderboardCanvas(
        allMembers,
        interaction.guild.name,
        "genres",
        `Total unique genres: ${totalGenres}`,
        i,
      ),
    ),
  );
  const urls = await Promise.all(
    buffers.map((buf, i) =>
      uploadToSupabase(
        buf,
        "stats-cache",
        `genres_${interaction.guildId}_${i}.png`,
      ),
    ),
  );

  // Save to generic cache
  const cacheData: CachedStats = {
    imageUrls: urls,
    pageCount: totalPages,
    memberCount,
  };
  await setCache(cacheKey, cacheData, 60);

  const footerParts = [
    `${memberCount} members • Unique genres from top 50 artists`,
  ];
  if (callerRank > PAGE_SIZE && callerEntry)
    footerParts.push(
      `You are ranked **#${callerRank}** with **${callerEntry.count}** genres`,
    );

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.listening} Server Genre Leaderboard — All time`,
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
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${pageStr(0, totalPages)} • ${footerParts.join(" • ")}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(false)
        .setSpacing(SeparatorSpacingSize.Small),
    );

  if (totalPages > 1) {
    const authorId = interaction.user.id;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stats_genres_prev_0_${authorId}`)
        .setEmoji({
          id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
          name: "scrobbler_prev",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`stats_genres_next_0_${authorId}`)
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
