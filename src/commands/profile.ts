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
import { generateBio } from "../generateBio.js";
import { cmdMention } from "../utils.js";

export const profileCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Your music profile with an AI-generated bio")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("View another user's profile (optional)")
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
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
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const lfmUsername = dbUser.lastfmUsername;

    const [infoData, topArtistsData, topTracksData, topTagsData] = await Promise.all([
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`).then(r => r.json()),
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=overall&limit=5&api_key=${apiKey}&format=json`).then(r => r.json()),
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(lfmUsername)}&period=overall&limit=1&api_key=${apiKey}&format=json`).then(r => r.json()),
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettoptags&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`).then(r => r.json()),
    ]) as [any, any, any, any];

    if (infoData.error) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const user = infoData.user;
    const registeredYear = new Date(parseInt(user.registered?.unixtime ?? user.registered?.['#text'] ?? '0') * 1000).getFullYear();
    const country = user.country && user.country !== 'None' ? user.country : null;
    const realName = user.realname?.trim() || null;
    const scrobblesRaw = parseInt(user.playcount);
    const artistCountRaw = parseInt(user.artist_count);
    const trackCountRaw = parseInt(user.track_count);
    const albumCountRaw = parseInt(user.album_count);

    const scrobbles = scrobblesRaw.toLocaleString();
    const artistCount = artistCountRaw.toLocaleString();
    const trackCount = trackCountRaw.toLocaleString();
    const albumCount = albumCountRaw.toLocaleString();
    const profileUrl = user.url;
    const avatar = user.image?.find((img: any) => img.size === 'extralarge')?.['#text']
      ?? user.image?.[user.image.length - 1]?.['#text']
      ?? 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';

    const topArtist = topArtistsData.topartists?.artist?.[0];
    const topTrack = topTracksData.toptracks?.track?.[0];

    const topArtistNames: string[] = (topArtistsData.topartists?.artist ?? [])
      .map((a: any) => a.name)
      .filter(Boolean);
    const topGenres: string[] = (topTagsData.toptags?.tag ?? [])
      .map((t: any) => t.name)
      .filter(Boolean)
      .slice(0, 5);

    const bioPromise = generateBio(topArtistNames, topGenres, scrobblesRaw);

    const bio = await bioPromise;

    // Wrap bio text at ~45 chars per line, breaking at word boundaries
    const wrapText = (text: string, maxLen = 45): string => {
      const words = text.split(' ');
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        if ((current + (current ? ' ' : '') + word).length > maxLen && current) {
          lines.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) lines.push(current);
      return lines.join('\n');
    };

    const bioText = bio ? `${wrapText(bio)}\n-# ✨ AI-generated` : null;

    const headerText = realName
      ? `### ${realName}\n${bioText ?? `[${lfmUsername}](https://www.last.fm/user/${lfmUsername})`}`
      : `### [${lfmUsername}](https://www.last.fm/user/${lfmUsername})${bioText ? `\n${bioText}` : ''}`;

    const memberLine = country
      ? `Member since ${registeredYear} • ${country}`
      : `Member since ${registeredYear}`;

    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(headerText),
        new TextDisplayBuilder().setContent(memberLine),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar));

    const use2x2 = scrobblesRaw > 99_999 || artistCountRaw > 10_000 || trackCountRaw > 10_000 || albumCountRaw > 10_000;

    const statsLine = use2x2
      ? `${E.music} ${scrobbles} scrobbles • ${E.artists} ${artistCount} artists\n${E.tracks} ${trackCount} tracks • ${E.albums} ${albumCount} albums`
      : `${E.music} ${scrobbles} scrobbles • ${E.artists} ${artistCount} artists • ${E.tracks} ${trackCount} tracks • ${E.albums} ${albumCount} albums`;

    const container = new ContainerBuilder()
      .addSectionComponents(section)
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(statsLine))
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      );

    if (topArtist) {
      const artistPlays = parseInt(topArtist.playcount);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.top} Top Artist: **${topArtist.name}** — ${artistPlays.toLocaleString()} ${artistPlays === 1 ? 'play' : 'plays'}`
        )
      );
    }

    if (topTrack) {
      const trackPlays = parseInt(topTrack.playcount);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.musicalNote} Top Track: **${topTrack.name}** by ${topTrack.artist?.name ?? 'Unknown'} — ${trackPlays.toLocaleString()} ${trackPlays === 1 ? 'play' : 'plays'}`
        )
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("View Last.fm Profile")
        .setURL(profileUrl)
        .setStyle(ButtonStyle.Link)
    );
    container.addActionRowComponents(row as any);

    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};
