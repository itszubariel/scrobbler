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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function executeAlbumInfo(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const dbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const lfmUsername = dbUser?.lastfmUsername ?? null;

  const rawAlbum = interaction.options.getString("album") as string | null;

  // Album autocomplete returns "albumName|||artistName"
  let albumName: string | null = rawAlbum?.includes('|||') ? rawAlbum.split('|||')[0]! : rawAlbum;
  let artistName: string | null = rawAlbum?.includes('|||') ? rawAlbum.split('|||')[1]! : null;

  // Default to now playing if no input
  if (!albumName || !artistName) {
    if (!lfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} No album specified and you haven't linked your Last.fm. Use \`/link\` or specify an album.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const np = await fetchNowPlaying(lfmUsername, apiKey);
    if (!np?.albumName || !np?.artistName) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't detect what you're listening to. Please specify an album.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    albumName = albumName ?? np.albumName;
    artistName = artistName ?? np.artistName;
  }

  const [lfmData, personalData] = await Promise.all([
    fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getInfo&album=${encodeURIComponent(albumName)}&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`)
      .then(r => r.json()).catch(() => null),
    lfmUsername
      ? fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getInfo&album=${encodeURIComponent(albumName)}&artist=${encodeURIComponent(artistName)}&username=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json`)
          .then(r => r.json()).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!lfmData || lfmData.error) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't find **${albumName}** by **${artistName}** on Last.fm.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const album = lfmData.album;
  const listeners = parseInt(album?.listeners ?? '0').toLocaleString('en-US');
  const playcount = parseInt(album?.playcount ?? '0').toLocaleString('en-US');
  const tags: string[] = (Array.isArray(album?.tags?.tag) ? album.tags.tag : album?.tags?.tag ? [album.tags.tag] : []).slice(0, 3).map((t: any) => t.name);
  const albumUrl: string = album?.url ?? `https://www.last.fm/music/${encodeURIComponent(artistName)}/${encodeURIComponent(albumName)}`;

  // Album art: prefer Last.fm's own image (always correct), fall back to iTunes
  const lfmImage = album?.image?.find((img: any) => img.size === 'extralarge')?.['#text'] || null;
  const LFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';
  const lfmImageValid = lfmImage && !lfmImage.includes(LFM_PLACEHOLDER) ? lfmImage : null;

  let imageUrl: string | null = lfmImageValid;
  if (!imageUrl) {
    const itunesData = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(artistName + ' ' + albumName)}&entity=album&limit=10`
    ).then(r => r.json()).catch(() => null);
    const results: any[] = itunesData?.results ?? [];
    const albumLower = albumName.toLowerCase();
    const match = results.find((r: any) => r.collectionName?.toLowerCase().includes(albumLower)) ?? results[0] ?? null;
    const raw = match?.artworkUrl100 ?? null;
    imageUrl = raw ? (raw as string).replace('100x100bb', '600x600bb') : null;
  }

  // Tracks
  const tracksRaw: any[] = Array.isArray(album?.tracks?.track)
    ? album.tracks.track
    : album?.tracks?.track ? [album.tracks.track] : [];

  const totalTracks = tracksRaw.length;
  const totalDurationSecs = tracksRaw.reduce((sum: number, t: any) => sum + (parseInt(t.duration ?? '0') || 0), 0);
  const totalDurationStr = totalDurationSecs > 0 ? formatDuration(totalDurationSecs) : null;

  // Release date
  const wikiPublished: string | null = album?.wiki?.published ?? null;
  let releaseDate: string | null = null;
  if (wikiPublished) {
    const match = wikiPublished.match(/\b(19|20)\d{2}\b/);
    if (match) releaseDate = match[0];
  }

  // Wiki summary — first 2 sentences, wrapped at ~45 chars
  const rawWiki: string = album?.wiki?.summary ?? '';
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

  // Personal playcount
  const personalPlaycount = personalData?.album?.userplaycount
    ? parseInt(personalData.album.userplaycount).toLocaleString('en-US')
    : null;

  // Track list (max 10)
  let trackListStr: string | null = null;
  if (tracksRaw.length > 0) {
    const displayTracks = tracksRaw.slice(0, 10);
    const lines = displayTracks.map((t: any, i: number) => {
      const dur = parseInt(t.duration ?? '0');
      const durStr = dur > 0 ? ` (${formatDuration(dur)})` : '';
      return `${i + 1}. ${t.name}${durStr}`;
    });
    if (tracksRaw.length > 10) {
      lines.push(`... and ${tracksRaw.length - 10} more tracks`);
    }
    trackListStr = lines.join('\n');
  }

  // Section: max 3 text components — header+subline, stats, meta+genre combined
  const headerLine = `### ${albumName}`;
  const subLine = `by **${artistName}**${releaseDate ? ` • ${releaseDate}` : ''}`;
  const statsLine = `${E.listening} **${listeners}** listeners • ${E.musicLast} **${playcount}** scrobbles`;
  const metaParts = [
    totalTracks > 0 ? `${totalTracks} tracks` : null,
    totalDurationStr ? `${totalDurationStr} total` : null,
    tags.length > 0 ? tags.join(' • ') : null,
  ].filter(Boolean);
  const metaLine = metaParts.length > 0 ? metaParts.join(' • ') : null;

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${headerLine}\n${subLine}`),
      new TextDisplayBuilder().setContent(statsLine),
      ...(metaLine ? [new TextDisplayBuilder().setContent(metaLine)] : []),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(
        imageUrl ?? 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'
      )
    );

  const container = new ContainerBuilder().addSectionComponents(section);

  if (trackListStr) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(trackListStr));
  }

  if (personalPlaycount) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Your plays:** ${personalPlaycount}`)
    );
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
      .setLabel(`${albumName} on Last.fm`)
      .setURL(albumUrl)
      .setStyle(ButtonStyle.Link)
  );
  container.addActionRowComponents(row as any);

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
