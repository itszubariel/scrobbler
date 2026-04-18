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

export async function executeStatsAlbums(interaction: any): Promise<void> {
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

  const albumResults = await Promise.all(
    linkedMembers.map(m =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(m.user.lastfmUsername!)}&limit=1000&period=overall&api_key=${apiKey}&format=json`)
        .then(r => r.json())
        .catch(() => null)
    )
  ) as any[];

  const members = linkedMembers
    .map((m, i) => {
      const raw = (albumResults[i]?.topalbums?.album ?? []).length as number;
      return {
        username: m.user.lastfmUsername!,
        count: raw,
        displayCount: raw >= 1000 ? '1,000+' : raw.toLocaleString('en-US'),
      };
    })
    .sort((a, b) => b.count - a.count);

  const hasCapHit = members.some(m => m.count >= 1000);
  const totalAlbums = hasCapHit
    ? members.reduce((sum, m) => sum + m.count, 0).toLocaleString('en-US') + '+'
    : members.reduce((sum, m) => sum + m.count, 0).toLocaleString('en-US');

  const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const callerLfm = callerDb?.lastfmUsername;
  const callerRank = callerLfm ? members.findIndex(m => m.username === callerLfm) + 1 : 0;
  const callerEntry = callerLfm ? members.find(m => m.username === callerLfm) : null;
  const footerParts = [`${members.length} members • Unique albums overall`];
  if (callerRank > 10 && callerEntry) {
    footerParts.push(`You are ranked **#${callerRank}** with **${callerEntry.displayCount}** albums`);
  }

  const imageBuffer = await buildLeaderboardCanvas(members.slice(0, 10), interaction.guild.name, "albums", `Total unique albums: ${totalAlbums}`);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'stats_albums.png' });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.albums} Server Album Leaderboard — All time`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://stats_albums.png')
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
