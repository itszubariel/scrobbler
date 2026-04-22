import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";
import { createCanvas } from "@napi-rs/canvas";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
} = pkg;

import type { Command } from "../index.js";
import { cmdMention } from "../utils.js";

const PERIOD_LABELS: Record<string, string> = {
  "7day":    "Last 7 days",
  "1month":  "Last month",
  "3month":  "Last 3 months",
  "6month":  "Last 6 months",
  "12month": "Last year",
  "overall": "All time",
};

function getLabel(undergroundScore: number): string {
  if (undergroundScore <= 20) return "Mainstream Maven 📻";
  if (undergroundScore <= 40) return "Chart Familiar 🎧";
  if (undergroundScore <= 60) return "Balanced Listener 🎵";
  if (undergroundScore <= 80) return "Indie Explorer 🔍";
  return "Underground Pioneer 🌑";
}

async function buildDiscoveryCanvas(
  rows: { label: string; score: number; color: string }[]
): Promise<Buffer> {
  const WIDTH = 800;
  const ROW_H = 56;
  const HEIGHT = rows.length * ROW_H;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const LABEL_W = 120;
  const BAR_X = LABEL_W + 20;
  const BAR_MAX_W = WIDTH - BAR_X - 80;

  rows.forEach((row, i) => {
    const y = i * ROW_H;
    const MID_Y = y + ROW_H / 2;

    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#0e0e0e';
    ctx.fillRect(0, y, WIDTH, ROW_H);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, y + ROW_H - 1, WIDTH, 1);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Inter';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, 20, MID_Y + 6);

    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.roundRect(BAR_X, MID_Y - 8, BAR_MAX_W, 16, 4);
    ctx.fill();

    const fillW = Math.max(row.score > 0 ? 8 : 0, BAR_MAX_W * (row.score / 100));
    if (fillW > 0) {
      ctx.fillStyle = row.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(BAR_X, MID_Y - 8, fillW, 16, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = row.color;
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(`${row.score}%`, WIDTH - 20, MID_Y + 5);
    ctx.textAlign = 'left';
  });

  return canvas.toBuffer('image/png');
}

export const discoveryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("discovery")
    .setDescription("See how underground or mainstream your music taste is")
    .addUserOption(option =>
      option.setName("user").setDescription("Check another user's discovery score (optional)").setRequired(false)
    )
    .addStringOption(option =>
      option.setName("period").setDescription("Time period").setRequired(false)
        .addChoices(
          { name: "Last 7 days",    value: "7day" },
          { name: "Last month",     value: "1month" },
          { name: "Last 3 months",  value: "3month" },
          { name: "Last 6 months",  value: "6month" },
          { name: "Last year",      value: "12month" },
          { name: "All time",       value: "overall" },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;
    const period = (interaction.options as any).getString("period") ?? "overall";
    const periodLabel = PERIOD_LABELS[period] ?? "All time";

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
      `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=100&api_key=${apiKey}&format=json`
    ).then(r => r.json()).catch(() => null) as any;

    const artists: any[] = topRes?.topartists?.artist ?? [];

    if (artists.length === 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} No listening data found for **${lfmUsername}** in this period.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const artistInfos = await Promise.all(
      artists.map(a =>
        fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`)
          .then(r => r.json()).catch(() => null)
      )
    ) as any[];

    let totalWeightedScore = 0;
    let totalPlaycount = 0;
    const artistScores: { name: string; listeners: number; mainstreamScore: number }[] = [];

    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      const info = artistInfos[i];
      const listeners = parseInt(info?.artist?.stats?.listeners ?? '0') || 0;
      const playcount = parseInt(artist.playcount ?? '0') || 1;
      const mainstreamScore = Math.min(listeners / 5_000_000, 1) * 100;
      totalWeightedScore += mainstreamScore * playcount;
      totalPlaycount += playcount;
      artistScores.push({ name: artist.name, listeners, mainstreamScore });
    }

    const mainstreamScore = totalPlaycount > 0 ? Math.round(totalWeightedScore / totalPlaycount) : 50;
    const undergroundScore = 100 - mainstreamScore;
    const label = getLabel(undergroundScore);

    const sorted = [...artistScores].sort((a, b) => a.listeners - b.listeners);
    const mostUnderground = sorted[0]!;
    const mostMainstream = sorted[sorted.length - 1]!;

    const scoreRows = [
      { label: 'Underground', score: undergroundScore, color: '#a78bfa' },
      { label: 'Mainstream',  score: mainstreamScore,  color: '#f472b6' },
    ];

    const imageBuffer = await buildDiscoveryCanvas(scoreRows);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'discovery.png' });

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### Discovery Score — ${lfmUsername}`),
        new TextDisplayBuilder().setContent(`# ${undergroundScore}%\n${label}`),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL('attachment://discovery.png')
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.search} **Most Underground:** ${mostUnderground.name} — ${mostUnderground.listeners.toLocaleString('en-US')} listeners\n${E.fm} **Most Mainstream:** ${mostMainstream.name} — ${mostMainstream.listeners.toLocaleString('en-US')} listeners`
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Based on your top 100 artists • ${periodLabel}`)
      );

    await interaction.editReply({ files: [attachment], components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};
