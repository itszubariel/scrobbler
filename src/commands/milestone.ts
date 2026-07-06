import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";
import { createCanvas } from "@napi-rs/canvas";
import { getCache, setCache } from "../cache.js";
import { uploadToSupabase } from "../uploadToSupabase.js";

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

const SCROBBLE_TIERS = [
  100, 500, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000,
];
const ARTIST_TIERS = [10, 50, 100, 500, 1_000, 5_000, 10_000];
const ALBUM_TIERS = [10, 50, 100, 500, 1_000, 5_000];
const TRACK_TIERS = [50, 100, 500, 1_000, 5_000, 10_000, 25_000];

interface MilestoneRow {
  label: string;
  count: number;
  last: number | null;
  next: number | null;
  pct: number;
  color: string;
}

interface CachedMilestone {
  imageUrl: string;
  lfmUsername: string;
  rows: MilestoneRow[];
}

function getMilestoneProgress(
  count: number,
  tiers: number[],
): { last: number | null; next: number | null; pct: number } {
  const achieved = tiers.filter((t) => count >= t);
  const last =
    achieved.length > 0 ? (achieved[achieved.length - 1] ?? null) : null;
  const nextIdx = last === null ? 0 : tiers.indexOf(last) + 1;
  const next = nextIdx < tiers.length ? (tiers[nextIdx] ?? null) : null;

  let pct = 0;
  if (next !== null) {
    const from = last ?? 0;
    pct = Math.min(Math.round(((count - from) / (next - from)) * 100), 99);
  } else {
    pct = 100;
  }

  return { last, next, pct };
}

