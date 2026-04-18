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

export async function executeWkArtists(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  let artistName = interaction.options.getString("artist") as string | null;

  // Default to now playing / last played if no artist provided
  if (!artistName) {
    const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
    if (!callerDb?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} No artist specified and you haven't linked your Last.fm. Use ${cmdMention('link')} or specify an artist.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const np = await fetchNowPlaying(callerDb.lastfmUsername, apiKey);
    if (!np) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't detect what you're listening to. Please specify an artist.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    artistName = np.artistName;
  }

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

  // NOTE: One API call per member — consider rate limiting or caching in the future
  const results = await Promise.all(
    linkedMembers.map(m =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&username=${encodeURIComponent(m.user.lastfmUsername!)}&api_key=${apiKey}&format=json`)
        .then(r => r.json())
        .catch(() => null)
    )
  ) as any[];

  const members = linkedMembers
    .map((m, i) => ({
      username: m.user.lastfmUsername!,
      plays: parseInt(results[i]?.artist?.stats?.userplaycount ?? '0'),
    }))
    .filter(m => m.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  if (members.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Nobody in this server has listened to **${artistName}**.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const canonicalName = results.find(r => r?.artist?.name)?.artist?.name ?? artistName;
  const imageBuffer = await buildWkCanvas(members, `Who Knows — ${canonicalName}`, 'artist', 'plays', interaction.guild.name);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'whoknows.png' });

  // Check if the caller is in the top 10, if not show their rank
  const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const callerLfm = callerDb?.lastfmUsername;
  const allSorted = linkedMembers
    .map((m, i) => ({
      username: m.user.lastfmUsername!,
      plays: parseInt(results[i]?.artist?.stats?.userplaycount ?? '0'),
    }))
    .filter(m => m.plays > 0)
    .sort((a, b) => b.plays - a.plays);
  const callerRank = callerLfm ? allSorted.findIndex(m => m.username === callerLfm) + 1 : 0;
  const callerInTop = callerRank > 0 && callerRank <= 10;
  const callerEntry = callerLfm ? allSorted.find(m => m.username === callerLfm) : null;

  const footerParts = [`${members.length} listener${members.length === 1 ? '' : 's'} in this server`];
  if (callerRank > 10 && callerEntry) {
    footerParts.push(`You are ranked **#${callerRank}** with **${callerEntry.plays.toLocaleString()}** plays`);
  } else if (callerLfm && callerRank === 0) {
    footerParts.push(`You haven't listened to this artist`);
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.artists} Who Knows **${canonicalName}**?`)
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
