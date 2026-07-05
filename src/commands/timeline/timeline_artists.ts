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

// Returns the last N months as { label, from, to } unix timestamp windows
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

// Fetch unique artist count for a user in a time window
async function fetchUniqueArtistCount(
  lfmUsername: string,
  apiKey: string,
  from: number,
  to: number,
): Promise<number> {
  const artists = new Set<string>();
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lfmUsername)}&from=${from}&to=${to}&limit=200&page=${page}&api_key=${apiKey}&format=json`,
    ).then((r) => r.json()).catch(() => null) as any;

    const tracks: any[] = res?.recenttracks?.track ?? [];
    if (tracks.length === 0) break;

    for (const t of tracks) {
      // skip currently-playing stub
      if (t["@attr"]?.nowplaying) continue;
      if (t.artist?.["#text"]) artists.add(t.artist["#text"]);
    }

    const totalPages = parseInt(res?.recenttracks?.["@attr"]?.totalPages ?? "1");
    if (page >= totalPages || page >= 5) break; // cap at 5 pages per month to avoid rate limits
    page++;
  }
  return artists.size;
}

export const timelineArtistsCommand = {
  execute: async (interaction: any) => {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;
    const months = interaction.options.getInteger("months") ?? 6;

    const cacheKey = `timeline_artists_${targetDiscordUser.id}_${months}`;
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

    const counts = await Promise.all(
      windows.map((w) => fetchUniqueArtistCount(lfmUsername, apiKey, w.from, w.to)),
    );

    const series: TimelineSeries[] = [{
      name: "Unique Artists",
      color: "#a78bfa",
      points: windows.map((w, i) => ({ label: w.label, value: counts[i] ?? 0 })),
    }];

    const buffer = await buildTimelineCanvas(
      series,
      `${lfmUsername}'s Artist Timeline`,
      `Unique artists per month — last ${months} months`,
    );

    const imageUrl = await uploadToSupabase(buffer, "timeline-cache", `${targetDiscordUser.id}_artists_${months}.png`);
    await setCache(cacheKey, { imageUrl }, 60);

    const container = buildContainer(imageUrl, lfmUsername, months);
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};

function buildContainer(imageUrl: string, lfmUsername: string, months: number) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.artists} ${lfmUsername}'s Artist Timeline`),
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
      new TextDisplayBuilder().setContent(`-# Unique artists per month • Last ${months} months`),
    );
}
