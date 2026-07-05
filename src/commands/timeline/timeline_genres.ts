import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { buildTimelineCanvas } from "./canvas.js";
import type { TimelineSeries } from "./canvas.js";
import { cmdMention } from "../../utils.js";
import { getCache, setCache } from "../../cache.js";
import { uploadToSupabase } from "../../uploadToSupabase.js";

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = pkg;

interface CachedTimeline {
  imageUrl: string;
}

function getMonthWindows(count: number): { label: string; from: number; to: number }[] {
  const windows: { label: string; from: number; to: number }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const label = start.toLocaleString("en-US", { month: "short", year: "2-digit" });
    windows.push({ label, from: Math.floor(start.getTime() / 1000), to: Math.floor(end.getTime() / 1000) });
  }
  return windows;
}

// Fetch top 3 genres (by tag) for a given month window via top artists → artist tags
async function fetchTopGenres(
  lfmUsername: string,
  apiKey: string,
  from: number,
  to: number,
): Promise<Map<string, number>> {
  const genreMap = new Map<string, number>();

  // Grab the top artists for this window (page 1 only, limit 20)
  const topRes = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lfmUsername)}&from=${from}&to=${to}&limit=200&page=1&api_key=${apiKey}&format=json`,
  ).then((r) => r.json()).catch(() => null) as any;

  const tracks: any[] = topRes?.recenttracks?.track ?? [];

  // Count scrobbles per artist in this window
  const artistCounts = new Map<string, number>();
  for (const t of tracks) {
    if (t["@attr"]?.nowplaying) continue;
    const artist = t.artist?.["#text"];
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }

  // Take top 10 artists by scrobbles and fetch their tags
  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const tagResults = await Promise.all(
    topArtists.map(([artist]) =>
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&artist=${encodeURIComponent(artist)}&api_key=${apiKey}&format=json`,
      ).then((r) => r.json()).catch(() => null),
    ),
  ) as any[];

  for (let i = 0; i < topArtists.length; i++) {
    const [, scrobbles] = topArtists[i]!;
    const tags: any[] = tagResults[i]?.toptags?.tag ?? [];
    // Weight each genre by the artist's scrobble count, take top 3 tags
    for (const tag of tags.slice(0, 3)) {
      const name = (tag.name as string).toLowerCase();
      // Filter out meta-tags
      if (["seen live", "favorite", "favourites", "music", "all"].includes(name)) continue;
      genreMap.set(name, (genreMap.get(name) ?? 0) + scrobbles);
    }
  }

  return genreMap;
}

// Pick the top N genres that are most consistent across all months
function pickTopGenres(allGenreMaps: Map<string, number>[], topN = 3): string[] {
  const totalScore = new Map<string, number>();
  for (const gMap of allGenreMaps) {
    for (const [genre, score] of gMap) {
      totalScore.set(genre, (totalScore.get(genre) ?? 0) + score);
    }
  }
  return [...totalScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([g]) => g);
}

const SERIES_COLORS = ["#a78bfa", "#f472b6", "#34d399", "#fb923c", "#60a5fa"];

export const timelineGenresCommand = {
  execute: async (interaction: any) => {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;
    const months = interaction.options.getInteger("months") ?? 6;

    const cacheKey = `timeline_genres_${targetDiscordUser.id}_${months}`;
    const cached = await getCache<CachedTimeline>(cacheKey);
    if (cached?.imageUrl) {
      const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordUser.id } });
      const lfmUsername = dbUser?.lastfmUsername ?? targetDiscordUser.username;
      const container = buildContainer(cached.imageUrl, lfmUsername, months);
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordUser.id } });
    if (!dbUser?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          isOwnProfile
            ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention("link")} to get started.`
            : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`,
        ),
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const lfmUsername = dbUser.lastfmUsername;
    const windows = getMonthWindows(months);

    // Fetch genre maps for each month
    const genreMaps = await Promise.all(
      windows.map((w) => fetchTopGenres(lfmUsername, apiKey, w.from, w.to)),
    );

    const topGenres = pickTopGenres(genreMaps, 3);

    if (topGenres.length === 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Not enough listening data to build a genre timeline for **${lfmUsername}**.`,
        ),
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const series: TimelineSeries[] = topGenres.map((genre, gi) => ({
      name: genre.charAt(0).toUpperCase() + genre.slice(1),
      color: SERIES_COLORS[gi % SERIES_COLORS.length]!,
      points: windows.map((w, wi) => ({
        label: w.label,
        value: genreMaps[wi]?.get(genre) ?? 0,
      })),
    }));

    const buffer = await buildTimelineCanvas(
      series,
      `${lfmUsername}'s Genre Timeline`,
      `Top genre weight per month — last ${months} months`,
    );

    const imageUrl = await uploadToSupabase(buffer, "timeline-cache", `${targetDiscordUser.id}_genres_${months}.png`);
    await setCache(cacheKey, { imageUrl }, 60);

    const container = buildContainer(imageUrl, lfmUsername, months);
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};

function buildContainer(imageUrl: string, lfmUsername: string, months: number) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.music} ${lfmUsername}'s Genre Timeline`),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Top 3 genres by weight • Last ${months} months`),
    );
}
