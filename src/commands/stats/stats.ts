import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { AttachmentBuilder } from "discord.js";
import { executeStatsScrobbles } from "./stats_scrobbles.js";
import { executeStatsArtists } from "./stats_artists.js";
import { executeStatsAlbums } from "./stats_albums.js";
import { executeStatsGenres } from "./stats_genres.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, '../../assests/images/scrobbler_logo.png');

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
} = pkg;

import type { Command } from "../../index.js";

const PAGE_SIZE = 10;

export type StatsEntry = { username: string; scrobbles: number };

export async function fetchStatsData(guildId: string, apiKey: string): Promise<{ members: StatsEntry[] } | null> {
  const server = await prisma.server.findUnique({
    where: { guildId },
    include: { members: { include: { user: true } } },
  });
  if (!server) return null;

  const linkedMembers = server.members.filter(m => m.user.lastfmUsername);

  const infoResults = await Promise.all(
    linkedMembers.map(m =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(m.user.lastfmUsername!)}&api_key=${apiKey}&format=json`)
        .then(r => r.json())
        .catch(() => null)
    )
  ) as any[];

  const members: StatsEntry[] = linkedMembers
    .map((m, i) => ({
      username: m.user.lastfmUsername!,
      scrobbles: parseInt(infoResults[i]?.user?.playcount ?? '0'),
    }))
    .sort((a, b) => b.scrobbles - a.scrobbles);

  return { members };
}

export async function buildStatsImage(
  members: StatsEntry[],
  guildName: string,
  page: number
): Promise<Buffer> {
  const totalPages = Math.ceil(members.length / PAGE_SIZE);
  const pageMembers = members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalScrobbles = members.reduce((sum, m) => sum + m.scrobbles, 0).toLocaleString('en-US');
  const displayName = guildName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const maxScrobbles = members[0]?.scrobbles ?? 1;

  const HEADER_H = 120;
  const ROW_H = 72;
  const FOOTER_H = 60;
  const WIDTH = 800;
  const HEIGHT = Math.max(400, HEADER_H + pageMembers.length * ROW_H + FOOTER_H);

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
  ctx.font = 'bold 28px Inter';
  ctx.fillText(displayName, 30, 52);

  ctx.fillStyle = '#888888';
  ctx.font = '16px Inter';
  const pageIndicator = totalPages > 1 ? ` • Page ${page + 1} of ${totalPages}` : '';
  ctx.fillText(`${members.length} members linked${pageIndicator}`, 30, 82);

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
  } catch { /* skip */ }

  pageMembers.forEach((member, i) => {
    const rank = page * PAGE_SIZE + i + 1;
    const y = HEADER_H + i * ROW_H;

    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#0e0e0e';
    ctx.fillRect(0, y, WIDTH, ROW_H);

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, y + ROW_H - 1, WIDTH, 1);

    const rankColor = rank === 1 ? '#ffffff' : rank <= 3 ? '#aaaaaa' : '#666666';
    const MID_Y = y + ROW_H / 2;
    const TEXT_Y = MID_Y + 6;
    const BAR_Y = MID_Y + 18;
    const CONTENT_X = 55;
    const BAR_W = WIDTH - CONTENT_X - 200;
    const BAR_H = 3;

    ctx.fillStyle = rankColor;
    ctx.font = 'bold 22px Inter';
    ctx.textAlign = 'left';
    ctx.fillText(`${rank}`, 20, TEXT_Y);

    ctx.fillStyle = '#888888';
    ctx.font = '15px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(`${member.scrobbles.toLocaleString('en-US')} scrobbles`, WIDTH - 30, TEXT_Y);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Inter';
    ctx.fillText(member.username, CONTENT_X, TEXT_Y);

    if (rank === 1) {
      const usernameWidth = ctx.measureText(member.username).width;
      const cx = CONTENT_X + usernameWidth + 8;
      const cy = MID_Y - 8;
      ctx.fillStyle = '#ffd700';
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 14); ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx + 5, cy + 9); ctx.lineTo(cx + 10, cy);
      ctx.lineTo(cx + 15, cy + 9); ctx.lineTo(cx + 20, cy + 4);
      ctx.lineTo(cx + 20, cy + 14);
      ctx.closePath();
      ctx.fill();
    }

    const fillRatio = maxScrobbles > 0 ? member.scrobbles / maxScrobbles : 0;
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.roundRect(CONTENT_X, BAR_Y, BAR_W, BAR_H, 2);
    ctx.fill();

    if (fillRatio > 0) {
      ctx.fillStyle = rank === 1 ? '#ffffff' : rank <= 3 ? '#aaaaaa' : '#555555';
      ctx.beginPath();
      ctx.roundRect(CONTENT_X, BAR_Y, Math.max(4, BAR_W * fillRatio), BAR_H, 2);
      ctx.fill();
    }
  });

  const footerY = HEADER_H + pageMembers.length * ROW_H;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, footerY, WIDTH, FOOTER_H);

  ctx.fillStyle = '#555555';
  ctx.font = '14px Inter';
  ctx.textAlign = 'center';
  ctx.fillText(`Total server scrobbles: ${totalScrobbles}`, WIDTH / 2, footerY + 36);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

export const statsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Server leaderboards")
    .addSubcommand(sub =>
      sub.setName("scrobbles").setDescription("Who has scrobbled the most in this server")
    )
    .addSubcommand(sub =>
      sub.setName("artists").setDescription("Who has listened to the most unique artists")
    )
    .addSubcommand(sub =>
      sub.setName("albums").setDescription("Who has listened to the most unique albums")
    )
    .addSubcommand(sub =>
      sub.setName("genres").setDescription("Who has the most diverse taste")
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();

    if (sub === "scrobbles") {
      await executeStatsScrobbles(interaction);
    } else if (sub === "artists") {
      await executeStatsArtists(interaction);
    } else if (sub === "albums") {
      await executeStatsAlbums(interaction);
    } else if (sub === "genres") {
      await executeStatsGenres(interaction);
    } else {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Unknown subcommand.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
  },
};
