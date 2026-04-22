import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = pkg;

import type { Command } from "../index.ts";
import { cmdMention } from "../utils.js";

export const npCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("np")
    .setDescription("See what you're scrobbling right now")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Check another user's now playing (optional)")
        .setRequired(false)
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
            ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention('link')} to get started.`
            : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`
        )
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const lfmUsername = dbUser.lastfmUsername;

    const res = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json&limit=1`
    );
    const data = (await res.json()) as any;

    if (data.error) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`
        )
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const tracks = data.recenttracks?.track;
    const track = Array.isArray(tracks) ? tracks[0] : tracks;

    if (!track) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} No recent tracks found for **${lfmUsername}**.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const isNowPlaying = track["@attr"]?.nowplaying === "true";

    const trackName = track.name ?? "Unknown Track";
    const artistName = track.artist?.["#text"] ?? "Unknown Artist";
    const albumName = track.album?.["#text"] ?? null;
    const albumArt = track.image?.find(
      (img: any) => img.size === "extralarge"
    )?.["#text"];
    const trackUrl = track.url ?? null;
    const scrobbleTimestamp: number | null = track.date?.uts ? parseInt(track.date.uts) : null;

    let userPlayCount: string | null = null;
    let topTags: string | null = null;
    let isLoved = false;
    let releaseYear: string | null = null;
    try {
      const trackInfoRes = await fetch(
        `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&user=${encodeURIComponent(lfmUsername)}&artist=${encodeURIComponent(artistName)}&track=${encodeURIComponent(trackName)}&api_key=${apiKey}&format=json`
      );
      const trackInfo = (await trackInfoRes.json()) as any;
      if (trackInfo.track?.userplaycount) {
        userPlayCount = parseInt(trackInfo.track.userplaycount).toLocaleString();
      }
      const tags = trackInfo.track?.toptags?.tag;
      if (Array.isArray(tags) && tags.length > 0) {
        const artistLower = artistName.toLowerCase();
        const trackLower = trackName.toLowerCase();
        const filtered = tags
          .filter((t: any) => {
            const name = t.name.toLowerCase();
            return name !== artistLower && name !== trackLower;
          })
          .slice(0, 3)
          .map((t: any) => t.name);
        if (filtered.length > 0) {
          const firstTwo = filtered.slice(0, 2);
          const firstTwoLength = firstTwo.join(' • ').length;
          const finalTags = firstTwoLength > 20 ? firstTwo : filtered;
          topTags = finalTags.join(' • ');
        }
      }
      isLoved = trackInfo.track?.userloved === '1';

      const wikiDate = trackInfo.track?.wiki?.published;
      if (wikiDate) {
        const yearMatch = wikiDate.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) releaseYear = yearMatch[0];
      }
    } catch {}

    // Fallback: try album.getInfo for release year if not found from track
    if (!releaseYear && albumName) {
      try {
        const albumInfoRes = await fetch(
          `https://ws.audioscrobbler.com/2.0/?method=album.getInfo&artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}&api_key=${apiKey}&format=json`
        );
        const albumInfo = (await albumInfoRes.json()) as any;
        const albumWikiDate = albumInfo.album?.wiki?.published;
        if (albumWikiDate) {
          const yearMatch = albumWikiDate.match(/\b(19|20)\d{2}\b/);
          if (yearMatch) releaseYear = yearMatch[0];
        }
      } catch {}
    }

    let listenerCount: string | null = null;
    try {
      const artistInfoRes = await fetch(
        `https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`
      );
      const artistInfo = (await artistInfoRes.json()) as any;
      const listeners = parseInt(artistInfo.artist?.stats?.listeners ?? '0');
      if (listeners >= 1_000_000) {
        listenerCount = `${(listeners / 1_000_000).toFixed(1)}M listeners`;
      } else if (listeners >= 1_000) {
        listenerCount = `${(listeners / 1_000).toFixed(1)}K listeners`;
      } else if (listeners > 0) {
        listenerCount = `${listeners} listeners`;
      }
    } catch {}

    // Status line
    let statusLine: string;
    if (isNowPlaying) {
      statusLine = `${E.musicalNote} Scrobbling • Now`;
    } else {
      const timestampStr = scrobbleTimestamp ? ` • <t:${scrobbleTimestamp}:R>` : '';
      statusLine = `${E.musicLast} Last Scrobbled${timestampStr}`;
    }

    // Build section text displays (max 3)
    const sectionTexts: InstanceType<typeof TextDisplayBuilder>[] = [
      new TextDisplayBuilder().setContent(statusLine),
      new TextDisplayBuilder().setContent(`### [${trackName}](${trackUrl})`),
      new TextDisplayBuilder().setContent(`**${artistName}**${listenerCount ? `\n${listenerCount}` : ''}`),
    ];

    // Dynamic layout: if album name is long (>15 chars), move "Your Plays" below with genre
    const ALBUM_SUFFIX_PATTERN = /[\s\-–(]+(?:OKNOTOK\s*\d{4}\s*\d{4}|remaster(?:ed)?(?:\s+\d{4})?|deluxe(?:\s+edition)?|special(?:\s+edition)?|expanded(?:\s+edition)?|anniversary(?:\s+edition)?|\d{4}\s+remaster(?:ed)?|bonus\s+tracks?|explicit\s+version|standard\s+edition|collector[''s]*\s+edition).*$/i;
    const albumCleaned = albumName ? albumName.replace(ALBUM_SUFFIX_PATTERN, '').trim() : null;

    const ALBUM_LENGTH_THRESHOLD = 20;
    const albumIsLong = albumCleaned && albumCleaned.length > ALBUM_LENGTH_THRESHOLD;

    // Truncate very long album names with ellipsis
    const MAX_ALBUM_DISPLAY = 30;
    const albumDisplay = albumCleaned
      ? albumCleaned.length > MAX_ALBUM_DISPLAY
        ? albumCleaned.slice(0, MAX_ALBUM_DISPLAY - 1) + '…'
        : albumCleaned
      : null;

    // Album line — release year always stays next to album name
    const albumLine = albumDisplay
      ? releaseYear
        ? `**Album:** ${albumDisplay} • ${releaseYear}`
        : `**Album:** ${albumDisplay}`
      : null;

    // "Your Plays" placement depends on album name length:
    // Short album (≤20): inline next to album line
    // Long album (>20): moved below genre
    // No album: own line
    let albumWithPlays: string | null = null;
    let playsBelow: string | null = null;

    if (userPlayCount) {
      if (albumIsLong) {
        // Long album: plays go below genre, heart follows plays
        playsBelow = `**Your plays:** ${userPlayCount}`;
      } else if (albumLine) {
        albumWithPlays = `${albumLine} • **Your plays:** ${userPlayCount}`;
      } else {
        playsBelow = `**Your plays:** ${userPlayCount}`;
      }
    }

    const genreLine = topTags ? `**Genre:** ${topTags}` : null;
    const lovedIndicator = isLoved ? E.heart : null;

    // Heart follows plays when plays is below (long album), otherwise stays on genre
    const heartOnPlays = lovedIndicator && (albumIsLong || !albumLine);
    const heartOnGenre = lovedIndicator && !heartOnPlays;

    const section = new SectionBuilder()
      .addTextDisplayComponents(...sectionTexts)
      .setThumbnailAccessory(
        new ThumbnailBuilder().setURL(
          albumArt && albumArt !== ""
            ? albumArt
            : "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png"
        )
      );

    const container = new ContainerBuilder()
      .addSectionComponents(section);

    if (albumWithPlays) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(albumWithPlays));
    } else if (albumLine) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(albumLine));
    }

    if (genreLine) {
      const genreWithLoved = heartOnGenre ? `${genreLine} • ${lovedIndicator}` : genreLine;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(genreWithLoved));
    } else if (heartOnGenre) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lovedIndicator!));
    }

    if (playsBelow) {
      const playsWithLoved = heartOnPlays ? `${playsBelow} • ${lovedIndicator}` : playsBelow;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(playsWithLoved));
    } else if (heartOnPlays) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lovedIndicator!));
    }

    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small)
      );

    const profileUrl = `https://www.last.fm/user/${encodeURIComponent(lfmUsername)}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(`${lfmUsername} on Last.fm`)
        .setURL(profileUrl)
        .setStyle(ButtonStyle.Link)
    );
    container.addActionRowComponents(row as any);

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};