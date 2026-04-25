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

export async function executeWkGenres(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  let genreInput = interaction.options.getString("genre") as string | null;

  if (!genreInput) {
    const callerDb = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
    if (!callerDb?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.reject} No genre specified and you haven't linked your Last.fm. Use ${cmdMention('link')} or specify a genre.`));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const np = await fetchNowPlaying(callerDb.lastfmUsername, apiKey);
    if (!np?.topGenre) {
      const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.reject} Couldn't detect a genre from what you're listening to. Please specify one.`));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    genreInput = np.topGenre;
  }

  genreInput = genreInput.toLowerCase();

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

  const memberScores = await Promise.all(
    linkedMembers.map(async m => {
      try {
        const topRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(m.user.lastfmUsername!)}&period=overall&limit=100&api_key=${apiKey}&format=json`).then(r => r.json()) as any;
        const artists: any[] = topRes?.topartists?.artist ?? [];
        const artistInfos = await Promise.all(
          artists.slice(0, 30).map(a =>
            fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(a.name)}&api_key=${apiKey}&format=json`).then(r => r.json()).catch(() => null)
          )
        ) as any[];
        let score = 0;
        for (let i = 0; i < artists.slice(0, 30).length; i++) {
          const tags: string[] = (artistInfos[i]?.artist?.tags?.tag ?? []).map((t: any) => t.name.toLowerCase());
          if (tags.includes(genreInput!)) score += parseInt(artists[i]?.playcount ?? '0');
        }
        return { username: m.user.lastfmUsername!, plays: score };
      } catch {
        return { username: m.user.lastfmUsername!, plays: 0 };
      }
    })
  );

  const allSorted = memberScores.filter(m => m.plays > 0).sort((a, b) => b.plays - a.plays);

  if (allSorted.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.reject} Nobody in this server listens to **${genreInput}**.`));
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const displayGenre = genreInput.charAt(0).toUpperCase() + genreInput.slice(1);
  const totalPages = Math.ceil(allSorted.length / 10);
  const totalListeners = allSorted.length;
  const cacheKey = `genre:${genreInput}`;

  const buffers = await Promise.all(
    Array.from({ length: totalPages }, (_, i) => buildWkCanvas(allSorted, `Who Knows — ${displayGenre}`, 'genre', 'plays', interaction.guild.name, i))
  );
  const urls = await Promise.all(
    buffers.map((buf, i) => uploadToSupabase(buf, 'wk-cache', `${interaction.guildId}_genre_${encodeURIComponent(genreInput!)}_${i}.png`))
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
  else if (callerLfm && callerRank === 0) footerParts.push(`You haven't listened to this genre`);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${E.chart} Who Listens to **${displayGenre}**?`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(urls[0]!)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${pageStr(0, totalPages)} • ${footerParts.join(' • ')}`));

  if (totalPages > 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wk_genre_prev_0_${interaction.guildId}_${encodeURIComponent(genreInput)}`).setEmoji({ id: E.prev.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_prev' }).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`wk_genre_next_0_${interaction.guildId}_${encodeURIComponent(genreInput)}`).setEmoji({ id: E.next.match(/:(\d+)>/)?.[1] ?? '0', name: 'scrobbler_next' }).setStyle(ButtonStyle.Secondary).setDisabled(false),
    );
    container.addActionRowComponents(row as any);
  }

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
