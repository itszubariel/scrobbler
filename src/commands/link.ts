import "dotenv/config";
import pkg from "discord.js";
import { createHash } from "crypto";
import { E } from "../emojis.js";
import { prisma } from "../db.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = pkg;



import type { Command } from "../index.ts";

const POLL_INTERVAL_MS = 3000;   // 3 seconds
const POLL_MAX_ATTEMPTS = 40;    // 40 × 3s = 2 minutes

async function tryGetSession(apiKey: string, secret: string, token: string): Promise<{ sessionKey: string; lfmUsername: string } | null> {
  const sigString = `api_key${apiKey}methodauth.getSessiontoken${token}${secret}`;
  const sig = createHash('md5').update(sigString).digest('hex');

  const res = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=${apiKey}&token=${encodeURIComponent(token)}&api_sig=${sig}&format=json`
  );
  const data = (await res.json()) as any;

  if (data.error || !data.session?.key) return null;
  return { sessionKey: data.session.key, lfmUsername: data.session.name };
}

async function sendDiscordDM(discordId: string, lfmUsername: string): Promise<void> {
  const botToken = process.env.DISCORD_TOKEN!;
  const headers = {
    'Authorization': `Bot ${botToken}`,
    'Content-Type': 'application/json',
  };

  const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers,
    body: JSON.stringify({ recipient_id: discordId }),
  }).catch(() => null);

  if (!dmRes?.ok) return;
  const dmChannel = (await dmRes.json()) as any;
  if (!dmChannel.id) return;

  await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      flags: 1 << 15,
      components: [{
        type: 17,
        components: [{
          type: 10,
          content: `${E.accept} **Successfully linked!** Your Last.fm account **${lfmUsername}** is now connected to scrobbler.`,
        }],
      }],
    }),
  }).catch(() => null);
}

async function pollForSession(
  interaction: any,
  apiKey: string,
  secret: string,
  token: string,
  discordId: string
): Promise<void> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const result = await tryGetSession(apiKey, secret, token);

      if (result) {
        const { sessionKey, lfmUsername } = result;

        // Update user
        await prisma.user.update({
          where: { discordId },
          data: { lastfmUsername: lfmUsername, sessionKey },
        });

        // Clean up pending link
        await prisma.pendingLink.deleteMany({ where: { discordId } }).catch(() => null);

        // Edit the interaction message
        const successContainer = new ContainerBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${E.accept} **Successfully linked!**`),
            new TextDisplayBuilder().setContent(`Your Last.fm account **${lfmUsername}** is now connected to scrobbler.`),
          );

        await interaction.editReply({
          components: [successContainer],
          flags: MessageFlags.IsComponentsV2,
        }).catch(() => null);

        // Send DM
        await sendDiscordDM(discordId, lfmUsername);
        return;
      }
    } catch (err) {
      console.error(`[link] Poll attempt ${attempt + 1} error:`, err);
    }
  }

  // Timeout — 2 minutes elapsed with no success
  await prisma.pendingLink.deleteMany({ where: { discordId } }).catch(() => null);

  const timeoutContainer = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} **Link timed out.**`),
      new TextDisplayBuilder().setContent("You didn't authorize within 2 minutes. Run </link:1493336821818720409> again to try."),
    );

  await interaction.editReply({
    components: [timeoutContainer],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => null);
}

export const linkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Connect your Last.fm account"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const apiKey  = process.env.LASTFM_API_KEY!;
    const secret  = process.env.LASTFM_SHARED_SECRET!;
    const discordId       = interaction.user.id;
    const discordUsername = interaction.user.username;

    // Ensure user record exists
    await prisma.user.upsert({
      where:  { discordId },
      update: {},
      create: { discordId, username: discordUsername },
    });

    // Register server membership if in a guild
    const guildId = interaction.guildId;
    if (guildId) {
      const guildName = interaction.guild?.name ?? "Unknown Server";
      const server = await prisma.server.upsert({
        where:  { guildId },
        update: {},
        create: { guildId, name: guildName },
      });
      const user = await prisma.user.findUnique({ where: { discordId } });
      if (user) {
        await prisma.serverMember.upsert({
          where:  { userId_serverId: { userId: user.id, serverId: server.id } },
          update: {},
          create: { userId: user.id, serverId: server.id },
        });
      }
    }

    // Get Last.fm auth token
    const sigString = `api_key${apiKey}methodauth.getToken${secret}`;
    const sig = createHash('md5').update(sigString).digest('hex');

    const tokenRes = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=auth.getToken&api_key=${apiKey}&api_sig=${sig}&format=json`
    );
    const tokenData = (await tokenRes.json()) as any;

    if (tokenData.error || !tokenData.token) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${E.reject} Couldn't generate a Last.fm auth token. Please try again in a moment.`
        )
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const token = tokenData.token as string;

    // Store token
    await prisma.pendingLink.upsert({
      where:  { discordId },
      update: { token, interactionToken: interaction.token },
      create: { discordId, token, interactionToken: interaction.token },
    });

    const authUrl = `https://www.last.fm/api/auth/?api_key=${apiKey}&token=${token}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Login with Last.fm")
        .setURL(authUrl)
        .setStyle(ButtonStyle.Link)
    );

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.lastfm} **Link your Last.fm account to scrobbler**`),
        new TextDisplayBuilder().setContent(
          "Click the button below to authorize with Last.fm.\nThe bot will detect when you've approved — this expires in **2 minutes**."
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(row as any);

    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });

    // Start polling in background — don't await so the command returns immediately
    pollForSession(interaction, apiKey, secret, token, discordId).catch(err => {
      console.error('[link] Polling error:', err);
    });
  },
};
