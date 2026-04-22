import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { buildGridCanvas } from "./canvas.js";

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
} = pkg;


import { PERIOD_LABELS, SIZE_MAP } from "./chart_artists.js";
import { cmdMention } from "../../utils.js";

export async function executeTopAlbums(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const targetDiscordUser = interaction.options.getUser("user") ?? interaction.user;
  const isOwnProfile = targetDiscordUser.id === interaction.user.id;
  const period = interaction.options.getString("period") ?? "overall";
  const periodLabel = PERIOD_LABELS[period] ?? "All time";
  const size = interaction.options.getString("size") ?? "3x3";
  const { cols, rows, count } = SIZE_MAP[size] ?? SIZE_MAP["3x3"]!;

  const dbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordUser.id } });

  if (!dbUser?.lastfmUsername) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isOwnProfile
          ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention('link')} to get started.`
          : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`
      )
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lfmUsername = dbUser.lastfmUsername;

  const topRes = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=${count}&api_key=${apiKey}&format=json`
  );
  const topData = (await topRes.json()) as any;

  if (topData.error) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const albums: any[] = topData.topalbums?.album ?? [];

  if (albums.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} No top albums found for **${lfmUsername}** in this period.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // iTunes for album art — better K-pop coverage than Last.fm embedded images
  const imageResults = await Promise.all(
    albums.map(a => {
      const lfmImage = a.image?.find((img: any) => img.size === 'extralarge')?.['#text'] || null;
      const LFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';
      if (lfmImage && !lfmImage.includes(LFM_PLACEHOLDER)) return Promise.resolve({ _lfm: lfmImage });
      return fetch(`https://itunes.apple.com/search?term=${encodeURIComponent((a.artist?.name ?? '') + ' ' + a.name)}&entity=album&limit=1`)
        .then(r => r.json()).catch(() => null);
    })
  );

  const items = albums.map((a, i) => {
    const result = imageResults[i] as any;
    let imageUrl: string | null = null;
    if (result?._lfm) {
      imageUrl = result._lfm;
    } else {
      const raw = result?.results?.[0]?.artworkUrl100 ?? null;
      imageUrl = raw ? (raw as string).replace('100x100bb', '600x600bb') : null;
    }
    return {
      name: a.name,
      artist: a.artist?.name ?? 'Unknown',
      plays: parseInt(a.playcount),
      imageUrl,
    };
  });

  const buffer = await buildGridCanvas(items, cols, rows, count);
  const attachment = new AttachmentBuilder(buffer, { name: 'topalbums.png' });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.albums} ${lfmUsername}'s Top Albums — ${periodLabel}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://topalbums.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Top ${items.length} albums • ${size} • ${periodLabel}`)
    );

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
