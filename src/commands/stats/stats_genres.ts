import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { AttachmentBuilder } from "discord.js";
import { cmdMention } from "../../utils.js";
import { buildLeaderboardCanvas } from "./canvas.js";

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = pkg;


const BLOCKED_TAGS = new Set(["seen live", "favorites", "favourite", "favorite", "owned"]);

function isBlockedTag(tag: string, artistNames: Set<string>): boolean {
  const lower = tag.toLowerCase();
  if (BLOCKED_TAGS.has(lower)) return true;
  if (/^\d{4}$/.test(lower)) return true;
  if (artistNames.has(lower)) return true;
  return false;
}

export async function executeStatsGenres(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;

  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} This command only works in servers.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const server = await prisma.server.findUnique({
    where: { guildId: interaction.guildId },
    include: { members: { include: { user: true } } },
  });

  if (!server) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} This server isn't set up yet.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const linkedMembers = server.members.filter(m => m.user.lastfmUsername);

  if (linkedMembers.length < 2) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} Not enough members have linked their Last.fm yet! Have more members use ${cmdMention('link')} to get started.`
      )
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const memberArtistResults = await Promise.all(
    linkedMembers.map(m =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(m.user.lastfmUsername!)}&period=overall&limit=50&api_key=${apiKey}&format=json`)
        .then(r => r.json()).catch(() => null)
    )
  ) as any[];

  // For each member, fetch artist tags and count unique genres
  const memberGenreCounts = await Promise.all(
    linkedMembers.map(async (m, memberIdx) => {
      const artists: any[] = memberArtistResults[memberIdx]?.topartists?.artist ?? [];
      const artistNames = new Set(artists.map(a => a.name.toLowerCase()));

      const artistInfos = await Promise.all(
        artists.slice(0, 30).map(a =>
          fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`)
            .then(r => r.json()).catch(() => null)
        )
      ) as any[];

      const uniqueGenres = new Set<string>();
      for (const info of artistInfos) {
        const tags: any[] = info?.artist?.tags?.tag ?? [];
        tags.slice(0, 3).forEach((tag: any) => {
          const name = (tag.name as string).toLowerCase();
          if (!isBlockedTag(name, artistNames)) {
            uniqueGenres.add(name);
          }
        });
      }

      return {
        username: m.user.lastfmUsername!,
        count: uniqueGenres.size,
      };
    })
  );

  const members = memberGenreCounts.sort((a, b) => b.count - a.count);

  const totalGenres = members.reduce((sum, m) => sum + m.count, 0).toLocaleString('en-US');

  const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const callerLfm = callerDb?.lastfmUsername;
  const callerRank = callerLfm ? members.findIndex(m => m.username === callerLfm) + 1 : 0;
  const callerEntry = callerLfm ? members.find(m => m.username === callerLfm) : null;
  const footerParts = [`${members.length} members • Unique genres from top 50 artists`];
  if (callerRank > 10 && callerEntry) {
    footerParts.push(`You are ranked **#${callerRank}** with **${callerEntry.count}** genres`);
  }

  const imageBuffer = await buildLeaderboardCanvas(
    members.slice(0, 10).map(m => ({ ...m, displayCount: m.count.toLocaleString('en-US') })),
    interaction.guild.name,
    "genres",
    `Total unique genres: ${totalGenres}`
  );
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'stats_genres.png' });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.listening} Server Genre Leaderboard — All time`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://stats_genres.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${footerParts.join(' • ')}`)
    );

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
