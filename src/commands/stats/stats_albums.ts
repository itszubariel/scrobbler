import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { cmdMention, pageStr } from "../../utils.js";
import { buildLeaderboardCanvas } from "./canvas.js";
import { uploadToSupabase } from "../../uploadToSupabase.js";

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = pkg;

const PAGE_SIZE = 10;
const TTL_MS = 10 * 60 * 1000;

export async function executeStatsAlbums(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;

  if (!interaction.guildId || !interaction.guild) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} This command only works in servers.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const server = await prisma.server.findUnique({
    where: { guildId: interaction.guildId },
    include: { members: { include: { user: true } } },
  });

  if (!server) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} This server isn't set up yet.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const linkedMembers = server.members.filter((m) => m.user.lastfmUsername);
  if (linkedMembers.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} No members have linked their Last.fm yet. Use ${cmdMention("link")} to get started.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const albumResults = (await Promise.all(
    linkedMembers.map((m) =>
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(m.user.lastfmUsername!)}&limit=1000&period=overall&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ),
  )) as any[];

  const allMembers = linkedMembers
    .map((m, i) => {
      const raw = (albumResults[i]?.topalbums?.album ?? []).length as number;
      return {
        username: m.user.lastfmUsername!,
        count: raw,
        displayCount: raw >= 1000 ? "1,000+" : raw.toLocaleString("en-US"),
      };
    })
    .sort((a, b) => b.count - a.count);

  const hasCapHit = allMembers.some((m) => m.count >= 1000);
  const totalAlbums = hasCapHit
    ? allMembers.reduce((s, m) => s + m.count, 0).toLocaleString("en-US") + "+"
    : allMembers.reduce((s, m) => s + m.count, 0).toLocaleString("en-US");

  const callerDb = await prisma.user.findUnique({
    where: { discordId: interaction.user.id },
  });
  const callerLfm = callerDb?.lastfmUsername;
  const callerRank = callerLfm
    ? allMembers.findIndex((m) => m.username === callerLfm) + 1
    : 0;
  const callerEntry = callerLfm
    ? allMembers.find((m) => m.username === callerLfm)
    : null;

  const totalPages = Math.ceil(allMembers.length / PAGE_SIZE);
  const memberCount = allMembers.length;

  const buffers = await Promise.all(
    Array.from({ length: totalPages }, (_, i) =>
      buildLeaderboardCanvas(
        allMembers,
        interaction.guild.name,
        "albums",
        `Total unique albums: ${totalAlbums}`,
        i,
      ),
    ),
  );
  const urls = await Promise.all(
    buffers.map((buf, i) =>
      uploadToSupabase(
        buf,
        "stats-cache",
        `albums_${interaction.guildId}_${i}.png`,
      ),
    ),
  );

  await (prisma as any).statsAlbumsCache.upsert({
    where: { guildId: interaction.guildId },
    create: {
      guildId: interaction.guildId,
      urls,
      totalPages,
      memberCount,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
    update: {
      urls,
      totalPages,
      memberCount,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });

  const footerParts = [`${memberCount} members • Unique albums overall`];
  if (callerRank > PAGE_SIZE && callerEntry)
    footerParts.push(
      `You are ranked **#${callerRank}** with **${callerEntry.displayCount}** albums`,
    );

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E.albums} Server Album Leaderboard — All time`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(urls[0]!),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${pageStr(0, totalPages)} • ${footerParts.join(" • ")}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(false)
        .setSpacing(SeparatorSpacingSize.Small),
    );

  if (totalPages > 1) {
    const authorId = interaction.user.id;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stats_albums_prev_0_${authorId}`)
        .setEmoji({
          id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
          name: "scrobbler_prev",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`stats_albums_next_0_${authorId}`)
        .setEmoji({
          id: E.next.match(/:(\d+)>/)?.[1] ?? "0",
          name: "scrobbler_next",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false),
    );
    container.addActionRowComponents(row as any);
  }

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
