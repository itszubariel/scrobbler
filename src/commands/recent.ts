import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";
import { pageStr } from "../utils.js";
import { getCache, setCache } from "../cache.js";

const RECENT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = pkg;

import type { Command } from "../index.ts";
import { cmdMention } from "../utils.js";

const PAGE_SIZE = 10;

interface CachedRecent {
  tracks: Array<{
    name: string;
    artist: string;
    url: string | null;
    timeAgo: string;
    timestamp: number | null;
  }>;
  headerTrack: {
    name: string;
    artist: string;
    url: string | null;
    isNowPlaying: boolean;
  };
  totalPages: number;
  totalTracks: number;
  uniqueArtists: number;
}

export async function fetchRecentTracks(lfmUsername: string, apiKey: string) {
  const res = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json&limit=50`,
  );
  const data = (await res.json()) as any;
  if (data.error) return null;
  const raw: any[] = Array.isArray(data.recenttracks?.track)
    ? data.recenttracks.track
    : [data.recenttracks?.track].filter(Boolean);
  return raw;
}

export function buildRecentContainer(
  rawTracks: any[],
  lfmUsername: string,
  targetDiscordId: string,
  page: number,
) {
  const headerTrack = rawTracks[0];
  const isNowPlaying = headerTrack?.["@attr"]?.nowplaying === "true";
  const firstName = headerTrack?.name ?? "Unknown Track";
  const firstArtist = headerTrack?.artist?.["#text"] ?? "Unknown Artist";
  const firstUrl = headerTrack?.url ?? null;
  const firstTrackText = firstUrl
    ? `[**${firstName}**](${firstUrl})`
    : `**${firstName}**`;
  const summaryLine = isNowPlaying
    ? `${E.musicalNote} Now playing: ${firstTrackText} by **${firstArtist}**`
    : `${E.musicalNote} Last played: ${firstTrackText} by **${firstArtist}**`;

  const listTracks = rawTracks.slice(1); // everything after header
  const totalPages = Math.ceil(listTracks.length / PAGE_SIZE);
  const pageTracks = listTracks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const lines = pageTracks.map((t) => {
    const name = t.name ?? "Unknown Track";
    const artist = t.artist?.["#text"] ?? "Unknown Artist";
    const url = t.url ?? null;
    const ago = t.date?.uts ? `<t:${t.date.uts}:R>` : "?";
    const trackText = url ? `[**${name}**](${url})` : `**${name}**`;
    return `${ago} • ${trackText} by **${artist}**`;
  });

  const uniqueArtists = new Set(
    rawTracks.map((t) => t.artist?.["#text"]).filter(Boolean),
  ).size;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${lfmUsername}'s Recent Tracks`),
      new TextDisplayBuilder().setContent(summaryLine),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${rawTracks.length} scrobbles • ${uniqueArtists} unique artists • ${pageStr(page, totalPages)}`,
      ),
    );

  if (totalPages > 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`recent_prev_${page}_${targetDiscordId}`)
        .setEmoji({
          id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
          name: "rewind_prev",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`recent_next_${page}_${targetDiscordId}`)
        .setEmoji({
          id: E.next.match(/:(\d+)>/)?.[1] ?? "0",
          name: "rewind_next",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    );
    container.addActionRowComponents(row as any);
  }

  return container;
}

export const recentCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("recent")
    .setDescription("Your recently scrobbled tracks")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Check another user's recent tracks (optional)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser =
      interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;

    // Check cache first
    const cacheKey = `recent_${targetDiscordUser.id}`;
    const cached = await getCache<CachedRecent>(cacheKey);

    if (cached) {
      // Rebuild from cache
      const dbUser = await prisma.user.findUnique({
        where: { discordId: targetDiscordUser.id },
      });
      const lfmUsername = dbUser?.lastfmUsername ?? targetDiscordUser.username;

      const headerTrack = cached.headerTrack;
      const summaryLine = headerTrack.isNowPlaying
        ? `${E.musicalNote} Now playing: ${headerTrack.url ? `[**${headerTrack.name}**](${headerTrack.url})` : `**${headerTrack.name}**`} by **${headerTrack.artist}**`
        : `${E.musicalNote} Last played: ${headerTrack.url ? `[**${headerTrack.name}**](${headerTrack.url})` : `**${headerTrack.name}**`} by **${headerTrack.artist}**`;

      const page = 0;
      const pageTracks = cached.tracks.slice(
        page * PAGE_SIZE,
        (page + 1) * PAGE_SIZE,
      );

      const lines = pageTracks.map((t) => {
        const trackText = t.url ? `[**${t.name}**](${t.url})` : `**${t.name}**`;
        return `${t.timeAgo} • ${trackText} by **${t.artist}**`;
      });

      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## ${lfmUsername}'s Recent Tracks`,
          ),
          new TextDisplayBuilder().setContent(summaryLine),
        )
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(lines.join("\n")),
        )
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `-# ${cached.totalTracks} scrobbles • ${cached.uniqueArtists} unique artists • ${pageStr(page, cached.totalPages)}`,
          ),
        );

      if (cached.totalPages > 1) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`recent_prev_${page}_${targetDiscordUser.id}`)
            .setEmoji({
              id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
              name: "rewind_prev",
            })
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`recent_next_${page}_${targetDiscordUser.id}`)
            .setEmoji({
              id: E.next.match(/:(\d+)>/)?.[1] ?? "0",
              name: "rewind_next",
            })
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= cached.totalPages - 1),
        );
        container.addActionRowComponents(row as any);
      }

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
    const rawTracks = await fetchRecentTracks(lfmUsername, apiKey);

    if (!rawTracks) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    // Build cache data
    const headerTrack = rawTracks[0];
    const listTracks = rawTracks.slice(1);
    const totalPages = Math.ceil(listTracks.length / PAGE_SIZE);
    const uniqueArtists = new Set(
      rawTracks.map((t) => t.artist?.["#text"]).filter(Boolean),
    ).size;

    const cacheData: CachedRecent = {
      tracks: listTracks.map((t) => ({
        name: t.name ?? "Unknown Track",
        artist: t.artist?.["#text"] ?? "Unknown Artist",
        url: t.url ?? null,
        timeAgo: t.date?.uts ? `<t:${t.date.uts}:R>` : "?",
        timestamp: t.date?.uts ? parseInt(t.date.uts) : null,
      })),
      headerTrack: {
        name: headerTrack?.name ?? "Unknown Track",
        artist: headerTrack?.artist?.["#text"] ?? "Unknown Artist",
        url: headerTrack?.url ?? null,
        isNowPlaying: headerTrack?.["@attr"]?.nowplaying === "true",
      },
      totalPages,
      totalTracks: rawTracks.length,
      uniqueArtists,
    };

    // Save to cache (5 minutes TTL)
    await setCache(cacheKey, cacheData, 5);

    const container = buildRecentContainer(
      rawTracks,
      lfmUsername,
      targetDiscordUser.id,
      0,
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
