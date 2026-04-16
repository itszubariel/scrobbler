import "dotenv/config";
import pkg from "discord.js";
import pkgPrisma from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
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
const { PrismaClient } = pkgPrisma;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

import type { Command } from "../index.ts";

function compatLabel(score: number): string {
  if (score <= 20) return "Very Different 🎭";
  if (score <= 40) return "Some Overlap 🤝";
  if (score <= 60) return "Decent Taste Match 🎵";
  if (score <= 80) return "Great Match 🎶";
  return "Musical Soulmates 🎸";
}

/** Jaccard similarity: shared / total unique, returns 0–100 */
function jaccardScore(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  const shared = [...setA].filter(k => setB.has(k)).length;
  const union = new Set([...setA, ...setB]).size;
  return Math.round((shared / union) * 100);
}

async function buildCompatCanvas(
  scores: { label: string; score: number; color: string }[]
): Promise<Buffer> {
  const WIDTH = 800;
  const ROW_H = 56;
  const HEIGHT = scores.length * ROW_H;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const LABEL_W = 120;
  const BAR_X = LABEL_W + 20;
  const BAR_MAX_W = WIDTH - BAR_X - 80;

  scores.forEach((row, i) => {
    const y = i * ROW_H;
    const MID_Y = y + ROW_H / 2;

    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#0e0e0e';
    ctx.fillRect(0, y, WIDTH, ROW_H);

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, y + ROW_H - 1, WIDTH, 1);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
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
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${row.score}%`, WIDTH - 20, MID_Y + 5);
    ctx.textAlign = 'left';
  });

  return canvas.toBuffer('image/png');
}

export const compatCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("compat")
    .setDescription("See how your taste compares to another user")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to compare with")
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName("user2")
        .setDescription("Compare two other users instead of yourself (optional)")
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const user2Discord = interaction.options.getUser("user", true);
    const user3Discord = interaction.options.getUser("user2", false);

    // If user2 option provided, compare user1 vs user2 (ignore caller)
    // Otherwise compare caller vs user1
    const user1Discord = user3Discord ? user2Discord : interaction.user;
    const user2Final   = user3Discord ?? user2Discord;

    if (user1Discord.id === user2Final.id) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} You can't compare yourself with yourself!`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const [db1, db2] = await Promise.all([
      prisma.user.findUnique({ where: { discordId: user1Discord.id } }),
      prisma.user.findUnique({ where: { discordId: user2Final.id } }),
    ]);

    if (!db1?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          user3Discord
            ? `${E.reject} **${user1Discord.username}** hasn't linked their Last.fm account yet.`
            : `${E.reject} You haven't linked your Last.fm account yet! Use </link:1493336821818720409> to get started.`
        )
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (!db2?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} **${user2Final.username}** hasn't linked their Last.fm account yet.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const lfm1 = db1.lastfmUsername;
    const lfm2 = db2.lastfmUsername;

    const lfmFetch = (method: string, user: string, extra = '') =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=${method}&user=${encodeURIComponent(user)}&period=overall&limit=100&api_key=${apiKey}&format=json${extra}`).then(r => r.json());

    const [
      artists1, artists2,
      tracks1, tracks2,
      albums1, albums2,
      tags1, tags2,
    ] = await Promise.all([
      lfmFetch('user.gettopartists', lfm1),
      lfmFetch('user.gettopartists', lfm2),
      lfmFetch('user.gettoptracks', lfm1),
      lfmFetch('user.gettoptracks', lfm2),
      lfmFetch('user.gettopalbums', lfm1),
      lfmFetch('user.gettopalbums', lfm2),
      lfmFetch('user.gettoptags', lfm1, ''),
      lfmFetch('user.gettoptags', lfm2, ''),
    ]) as [any, any, any, any, any, any, any, any];

    if (artists1.error || artists2.error) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't fetch Last.fm data for one or both users.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // Build normalised sets
    const artistSet1 = new Set<string>((artists1.topartists?.artist ?? []).map((a: any) => a.name.toLowerCase()));
    const artistSet2 = new Set<string>((artists2.topartists?.artist ?? []).map((a: any) => a.name.toLowerCase()));

    const trackSet1 = new Set<string>((tracks1.toptracks?.track ?? []).map((t: any) => `${t.name.toLowerCase()}::${t.artist?.name?.toLowerCase()}`));
    const trackSet2 = new Set<string>((tracks2.toptracks?.track ?? []).map((t: any) => `${t.name.toLowerCase()}::${t.artist?.name?.toLowerCase()}`));

    const albumSet1 = new Set<string>((albums1.topalbums?.album ?? []).map((a: any) => `${a.name.toLowerCase()}::${a.artist?.name?.toLowerCase()}`));
    const albumSet2 = new Set<string>((albums2.topalbums?.album ?? []).map((a: any) => `${a.name.toLowerCase()}::${a.artist?.name?.toLowerCase()}`));

    const genreSet1 = new Set<string>((tags1.toptags?.tag ?? []).slice(0, 30).map((t: any) => t.name.toLowerCase()));
    const genreSet2 = new Set<string>((tags2.toptags?.tag ?? []).slice(0, 30).map((t: any) => t.name.toLowerCase()));

    // Individual scores
    const artistScore = jaccardScore(artistSet1, artistSet2);
    const trackScore  = jaccardScore(trackSet1, trackSet2);
    const albumScore  = jaccardScore(albumSet1, albumSet2);
    const genreScore  = jaccardScore(genreSet1, genreSet2);

    // Weighted overall: genres carry most weight (broad taste), then artists, tracks, albums
    const overall = Math.round(
      genreScore  * 0.35 +
      artistScore * 0.30 +
      trackScore  * 0.20 +
      albumScore  * 0.15
    );

    // Top 5 shared artists by combined playcount
    const artistMap1 = new Map<string, any>((artists1.topartists?.artist ?? []).map((a: any) => [a.name.toLowerCase(), a]));
    const artistMap2 = new Map<string, any>((artists2.topartists?.artist ?? []).map((a: any) => [a.name.toLowerCase(), a]));
    const sharedArtists = [...artistSet1]
      .filter(k => artistSet2.has(k))
      .map(k => ({
        name: artistMap1.get(k)!.name,
        combined: parseInt(artistMap1.get(k)!.playcount) + parseInt(artistMap2.get(k)!.playcount),
      }))
      .sort((a, b) => b.combined - a.combined)
      .slice(0, 5);

    // Top 5 shared genres
    const sharedGenres = [...genreSet1]
      .filter(k => genreSet2.has(k))
      .slice(0, 5);

    // Top 5 shared tracks
    const trackMap1 = new Map<string, any>((tracks1.toptracks?.track ?? []).map((t: any) => [`${t.name.toLowerCase()}::${t.artist?.name?.toLowerCase()}`, t]));
    const sharedTracks = [...trackSet1]
      .filter(k => trackSet2.has(k))
      .map(k => trackMap1.get(k))
      .filter(Boolean)
      .slice(0, 5);

    // Top 5 shared albums
    const albumMap1 = new Map<string, any>((albums1.topalbums?.album ?? []).map((a: any) => [`${a.name.toLowerCase()}::${a.artist?.name?.toLowerCase()}`, a]));
    const sharedAlbums = [...albumSet1]
      .filter(k => albumSet2.has(k))
      .map(k => albumMap1.get(k))
      .filter(Boolean)
      .slice(0, 5);

    // Build canvas score bars
    const scoreRows = [
      { label: 'Artists', score: artistScore, color: '#a78bfa' },
      { label: 'Tracks',  score: trackScore,  color: '#60a5fa' },
      { label: 'Albums',  score: albumScore,  color: '#34d399' },
      { label: 'Genres',  score: genreScore,  color: '#f472b6' },
    ];

    const imageBuffer = await buildCompatCanvas(scoreRows);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'compat.png' });

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### Music Compatibility — ${lfm1} & ${lfm2}`),
        new TextDisplayBuilder().setContent(`# ${overall}%\n${compatLabel(overall)}`),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL('attachment://compat.png')
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      );

    // Slice all to top 3
    const top3Artists = sharedArtists.slice(0, 3);
    const top3Tracks  = sharedTracks.slice(0, 3);
    const top3Albums  = sharedAlbums.slice(0, 3);
    const top3Genres  = sharedGenres.slice(0, 3);

    const hasAny = top3Artists.length > 0 || top3Tracks.length > 0 || top3Albums.length > 0 || top3Genres.length > 0;

    if (!hasAny) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No overlap found — you two are musical opposites!")
      );
    } else {
      const lines: string[] = [];

      if (top3Artists.length > 0)
        lines.push(`${E.top} **Artists:** ${top3Artists.map(a => a.name).join(' • ')}`);

      if (top3Tracks.length > 0)
        lines.push(`${E.musicalNote} **Tracks:** ${top3Tracks.map((t: any) => `${t.name} — ${t.artist?.name}`).join(' • ')}`);

      if (top3Albums.length > 0)
        lines.push(`${E.albums} **Albums:** ${top3Albums.map((a: any) => a.name).join(' • ')}`);

      if (top3Genres.length > 0)
        lines.push(`${E.chart} **Genres:** ${top3Genres.join(' • ')}`);

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join('\n'))
      );
    }

    container
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Based on top 100 artists, tracks, albums & genres`
        )
      );

    await interaction.editReply({ files: [attachment], components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};
