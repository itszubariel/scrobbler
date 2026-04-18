import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { fetchNowPlaying } from "../../nowplaying.js";

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

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function executeTrackInfo(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const dbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const lfmUsername = dbUser?.lastfmUsername ?? null;

  const rawTrack = interaction.options.getString("track") as string | null;

  // Track autocomplete returns "trackName|||artistName"
  let trackName: string | null = rawTrack?.includes('|||') ? rawTrack.split('|||')[0]! : rawTrack;
  let artistName: string | null = rawTrack?.includes('|||') ? rawTrack.split('|||')[1]! : null;

  // Default to now playing if no input
  if (!trackName || !artistName) {
    if (!lfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} No track specified and you haven't linked your Last.fm. Use \`/link\` or specify a track.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const np = await fetchNowPlaying(lfmUsername, apiKey);
    if (!np?.trackName || !np?.artistName) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't detect what you're listening to. Please specify a track.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    trackName = trackName ?? np.trackName;
    artistName = artistName ?? np.artistName;
  }

  const [lfmData, personalData] = await Promise.all([
    fetch(`https://ws.audioscrobbler.com/2.0/?method=track.getInfo&track=${encodeURIComponent(trackName)}&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`)
      .then(r => r.json()).catch(() => null),
    lfmUsername
      ? fetch(`https://ws.audioscrobbler.com/2.0/?method=track.getInfo&track=${encodeURIComponent(trackName)}&artist=${encodeURIComponent(artistName)}&username=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`)
          .then(r => r.json()).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!lfmData || lfmData.error) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't find **${trackName}** by **${artistName}** on Last.fm.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const track = lfmData.track;
  const albumName: string | null = track?.album?.title ?? null;
  const albumArtist: string = track?.album?.artist ?? artistName;
  const listeners = parseInt(track?.listeners ?? '0').toLocaleString('en-US');
  const playcount = parseInt(track?.playcount ?? '0').toLocaleString('en-US');
  const durationMs = parseInt(track?.duration ?? '0');
  const durationStr = durationMs > 0 ? formatDuration(durationMs) : null;
  const tags: string[] = (Array.isArray(track?.toptags?.tag) ? track.toptags.tag : track?.toptags?.tag ? [track.toptags.tag] : []).slice(0, 3).map((t: any) => t.name);
  const trackUrl: string = track?.url ?? `https://www.last.fm/music/${encodeURIComponent(artistName)}/_/${encodeURIComponent(trackName)}`;

  // Wiki — first 2 sentences, wrapped at ~45 chars
  const rawWiki: string = track?.wiki?.summary ?? '';
  const cleanWiki = rawWiki ? rawWiki.replace(/<a\s[^>]*>.*?<\/a>/gi, '').trim() : '';
  let wiki: string | null = null;
  if (cleanWiki) {
    const sentences = cleanWiki.match(/[^.!?]+[.!?]+/g) ?? [];
    const twoSentences = sentences.slice(0, 2).join(' ').trim() || cleanWiki.slice(0, 200);
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
    wiki = lines.map(l => `-# ${l}`).join('\n');
  }

  // Personal stats
  const personalPlaycount = personalData?.track?.userplaycount
    ? parseInt(personalData.track.userplaycount).toLocaleString('en-US')
    : null;
  const isLoved = personalData?.track?.userloved === '1';

  // Track art: prefer Last.fm's album image (always correct), fall back to iTunes
  const LFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';
  const lfmAlbumImage = track?.album?.image?.find((img: any) => img.size === 'extralarge')?.['#text'] || null;
  const lfmImageValid = lfmAlbumImage && !lfmAlbumImage.includes(LFM_PLACEHOLDER) ? lfmAlbumImage : null;

  let imageUrl: string | null = lfmImageValid;
  if (!imageUrl) {
    const itunesQuery = albumName ? `${albumArtist} ${albumName}` : `${artistName} ${trackName}`;
    const itunesEntity = albumName ? 'album' : 'song';
    const itunesData = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(itunesQuery)}&entity=${itunesEntity}&limit=10`
    ).then(r => r.json()).catch(() => null);
    const results: any[] = itunesData?.results ?? [];
    const nameLower = (albumName ?? trackName).toLowerCase();
    const nameField = albumName ? 'collectionName' : 'trackName';
    const match = results.find((r: any) => r[nameField]?.toLowerCase().includes(nameLower)) ?? results[0] ?? null;
    const raw = match?.artworkUrl100 ?? null;
    imageUrl = raw ? (raw as string).replace('100x100bb', '600x600bb') : null;
  }

  // Section: max 3 text components — header+sub, stats+duration, genre
  const headerLine = `### ${trackName}`;
  const subLine = `by **${artistName}**${albumName ? ` • ${albumName}` : ''}`;
  const statsLine = `${E.listening} **${listeners}** listeners • ${E.musicLast} **${playcount}** scrobbles${durationStr ? ` • ${durationStr}` : ''}`;
  const genreLine = tags.length > 0 ? tags.join(' • ') : null;

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${headerLine}\n${subLine}`),
      new TextDisplayBuilder().setContent(statsLine),
      ...(genreLine ? [new TextDisplayBuilder().setContent(genreLine)] : []),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(
        imageUrl ?? 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'
      )
    );

  const container = new ContainerBuilder().addSectionComponents(section);

  if (personalPlaycount) {
    const playsLine = `**Your plays:** ${personalPlaycount}${isLoved ? ` • ${E.heart}` : ''}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(playsLine));
  }

  if (wiki) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(wiki)
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(`${trackName} on Last.fm`)
      .setURL(trackUrl)
      .setStyle(ButtonStyle.Link)
  );
  container.addActionRowComponents(row as any);

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
