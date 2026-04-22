import { prisma } from "../../db.js";

const apiKey = () => process.env.LASTFM_API_KEY!;

async function fetchWithTimeout(url: string, ms = 2000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleWkAutocomplete(interaction: any): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const focused = interaction.options.getFocused(true);

  const dbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const lfm = dbUser?.lastfmUsername ?? null;
  const focusedValue = (focused.value ?? '').trim();

  try {
    if (sub === "artist" && focused.name === "artist") {
      if (!focusedValue) {
        if (!lfm) { await interaction.respond([]); return; }
        const res = await fetchWithTimeout(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfm)}&limit=20&period=overall&api_key=${apiKey()}&format=json`
        );
        const artists = res?.topartists?.artist ?? [];
        await interaction.respond(artists.slice(0, 20).map((a: any) => ({ name: a.name, value: a.name })));
      } else {
        const res = await fetchWithTimeout(
          `https://ws.audioscrobbler.com/2.0/?method=artist.search&artist=${encodeURIComponent(focusedValue)}&limit=25&api_key=${apiKey()}&format=json`
        );
        const artists = res?.results?.artistmatches?.artist ?? [];
        await interaction.respond(artists.slice(0, 25).map((a: any) => ({ name: a.name, value: a.name })));
      }
      return;
    }

    if (sub === "album" && focused.name === "album") {
      if (!focusedValue) {
        if (!lfm) { await interaction.respond([]); return; }
        const res = await fetchWithTimeout(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(lfm)}&limit=20&period=overall&api_key=${apiKey()}&format=json`
        );
        const albums = res?.topalbums?.album ?? [];
        await interaction.respond(
          albums.slice(0, 20).map((a: any) => ({
            name: `${a.name} — ${a.artist?.name ?? 'Unknown'}`,
            value: `${a.name}|||${a.artist?.name ?? ''}`,
          }))
        );
      } else {
        const res = await fetchWithTimeout(
          `https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(focusedValue)}&limit=25&api_key=${apiKey()}&format=json`
        );
        const albums = res?.results?.albummatches?.album ?? [];
        await interaction.respond(
          albums.slice(0, 25).map((a: any) => ({
            name: `${a.name} — ${a.artist ?? 'Unknown'}`,
            value: `${a.name}|||${a.artist ?? ''}`,
          }))
        );
      }
      return;
    }

    if (sub === "track" && focused.name === "track") {
      if (!focusedValue) {
        if (!lfm) { await interaction.respond([]); return; }
        const res = await fetchWithTimeout(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(lfm)}&limit=20&period=overall&api_key=${apiKey()}&format=json`
        );
        const tracks = res?.toptracks?.track ?? [];
        await interaction.respond(
          tracks.slice(0, 20).map((t: any) => ({
            name: `${t.name} — ${t.artist?.name ?? 'Unknown'}`,
            value: `${t.name}|||${t.artist?.name ?? ''}`,
          }))
        );
      } else {
        const res = await fetchWithTimeout(
          `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(focusedValue)}&limit=25&api_key=${apiKey()}&format=json`
        );
        const tracks = res?.results?.trackmatches?.track ?? [];
        await interaction.respond(
          tracks.slice(0, 25).map((t: any) => ({
            name: `${t.name} — ${t.artist ?? 'Unknown'}`,
            value: `${t.name}|||${t.artist ?? ''}`,
          }))
        );
      }
      return;
    }

    if (sub === "genre" && focused.name === "genre") {
      if (!focusedValue) {
        if (!lfm) { await interaction.respond([]); return; }
        const topArtistsRes = await fetchWithTimeout(
          `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfm)}&limit=10&period=overall&api_key=${apiKey()}&format=json`
        );
        const artists: any[] = topArtistsRes?.topartists?.artist ?? [];
        const tagScores: Record<string, number> = {};
        await Promise.all(
          artists.slice(0, 10).map(async (a: any) => {
            try {
              const infoRes = await fetchWithTimeout(
                `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey()}&format=json`
              );
              const tags: any[] = infoRes?.artist?.tags?.tag ?? [];
              const playcount = parseInt(a.playcount ?? '0');
              for (const tag of tags.slice(0, 5)) {
                const tagName = tag.name.toLowerCase();
                tagScores[tagName] = (tagScores[tagName] ?? 0) + playcount;
              }
            } catch { /* skip */ }
          })
        );
        const sorted = Object.entries(tagScores)
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name)
          .slice(0, 20);
        await interaction.respond(sorted.map(name => ({ name, value: name })));
      } else {
        const res = await fetchWithTimeout(
          `https://ws.audioscrobbler.com/2.0/?method=tag.search&tag=${encodeURIComponent(focusedValue)}&limit=25&api_key=${apiKey()}&format=json`
        );
        const tags: any[] = res?.results?.tagmatches?.tag ?? [];
        await interaction.respond(tags.slice(0, 25).map((t: any) => ({ name: t.name, value: t.name })));
      }
      return;
    }

    await interaction.respond([]);
  } catch {
    try { await interaction.respond([]); } catch { /* interaction already expired */ }
  }
}
