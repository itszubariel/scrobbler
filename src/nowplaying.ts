export interface NowPlayingData {
  trackName: string;
  artistName: string;
  albumName: string | null;
  topGenre: string | null;
}

export async function fetchNowPlaying(lfmUsername: string, apiKey: string): Promise<NowPlayingData | null> {
  try {
    const res = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lfmUsername)}&limit=1&api_key=${apiKey}&format=json`
    );
    const data = (await res.json()) as any;
    const tracks = data?.recenttracks?.track;
    const track = Array.isArray(tracks) ? tracks[0] : tracks;
    if (!track) return null;

    const trackName  = track.name ?? null;
    const artistName = track.artist?.['#text'] ?? null;
    const albumName  = track.album?.['#text'] || null;
    if (!trackName || !artistName) return null;

    let topGenre: string | null = null;
    try {
      const infoRes = await fetch(
        `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&artist=${encodeURIComponent(artistName)}&track=${encodeURIComponent(trackName)}&api_key=${apiKey}&format=json`
      );
      const info = (await infoRes.json()) as any;
      const tags: any[] = info?.track?.toptags?.tag ?? [];
      topGenre = tags[0]?.name ?? null;
    } catch { /* skip */ }

    return { trackName, artistName, albumName, topGenre };
  } catch {
    return null;
  }
}
