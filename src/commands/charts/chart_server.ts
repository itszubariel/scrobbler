import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { buildGridCanvas } from "./canvas.js";
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
  AttachmentBuilder,
} = pkg;

import { PERIOD_LABELS, SIZE_MAP } from "./chart_artists.js";

interface CachedChart {
  imageUrl: string;
}

export async function executeChartServer(interaction: any): Promise<void> {
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

  const apiKey = process.env.LASTFM_API_KEY!;
  const type = interaction.options.getString("type") as string;
  const size = interaction.options.getString("size") ?? "3x3";
  const period = interaction.options.getString("period") ?? "overall";
  const periodLabel = PERIOD_LABELS[period] ?? "All time";
  const { cols, rows, count } = SIZE_MAP[size] ?? SIZE_MAP["3x3"]!;
  const guildName = interaction.guild.name;

  // Check cache first
  const cacheKey = `chart_server_${interaction.guildId}_${type}_${period}_${size}`;
  const cached = await getCache<CachedChart>(cacheKey);

  if (cached && cached.imageUrl) {
    // Cache hit - skip all generation and send cached URL
    const typeLabel =
      type === "artists" ? "Artists" : type === "albums" ? "Albums" : "Tracks";

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${E.chart} ${guildName} — Top ${typeLabel} — ${periodLabel}`,
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(cached.imageUrl),
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# ${size} chart • ${periodLabel}`,
        ),
      );

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

  const linkedMembers =
    server?.members.filter((m: any) => m.user.lastfmUsername) ?? [];

  if (linkedMembers.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} No members have linked their Last.fm yet.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const method =
    type === "artists"
      ? "user.gettopartists"
      : type === "albums"
        ? "user.gettopalbums"
        : "user.gettoptracks";
  const allResults = (await Promise.all(
    linkedMembers.map((m: any) =>
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=${method}&user=${encodeURIComponent(m.user.lastfmUsername!)}&period=${period}&limit=50&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ),
  )) as any[];

  const playMap = new Map<string, { plays: number; artist: string }>();
  for (const data of allResults) {
    if (!data || data.error) continue;
    const entries: any[] =
      type === "artists"
        ? (data.topartists?.artist ?? [])
        : type === "albums"
          ? (data.topalbums?.album ?? [])
          : (data.toptracks?.track ?? []);
    for (const entry of entries) {
      const name = entry.name as string;
      const plays = parseInt(entry.playcount ?? "0");
      const artist: string =
        type === "artists"
          ? name
          : type === "albums"
            ? (entry.artist?.name ?? "")
            : (entry.artist?.name ?? "");
      // Key by "name|||artist" for tracks/albums to avoid merging same-named items from different artists
      const key =
        type === "tracks" || type === "albums" ? `${name}|||${artist}` : name;
      const existing = playMap.get(key);
      playMap.set(key, {
        plays: (existing?.plays ?? 0) + plays,
        artist: existing?.artist ?? artist,
      });
    }
  }

  const sorted = [...playMap.entries()]
    .sort((a, b) => b[1].plays - a[1].plays)
    .slice(0, count)
    .map(([key, { plays, artist }]) => ({
      name: key.includes("|||") ? key.split("|||")[0]! : key,
      plays,
      artist,
    }));

  if (sorted.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} Not enough data to generate a chart.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const imageResults = (await Promise.all(
    sorted.map((item) => {
      if (type === "artists") {
        return fetch(
          `https://api.deezer.com/search/artist?q=${encodeURIComponent(item.name)}&limit=5`,
        )
          .then((r) => r.json())
          .catch(() => null);
      } else if (type === "albums") {
        return fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent((item.artist ? item.artist + " " : "") + item.name)}&entity=album&limit=1`,
        )
          .then((r) => r.json())
          .catch(() => null);
      } else {
        return fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent((item.artist ? item.artist + " " : "") + item.name)}&entity=song&limit=1`,
        )
          .then((r) => r.json())
          .catch(() => null);
      }
    }),
  )) as any[];

  const LFM_PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";
  const items = sorted.map((item, i) => {
    let imageUrl: string | null = null;
    if (type === "artists") {
      const results: any[] = imageResults[i]?.data ?? [];
      const match =
        results.find(
          (r: any) => r.name.toLowerCase() === item.name.toLowerCase(),
        ) ??
        results[0] ??
        null;
      imageUrl = match?.picture_xl ?? null;
    } else {
      const raw = imageResults[i]?.results?.[0]?.artworkUrl100 ?? null;
      imageUrl = raw ? (raw as string).replace("100x100bb", "600x600bb") : null;
    }
    return { name: item.name, plays: item.plays, imageUrl };
  });

  const buffer = await buildGridCanvas(items, cols, rows, count);

  // Upload to Supabase
  const imageUrl = await uploadToSupabase(
    buffer,
    "chart-cache",
    `${interaction.guildId}_${type}_${period}_${size}.png`,
  );

  // Save to cache
  const cacheData: CachedChart = { imageUrl };
  await setCache(cacheKey, cacheData, 60);

  const typeLabel =
    type === "artists" ? "Artists" : type === "albums" ? "Albums" : "Tracks";
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.chart} ${guildName} — Top ${typeLabel} — ${periodLabel}`,
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
        `-# ${size} chart • ${periodLabel} • ${linkedMembers.length} members`,
      ),
    );

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
