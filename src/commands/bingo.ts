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

interface BingoData {
  topArtists: any[];
  topTracks: any[];
  topAlbums: any[];
  topTags: any[];
  artistInfos: any[];
  totalScrobbles: number;
  uniqueArtists: number;
}

interface BingoCell {
  label: string;
  sublabel: string;
  check: (d: BingoData) => boolean;
  stat: (d: BingoData) => string;
}

const CELLS: BingoCell[] = [
  {
    label: "Mainstream",
    sublabel: "Top artist has 1M+ listeners",
    check: (d) => {
      const listeners = parseInt(
        d.artistInfos[0]?.artist?.stats?.listeners ?? "0",
      );
      return listeners >= 1_000_000;
    },
    stat: (d) => {
      const listeners = parseInt(
        d.artistInfos[0]?.artist?.stats?.listeners ?? "0",
      );
      return listeners >= 1_000_000
        ? `${(listeners / 1_000_000).toFixed(1)}M`
        : listeners >= 1_000
          ? `${(listeners / 1_000).toFixed(0)}K`
          : `${listeners}`;
    },
  },
  {
    label: "Genre Hopper",
    sublabel: "5+ genres in top tags",
    check: (d) => d.topTags.length >= 5,
    stat: (d) => `${d.topTags.length}`,
  },
  {
    label: "Obsessed",
    sublabel: "A track played 20+ times",
    check: (d) =>
      d.topTracks.some((t: any) => parseInt(t.playcount ?? "0") >= 20),
    stat: (d) => {
      const top = d.topTracks[0];
      return top ? `${parseInt(top.playcount ?? "0")}` : "0";
    },
  },
  {
    label: "Deep Cuts",
    sublabel: "Top artist under 100K listeners",
    check: (d) => {
      const listeners = parseInt(
        d.artistInfos[0]?.artist?.stats?.listeners ?? "0",
      );
      return listeners > 0 && listeners < 100_000;
    },
    stat: (d) => {
      const listeners = parseInt(
        d.artistInfos[0]?.artist?.stats?.listeners ?? "0",
      );
      return listeners >= 1_000
        ? `${(listeners / 1_000).toFixed(0)}K`
        : `${listeners}`;
    },
  },
  {
    label: "Collector",
    sublabel: "50+ unique artists",
    check: (d) => d.uniqueArtists >= 50,
    stat: (d) => `${d.uniqueArtists}`,
  },
  {
    label: "Album Fan",
    sublabel: "An album played 10+ times",
    check: (d) =>
      d.topAlbums.some((a: any) => parseInt(a.playcount ?? "0") >= 10),
    stat: (d) => {
      const top = d.topAlbums[0];
      return top ? `${parseInt(top.playcount ?? "0")}` : "0";
    },
  },
  {
    label: "Scrobble King",
    sublabel: "1,000+ total scrobbles",
    check: (d) => d.totalScrobbles >= 1_000,
    stat: (d) => {
      const s = d.totalScrobbles;
      return s >= 1_000_000
        ? `${(s / 1_000_000).toFixed(1)}M`
        : s >= 1_000
          ? `${(s / 1_000).toFixed(0)}K`
          : `${s}`;
    },
  },
  {
    label: "Loyal Fan",
    sublabel: "An artist played 50+ times",
    check: (d) =>
      d.topArtists.some((a: any) => parseInt(a.playcount ?? "0") >= 50),
    stat: (d) => {
      const top = d.topArtists[0];
      return top ? `${parseInt(top.playcount ?? "0")}` : "0";
    },
  },
  {
    label: "Variety Pack",
    sublabel: "10+ albums in top albums",
    check: (d) => d.topAlbums.length >= 10,
    stat: (d) => `${d.topAlbums.length}`,
  },
];

interface CachedBingo {
  imageUrl: string;
  lfmUsername: string;
  completed: number; // how many cells checked
}

const COLS = 3;
const ROWS = 3;
const WIDTH = 800;
const HEIGHT = 800;
const CELL_W = Math.floor(WIDTH / COLS); // 266
const CELL_H = Math.floor(HEIGHT / ROWS); // 266

async function buildBingoCanvas(
  checked: boolean[],
  data: BingoData,
): Promise<Buffer> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const GAP = 4;

  for (let i = 0; i < 9; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * CELL_W + GAP;
    const y = row * CELL_H + GAP;
    const w = CELL_W - GAP * 2;
    const h = CELL_H - GAP * 2;
    const done = checked[i] ?? false;
    const cell = CELLS[i]!;

    const MID_X = x + w / 2;
    const MID_Y = y + h / 2;

    // Cell background — rounded rect
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fillStyle = done ? "#0c1f15" : "#141414";
    ctx.fill();

    // Top label bar
    ctx.beginPath();
    ctx.roundRect(x, y, w, 36, [8, 8, 0, 0]);
    ctx.fillStyle = done ? "#0f2a1a" : "#1a1a1a";
    ctx.fill();

    // Label text
    ctx.fillStyle = done ? "#34d399" : "#cccccc";
    ctx.font = "bold 14px Inter";
    ctx.textAlign = "center";
    ctx.fillText(cell.label.toUpperCase(), MID_X, y + 23);

    // Big stat in the center
    const statVal = cell.stat(data);
    const statFontSize =
      statVal.length <= 4 ? 52 : statVal.length <= 6 ? 40 : 32;
    ctx.fillStyle = done ? "#34d399" : "#333333";
    ctx.font = `bold ${statFontSize}px Inter`;
    ctx.textAlign = "center";
    ctx.fillText(statVal, MID_X, MID_Y + statFontSize * 0.35);

    // Sublabel at bottom
    ctx.fillStyle = done ? "#1f6645" : "#383838";
    ctx.font = "12px Inter";
    ctx.fillText(cell.sublabel, MID_X, y + h - 14);

    // Checkmark (top-right corner) for completed
    if (done) {
      const cx = x + w - 14;
      const cy = y + 14;
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy);
      ctx.lineTo(cx - 1, cy + 4);
      ctx.lineTo(cx + 6, cy - 5);
      ctx.stroke();
    }

    // Subtle border
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.strokeStyle = done ? "#1a4a30" : "#1e1e1e";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return canvas.toBuffer("image/png");
}

