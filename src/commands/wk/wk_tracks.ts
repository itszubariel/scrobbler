import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { buildWkCanvas } from "./canvas.js";
import { fetchNowPlaying } from "../../nowplaying.js";
import { cmdMention, pageStr } from "../../utils.js";
import { uploadToSupabase } from "../../uploadToSupabase.js";

const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = pkg;

const TTL_MS = 10 * 60 * 1000;

export async function executeWkTracks(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const rawTrack = interaction.options.getString("track") as string | null;

  let trackInput: string | null = null;
  let artistInput: string | null = null;
  if (rawTrack?.includes('|||')) {
    const [a, b] = rawTrack.split('|||');
    trackInput = a ?? null;
    artistInput = b ?? null;
  } else {
    trackInput = rawTrack;
  }

  if (!trackInput || !artistInput) {
    const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
    if (!callerDb?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.reject} No track specified and you haven't linked your Last.fm. Use ${cmdMention('link')} or specify a track.`));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const np = await fetchNowPlaying(callerDb.lastfmUsername, apiKey);
    if (!np) {
      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.reject} Couldn't detect what you're listening to. Please specify a track.`));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    trackInput = trackInput ?? np.trackName;
    artistInput = artistInput ?? np.artistName;
  }

  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.reject} This command only works in servers.`));
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const server = await prisma.server.findUnique({ where: { guildId: interaction.guildId }, include: { members: { include: { user: true } } } });
  const linkedMembers = server?.members.filter(m => m.user.lastfmUsername) ?? [];

  if (linkedMembers.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.reject} No members have linked their Last.fm yet. Use ${cmdMention('link')} to get started.`));
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const results = await Promise.all(
    linkedMembers.map(m =>
      fetch(`https://ws.audioscrobbler.com/2.0/?method=track.getInfo&artist=${encodeURIComponent(artistInput!)}&track=${encodeURIComponent(trackInput!)}&username=${encodeURIComponent(m.user.lastfmUsername!)}&api_key=${apiKey}&format=json`)
        .then(r => r.json()).catch(() => null)
    )
  ) as any[];

  const allSorted = linkedMembers
    .map((m, i) => ({ username: m.user.lastfmUsername!, plays: parseInt(results[i]?.track?.userplaycount ?? '0') }))
    .filter(m => m.plays > 0)
    .sort((a, b) => b.plays - a.plays);

  if (allSorted.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.reject} Nobody in this server has listened to **${trackInput}** by **${artistInput}**.`));
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const canonicalTrack = results.find(r => r?.track?.name)?.track?.name ?? trackInput;
  const canonicalArtist = results.find(r => r?.track?.artist?.name)?.track?.artist?.name ?? artistInput;
  const totalPages = Math.ceil(allSorted.length / 10);
  const totalListeners = allSorted.length;
  const cacheKey = `track:${canonicalTrack}|||${canonicalArtist}`;

  const buffers = await Promise.all(
    Array.from({ length: totalPages }, (_, i) => buildWkCanvas(allSorted, `Who Knows — ${canonicalTrack}`, `track by ${canonicalArtist}`, 'plays', interaction.guild.name, i))
  );
  const urls = await Promise.all(
    buffers.map((buf, i) => uploadToSupabase(buf, 'wk-cache', `${interaction.guildId}_track_${encodeURIComponent(canonicalTrack)}_${i}.png`))
  );

  await (prisma as any).wkCache.upsert({
    where: { guildId_key: { guildId: interaction.guildId, key: cacheKey } },
    create: { guildId: interaction.guildId, key: cacheKey, urls, totalPages, totalListeners, expiresAt: new Date(Date.now() + TTL_MS) },
    update: { urls, totalPages, totalListeners, expiresAt: new Date(Date.now() + TTL_MS) },
  });

  const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const callerLfm = callerDb?.lastfmUsername;
  const callerRank = callerLfm ? allSorted.findIndex(m => m.username === callerLfm) + 1 : 0;
  const callerEntry = callerLfm ? allSorted.find(m => m.username === callerLfm) : null;

  const footerParts = [`${totalListeners} listener${totalListeners === 1 ? '' : 's'} in this server`];
  if (callerRank > 10 && callerEntry) footerParts.push(`You are ranked **#${callerRank}** with **${callerEntry.plays.toLocaleString()}** plays`);
  else if (callerLfm && callerRank === 0) footerParts.push(`You haven't listened to this track`);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${E.tracks} Who Knows **${canonicalTrack}**?`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(urls[0]!)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${pageStr(0, totalPages)} • ${footerParts.join(' • ')}`));

  if (totalPages > 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wk_track_prev_0_${interaction.guildId}_${encodeURIComponent(canonicalTrack)}|||${encodeURIComponent(canonicalArtist)}`).setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' }).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`wk_track_next_0_${interaction.guildId}_${encodeURIComponent(canonicalTrack)}|||${encodeURIComponent(canonicalArtist)}`).setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' }).setStyle(ButtonStyle.Secondary).setDisabled(false),
    );
    container.addActionRowComponents(row as any);
  }

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
