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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = pkg;


import type { Command } from "../index.ts";
import { cmdMention } from "../utils.js";

export const TASTE_PAGE_SIZE = 10;

export const PERIOD_LABELS_TASTE: Record<string, string> = {
  "7day":    "Last 7 days",
  "1month":  "Last month",
  "3month":  "Last 3 months",
  "6month":  "Last 6 months",
  "12month": "Last year",
  "overall": "All time",
};

const BAR_COLORS = [
  '#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fb923c',
  '#facc15', '#38bdf8', '#f87171', '#a3e635', '#e879f9',
];

function capitalizeTag(tag: string): string {
  return tag.replace(/\b\w/g, c => c.toUpperCase());
}

const BLOCKED_TAGS = new Set(["seen live", "favorites", "favourite", "favorite", "owned"]);

function isBlockedTag(tag: string, artistNames: Set<string>): boolean {
  const lower = tag.toLowerCase();
  if (BLOCKED_TAGS.has(lower)) return true;
  if (/^\d{4}$/.test(lower)) return true;
  if (artistNames.has(lower)) return true;
  return false;
}

export async function fetchTasteData(
  lfmUsername: string,
  period: string,
  apiKey: string
): Promise<{ tag: string; pct: number }[] | null> {
  const topRes = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=50&api_key=${apiKey}&format=json`
  );
  const topData = (await topRes.json()) as any;
  if (topData.error) return null;

  const artists: any[] = topData.topartists?.artist ?? [];
  const artistNames = new Set(artists.map(a => a.name.toLowerCase()));

  const artistInfos = await Promise.all(
    artists.map(a =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`)
        .then(r => r.json()).catch(() => null)
    )
  ) as any[];

  const tagWeights = new Map<string, number>();
  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    const info = artistInfos[i];
    const playcount = parseInt(artist.playcount) || 1;
    const tags: any[] = info?.artist?.tags?.tag ?? [];
    tags.slice(0, 3).forEach((tag: any) => {
      const name = tag.name.toLowerCase();
      if (isBlockedTag(name, artistNames)) return;
      tagWeights.set(name, (tagWeights.get(name) ?? 0) + playcount);
    });
  }

  const sorted = [...tagWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  if (sorted.length === 0) return null;

  const total = sorted.reduce((sum, [, w]) => sum + w, 0);
  return sorted.map(([tag, weight]) => ({
    tag,
    pct: Math.round((weight / total) * 100),
  }));
}

export async function buildTasteCanvas(
  allGenres: { tag: string; pct: number }[],
  username: string,
  periodLabel: string,
  page: number
): Promise<Buffer> {
  const pageGenres = allGenres.slice(page * TASTE_PAGE_SIZE, (page + 1) * TASTE_PAGE_SIZE);
  const totalPages = Math.ceil(allGenres.length / TASTE_PAGE_SIZE);

  const WIDTH = 800;
  const HEADER_H = 100;
  const ROW_H = 56;
  const FOOTER_H = 50;
  const HEIGHT = HEADER_H + pageGenres.length * ROW_H + FOOTER_H;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, WIDTH, HEADER_H);

  const hazeGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 200);
  hazeGrad.addColorStop(0, 'rgba(120, 60, 220, 0.18)');
  hazeGrad.addColorStop(0.5, 'rgba(80, 30, 160, 0.08)');
  hazeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, 0, WIDTH, HEADER_H);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(`${username}'s Taste Profile`, 30, 44);

  ctx.fillStyle = '#888888';
  ctx.font = '15px sans-serif';
  const pageIndicator = totalPages > 1 ? ` • Page ${page + 1} of ${totalPages}` : '';
  ctx.fillText(`${periodLabel}${pageIndicator}`, 30, 72);

  const LABEL_W = 200;
  const BAR_X = LABEL_W + 10;
  const BAR_MAX_W = WIDTH - BAR_X - 80;

  pageGenres.forEach((genre, i) => {
    const globalRank = page * TASTE_PAGE_SIZE + i;
    const y = HEADER_H + i * ROW_H;
    const MID_Y = y + ROW_H / 2;
    const color = BAR_COLORS[globalRank % BAR_COLORS.length] ?? '#a78bfa';

    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#0e0e0e';
    ctx.fillRect(0, y, WIDTH, ROW_H);

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, y + ROW_H - 1, WIDTH, 1);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    let label = capitalizeTag(genre.tag);
    if (ctx.measureText(label).width > LABEL_W - 20) {
      while (ctx.measureText(label + '…').width > LABEL_W - 20 && label.length > 0) {
        label = label.slice(0, -1);
      }
      label += '…';
    }
    ctx.fillText(label, 20, MID_Y + 6);

    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.roundRect(BAR_X, MID_Y - 8, BAR_MAX_W, 16, 4);
    ctx.fill();

    const fillW = Math.max(8, BAR_MAX_W * (genre.pct / 100));
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(BAR_X, MID_Y - 8, fillW, 16, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = color;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${genre.pct}%`, WIDTH - 20, MID_Y + 5);
    ctx.textAlign = 'left';
  });

  const footerY = HEADER_H + pageGenres.length * ROW_H;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, footerY, WIDTH, FOOTER_H);

  ctx.fillStyle = '#555555';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Based on top 50 artists • ${periodLabel}`, WIDTH / 2, footerY + 32);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

export function buildTasteContainer(
  allGenres: { tag: string; pct: number }[],
  attachment: any,
  lfmUsername: string,
  periodLabel: string,
  page: number,
  targetDiscordId: string,
  period: string  // period key e.g. "7day", not the label
) {
  const totalPages = Math.ceil(allGenres.length / TASTE_PAGE_SIZE);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.listening} ${lfmUsername}'s Top Genres — ${periodLabel}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://taste.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Page ${page + 1} of ${totalPages} • ${allGenres.length} genres`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );

  if (totalPages > 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`taste_prev_${page}_${targetDiscordId}_${period}`)
        .setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`taste_next_${page}_${targetDiscordId}_${period}`)
        .setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    );
    container.addActionRowComponents(row as any);
  }

  return container;
}

export const tasteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("taste")
    .setDescription("A breakdown of your top genres")
    .addStringOption((option) =>
      option.setName("period").setDescription("Time period").setRequired(false)
        .addChoices(
          { name: "Last 7 days",    value: "7day" },
          { name: "Last month",     value: "1month" },
          { name: "Last 3 months",  value: "3month" },
          { name: "Last 6 months",  value: "6month" },
          { name: "Last year",      value: "12month" },
          { name: "All time",       value: "overall" },
        )
    )
    .addUserOption((option) =>
      option.setName("user").setDescription("Check another user's taste (optional)").setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;
    const period = (interaction.options as any).getString("period") ?? "overall";
    const periodLabel = PERIOD_LABELS_TASTE[period] ?? "All time";

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
    const allGenres = await fetchTasteData(lfmUsername, period, apiKey);

    if (!allGenres) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't determine genre data for **${lfmUsername}**.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const page = 0;
    const imageBuffer = await buildTasteCanvas(allGenres, lfmUsername, periodLabel, page);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'taste.png' });
    const container = buildTasteContainer(allGenres, attachment, lfmUsername, periodLabel, page, targetDiscordUser.id, period);

    await interaction.editReply({
      files: [attachment],
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
