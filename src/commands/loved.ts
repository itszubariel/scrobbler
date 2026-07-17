import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../db.js";
import { E } from "../emojis.js";
import { pageStr } from "../utils.js";
import { getCache, setCache } from "../cache.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = pkg;

import type { Command } from "../index.ts";
import { cmdMention } from "../utils.js";

const PAGE_SIZE = 10;

interface CachedLoved {
  tracks: Array<{
    name: string;
    artist: string;
    url: string | null;
    lovedAt: string;
  }>;
  totalPages: number;
  totalTracks: number;
}

export async function fetchLovedTracks(
  lfmUsername: string,
  apiKey: string,
  page: number = 1,
) {
  const cacheKey = `loved_${lfmUsername}_${page}`;
  const cached = await getCache<any>(cacheKey);
  if (cached) return cached;

  const res = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.getlovedtracks&user=${encodeURIComponent(lfmUsername)}&api_key=${apiKey}&format=json&limit=${PAGE_SIZE}&page=${page}`,
  );
  const data = (await res.json()) as any;
  if (data.error || !data.lovedtracks) return null;
  
  await setCache(cacheKey, data.lovedtracks, 5); // 5 minute TTL
  return data.lovedtracks;
}

export function buildLovedContainer(
  lovedData: any,
  lfmUsername: string,
  targetDiscordId: string,
  page: number,
) {
  const rawTracks = Array.isArray(lovedData.track)
    ? lovedData.track
    : [lovedData.track].filter(Boolean);
  const totalPages = Math.min(parseInt(lovedData["@attr"]?.totalPages ?? "1"), 10);
  const totalTracks = parseInt(lovedData["@attr"]?.total ?? "0");

  const lines = rawTracks.map((t: any) => {
    const name = t.name ?? "Unknown Track";
    const artist = t.artist?.name ?? "Unknown Artist";
    const url = t.url ?? null;
    const timestamp = t.date?.uts ? `<t:${t.date.uts}:R>` : "?";
    const trackText = url ? `[**${name}**](${url})` : `**${name}**`;
    return `${timestamp} • ${trackText} by **${artist}**`;
  });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${lfmUsername}'s Loved Tracks`),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${totalTracks} total loved tracks • Page ${page} of ${totalPages}`,
      ),
    );

  if (totalPages > 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`loved_prev_${page}_${targetDiscordId}`)
        .setEmoji({
          id: E.prev.match(/:(\d+)>/)?.[1] ?? "0",
          name: "rewind_prev",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`loved_next_${page}_${targetDiscordId}`)
        .setEmoji({
          id: E.next.match(/:(\d+)>/)?.[1] ?? "0",
          name: "rewind_next",
        })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages),
    );
    container.addActionRowComponents(row as any);
  }

  return container;
}

export const lovedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("loved")
    .setDescription("View your loved tracks")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Check another user's loved tracks (optional)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const apiKey = process.env.LASTFM_API_KEY!;
    const targetDiscordUser =
      interaction.options.getUser("user") ?? interaction.user;
    const isOwnProfile = targetDiscordUser.id === interaction.user.id;

    const dbUser = await prisma.user.findUnique({
      where: { discordId: targetDiscordUser.id },
    });

    if (!dbUser?.lastfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          isOwnProfile
            ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention("link")} to get started.`
            : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const lfmUsername = dbUser.lastfmUsername;
    const lovedData = await fetchLovedTracks(lfmUsername, apiKey, 1);

    if (!lovedData) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Couldn't fetch loved tracks for **${lfmUsername}**.`,
        ),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const container = buildLovedContainer(
      lovedData,
      lfmUsername,
      targetDiscordUser.id,
      1,
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
