import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { cmdMention } from "../../utils.js";
import { uploadToSupabase } from "../../uploadToSupabase.js";
import { getCache, setCache } from "../../cache.js";
import {
  fetchTasteData,
  buildTasteCanvas,
  buildTasteContainer,
  PERIOD_LABELS_TASTE,
  TASTE_PAGE_SIZE,
} from "./taste_helpers.js";

const {
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
} = pkg;

const TTL_MS = 15 * 60 * 1000;

interface CachedTasteUser {
  imageUrls: string[];
  genres: Array<{ name: string; percentage: number }>;
  topThree: string[];
  totalArtists: number;
  totalPages: number;
}

export async function executeTasteUser(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const targetDiscordUser =
    interaction.options.getUser("user") ?? interaction.user;
  const isOwnProfile = targetDiscordUser.id === interaction.user.id;
  const period = interaction.options.getString("period") ?? "overall";
  const periodLabel = PERIOD_LABELS_TASTE[period] ?? "All time";

  // Check cache first
  const cacheKey = `taste_user_${targetDiscordUser.id}_${period}`;
  const cached = await getCache<CachedTasteUser>(cacheKey);

  if (cached && cached.imageUrls && cached.imageUrls.length > 0) {
    // Rebuild container from cached data with canvas image
    const dbUser = await prisma.user.findUnique({
      where: { discordId: targetDiscordUser.id },
    });
    const lfmUsername = dbUser?.lastfmUsername ?? targetDiscordUser.username;

    // Reconstruct allGenres from cached data for buildTasteContainer
    const allGenres = cached.genres.map((g) => ({
      tag: g.name,
      pct: g.percentage,
    }));

    const container = buildTasteContainer(
      allGenres,
      null,
      lfmUsername,
      periodLabel,
      0,
      targetDiscordUser.id,
      period,
      cached.imageUrls[0],
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
  const allGenres = await fetchTasteData(lfmUsername, period, apiKey);

  if (!allGenres) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} Couldn't determine genre data for **${lfmUsername}**.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const totalPages = Math.ceil(allGenres.length / TASTE_PAGE_SIZE);
  const title = `${lfmUsername}'s Taste Profile`;

  // Render all pages and upload in parallel
  const buffers = await Promise.all(
    Array.from({ length: totalPages }, (_, i) =>
      buildTasteCanvas(allGenres, title, periodLabel, i),
    ),
  );
  const urls = await Promise.all(
    buffers.map((buf, i) =>
      uploadToSupabase(
        buf,
        "taste-cache",
        `${targetDiscordUser.id}_${period}_${i}.png`,
      ),
    ),
  );

  console.log("Upload results (taste_user):", urls);

  // Save to generic cache
  const topThree = allGenres
    .slice(0, 3)
    .map((g) => g.tag)
    .filter(Boolean);
  const cacheData: CachedTasteUser = {
    imageUrls: urls,
    genres: allGenres
      .filter((g) => g.tag !== undefined && g.pct !== undefined)
      .map((g) => ({
        name: g.tag,
        percentage: g.pct,
      })),
    topThree,
    totalArtists: allGenres.length,
    totalPages,
  };
  await setCache(cacheKey, cacheData, 120);

  const container = buildTasteContainer(
    allGenres,
    null,
    lfmUsername,
    periodLabel,
    0,
    targetDiscordUser.id,
    period,
    urls[0]!,
  );
  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
