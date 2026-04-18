import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { AttachmentBuilder } from "discord.js";
import { buildWkCanvas } from "./canvas.js";
import { fetchNowPlaying } from "../../nowplaying.js";
import { cmdMention } from "../../utils.js";

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = pkg;

export async function executeWkGenres(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  let genreInput = interaction.options.getString("genre") as string | null;

  if (!genreInput) {
    const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
    if (!callerDb?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} No genre specified and you haven't linked your Last.fm. Use ${cmdMention('link')} or specify a genre.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const np = await fetchNowPlaying(callerDb.lastfmUsername, apiKey);
    if (!np?.topGenre) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't detect a genre from what you're listening to. Please specify one.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    genreInput = np.topGenre;
  }

  genreInput = genreInput.toLowerCase();

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

  const linkedMembers = server?.members.filter(m => m.user.lastfmUsername) ?? [];

  if (linkedMembers.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} No members have linked their Last.fm yet. Use ${cmdMention('link')} to get started.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // For each member, fetch their top artists tagged with this genre via tag.getTopArtists
  // then cross-reference with their personal top artists to get a weighted play score
  // NOTE: One API call per member — consider rate limiting or caching in the future
  const memberScores = await Promise.all(
    linkedMembers.map(async m => {
      try {
        // Get member's top artists
        const topRes = await fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(m.user.lastfmUsername!)}&period=overall&limit=100&api_key=${apiKey}&format=json`
        ).then(r => r.json()) as any;

        const artists: any[] = topRes?.topartists?.artist ?? [];

        // Get artist info for each to check tags, sum playcounts for artists tagged with this genre
        const artistInfos = await Promise.all(
          artists.slice(0, 30).map(a =>
            fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`)
              .then(r => r.json()).catch(() => null)
          )
        ) as any[];

        let score = 0;
        for (let i = 0; i < artists.slice(0, 30).length; i++) {
          const info = artistInfos[i];
          const tags: string[] = (info?.artist?.tags?.tag ?? []).map((t: any) => t.name.toLowerCase());
          if (tags.includes(genreInput)) {
            score += parseInt(artists[i]?.playcount ?? '0');
          }
        }
        return { username: m.user.lastfmUsername!, plays: score };
      } catch {
        return { username: m.user.lastfmUsername!, plays: 0 };
      }
    })
  );

  const members = memberScores
    .filter(m => m.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  if (members.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Nobody in this server listens to **${genreInput}**.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const displayGenre = genreInput.charAt(0).toUpperCase() + genreInput.slice(1);
  const imageBuffer = await buildWkCanvas(members, `Who Knows — ${displayGenre}`, 'genre', 'plays', interaction.guild.name);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'whoknows.png' });

  const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const callerLfm = callerDb?.lastfmUsername;
  const allSorted = memberScores.filter(m => m.plays > 0).sort((a, b) => b.plays - a.plays);
  const callerRank = callerLfm ? allSorted.findIndex(m => m.username === callerLfm) + 1 : 0;
  const callerEntry = callerLfm ? allSorted.find(m => m.username === callerLfm) : null;

  const footerParts = [`${members.length} listener${members.length === 1 ? '' : 's'} in this server`];
  if (callerRank > 10 && callerEntry) {
    footerParts.push(`You are ranked **#${callerRank}** with **${callerEntry.plays.toLocaleString()}** plays`);
  } else if (callerLfm && callerRank === 0) {
    footerParts.push(`You haven't listened to this genre`);
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.chart} Who Listens to **${displayGenre}**?`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://whoknows.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${footerParts.join(' • ')}`)
    );

  await interaction.editReply({ files: [attachment], components: [container], flags: MessageFlags.IsComponentsV2 });
}
