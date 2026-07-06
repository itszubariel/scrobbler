import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";
import { getCache, setCache } from "../cache.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = pkg;

import type { Command } from "../index.js";
import { cmdMention } from "../utils.js";

interface CachedEra {
  periodLabel: string;
  eraLabel: string;
  vibeEmoji: string;
  dominantGenre: string;
  topArtists: Array<{ name: string; playcount: number }>;
  topTrack: { name: string; artist: string; playcount: number } | null;
  lfmUsername: string;
}

const PERIOD_LABELS: Record<string, string> = {
  "7day": "Last 7 days",
  "1month": "Last month",
  "3month": "Last 3 months",
  "6month": "Last 6 months",
  "12month": "Last year",
  overall: "All time",
};

const BLOCKED_TAGS = new Set([
  "seen live",
  "favorites",
  "favourite",
  "favorite",
  "owned",
  "under 2000 listeners",
  "spotify",
  "youtube",
]);

function getEraLabel(genre: string): { label: string; emoji: string } {
  const g = genre.toLowerCase();

  if (/metal|hardcore|grindcore|deathcore|doom|sludge/.test(g))
    return { label: "heavy era", emoji: "🤘" };
  if (/punk|emo|post-hardcore|screamo/.test(g))
    return { label: "punk era", emoji: "⚡" };
  if (
    /electronic|edm|techno|house|trance|dubstep|drum and bass|dnb|ambient|synthwave|hyperpop/.test(
      g,
    )
  )
    return { label: "electronic era", emoji: "🎛️" };
  if (/hip.?hop|rap|trap|drill|grime|r&b|rnb/.test(g))
    return { label: "hip-hop era", emoji: "🎤" };
  if (/jazz|soul|blues|funk|gospel|swing|bebop/.test(g))
    return { label: "soul era", emoji: "🎷" };
  if (/classical|orchestral|opera|symphony|chamber|baroque/.test(g))
    return { label: "classical era", emoji: "🎻" };
  if (/folk|country|americana|bluegrass|singer.?songwriter/.test(g))
    return { label: "folk era", emoji: "🪕" };
  if (/indie|alternative|shoegaze|dream pop|lo.?fi|bedroom pop/.test(g))
    return { label: "indie era", emoji: "🌿" };
  if (/pop|dance pop|synth.?pop|electropop|k.?pop|j.?pop/.test(g))
    return { label: "pop era", emoji: "✨" };
  if (/rock|grunge|post.?rock|prog|psychedelic/.test(g))
    return { label: "rock era", emoji: "🎸" };

  // Fallback — use the genre name itself
  return { label: `${genre} era`, emoji: "🎵" };
}

