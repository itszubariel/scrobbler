import "dotenv/config";
import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { buildWkCanvas } from "./canvas.js";
import { fetchNowPlaying } from "../../nowplaying.js";
import { cmdMention, pageStr } from "../../utils.js";
import { uploadToSupabase } from "../../uploadToSupabase.js";
import { getCache, setCache } from "../../cache.js";

const TTL_MS = 10 * 60 * 1000;

export async function executeWkAlbums(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const rawAlbum = interaction.options.getString("album") as string | null;

  let albumInput: string | null = null;
  let artistInput: string | null = null;
  if (rawAlbum?.includes("|||")) {
    const [a, b] = rawAlbum.split("|||");
    albumInput = a ?? null;
    artistInput = b ?? null;
  } else {
    albumInput = rawAlbum;
  }

  if (!albumInput || !artistInput) {
    const callerDb = await prisma.user.findUnique({
      where: { discordId: interaction.user.id },
    });
    if (!callerDb?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} No album specified and you haven't linked your Last.fm. Use ${cmdMention("link")} or specify an album.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }
    const np = await fetchNowPlaying(callerDb.lastfmUsername, apiKey);
    if (!np?.albumName) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Couldn't detect what album you're listening to. Please specify one.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }
    albumInput = albumInput ?? np.albumName;
    artistInput = artistInput ?? np.artistName;
  }

  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} This command only works in servers.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const server = await prisma.server.findUnique({
    where: { guildId: interaction.guildId },
    include: { members: { include: { user: true } } },
  });
  const linkedMembers =
    server?.members.filter((m) => m.user.lastfmUsername) ?? [];

  if (linkedMembers.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} No members have linked their Last.fm yet. Use ${cmdMention("link")} to get started.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const results = (await Promise.all(
    linkedMembers.map((m) =>
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=album.getInfo&artist=${encodeURIComponent(artistInput!)}&album=${encodeURIComponent(albumInput!)}&username=${encodeURIComponent(m.user.lastfmUsername!)}&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ),
  )) as any[];

  const allSorted = linkedMembers
    .map((m, i) => ({
      username: m.user.lastfmUsername!,
      plays: parseInt(results[i]?.album?.userplaycount ?? "0"),
    }))
    .filter((m) => m.plays > 0)
    .sort((a, b) => b.plays - a.plays);

  if (allSorted.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} Nobody in this server has listened to **${albumInput}** by **${artistInput}**.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const canonicalAlbum =
    results.find((r) => r?.album?.name)?.album?.name ?? albumInput;
  const canonicalArtist =
    results.find((r) => r?.album?.artist)?.album?.artist ?? artistInput;
  const totalPages = Math.ceil(allSorted.length / 10);
  const totalListeners = allSorted.length;
  const cacheKey = `album:${canonicalAlbum}|||${canonicalArtist}`;

  const buffers = await Promise.all(
    Array.from({ length: totalPages }, (_, i) =>
      buildWkCanvas(
        allSorted,
        `Who Knows — ${canonicalAlbum}`,
        `album by ${canonicalArtist}`,
        "plays",
        interaction.guild.name,
        i,
      ),
    ),
  );
  const urls = await Promise.all(
    buffers.map((buf, i) =>
      uploadToSupabase(
        buf,
        "wk-cache",
        `${interaction.guildId}_album_${encodeURIComponent(canonicalAlbum)}_${i}.png`,
      ),
    ),
  );

  // Save to generic cache
  const genericCacheKey = `wk_albums_${interaction.guildId}_${canonicalAlbum}_${canonicalArtist}`;
  await setCache(
    genericCacheKey,
    {
      imageUrls: urls,
      pageCount: totalPages,
      memberCount: totalListeners,
    },
    60,
  );

  // Build container
  const callerDb = await prisma.user.findUnique({
    where: { discordId: interaction.user.id },
  });
  const callerLfm = callerDb?.lastfmUsername;
  const callerRank = callerLfm
    ? allSorted.findIndex((m) => m.username === callerLfm) + 1
    : 0;
  const callerEntry = callerLfm
    ? allSorted.find((m) => m.username === callerLfm)
    : null;

  const footerParts = [
    `${totalListeners} listener${totalListeners === 1 ? "" : "s"} in this server`,
  ];
  if (callerRank > 10 && callerEntry)
    footerParts.push(
      `You are ranked **#${callerRank}** with **${callerEntry.plays.toLocaleString()}** plays`,
    );
  else if (callerLfm && callerRank === 0)
    footerParts.push(`You haven't listened to this album`);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.albums} Who Knows **${canonicalAlbum}**?`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(urls[0]!),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${pageStr(0, totalPages)} • ${footerParts.join(" • ")}`,
      ),
    );

  if (totalPages > 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `wk_album_prev_0_${interaction.guildId}_${encodeURIComponent(canonicalAlbum)}|||${encodeURIComponent(canonicalArtist)}`,
        )
        .setEmoji({
          id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
          name: "scrobbler_prev",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(
          `wk_album_next_0_${interaction.guildId}_${encodeURIComponent(canonicalAlbum)}|||${encodeURIComponent(canonicalArtist)}`,
        )
        .setEmoji({
          id: E.next.match(/:(\d+)>/)?.[1] ?? "0",
          name: "scrobbler_next",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false),
    );
    container.addActionRowComponents(row as any);
  }

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
