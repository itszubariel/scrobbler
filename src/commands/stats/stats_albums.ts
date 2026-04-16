import "dotenv/config";
import pkg from "discord.js";
import pkgPrisma from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { E } from "../../emojis.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { AttachmentBuilder } from "discord.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, '../../assests/images/scrobbler_logo.png');

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = pkg;
const { PrismaClient } = pkgPrisma;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function buildAlbumsImage(
  members: { username: string; count: number }[],
  guildName: string
): Promise<Buffer> {
  const displayName = guildName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const maxCount = members[0]?.count ?? 1;
  const totalAlbums = members.reduce((sum, m) => sum + m.count, 0).toLocaleString('en-US');

  const HEADER_H = 120;
  const ROW_H = 72;
  const FOOTER_H = 60;
  const WIDTH = 800;
  const HEIGHT = Math.max(400, HEADER_H + members.length * ROW_H + FOOTER_H);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, WIDTH, HEADER_H);

  const hazeGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 220);
  hazeGrad.addColorStop(0, 'rgba(120, 60, 220, 0.18)');
  hazeGrad.addColorStop(0.5, 'rgba(80, 30, 160, 0.08)');
  hazeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, 0, WIDTH, HEADER_H);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(displayName, 30, 52);

  ctx.fillStyle = '#888888';
  ctx.font = '16px sans-serif';
  ctx.fillText(`${members.length} members linked`, 30, 82);

  try {
    const logo = await loadImage(LOGO_PATH);
    const LOGO_SIZE = 40;
    const LOGO_X = WIDTH - LOGO_SIZE - 20;
    const LOGO_Y = (HEADER_H - LOGO_SIZE) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(LOGO_X + LOGO_SIZE / 2, LOGO_Y + LOGO_SIZE / 2, LOGO_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, LOGO_X, LOGO_Y, LOGO_SIZE, LOGO_SIZE);
    ctx.restore();
  } catch {
    // Logo not found — skip silently
  }

  members.forEach((member, i) => {
    const rank = i + 1;
    const y = HEADER_H + i * ROW_H;

    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#0e0e0e';
    ctx.fillRect(0, y, WIDTH, ROW_H);

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, y + ROW_H - 1, WIDTH, 1);

    const MID_Y = y + ROW_H / 2;
    const TEXT_Y = MID_Y + 6;
    const BAR_Y = MID_Y + 18;
    const CONTENT_X = 55;
    const BAR_W = WIDTH - CONTENT_X - 200;
    const BAR_H = 3;

    const rankColor =
      rank === 1 ? '#ffffff' :
      rank === 2 ? '#aaaaaa' :
      rank === 3 ? '#aaaaaa' :
      '#666666';

    ctx.fillStyle = rankColor;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${rank}`, 20, TEXT_Y);

    ctx.fillStyle = '#888888';
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${member.count.toLocaleString('en-US')} albums`, WIDTH - 30, TEXT_Y);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(member.username, CONTENT_X, TEXT_Y);

    if (rank === 1) {
      const usernameWidth = ctx.measureText(member.username).width;
      const cx = CONTENT_X + usernameWidth + 8;
      const cy = MID_Y - 8;
      ctx.fillStyle = '#ffd700';
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 14);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx + 5, cy + 9);
      ctx.lineTo(cx + 10, cy);
      ctx.lineTo(cx + 15, cy + 9);
      ctx.lineTo(cx + 20, cy + 4);
      ctx.lineTo(cx + 20, cy + 14);
      ctx.closePath();
      ctx.fill();
    }

    const fillRatio = maxCount > 0 ? member.count / maxCount : 0;

    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.roundRect(CONTENT_X, BAR_Y, BAR_W, BAR_H, 2);
    ctx.fill();

    if (fillRatio > 0) {
      ctx.fillStyle =
        rank === 1 ? '#ffffff' :
        rank <= 3  ? '#aaaaaa' :
        '#555555';
      ctx.beginPath();
      ctx.roundRect(CONTENT_X, BAR_Y, Math.max(4, BAR_W * fillRatio), BAR_H, 2);
      ctx.fill();
    }
  });

  const footerY = HEADER_H + members.length * ROW_H;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, footerY, WIDTH, FOOTER_H);

  ctx.fillStyle = '#555555';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Total unique albums: ${totalAlbums}`, WIDTH / 2, footerY + 36);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

export async function executeStatsAlbums(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;

  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} This command only works in servers.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const server = await prisma.server.findUnique({
    where: { guildId: interaction.guildId },
    include: { members: { include: { user: true } } },
  });

  if (!server) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} This server isn't set up yet.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const linkedMembers = server.members
    .filter(m => m.user.lastfmUsername)
    .slice(0, 10);

  if (linkedMembers.length < 2) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} Not enough members have linked their Last.fm yet! Have more members use </link:1493336821818720409> to get started.`
      )
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const albumResults = await Promise.all(
    linkedMembers.map(m =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(m.user.lastfmUsername!)}&limit=1000&period=overall&api_key=${apiKey}&format=json`)
        .then(r => r.json())
        .catch(() => null)
    )
  ) as any[];

  const members = linkedMembers
    .map((m, i) => ({
      username: m.user.lastfmUsername!,
      count: (albumResults[i]?.topalbums?.album ?? []).length as number,
    }))
    .sort((a, b) => b.count - a.count);

  const imageBuffer = await buildAlbumsImage(members, interaction.guild.name);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'stats_albums.png' });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.albums} Server Album Leaderboard — All time`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://stats_albums.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${members.length} members • Unique albums overall`)
    );

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