function fmtTier(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}K`;
  return `${n}`;
}

async function buildMilestoneCanvas(rows: MilestoneRow[]): Promise<Buffer> {
  const WIDTH = 800;
  const ROW_H = 72;
  const HEIGHT = rows.length * ROW_H;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const LABEL_X = 20;
  const LABEL_W = 130;
  const BAR_X = LABEL_X + LABEL_W;
  const BAR_MAX_W = WIDTH - BAR_X - 110;
  const BAR_H = 14;

  rows.forEach((row, i) => {
    const y = i * ROW_H;
    const MID_Y = y + ROW_H / 2;

    // Row background
    ctx.fillStyle = i % 2 === 0 ? "#111111" : "#0e0e0e";
    ctx.fillRect(0, y, WIDTH, ROW_H);
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, y + ROW_H - 1, WIDTH, 1);

    // Label (e.g. "Scrobbles")
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 17px Inter";
    ctx.textAlign = "left";
    ctx.fillText(row.label, LABEL_X, MID_Y - 8);

    // Count below label
    ctx.fillStyle = "#888888";
    ctx.font = "13px Inter";
    ctx.fillText(row.count.toLocaleString("en-US"), LABEL_X, MID_Y + 10);

    // Progress bar track
    const BAR_Y = MID_Y - BAR_H / 2;
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.roundRect(BAR_X, BAR_Y, BAR_MAX_W, BAR_H, 4);
    ctx.fill();

    // Progress bar fill
    const fillW = Math.max(row.pct > 0 ? 8 : 0, BAR_MAX_W * (row.pct / 100));
    if (fillW > 0) {
      ctx.fillStyle = row.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(BAR_X, BAR_Y, fillW, BAR_H, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Right side — pct or maxed
    const RIGHT_X = WIDTH - 20;
    if (row.next === null) {
      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 14px Inter";
      ctx.textAlign = "right";
      ctx.fillText("🏆 MAX", RIGHT_X, MID_Y + 5);
    } else {
      // Tier label: "10K → 25K"
      const tierLabel =
        row.last !== null
          ? `${fmtTier(row.last)} → ${fmtTier(row.next)}`
          : `0 → ${fmtTier(row.next)}`;

      ctx.fillStyle = row.color;
      ctx.font = "bold 14px Inter";
      ctx.textAlign = "right";
      ctx.fillText(`${row.pct}%`, RIGHT_X, MID_Y - 7);

      ctx.fillStyle = "#666666";
      ctx.font = "12px Inter";
      ctx.fillText(tierLabel, RIGHT_X, MID_Y + 9);
    }

    ctx.textAlign = "left";
  });

  return canvas.toBuffer("image/png");
}

export const milestoneCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("milestone")
    .setDescription(
      "See your listening milestones and progress to the next one",
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Check another user's milestones (optional)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser =
      interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;

    const cacheKey = `milestone_${targetDiscordUser.id}`;
    const cached = await getCache<CachedMilestone>(cacheKey);

    if (cached) {
      if (!cached.imageUrl || cached.imageUrl.trim() === "") {
        console.log("Cached milestone imageUrl is invalid, skipping cache");
      } else {
        // Verify the image actually exists before serving from cache
        const headOk = await fetch(cached.imageUrl, { method: "HEAD" })
          .then((r) => r.ok)
          .catch(() => false);
        if (!headOk) {
          console.log("Cached milestone imageUrl returned 404, skipping cache");
        } else {
          await interaction.editReply({
            components: [
              buildMilestoneContainer(cached.lfmUsername, cached.imageUrl),
            ],
            flags: MessageFlags.IsComponentsV2,
          });
          return;
        }
      }
    }

    const dbUser = await prisma.user.findUnique({
      where: { discordId: targetDiscordUser.id },
    });

    if (!dbUser?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          isOwnProfile
            ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention("link")} to get started.`
            : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const lfmUsername = dbUser.lastfmUsername;

    const infoRes = (await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`,
    )
      .then((r) => r.json())
      .catch(() => null)) as any;

    if (infoRes?.error || !infoRes?.user) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const user = infoRes.user;
    const scrobbles = parseInt(user.playcount ?? "0");
    const artists = parseInt(user.artist_count ?? "0");
    const albums = parseInt(user.album_count ?? "0");
    const tracks = parseInt(user.track_count ?? "0");

    const rawRows = [
      {
        label: "Scrobbles",
        count: scrobbles,
        tiers: SCROBBLE_TIERS,
        color: "#a78bfa",
      },
      {
        label: "Artists",
        count: artists,
        tiers: ARTIST_TIERS,
        color: "#34d399",
      },
      { label: "Albums", count: albums, tiers: ALBUM_TIERS, color: "#60a5fa" },
      { label: "Tracks", count: tracks, tiers: TRACK_TIERS, color: "#f472b6" },
    ];

    const rows: MilestoneRow[] = rawRows.map((r) => {
      const { last, next, pct } = getMilestoneProgress(r.count, r.tiers);
      return {
        label: r.label,
        count: r.count,
        last,
        next,
        pct,
        color: r.color,
      };
    });

    const imageBuffer = await buildMilestoneCanvas(rows);

    let imageUrl = await uploadToSupabase(
      imageBuffer,
      "milestone-cache",
      `${targetDiscordUser.id}.png`,
    );

    console.log("Upload result:", imageUrl);

    const useAttachment = !imageUrl || imageUrl.trim() === "";
    const attachment = useAttachment
      ? new AttachmentBuilder(imageBuffer, { name: "milestone.png" })
      : null;

    const finalUrl = useAttachment ? "attachment://milestone.png" : imageUrl;

    const cacheData: CachedMilestone = {
      imageUrl: useAttachment ? "" : imageUrl,
      lfmUsername,
      rows,
    };
    await setCache(cacheKey, cacheData, 30);

    await interaction.editReply({
      files: attachment ? [attachment] : [],
      components: [buildMilestoneContainer(lfmUsername, finalUrl)],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

function buildMilestoneContainer(lfmUsername: string, imageUrl: string) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.crown} Milestones — ${lfmUsername}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Based on your Last.fm profile stats`,
      ),
    );
}
