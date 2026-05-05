import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";
import {
  buildCoverCard,
  buildArtistsCard,
  buildTracksCard,
  buildTasteCard,
  buildStatsCard,
} from "./wrapped_canvas.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = pkg;

import type { Command } from "../index.js";
import { cmdMention } from "../utils.js";

export const PERIOD_LABELS_WRAPPED: Record<string, string> = {
  "7day": "Last 7 days",
  "1month": "This month",
  "3month": "Last 3 months",
  "6month": "Last 6 months",
  "12month": "Last year",
  overall: "All time",
};

const PERIOD_DAYS: Record<string, number> = {
  "7day": 7,
  "1month": 30,
  "3month": 90,
  "6month": 180,
  "12month": 365,
  overall: 365 * 5,
};

const BLOCKED_TAGS = new Set([
  "seen live",
  "favorites",
  "favourite",
  "favorite",
  "owned",
]);

export interface WrappedPayload {
  username: string;
  periodLabel: string;
  scrobbles: number;
  artistCount: number;
  trackCount: number;
  albumCount: number;
  topArtists: { name: string; playcount: number }[];
  artistImages: (string | null)[];
  topTracks: { name: string; artist: string; playcount: number }[];
  trackImages: (string | null)[];
  topGenres: { name: string; pct: number }[];
  discoveryScore: number;
  daysInPeriod: number;
}

export async function fetchWrappedData(
  lfmUsername: string,
  period: string,
  apiKey: string,
): Promise<WrappedPayload | null> {
  const periodLabel = PERIOD_LABELS_WRAPPED[period] ?? "Last 7 days";
  const daysInPeriod = PERIOD_DAYS[period] ?? 7;

  const [userInfoRes, topArtistsRes, topTracksRes] = (await Promise.all([
    fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`,
    )
      .then((r) => r.json())
      .catch(() => null),
    fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=10&api_key=${apiKey}&format=json`,
    )
      .then((r) => r.json())
      .catch(() => null),
    fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=10&api_key=${apiKey}&format=json`,
    )
      .then((r) => r.json())
      .catch(() => null),
  ])) as any[];

  if (!userInfoRes || userInfoRes.error) return null;

  const user = userInfoRes.user;
  const scrobbles = parseInt(user?.playcount ?? "0");
  const artistCount = parseInt(user?.artist_count ?? "0");
  const trackCount = parseInt(user?.track_count ?? "0");
  const albumCount = parseInt(user?.album_count ?? "0");

  const topArtists: any[] = topArtistsRes?.topartists?.artist ?? [];
  const topTracks: any[] = topTracksRes?.toptracks?.track ?? [];

  if (topArtists.length === 0) return null;

  // Fetch artist images + artist info in parallel
  const [deezerResults, artistInfoResults] = (await Promise.all([
    Promise.all(
      topArtists.slice(0, 5).map((a) =>
        fetch(
          `https://api.deezer.com/search/artist?q=${encodeURIComponent(a.name)}&limit=5`,
        )
          .then((r) => r.json())
          .catch(() => null),
      ),
    ),
    Promise.all(
      topArtists.map((a) =>
        fetch(
          `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`,
        )
          .then((r) => r.json())
          .catch(() => null),
      ),
    ),
  ])) as [any[], any[]];

  // Fetch track art from iTunes
  const trackArtResults = (await Promise.all(
    topTracks.slice(0, 5).map((t) =>
      fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent((t.artist?.name ?? "") + " " + t.name)}&entity=song&limit=1`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ),
  )) as any[];

  const artistImages: (string | null)[] = topArtists
    .slice(0, 5)
    .map((a: any, i: number) => {
      const results: any[] = deezerResults[i]?.data ?? [];
      const match =
        results.find(
          (r: any) => r.name.toLowerCase() === a.name.toLowerCase(),
        ) ??
        results[0] ??
        null;
      return match?.picture_xl ?? null;
    });

  const trackImages: (string | null)[] = topTracks
    .slice(0, 5)
    .map((_: any, i: number) => {
      const raw = trackArtResults[i]?.results?.[0]?.artworkUrl100 ?? null;
      return raw ? (raw as string).replace("100x100bb", "600x600bb") : null;
    });

  // Discovery score + genres
  let totalWeightedScore = 0;
  let totalPlaycount = 0;
  const tagWeights = new Map<string, number>();

  for (let i = 0; i < topArtists.length; i++) {
    const artist = topArtists[i];
    const info = artistInfoResults[i];
    const listeners = parseInt(info?.artist?.stats?.listeners ?? "0") || 0;
    const playcount = parseInt(artist.playcount ?? "0") || 1;
    totalWeightedScore += Math.min(listeners / 5_000_000, 1) * 100 * playcount;
    totalPlaycount += playcount;

    const tags: any[] = Array.isArray(info?.artist?.tags?.tag)
      ? info.artist.tags.tag
      : info?.artist?.tags?.tag
        ? [info.artist.tags.tag]
        : [];
    for (const tag of tags.slice(0, 3)) {
      const name = tag.name.toLowerCase();
      if (!BLOCKED_TAGS.has(name) && !/^\d{4}$/.test(name)) {
        tagWeights.set(name, (tagWeights.get(name) ?? 0) + playcount);
      }
    }
  }

  const mainstreamScore =
    totalPlaycount > 0 ? Math.round(totalWeightedScore / totalPlaycount) : 50;
  const discoveryScore = 100 - mainstreamScore;

  const sortedGenres = [...tagWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const totalGenreWeight = sortedGenres.reduce((s, [, w]) => s + w, 0);
  const topGenres = sortedGenres.map(([name, weight]) => ({
    name,
    pct: Math.round((weight / totalGenreWeight) * 100),
  }));

  return {
    username: lfmUsername,
    periodLabel,
    scrobbles,
    artistCount,
    trackCount,
    albumCount,
    topArtists: topArtists.map((a: any) => ({
      name: a.name,
      playcount: parseInt(a.playcount ?? "0"),
    })),
    artistImages,
    topTracks: topTracks.map((t: any) => ({
      name: t.name,
      artist: t.artist?.name ?? "",
      playcount: parseInt(t.playcount ?? "0"),
    })),
    trackImages,
    topGenres,
    discoveryScore,
    daysInPeriod,
  };
}

export async function buildWrappedCard(
  payload: WrappedPayload,
  page: number,
): Promise<Buffer> {
  const dailyAvg =
    payload.daysInPeriod > 0
      ? Math.round(payload.scrobbles / payload.daysInPeriod)
      : payload.scrobbles;
  const topGenre = payload.topGenres[0]?.name ?? "—";

  switch (page) {
    case 1:
      return buildCoverCard(payload.username, payload.scrobbles);
    case 2:
      return buildArtistsCard(
        payload.username,
        payload.topArtists,
        payload.artistImages,
      );
    case 3:
      return buildTracksCard(
        payload.username,
        payload.topTracks,
        payload.trackImages,
      );
    case 4:
      return buildTasteCard(
        payload.username,
        payload.topGenres,
        payload.discoveryScore,
      );
    case 5:
      return buildStatsCard(payload.username, {
        uniqueArtists: payload.artistCount,
        uniqueTracks: payload.trackCount,
        uniqueAlbums: payload.albumCount,
        discoveryScore: payload.discoveryScore,
        topGenre,
        dailyAvg,
      });
    default:
      return buildCoverCard(payload.username, payload.scrobbles);
  }
}

export function buildWrappedContainer(
  username: string,
  periodLabel: string,
  page: number,
  targetDiscordId: string,
  imageUrl: string,
) {
  const TOTAL = 5;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.listening} ${username}'s Scrobbler Wrapped — ${periodLabel}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Page ${page} of ${TOTAL} • ${periodLabel}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(false)
        .setSpacing(SeparatorSpacingSize.Small),
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wrapped_prev_${page}_${targetDiscordId}`)
      .setEmoji({
        id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
        name: "scrobbler_prev",
      })
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 1),
    new ButtonBuilder()
      .setCustomId(`wrapped_next_${page}_${targetDiscordId}`)
      .setEmoji({
        id: E.next.match(/:(\d+)>/)?.[1] ?? "0",
        name: "scrobbler_next",
      })
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === TOTAL),
  );
  container.addActionRowComponents(row as any);

  return container;
}