export const eraCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("era")
    .setDescription("What's your current music era?")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Check another user's era (optional)")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("Time period (default: last month)")
        .setRequired(false)
        .addChoices(
          { name: "Last 7 days", value: "7day" },
          { name: "Last month", value: "1month" },
          { name: "Last 3 months", value: "3month" },
          { name: "Last 6 months", value: "6month" },
          { name: "Last year", value: "12month" },
          { name: "All time", value: "overall" },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser =
      interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;
    const period =
      (interaction.options.getString("period") as string | null) ?? "1month";
    const periodLabel = PERIOD_LABELS[period] ?? "Last month";

    // Cache key includes period so different periods are cached separately
    const cacheKey = `era_${targetDiscordUser.id}_${period}`;
    const cached = await getCache<CachedEra>(cacheKey);

    if (cached) {
      const container = buildEraContainer(cached);
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const dbUser = await prisma.user.findUnique({
      where: { discordId: targetDiscordUser.id },
    });

    if (!dbUser?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          isOwnProfile
            ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention("link")} to get started.`
            : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const lfmUsername = dbUser.lastfmUsername;

    // Fetch top artists and top track in parallel
    const [artistsRes, tracksRes] = (await Promise.all([
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=50&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null),
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=1&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ])) as any[];

    const topArtistsRaw: any[] = artistsRes?.topartists?.artist ?? [];

    if (topArtistsRaw.length === 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} No listening data found for **${lfmUsername}** in that period.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    // Fetch artist info for genre tags (top 20 artists)
    const top20Artists = topArtistsRaw.slice(0, 20);
    const artistInfos = (await Promise.all(
      top20Artists.map((a: any) =>
        fetch(
          `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`,
        )
          .then((r) => r.json())
          .catch(() => null),
      ),
    )) as any[];

    // Tally genre tags weighted by playcount
    const tagWeights = new Map<string, number>();
    for (let i = 0; i < top20Artists.length; i++) {
      const artist = top20Artists[i];
      const info = artistInfos[i];
      const playcount = parseInt(artist.playcount ?? "0") || 1;
      const tags: any[] = Array.isArray(info?.artist?.tags?.tag)
        ? info.artist.tags.tag
        : info?.artist?.tags?.tag
          ? [info.artist.tags.tag]
          : [];

      for (const tag of tags.slice(0, 3)) {
        const name = (tag.name as string).toLowerCase().trim();
        if (
          !BLOCKED_TAGS.has(name) &&
          !/^\d{4}$/.test(name) &&
          name.length > 1
        ) {
          tagWeights.set(name, (tagWeights.get(name) ?? 0) + playcount);
        }
      }
    }

    // Pick dominant genre
    const sortedTags = [...tagWeights.entries()].sort((a, b) => b[1] - a[1]);
    const dominantGenre =
      sortedTags.length > 0
        ? sortedTags[0]![0]
            .split(" ")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
        : "Music";

    const { label: eraLabel, emoji: vibeEmoji } = getEraLabel(dominantGenre);

    // Top 3 artists for the period
    const topArtists = topArtistsRaw.slice(0, 3).map((a: any) => ({
      name: a.name as string,
      playcount: parseInt(a.playcount ?? "0"),
    }));

    // Top track
    const topTrackRaw = tracksRes?.toptracks?.track?.[0] ?? null;
    const topTrack = topTrackRaw
      ? {
          name: topTrackRaw.name as string,
          artist: topTrackRaw.artist?.name as string,
          playcount: parseInt(topTrackRaw.playcount ?? "0"),
        }
      : null;

    const cacheData: CachedEra = {
      periodLabel,
      eraLabel,
      vibeEmoji,
      dominantGenre,
      topArtists,
      topTrack,
      lfmUsername,
    };

    // Cache for 60 minutes
    await setCache(cacheKey, cacheData, 60);

    const container = buildEraContainer(cacheData);
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

function buildEraContainer(data: CachedEra) {
  const {
    periodLabel,
    eraLabel,
    vibeEmoji,
    dominantGenre,
    topArtists,
    topTrack,
    lfmUsername,
  } = data;

  const medals = ["🥇", "🥈", "🥉"];

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### Music Era — ${lfmUsername}`),
      new TextDisplayBuilder().setContent(
        `# You're in your ${eraLabel} ${vibeEmoji}`,
      ),
      new TextDisplayBuilder().setContent(
        `-# ${periodLabel} • Dominant genre: **${dominantGenre}**`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    );

  // Top artists
  if (topArtists.length > 0) {
    const artistLines = topArtists
      .map(
        (a, i) =>
          `${medals[i] ?? `${i + 1}.`} **${a.name}** — ${a.playcount.toLocaleString("en-US")} plays`,
      )
      .join("\n");

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${E.artists} Top Artists**\n${artistLines}`,
      ),
    );
  }

  // Top track
  if (topTrack) {
    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(false)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**${E.musicalNote} Most Played Track**\n**${topTrack.name}** by ${topTrack.artist} — ${topTrack.playcount.toLocaleString("en-US")} plays`,
        ),
      );
  }

  container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Based on your top 50 artists • ${periodLabel}`,
      ),
    );

  return container;
}
