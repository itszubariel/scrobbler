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
import { cmdMention } from "../../utils.js";

interface CachedChart {
  imageUrl: string;
}

export async function executeTopTracks(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const targetDiscordUser =
    interaction.options.getUser("user") ?? interaction.user;
  const isOwnProfile = targetDiscordUser.id === interaction.user.id;
  const period = interaction.options.getString("period") ?? "overall";
  const periodLabel = PERIOD_LABELS[period] ?? "All time";
  const size = interaction.options.getString("size") ?? "3x3";
  const { cols, rows, count } = SIZE_MAP[size] ?? SIZE_MAP["3x3"]!;

  // Check cache first
  const cacheKey = `chart_tracks_${targetDiscordUser.id}_${period}_${size}`;
  const cached = await getCache<CachedChart>(cacheKey);

  if (cached && cached.imageUrl) {
    // Cache hit - skip all generation and send cached URL
    const dbUser = await prisma.user.findUnique({
      where: { discordId: targetDiscordUser.id },
    });
    const lfmUsername = dbUser?.lastfmUsername ?? targetDiscordUser.username;

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${E.tracks} ${lfmUsername}'s Top Tracks — ${periodLabel}`,
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
          `-# Top ${count} tracks • ${size} • ${periodLabel}`,
        ),
      );

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

  const topRes = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=${count}&api_key=${apiKey}&format=json`,
  );
  const topData = (await topRes.json()) as any;

  if (topData.error) {
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

  const tracks: any[] = topData.toptracks?.track ?? [];

  if (tracks.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} No top tracks found for **${lfmUsername}** in this period.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  // iTunes for track art — better K-pop coverage than Deezer
  const imageResults = await Promise.all(
    tracks.map((t) =>
      fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent((t.artist?.name ?? "") + " " + t.name)}&entity=song&limit=1`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ),
  );

  const items = tracks.map((t, i) => {
    const raw = imageResults[i]?.results?.[0]?.artworkUrl100 ?? null;
    const imageUrl = raw
      ? (raw as string).replace("100x100bb", "600x600bb")
      : null;
    return {
      name: t.name,
      plays: parseInt(t.playcount),
      imageUrl,
    };
  });

  const buffer = await buildGridCanvas(items, cols, rows, count);

  // Upload to Supabase
  const imageUrl = await uploadToSupabase(
    buffer,
    "chart-cache",
    `${targetDiscordUser.id}_tracks_${period}_${size}.png`,
  );

  // Save to cache
  const cacheData: CachedChart = { imageUrl };
  await setCache(cacheKey, cacheData, 60);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.tracks} ${lfmUsername}'s Top Tracks — ${periodLabel}`,
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
        `-# Top ${items.length} tracks • ${size} • ${periodLabel}`,
      ),
    );

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