export const bingoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("bingo")
    .setDescription("Generate your music taste bingo card")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Check another user's bingo card (optional)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser =
      interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;

    const cacheKey;

    if (cached) {
      if (!cached.imageUrl || cached.imageUrl.trim() === "") {
        console.log("Cached bingo imageUrl is invalid, skipping cache");
      } else {
        const headOk = await fetch(cached.imageUrl, { method: "HEAD" })
          .then((r) => r.ok)
          .catch(() => false);
        if (!headOk) {
          console.log("Cached bingo imageUrl returned 404, skipping cache");
        } else {
          await interaction.editReply({
            components: [buildBingoContainer(cached)],
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

    // Fetch all data in parallel
    const [artistsRes, tracksRes, albumsRes, tagsRes, infoRes] =
      (await Promise.all([
        fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=overall&limit=50&api_key=${apiKey}&format=json`,
        )
          .then((r) => r.json())
          .catch(() => null),
        fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(lfmUsername)}&period=overall&limit=50&api_key=${apiKey}&format=json`,
        )
          .then((r) => r.json())
          .catch(() => null),
        fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(lfmUsername)}&period=overall&limit=50&api_key=${apiKey}&format=json`,
        )
          .then((r) => r.json())
          .catch(() => null),
        fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettoptags&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`,
        )
          .then((r) => r.json())
          .catch(() => null),
        fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`,
        )
          .then((r) => r.json())
          .catch(() => null),
      ])) as any[];

    const topArtists: any[] = artistsRes?.topartists?.artist ?? [];
    const topTracks: any[] = tracksRes?.toptracks?.track ?? [];
    const topAlbums: any[] = albumsRes?.topalbums?.album ?? [];
    const topTags: any[] = tagsRes?.toptags?.tag ?? [];
    const totalScrobbles = parseInt(infoRes?.user?.playcount ?? "0");
    const uniqueArtists = parseInt(infoRes?.user?.artist_count ?? "0");

    if (topArtists.length === 0 && totalScrobbles === 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Not enough listening data found for **${lfmUsername}**.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    // Fetch artist info for top 20 (needed for listener count checks)
    const top20 = topArtists.slice(0, 20);
    const artistInfos = (await Promise.all(
      top20.map((a: any) =>
        fetch(
          `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`,
        )
          .then((r) => r.json())
          .catch(() => null),
      ),
    )) as any[];

    const bingoData: BingoData = {
      topArtists,
      topTracks,
      topAlbums,
      topTags,
      artistInfos,
      totalScrobbles,
      uniqueArtists,
    };

    // Evaluate each cell
    const checked = CELLS.map((cell) => cell.check(bingoData));
    const completed = checked.filter(Boolean).length;

    const imageBuffer = await buildBingoCanvas(checked, bingoData);

    let imageUrl = await uploadToSupabase(
      imageBuffer,
      "bingo-cache",
      `${targetDiscordUser.id}_v2.png`,
    );

    console.log("Upload result:", imageUrl);

    const useAttachment = !imageUrl || imageUrl.trim() === "";
    const attachment = useAttachment
      ? new AttachmentBuilder(imageBuffer, { name: "bingo.png" })
      : null;

    const finalUrl = useAttachment ? "attachment://bingo.png" : imageUrl;

    const cacheData: CachedBingo = {
      imageUrl: useAttachment ? "" : imageUrl,
      lfmUsername,
      completed,
    };
    // 60 min TTL
    await setCache(cacheKey, cacheData, 60);

    await interaction.editReply({
      files: attachment ? [attachment] : [],
      components: [buildBingoContainer({ ...cacheData, imageUrl: finalUrl })],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

function buildBingoContainer(data: CachedBingo) {
  const { lfmUsername, completed, imageUrl } = data;

  const total = 9;
  const completedLabel =
    completed === total
      ? "🎉 Full house!"
      : `${completed}/${total} squares completed`;

  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🎱 Music Bingo — ${lfmUsername}`,
      ),
      new TextDisplayBuilder().setContent(`-# ${completedLabel}`),
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
        `-# Based on your all-time listening history`,
      ),
    );
}