async function uploadToSupabase(
  buffer: Buffer,
  discordId: string,
  page: number,
): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;
  const filename = `${discordId}_${page}.png`;
  const uploadUrl = `${supabaseUrl}/storage/v1/object/wrapped-cache/${filename}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: buffer as unknown as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `Supabase upload failed for page ${page}: ${res.status} ${text}`,
    );
  }

  return `${supabaseUrl}/storage/v1/object/public/wrapped-cache/${filename}`;
}
export const wrappedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("wrapped")
    .setDescription("Your personalized music recap with stats, charts and more")
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("Time period")
        .setRequired(false)
        .addChoices(
          { name: "Last 7 days", value: "7day" },
          { name: "This month", value: "1month" },
          { name: "Last 3 months", value: "3month" },
          { name: "Last 6 months", value: "6month" },
          { name: "Last year", value: "12month" },
          { name: "All time", value: "overall" },
        ),
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Check another user's Wrapped (optional)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser =
      interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;
    const period = (interaction.options as any).getString("period") ?? "7day";

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
    const payload = await fetchWrappedData(lfmUsername, period, apiKey);

    if (!payload) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} No listening data found for **${lfmUsername}** in this period.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    // Generate all 5 cards in parallel
    const buffers = await Promise.all(
      [1, 2, 3, 4, 5].map((p) => buildWrappedCard(payload, p)),
    );

    // Upload all 5 to Supabase Storage in parallel
    const urls = await Promise.all(
      buffers.map((buf, i) =>
        uploadToSupabase(buf, targetDiscordUser.id, i + 1),
      ),
    );

    // Cache URLs in DB (upsert so re-running /wrapped refreshes the cache)
    const db = prisma as any;
    await db.wrappedCache.upsert({
      where: { discordId: targetDiscordUser.id },
      update: {
        urls,
        period,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      create: {
        discordId: targetDiscordUser.id,
        urls,
        period,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const page = 1;
    const container = buildWrappedContainer(
      payload.username,
      payload.periodLabel,
      page,
      targetDiscordUser.id,
      urls[0]!,
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
