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

async function fetchScrobbleCount(
  lfmUsername: string,
  apiKey: string,
  from: number,
  to: number,
): Promise<number> {
  const res = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lfmUsername)}&from=${from}&to=${to}&limit=1&page=1&api_key=${apiKey}&format=json`,
  ).then((r) => r.json()).catch(() => null) as any;
  const total = parseInt(res?.recenttracks?.["@attr"]?.total ?? "0");
  return isNaN(total) ? 0 : total;
}

export const timelineServerCommand = {
  execute: async (interaction: any) => {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const guildId = interaction.guildId;
    const months = interaction.options.getInteger("months") ?? 6;

    if (!guildId || !interaction.guild) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} This command can only be used in a server.`),
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const cacheKey = `timeline_server_${guildId}_${months}`;
    const cached = await getCache<CachedTimeline>(cacheKey);
    if (cached?.imageUrl) {
      const container = buildContainer(cached.imageUrl, interaction.guild.name, months);
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const server = await prisma.server.findUnique({
      where: { guildId },
      include: { members: { include: { user: true } } },
    });

    if (!server) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} This server isn't set up yet.`),
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const linkedMembers = server.members.filter((m) => m.user.lastfmUsername);
    if (linkedMembers.length === 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} No members have linked their Last.fm yet. Use ${cmdMention("link")} to get started.`,
        ),
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const windows = getMonthWindows(months);

    // For each month, sum scrobbles across all linked members
    const monthlyCounts = await Promise.all(
      windows.map(async (w) => {
        const perMember = await Promise.all(
          linkedMembers.map((m) =>
            fetchScrobbleCount(m.user.lastfmUsername!, apiKey, w.from, w.to),
          ),
        );
        return perMember.reduce((a, b) => a + b, 0);
      }),
    );

    const series: TimelineSeries[] = [{
      name: "Server Scrobbles",
      color: "#60a5fa",
      points: windows.map((w, i) => ({ label: w.label, value: monthlyCounts[i] ?? 0 })),
    }];

    const buffer = await buildTimelineCanvas(
      series,
      `${interaction.guild.name} — Server Timeline`,
      `Total scrobbles per month — last ${months} months • ${linkedMembers.length} members`,
    );

    const imageUrl = await uploadToSupabase(buffer, "timeline-cache", `server_${guildId}_${months}.png`);
    await setCache(cacheKey, { imageUrl }, 60);

    const container = buildContainer(imageUrl, interaction.guild.name, months);
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};

function buildContainer(imageUrl: string, guildName: string, months: number) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.graph} ${guildName} — Server Timeline`),
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
      new TextDisplayBuilder().setContent(`-# Combined server scrobbles per month • Last ${months} months`),
    );
}
