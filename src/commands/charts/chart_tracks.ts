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

export async function executeTopTracks(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
  const isOwnProfile = targetDiscordUser.id === interaction.user.id;
  const period = interaction.options.getString("period") ?? "overall";
  const periodLabel = PERIOD_LABELS[period] ?? "All time";
  const size = interaction.options.getString("size") ?? "3x3";
  const { cols, rows, count } = SIZE_MAP[size] ?? SIZE_MAP["3x3"]!;

  const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordUser.id } });

  if (!dbUser?.lastfmUsername) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isOwnProfile
          ? `${E.reject} You haven't linked your Last.fm account yet! Use </link:1493336821818720409> to get started.`
          : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`
      )
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lfmUsername = dbUser.lastfmUsername;

  const topRes = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=${count}&api_key=${apiKey}&format=json`
  );
  const topData = (await topRes.json()) as any;

  if (topData.error) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const tracks: any[] = topData.toptracks?.track ?? [];

  if (tracks.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} No top tracks found for **${lfmUsername}** in this period.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const deezerResults = await Promise.all(
    tracks.map(t =>
      fetch(`https://api.deezer.com/search/track?q=${encodeURIComponent(t.name + ' ' + (t.artist?.name ?? ''))}`)
        .then(r => r.json()).catch(() => null)
    )
  ) as any[];

  const items = tracks.map((t, i) => ({
    name: t.name,
    plays: parseInt(t.playcount),
    imageUrl: deezerResults[i]?.data?.[0]?.album?.cover_medium ?? null,
  }));

  const canvas = createCanvas(cols * CELL, rows * CELL);
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < count; i++) {
    const item = items[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * CELL;
    const y = row * CELL;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x, y, CELL, CELL);

    if (item?.imageUrl) {
      try {
        const img = await loadImage(item.imageUrl);
        ctx.drawImage(img, x, y, CELL, CELL);
      } catch { /* fallback */ }
    }

    const grad = ctx.createLinearGradient(x, y + CELL - 100, x, y + CELL);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + CELL - 100, CELL, 100);

    if (item) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(item.name, x + 10, y + CELL - 20, 190);
      ctx.fillStyle = '#cccccc';
      ctx.font = '12px sans-serif';
      ctx.fillText(`${item.plays.toLocaleString('en-US')} plays`, x + 10, y + CELL - 6, 190);
    }

    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, CELL, CELL);
  }

  const buffer = canvas.toBuffer('image/png');
  const attachment = new AttachmentBuilder(buffer, { name: 'toptracks.png' });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.tracks} ${lfmUsername}'s Top Tracks — ${periodLabel}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://toptracks.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Top ${items.length} tracks • ${size} • ${periodLabel}`)
    );

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
