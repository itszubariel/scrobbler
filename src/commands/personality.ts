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

interface PersonalityType {
  name: string;
  description: string;
}

function getPersonalityType(dims: Record<string, number>): PersonalityType {
  const topTwo = Object.entries(dims)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);

  const within10 = Math.abs(dims[topTwo[0]!]! - dims[topTwo[1]!]!) <= 10;

  if (within10) {
    const combo = new Set(topTwo);
    if (combo.has('loyalty') && combo.has('intensity'))
      return { name: '💿 The Collector', description: 'Deep cuts, high playcounts, unwavering dedication.' };
    if (combo.has('diversity') && combo.has('mainstream'))
      return { name: '🎪 The Curator', description: "You know every genre but always know what's trending." };
    if (combo.has('diversity') && combo.has('intensity'))
      return { name: '🚀 The Fanatic', description: 'Endlessly curious and endlessly listening.' };
  }

  const top = topTwo[0]!;
  if (top === 'loyalty')    return { name: '🎯 The Loyalist',    description: 'You find your sound and stick with it. Your favorites are your forever favorites.' };
  if (top === 'diversity')  return { name: '🌍 The Explorer',    description: 'You roam freely across genres and scenes, always searching for something new.' };
  if (top === 'mainstream') return { name: '📻 The Trendsetter', description: "You're plugged into the pulse of popular music and love what's hot." };
  if (top === 'intensity')  return { name: '🔥 The Obsessive',   description: "Music isn't background noise for you. It's everything." };
  return { name: '🎵 The Listener', description: 'You just love music.' };
}

async function buildPersonalityCanvas(
  rows: { label: string; score: number; color: string }[]
): Promise<Buffer> {
  const WIDTH = 800;
  const ROW_H = 56;
  const HEIGHT = rows.length * ROW_H;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const LABEL_W = 140;
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

export const personalityCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("personality")
    .setDescription("Discover your music personality type")
    .addUserOption(option =>
      option.setName("user").setDescription("Check another user's personality (optional)").setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;

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

    const [overallRes, weekRes, userInfoRes] = await Promise.all([
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=overall&limit=100&api_key=${apiKey}&format=json`)
        .then(r => r.json()).catch(() => null),
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=7day&limit=50&api_key=${apiKey}&format=json`)
        .then(r => r.json()).catch(() => null),
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`)
        .then(r => r.json()).catch(() => null),
    ]) as any[];

    const overallArtists: any[] = overallRes?.topartists?.artist ?? [];
    const weekArtists: any[] = weekRes?.topartists?.artist ?? [];

    if (overallArtists.length === 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Not enough listening data found for **${lfmUsername}**.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const artistInfos = await Promise.all(
      overallArtists.map(a =>
        fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`)
          .then(r => r.json()).catch(() => null)
      )
    ) as any[];

    // Loyalty
    const overallNames = new Set(overallArtists.map(a => a.name.toLowerCase()));
    const weekInOverall = weekArtists.filter(a => overallNames.has(a.name.toLowerCase())).length;
    const loyalty = weekArtists.length > 0 ? Math.round((weekInOverall / weekArtists.length) * 100) : 50;

    // Diversity — based on genre dominance (same weighting as taste.ts)
    const BLOCKED_TAGS = new Set(['seen live', 'favorites', 'favourite', 'favorite', 'owned']);
    const tagWeights = new Map<string, number>();
    for (let i = 0; i < overallArtists.length; i++) {
      const artist = overallArtists[i];
      const info = artistInfos[i];
      const playcount = parseInt(artist.playcount ?? '0') || 1;
      const tags: any[] = Array.isArray(info?.artist?.tags?.tag)
        ? info.artist.tags.tag
        : info?.artist?.tags?.tag ? [info.artist.tags.tag] : [];
      for (const tag of tags.slice(0, 3)) {
        const name = tag.name.toLowerCase();
        if (!BLOCKED_TAGS.has(name) && !/^\d{4}$/.test(name)) {
          tagWeights.set(name, (tagWeights.get(name) ?? 0) + playcount);
        }
      }
    }
    const sortedTags = [...tagWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const totalTagWeight = sortedTags.reduce((sum, [, w]) => sum + w, 0);
    const topGenrePercentage = totalTagWeight > 0 && sortedTags.length > 0
      ? (sortedTags[0]![1] / totalTagWeight) * 100
      : 50;
    const diversity = Math.min(Math.round((1 - (topGenrePercentage / 100)) * 150), 100);

    // Mainstream
    let totalWeightedScore = 0;
    let totalPlaycount = 0;
    for (let i = 0; i < overallArtists.length; i++) {
      const artist = overallArtists[i];
      const info = artistInfos[i];
      const listeners = parseInt(info?.artist?.stats?.listeners ?? '0') || 0;
      const playcount = parseInt(artist.playcount ?? '0') || 1;
      totalWeightedScore += Math.min(listeners / 5_000_000, 1) * 100 * playcount;
      totalPlaycount += playcount;
    }
    const mainstream = totalPlaycount > 0 ? Math.round(totalWeightedScore / totalPlaycount) : 50;

    // Intensity
    const totalScrobbles = parseInt(userInfoRes?.user?.playcount ?? '0') || 0;
    const registeredUnix = parseInt(userInfoRes?.user?.registered?.unixtime ?? userInfoRes?.user?.registered?.['#text'] ?? '0') || 0;
    const monthsSinceReg = registeredUnix > 0
      ? Math.max(1, (Date.now() / 1000 - registeredUnix) / (30.44 * 24 * 3600))
      : 12;
    const intensity = Math.min(Math.round(((totalScrobbles / monthsSinceReg) / 300) * 100), 100);

    const nostalgia = 50;

    const dims = { loyalty, diversity, mainstream, intensity, nostalgia };
    const personality = getPersonalityType(dims);

    const dimRows = [
      { label: '🎯 Loyalty',    score: loyalty,    color: '#a78bfa' },
      { label: '🌍 Diversity',  score: diversity,  color: '#34d399' },
      { label: '📻 Mainstream', score: mainstream, color: '#f472b6' },
      { label: '🔥 Intensity',  score: intensity,  color: '#fb923c' },
      { label: '🕰️ Nostalgia',  score: nostalgia,  color: '#60a5fa' },
    ];

    const imageBuffer = await buildPersonalityCanvas(dimRows);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'personality.png' });

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### Music Personality — ${lfmUsername}`),
        new TextDisplayBuilder().setContent(`# ${personality.name}\n${personality.description}`),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL('attachment://personality.png')
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Based on your listening history • Scrobbler`)
      );

    await interaction.editReply({ files: [attachment], components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};
