import "dotenv/config";
import pkg from "discord.js";
import { E } from "../emojis.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = pkg;

import type { Command } from "../index.ts";

const CMD_IDS: Record<string, string> = {
  link:    '1493336821818720409',
  unlink:  '1493604715609722931',
  profile: '1493486609029664951',
  np:      '1493341791905382561',
  recent:  '1493508576617173042',
  chart:   '1493526789400559677',
  taste:   '1493491841105006715',
  compat:  '1493490117971808320',
  stats:   '1493515916099584100',
  help:    '1493604970153644052',
};

function cmd(name: string): string {
  const id = CMD_IDS[name.split(' ')[0] ?? name];
  return id ? `</${name}:${id}>` : `**/${name}**`;
}

const sections = [
  {
    heading: "Account",
    commands: [
      { name: "link",    desc: "Connect your Last.fm account" },
      { name: "unlink",  desc: "Disconnect your Last.fm account" },
      { name: "profile", desc: "Your music profile with an AI-generated bio" },
    ],
  },
  {
    heading: "Now Playing",
    commands: [
      { name: "np",     desc: "See what you're scrobbling right now" },
      { name: "recent", desc: "Your recently scrobbled tracks" },
    ],
  },
  {
    heading: "Charts",
    commands: [
      { name: "chart artists", desc: "Grid chart of your top artists" },
      { name: "chart albums",  desc: "Grid chart of your top albums" },
      { name: "chart tracks",  desc: "Grid chart of your top tracks" },
      { name: "chart server",  desc: "Grid chart of your server's top artists, albums or tracks" },
    ],
  },
  {
    heading: "Insights",
    commands: [
      { name: "taste",  desc: "A breakdown of your top genres" },
      { name: "compat", desc: "See how your taste compares to another user" },
    ],
  },
  {
    heading: "Server",
    commands: [
      { name: "stats scrobbles", desc: "Who has scrobbled the most in this server" },
      { name: "stats artists",   desc: "Who has listened to the most unique artists" },
      { name: "stats albums",    desc: "Who has listened to the most unique albums" },
      { name: "stats genres",    desc: "Who has the most diverse taste" },
    ],
  },
];

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("See all scrobbler commands and what they do"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${E.commands} scrobbler Commands`),
      );

    for (const section of sections) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      );

      const lines = section.commands.map(c => cmd(c.name)).join(', ');
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${section.heading}**\n${lines}`)
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Made with ${E.heart} by Zubariel`)
    );

    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};
