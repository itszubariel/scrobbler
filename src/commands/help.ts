import "dotenv/config";
import pkg from "discord.js";
import { E } from "../emojis.js";
import { commandIds } from "../index.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = pkg;

import type { Command } from "../index.ts";

function cmd(name: string): string {
  const baseName = name.split(" ")[0] ?? name;
  const id = commandIds.get(baseName);
  return id ? `</${name}:${id}>` : `**/${name}**`;
}

const sections = [
  {
    heading: "Account",
    commands: [
      { name: "link", desc: "Connect your Last.fm account" },
      { name: "unlink", desc: "Disconnect your Last.fm account" },
      { name: "profile", desc: "Your music profile with an AI-generated bio" },
    ],
  },
  {
    heading: "Now Playing",
    commands: [
      { name: "np", desc: "See what you're scrobbling right now" },
      { name: "recent", desc: "Your recently scrobbled tracks" },
      { name: "loved", desc: "View your loved tracks" },
    ],
  },
  {
    heading: "Charts",
    commands: [
      { name: "chart artists", desc: "Grid chart of your top artists" },
      { name: "chart albums", desc: "Grid chart of your top albums" },
      { name: "chart tracks", desc: "Grid chart of your top tracks" },
      {
        name: "chart server",
        desc: "Server-wide top artists, albums or tracks",
      },
    ],
  },
  {
    heading: "Timelines",
    commands: [
      {
        name: "timeline artists",
        desc: "Line chart of unique artists discovered over time",
      },
      {
        name: "timeline albums",
        desc: "Line chart of unique albums listened to over time",
      },
      {
        name: "timeline tracks",
        desc: "Line chart of total scrobbles over time",
      },
      { name: "timeline genres", desc: "Your top genre trends over time" },
      { name: "timeline server", desc: "Server-wide combined scrobble trend" },
    ],
  },

  {
    heading: "Info",
    commands: [
      { name: "info artist", desc: "Detailed info about an artist" },
      { name: "info album", desc: "Detailed info about an album" },
      { name: "info track", desc: "Detailed info about a track" },
      { name: "info genre", desc: "Detailed info about a genre" },
    ],
  },
  {
    heading: "Insights",
    commands: [
      { name: "taste user", desc: "Your top 50 genres" },
      { name: "taste server", desc: "This server's top genres" },
      { name: "compat", desc: "See how your taste compares to another user" },
      {
        name: "discovery",
        desc: "See how underground or mainstream your taste is",
      },
      { name: "personality", desc: "Discover your music personality type" },
      {
        name: "streak",
        desc: "Your top artist, track and album streaks over 90 days",
      },
      {
        name: "wrapped",
        desc: "Your personalized music recap with stats, charts and more",
      },
      { name: "era", desc: "What's your current music era?" },
      {
        name: "milestone",
        desc: "Your listening milestones and progress to the next one",
      },
      { name: "bingo", desc: "Your music taste bingo card" },
    ],
  },
  {
    heading: "Recommendations",
    commands: [
      {
        name: "rec artists",
        desc: "Get artist recommendations based on your taste",
      },
      {
        name: "rec tracks",
        desc: "Get track recommendations based on your taste",
      },
      {
        name: "rec albums",
        desc: "Get album recommendations based on your taste",
      },
    ],
  },
  {
    heading: "Who Knows",
    commands: [
      { name: "wk artist", desc: "Who has listened to this artist the most" },
      { name: "wk album", desc: "Who has listened to this album the most" },
      { name: "wk track", desc: "Who has listened to this track the most" },
      { name: "wk genre", desc: "Who listens to this genre the most" },
    ],
  },
  {
    heading: "Server",
    commands: [
      {
        name: "stats scrobbles",
        desc: "Who has scrobbled the most in this server",
      },
      {
        name: "stats artists",
        desc: "Who has listened to the most unique artists",
      },
      {
        name: "stats albums",
        desc: "Who has listened to the most unique albums",
      },
      { name: "stats genres", desc: "Who has the most diverse taste" },
      {
        name: "overlap",
        desc: "Find music shared between you and up to 9 others",
      },
    ],
  },
];

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("See all scrobbler commands and what they do"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${E.commands} scrobbler Commands`,
      ),
    );

    for (const section of sections) {
      container.addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      );

      const lines = section.commands.map((c) => cmd(c.name)).join(", ");
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${section.heading}**\n${lines}`),
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Made with ${E.heart} by Zubariel • 41 commands`,
      ),
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
