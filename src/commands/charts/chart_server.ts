import "dotenv/config";
import pkg from "discord.js";
import pkgPrisma from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { E } from "../../emojis.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";

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
const { PrismaClient } = pkgPrisma;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

import { PERIOD_LABELS, SIZE_MAP } from "./chart_artists.js";

const CELL = 200;

export async function executeChartServer(interaction: any): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} This command only works in servers.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const apiKey = process.env.LASTFM_API_KEY!;
  const type   = interaction.options.getString("type") as string;
  const size   = interaction.options.getString("size") ?? "3x3";
  const period = interaction.options.getString("period") ?? "overall";
  const periodLabel = PERIOD_LABELS[period] ?? "All time";
  const { cols, rows, count } = SIZE_MAP[size] ?? SIZE_MAP["3x3"]!;
  const guildName = interaction.guild.name;

  const server = await prisma.server.findUnique({
    where: { guildId: interaction.guildId },
    include: { members: { include: { user: true } } },
  });

  const linkedMembers = server?.members.filter((m: any) => m.user.lastfmUsername) ?? [];

  if (linkedMembers.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} No members have linked their Last.fm yet.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const method = type === "artists" ? "user.gettopartists" : type === "albums" ? "user.gettopalbums" : "user.gettoptracks";
  const allResults = await Promise.all(
    linkedMembers.map((m: any) =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=${method}&user=${encodeURIComponent(m.user.lastfmUsername!)}&period=${period}&limit=50&api_key=${apiKey}&format=json`)
        .then(r => r.json()).catch(() => null)
    )
  ) as any[];

  const playMap = new Map<string, number>();
  for (const data of allResults) {
    if (!data || data.error) continue;
    const entries: any[] =
      type === "artists" ? (data.topartists?.artist ?? []) :
      type === "albums"  ? (data.topalbums?.album ?? []) :
      (data.toptracks?.track ?? []);
    for (const entry of entries) {
      const name = entry.name as string;
      const plays = parseInt(entry.playcount ?? '0');
      playMap.set(name, (playMap.get(name) ?? 0) + plays);
    }
  }

  const sorted = [...playMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name, plays]) => ({ name, plays }));

  if (sorted.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Not enough data to generate a chart.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const deezerResults = await Promise.all(
    sorted.map(item =>
      type === "artists"
        ? fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(item.name)}`).then(r => r.json()).catch(() => null)
        : type === "albums"
          ? fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(item.name)}`).then(r => r.json()).catch(() => null)
          : fetch(`https://api.deezer.com/search/track?q=${encodeURIComponent(item.name)}`).then(r => r.json()).catch(() => null)
    )
  ) as any[];

  const items = sorted.map((item, i) => ({
    name: item.name,
    plays: item.plays,
    imageUrl: type === "artists"
      ? (deezerResults[i]?.data?.[0]?.picture_medium ?? null)
      : type === "albums"
        ? (deezerResults[i]?.data?.[0]?.cover_medium ?? null)
        : (deezerResults[i]?.data?.[0]?.album?.cover_medium ?? null),
  }));

  const canvas = createCanvas(cols * CELL, rows * CELL);
  const ctx = canvas.getContext("2d");

  for (let i = 0; i < count; i++) {
    const item = items[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * CELL;
    const y = row * CELL;

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(x, y, CELL, CELL);

    if (item?.imageUrl) {
      try {
        const img = await loadImage(item.imageUrl);
        ctx.drawImage(img, x, y, CELL, CELL);
      } catch { /* fallback */ }
    }

    const grad = ctx.createLinearGradient(x, y + CELL - 100, x, y + CELL);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + CELL - 100, CELL, 100);

    if (item) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(item.name, x + 10, y + CELL - 20, 190);
      ctx.fillStyle = "#cccccc";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${item.plays.toLocaleString('en-US')} plays`, x + 10, y + CELL - 6, 190);
    }

    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, CELL, CELL);
  }

  const buffer = canvas.toBuffer("image/png");
  const attachment = new AttachmentBuilder(buffer, { name: "chart.png" });

  const typeLabel = type === "artists" ? "Artists" : type === "albums" ? "Albums" : "Tracks";
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.chart} ${guildName} — Top ${typeLabel} — ${periodLabel}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL("attachment://chart.png")
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${size} chart • ${periodLabel} • ${linkedMembers.length} members`)
    );

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
