import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";
import { getCache, setCache } from "../cache.js";

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

interface CachedOverlap {
  usernames: string[];
  sharedArtists: string[];
  sharedTracks: Array<{ name: string; artist: string }>;
  sharedAlbums: string[];
  sharedGenres: string[];
}

export const overlapCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("overlap")
    .setDescription("Find music shared between you and up to 9 others")
    .addUserOption((o) =>
      o
        .setName("user1")
        .setDescription("First user to compare")
        .setRequired(true),
    )
    .addUserOption((o) =>
      o
        .setName("user2")
        .setDescription("Second user (optional)")
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName("user3")
        .setDescription("Third user (optional)")
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName("user4")
        .setDescription("Fourth user (optional)")
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName("user5")
        .setDescription("Fifth user (optional)")
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName("user6")
        .setDescription("Sixth user (optional)")
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName("user7")
        .setDescription("Seventh user (optional)")
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName("user8")
        .setDescription("Eighth user (optional)")
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName("user9")
        .setDescription("Ninth user (optional)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const caller = interaction.user;
    const extras = (
      [
        "user1",
        "user2",
        "user3",
        "user4",
        "user5",
        "user6",
        "user7",
        "user8",
        "user9",
      ] as const
    )
      .map((k) => interaction.options.getUser(k))
      .filter((u): u is NonNullable<typeof u> => u !== null);

    const seen = new Set<string>();
    const discordUsers = [caller, ...extras].filter((u) => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });

    if (discordUsers.length < 2) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} You need at least one other user to compare with.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const sortedIds = [...discordUsers.map((u) => u.id)].sort();
    const cacheKey = `overlap_${sortedIds.join("_")}`;
    const cached = await getCache<CachedOverlap>(cacheKey);

    if (cached) {
      await interaction.editReply({
        components: [buildOverlapContainer(cached)],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const dbUsers = await Promise.all(
      discordUsers.map((u) =>
        prisma.user.findUnique({ where: { discordId: u.id } }),
      ),
    );

    for (let i = 0; i < discordUsers.length; i++) {
      if (!dbUsers[i]?.lastfmUsername) {
        const isCallerMissing = discordUsers[i]!.id === caller.id;
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            isCallerMissing
              ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention("link")} to get started.`
              : `${E.reject} **${discordUsers[i]!.username}** hasn't linked their Last.fm account yet.`,
          ),
        );
        await interaction.editReply({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
        return;
      }
    }

    const lfmUsernames = dbUsers.map((u) => u!.lastfmUsername!);

    // Fetch top artists, tracks, albums, tags for all users in parallel
    const lfmFetch = (method: string, user: string) =>
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=${method}&user=${encodeURIComponent(user)}&period=overall&limit=100&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null);

    const allResults = (await Promise.all(
      lfmUsernames.flatMap((u) => [
        lfmFetch("user.gettopartists", u),
        lfmFetch("user.gettoptracks", u),
        lfmFetch("user.gettopalbums", u),
        lfmFetch("user.gettoptags", u),
      ]),
    )) as any[];

    // Group results back per user: [artists, tracks, albums, tags]
    const perUser = lfmUsernames.map((_, i) => ({
      artists: allResults[i * 4 + 0],
      tracks: allResults[i * 4 + 1],
      albums: allResults[i * 4 + 2],
      tags: allResults[i * 4 + 3],
    }));

    if (perUser.some((u) => u.artists?.error)) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Couldn't fetch Last.fm data for one or more users.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const artistSets = perUser.map(
      (u) =>
        new Set<string>(
          (u.artists?.topartists?.artist ?? []).map((a: any) =>
            a.name.toLowerCase(),
          ),
        ),
    );
    const trackSets = perUser.map(
      (u) =>
        new Set<string>(
          (u.tracks?.toptracks?.track ?? []).map(
            (t: any) =>
              `${t.name.toLowerCase()}::${t.artist?.name?.toLowerCase() ?? ""}`,
          ),
        ),
    );
    const albumSets = perUser.map(
      (u) =>
        new Set<string>(
          (u.albums?.topalbums?.album ?? []).map(
            (a: any) =>
              `${a.name.toLowerCase()}::${a.artist?.name?.toLowerCase() ?? ""}`,
          ),
        ),
    );
    const genreSets = perUser.map(
      (u) =>
        new Set<string>(
          (u.tags?.toptags?.tag ?? [])
            .slice(0, 30)
            .map((t: any) => t.name.toLowerCase()),
        ),
    );

    function intersectAll<T>(sets: Set<T>[]): Set<T> {
      if (sets.length === 0) return new Set();
      const [first, ...rest] = sets as [Set<T>, ...Set<T>[]];
      return new Set(
        [...first].filter((item) => rest.every((s) => s.has(item))),
      );
    }

    const sharedArtistKeys = intersectAll(artistSets);
    const sharedTrackKeys = intersectAll(trackSets);
    const sharedAlbumKeys = intersectAll(albumSets);
    const sharedGenreKeys = intersectAll(genreSets);

    const artistMap = new Map<string, string>(
      (perUser[0]!.artists?.topartists?.artist ?? []).map((a: any) => [
        a.name.toLowerCase(),
        a.name as string,
      ]),
    );
    const trackMap = new Map<string, { name: string; artist: string }>(
      (perUser[0]!.tracks?.toptracks?.track ?? []).map((t: any) => [
        `${t.name.toLowerCase()}::${t.artist?.name?.toLowerCase() ?? ""}`,
        { name: t.name as string, artist: (t.artist?.name as string) ?? "" },
      ]),
    );
    const albumMap = new Map<string, string>(
      (perUser[0]!.albums?.topalbums?.album ?? []).map((a: any) => [
        `${a.name.toLowerCase()}::${a.artist?.name?.toLowerCase() ?? ""}`,
        a.name as string,
      ]),
    );

    const sharedArtists = [...sharedArtistKeys]
      .map((k) => artistMap.get(k) ?? k)
      .slice(0, 10);

    const sharedTracks = [...sharedTrackKeys]
      .map((k) => trackMap.get(k))
      .filter((t): t is { name: string; artist: string } => t !== undefined)
      .slice(0, 10);

    const sharedAlbums = [...sharedAlbumKeys]
      .map((k) => albumMap.get(k) ?? k)
      .slice(0, 10);

    const sharedGenres = [...sharedGenreKeys]
      .map((k) =>
        k
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      )
      .slice(0, 10);

    const cacheData: CachedOverlap = {
      usernames: lfmUsernames,
      sharedArtists,
      sharedTracks,
      sharedAlbums,
      sharedGenres,
    };
    await setCache(cacheKey, cacheData, 120);

    await interaction.editReply({
      components: [buildOverlapContainer(cacheData)],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

function buildOverlapContainer(data: CachedOverlap) {
  const { usernames, sharedArtists, sharedTracks, sharedAlbums, sharedGenres } =
    data;

  const hasAny =
    sharedArtists.length > 0 ||
    sharedTracks.length > 0 ||
    sharedAlbums.length > 0 ||
    sharedGenres.length > 0;

  const userList = usernames.join(" • ");
  const userCount = usernames.length;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.listening} Music Overlap — ${userCount} listeners`,
      ),
      new TextDisplayBuilder().setContent(`-# ${userList}`),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    );

  if (!hasAny) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `No shared music found across all ${userCount} listeners — you're all very different!`,
      ),
    );
  } else {
    if (sharedArtists.length > 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**${E.artists} Artists** — ${sharedArtists.length} shared\n${sharedArtists.join(" • ")}`,
        ),
      );
    }

    if (sharedTracks.length > 0) {
      container
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(false)
            .setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${E.tracks} Tracks** — ${sharedTracks.length} shared\n${sharedTracks.map((t) => `${t.name} — ${t.artist}`).join(" • ")}`,
          ),
        );
    }

    if (sharedAlbums.length > 0) {
      container
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(false)
            .setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${E.albums} Albums** — ${sharedAlbums.length} shared\n${sharedAlbums.join(" • ")}`,
          ),
        );
    }

    if (sharedGenres.length > 0) {
      container
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(false)
            .setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${E.chart} Genres** — ${sharedGenres.length} shared\n${sharedGenres.join(" • ")}`,
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
        `-# Based on top 100 artists, tracks, albums & genres • All time`,
      ),
    );

  return container;
}
