import "dotenv/config";
import pkg from "discord.js";
import { E } from "../../emojis.js";
import { executeRecArtists } from "./rec_artists.js";
import { executeRecTracks } from "./rec_tracks.js";
import { executeRecAlbums } from "./rec_albums.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
} = pkg;

import type { Command } from "../../index.js";

const periodChoices = [
  { name: "Last 7 days", value: "7day" },
  { name: "Last month", value: "1month" },
  { name: "Last 3 months", value: "3month" },
  { name: "Last 6 months", value: "6month" },
  { name: "Last year", value: "12month" },
  { name: "All time", value: "overall" },
];

export const recCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("rec")
    .setDescription("Get personalized music recommendations")
    .addSubcommand((sub) =>
      sub
        .setName("artists")
        .setDescription("Get artist recommendations based on your taste")
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Time period")
            .setRequired(false)
            .addChoices(...periodChoices),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Get recommendations for another user (optional)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("tracks")
        .setDescription("Get track recommendations based on your taste")
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Time period")
            .setRequired(false)
            .addChoices(...periodChoices),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Get recommendations for another user (optional)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("albums")
        .setDescription("Get album recommendations based on your taste")
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Time period")
            .setRequired(false)
            .addChoices(...periodChoices),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Get recommendations for another user (optional)")
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();

    if (sub === "artists") {
      await executeRecArtists(interaction);
    } else if (sub === "tracks") {
      await executeRecTracks(interaction);
    } else if (sub === "albums") {
      await executeRecAlbums(interaction);
    } else {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Unknown subcommand.`),
      );
      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    }
  },
};
