import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = pkg;

import type { Command } from "../index.js";
import { cmdMention } from "../utils.js";

const MEDALS = ["1.", "2.", "3."];

function utsToDateStr(uts: number): string {
  const d = new Date(uts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(dateStrA: string, dateStrB: string): number {
  const a = new Date(dateStrA).getTime();
  const b = new Date(dateStrB).getTime();
  return Math.round(Math.abs(a - b) / (24 * 60 * 60 * 1000));
}

function todayStr(): string {
  return utsToDateStr(Math.floor(Date.now() / 1000));
}

interface StreakResult {
  name: string;
  days: number;
  lastDay: string;
}

function calcStreaks(daysByKey: Map<string, Set<string>>): StreakResult[] {
  const results: StreakResult[] = [];

  for (const [key, daysSet] of daysByKey) {
    const days = [...daysSet].sort();
    if (days.length === 0) continue;

    // Find all consecutive runs
    let runStart = 0;
    let best = 1;
    let bestEnd = days[0]!;

    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i - 1]!).getTime();
      const curr = new Date(days[i]!).getTime();
      const diff = Math.round((curr - prev) / (24 * 60 * 60 * 1000));
      if (diff === 1) {
        const run = i - runStart + 1;
        if (run > best) {
          best = run;
          bestEnd = days[i]!;
        }
      } else {
        runStart = i;
      }
    }

    if (best >= 2) {
      results.push({ name: key, days: best, lastDay: bestEnd });
    }
  }

  return results.sort((a, b) => b.days - a.days).slice(0, 3);
}

function formatStreak(streak: StreakResult, rank: number): string {
  const medal = MEDALS[rank] ?? "▪️";
  const today = todayStr();
  const daysAgo = daysBetween(streak.lastDay, today);
  const isActive = daysAgo <= 3;

  const namePart = streak.name.includes("|||")
    ? streak.name.split("|||")[0]!
    : streak.name;

  if (isActive) {
    return `${medal} **${namePart}** — ${E.streak} ${streak.days} day streak`;
  } else {
    return `${medal} **${namePart}** — ${E.days} ${streak.days} days • ended ${daysAgo} days ago`;
  }
}

export const streakCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("streak")
    .setDescription("Your top artist, track and album streaks over 90 day")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Check another user's streaks (optional)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser =
      interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;

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
    const cutoffMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const cutoffUts = Math.floor(cutoffMs / 1000);

    // Fetch pages until 90 days covered or 10 pages max
    const allTracks: any[] = [];
    let page = 1;
    const MAX_PAGES = 10;

    while (page <= MAX_PAGES) {
      const res = (await fetch(
        `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lfmUsername)}&limit=200&page=${page}&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null)) as any;

      const pageTracks: any[] = Array.isArray(res?.recenttracks?.track)
        ? res.recenttracks.track
        : res?.recenttracks?.track
          ? [res.recenttracks.track]
          : [];

      if (pageTracks.length === 0) break;

      // Filter out now playing and tracks without date
      const valid = pageTracks.filter(
        (t) => !t["@attr"]?.nowplaying && t.date?.uts,
      );
      allTracks.push(...valid);

      // Check if oldest track on this page is before cutoff
      const oldest = valid[valid.length - 1];
      if (oldest && parseInt(oldest.date.uts) < cutoffUts) break;

      // Check if there are more pages
      const totalPages = parseInt(
        res?.recenttracks?.["@attr"]?.totalPages ?? "1",
      );
      if (page >= totalPages) break;

      page++;
    }

    // Filter to only tracks within 90 days
    const tracks = allTracks.filter((t) => parseInt(t.date.uts) >= cutoffUts);

    if (tracks.length === 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} No scrobbles found in the last 90 days for **${lfmUsername}**.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    // Build day maps
    const artistDays = new Map<string, Set<string>>();
    const albumDays = new Map<string, Set<string>>();
    const trackDays = new Map<string, Set<string>>();

    for (const t of tracks) {
      const uts = parseInt(t.date.uts);
      const day = utsToDateStr(uts);
      const artist = t.artist?.["#text"] ?? t.artist?.name ?? "";
      const trackName = t.name ?? "";
      const album = t.album?.["#text"] ?? "";

      if (artist) {
        if (!artistDays.has(artist)) artistDays.set(artist, new Set());
        artistDays.get(artist)!.add(day);
      }

      if (trackName && artist) {
        const key = `${trackName}|||${artist}`;
        if (!trackDays.has(key)) trackDays.set(key, new Set());
        trackDays.get(key)!.add(day);
      }

      if (album && artist) {
        const key = `${album}|||${artist}`;
        if (!albumDays.has(key)) albumDays.set(key, new Set());
        albumDays.get(key)!.add(day);
      }
    }

    const artistStreaks = calcStreaks(artistDays);
    const trackStreaks = calcStreaks(trackDays);
    const albumStreaks = calcStreaks(albumDays);

    const hasAny =
      artistStreaks.length > 0 ||
      trackStreaks.length > 0 ||
      albumStreaks.length > 0;

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.listening} ${lfmUsername}'s Scrobbling Streaks — Last 90 Days`,
      ),
    );

    if (!hasAny) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `No streaks found in the last 90 days — keep scrobbling!`,
        ),
      );
    } else {
      if (artistStreaks.length > 0) {
        container
          .addSeparatorComponents(
            new SeparatorBuilder()
              .setDivider(true)
              .setSpacing(SeparatorSpacingSize.Small),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**${E.artists} Artist Streaks**`,
            ),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              artistStreaks.map((s, i) => formatStreak(s, i)).join("\n"),
            ),
          );
      }

      if (trackStreaks.length > 0) {
        container
          .addSeparatorComponents(
            new SeparatorBuilder()
              .setDivider(true)
              .setSpacing(SeparatorSpacingSize.Small),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**${E.tracks} Track Streaks**`,
            ),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              trackStreaks.map((s, i) => formatStreak(s, i)).join("\n"),
            ),
          );
      }

      if (albumStreaks.length > 0) {
        container
          .addSeparatorComponents(
            new SeparatorBuilder()
              .setDivider(true)
              .setSpacing(SeparatorSpacingSize.Small),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**${E.albums} Album Streaks**`,
            ),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              albumStreaks.map((s, i) => formatStreak(s, i)).join("\n"),
            ),
          );
      }
    }

    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Based on last 90 days of scrobbles • up to 2,000 tracks analyzed`,
        ),
      );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
