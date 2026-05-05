import "dotenv/config";
import pkg from "discord.js";
import { E } from "../../emojis.js";
import { executeTopArtists } from "./chart_artists.js";
import { executeTopTracks } from "./chart_tracks.js";
import { executeTopAlbums } from "./chart_albums.js";
import { executeChartServer } from "./chart_server.js";

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

const sizeChoices = [
  { name: "3x3 (9 items)", value: "3x3" },
  { name: "4x4 (16 items)", value: "4x4" },
  { name: "5x5 (25 items)", value: "5x5" },
];

export const chartCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("chart")
    .setDescription("Grid charts of your top music")
    .addSubcommand((sub) =>
      sub
        .setName("artists")
        .setDescription("Grid chart of your top artists")
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Time period")
            .setRequired(false)
            .addChoices(...periodChoices),
        )
        .addStringOption((option) =>
          option
            .setName("size")
            .setDescription("Grid size — 3x3 (9), 4x4 (16) or 5x5 (25)")
            .setRequired(false)
            .addChoices(...sizeChoices),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Check another user's chart (optional)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("tracks")
        .setDescription("Grid chart of your top tracks")
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Time period")
            .setRequired(false)
            .addChoices(...periodChoices),
        )
        .addStringOption((option) =>
          option
            .setName("size")
            .setDescription("Grid size — 3x3 (9), 4x4 (16) or 5x5 (25)")
            .setRequired(false)
            .addChoices(...sizeChoices),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Check another user's chart (optional)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("albums")
        .setDescription("Grid chart of your top albums")
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Time period")
            .setRequired(false)
            .addChoices(...periodChoices),
        )
        .addStringOption((option) =>
          option
            .setName("size")
            .setDescription("Grid size — 3x3 (9), 4x4 (16) or 5x5 (25)")
            .setRequired(false)
            .addChoices(...sizeChoices),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Check another user's chart (optional)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("server")
        .setDescription(
          "Grid chart of your server's top artists, albums or tracks",
        )
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Artists, albums or tracks")
            .setRequired(true)
            .addChoices(
              { name: "Artists", value: "artists" },
              { name: "Albums", value: "albums" },
              { name: "Tracks", value: "tracks" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Time period")
            .setRequired(false)
            .addChoices(...periodChoices),
        )
        .addStringOption((option) =>
          option
            .setName("size")
            .setDescription("Grid size — 3x3 (9), 4x4 (16) or 5x5 (25)")
            .setRequired(false)
            .addChoices(...sizeChoices),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();

    if (sub === "artists") {
      await executeTopArtists(interaction);
    } else if (sub === "tracks") {
      await executeTopTracks(interaction);
    } else if (sub === "albums") {
      await executeTopAlbums(interaction);
    } else if (sub === "server") {
      await executeChartServer(interaction);
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
