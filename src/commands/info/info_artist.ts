import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { fetchNowPlaying } from "../../nowplaying.js";
import { cmdMention } from "../../utils.js";

const {
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

function stripBioHtml(bio: string): string {
  // Remove "Read more on Last.fm" link at the end
  return bio.replace(/<a\s[^>]*>Read more on Last\.fm<\/a>/i, '').trim();
}

export async function executeArtistInfo(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const dbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const lfmUsername = dbUser?.lastfmUsername ?? null;

  let artistName = interaction.options.getString("artist") as string | null;

  // Default to now playing if no input
  if (!artistName) {
    if (!lfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} No artist specified and you haven't linked your Last.fm. Use ${cmdMention('link')} or specify an artist.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const np = await fetchNowPlaying(lfmUsername, apiKey);
    if (!np?.artistName) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't detect what you're listening to. Please specify an artist.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    artistName = np.artistName;
  }

  // Fetch Last.fm artist info, Deezer image (picture_xl, exact name match), and personal playcount in parallel
  const [lfmData, deezerData, personalData] = await Promise.all([
    fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`)
      .then(r => r.json()).catch(() => null),
    fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=5`)
      .then(r => r.json()).catch(() => null),
    lfmUsername
      ? fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&username=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`)
          .then(r => r.json()).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!lfmData || lfmData.error) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't find artist **${artistName}** on Last.fm.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const deezerResults: any[] = deezerData?.data ?? [];
  const deezerMatch = deezerResults.find((r: any) => r.name.toLowerCase() === artistName!.toLowerCase()) ?? deezerResults[0] ?? null;
  const imageUrl: string | null = deezerMatch?.picture_xl ?? null;

  const artist = lfmData.artist;
  const listeners = parseInt(artist?.stats?.listeners ?? '0').toLocaleString('en-US');
  const playcount = parseInt(artist?.stats?.playcount ?? '0').toLocaleString('en-US');
  const tags: string[] = (Array.isArray(artist?.tags?.tag) ? artist.tags.tag : artist?.tags?.tag ? [artist.tags.tag] : []).slice(0, 3).map((t: any) => t.name);
  const similar: string[] = (artist?.similar?.artist ?? []).slice(0, 5).map((a: any) => a.name);
  const rawBio: string = artist?.bio?.summary ?? '';
  const cleanBio = rawBio ? stripBioHtml(rawBio) : '';
  let bio: string | null = null;
  if (cleanBio) {
    const sentences = cleanBio.match(/[^.!?]+[.!?]+/g) ?? [];
    const twoSentences = sentences.slice(0, 2).join(' ').trim() || cleanBio.slice(0, 300);
    const words = twoSentences.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if ((current + (current ? ' ' : '') + word).length > 60 && current) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
    bio = lines.map(l => `-# ${l}`).join('\n');
  }
  const artistUrl: string = artist?.url ?? `https://www.last.fm/music/${encodeURIComponent(artistName)}`;
  const personalPlaycount = personalData?.artist?.stats?.userplaycount
    ? parseInt(personalData.artist.stats.userplaycount).toLocaleString('en-US')
    : null;

  // Section: max 3 text components — header, stats, genre (all on one line each)
  const statsLine = `${E.listening} **${listeners}** listeners • ${E.musicLast} **${playcount}** scrobbles`;
  const genreLine = tags.length > 0 ? `**Genre:** ${tags.join(' • ')}` : null;
  const similarLine = similar.length > 0 ? `**Similar:** ${similar.join(', ')}` : null;
  const personalLine = personalPlaycount ? `**Your plays:** ${personalPlaycount}` : null;

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${artistName}`),
      new TextDisplayBuilder().setContent(statsLine),
      ...(genreLine ? [new TextDisplayBuilder().setContent(genreLine)] : []),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(
        imageUrl ?? 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'
      )
    );

  const container = new ContainerBuilder().addSectionComponents(section);

  if (bio) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(bio)
    );
  }

  if (personalLine) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(personalLine));
  }

  if (similarLine) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(similarLine));
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(`${artistName} on Last.fm`)
      .setURL(artistUrl)
      .setStyle(ButtonStyle.Link)
  );
  container.addActionRowComponents(row as any);

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
