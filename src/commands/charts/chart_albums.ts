import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
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


import { PERIOD_LABELS, SIZE_MAP } from "./chart_artists.js";
import { cmdMention } from "../../utils.js";

const CELL = 200;

export async function executeTopAlbums(interaction: any): Promise<void> {
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
          ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention('link')} to get started.`
          : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`
      )
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lfmUsername = dbUser.lastfmUsername;

  const topRes = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=${count}&api_key=${apiKey}&format=json`
  );
  const topData = (await topRes.json()) as any;

  if (topData.error) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const albums: any[] = topData.topalbums?.album ?? [];

  if (albums.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} No top albums found for **${lfmUsername}** in this period.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const items = albums.map(a => ({
    name: a.name,
    artist: a.artist?.name ?? 'Unknown',
    plays: parseInt(a.playcount),
    imageUrl: a.image?.find((img: any) => img.size === 'extralarge')?.['#text'] || null,
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
      ctx.font = 'bold 16px Inter';
      ctx.fillText(item.name, x + 10, y + CELL - 20, 190);
      ctx.fillStyle = '#cccccc';
      ctx.font = '12px Inter';
      ctx.fillText(`${item.plays.toLocaleString('en-US')} plays`, x + 10, y + CELL - 6, 190);
    }

    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, CELL, CELL);
  }

  const buffer = canvas.toBuffer('image/png');
  const attachment = new AttachmentBuilder(buffer, { name: 'topalbums.png' });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.albums} ${lfmUsername}'s Top Albums — ${periodLabel}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://topalbums.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Top ${items.length} albums • ${size} • ${periodLabel}`)
    );

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
