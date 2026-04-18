import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { buildGridCanvas } from "./canvas.js";
import { cmdMention } from "../../utils.js";

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

export const PERIOD_LABELS: Record<string, string> = {
  "7day":    "Last 7 days",
  "1month":  "Last month",
  "3month":  "Last 3 months",
  "6month":  "Last 6 months",
  "12month": "Last year",
  "overall": "All time",
};

export const SIZE_MAP: Record<string, { cols: number; rows: number; count: number }> = {
  "3x3": { cols: 3, rows: 3, count: 9 },
  "4x4": { cols: 4, rows: 4, count: 16 },
  "5x5": { cols: 5, rows: 5, count: 25 },
};

export async function executeTopArtists(interaction: any): Promise<void> {
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
    `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=${count}&api_key=${apiKey}&format=json`
  );
  const topData = (await topRes.json()) as any;

  if (topData.error) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const artists: any[] = topData.topartists?.artist ?? [];

  if (artists.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} No top artists found for **${lfmUsername}** in this period.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const deezerResults = await Promise.all(
    artists.map(a =>
      fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(a.name)}&limit=5`)
        .then(r => r.json()).catch(() => null)
    )
  ) as any[];

  const items = artists.map((a, i) => {
    const results: any[] = deezerResults[i]?.data ?? [];
    const match = results.find((r: any) => r.name.toLowerCase() === a.name.toLowerCase()) ?? results[0] ?? null;
    return {
      name: a.name,
      plays: parseInt(a.playcount),
      imageUrl: match?.picture_xl ?? null,
    };
  });

  const buffer = await buildGridCanvas(items, cols, rows, count);
  const attachment = new AttachmentBuilder(buffer, { name: 'topartists.png' });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E.artists} ${lfmUsername}'s Top Artists — ${periodLabel}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://topartists.png')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Top ${items.length} artists • ${size} • ${periodLabel}`)
    );

  await interaction.editReply({
    files: [attachment],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
