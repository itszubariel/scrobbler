import pkg from "discord.js";
import { E } from "../../emojis.js";
import { timelineArtistsCommand } from "./timeline_artists.js";
import { timelineAlbumsCommand } from "./timeline_albums.js";
import { timelineTracksCommand } from "./timeline_tracks.js";
import { timelineGenresCommand } from "./timeline_genres.js";
import { timelineServerCommand } from "./timeline_server.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
} = pkg;

import type { Command } from "../../index.js";

const MONTHS_OPTION = (sub: any) =>
  sub.addIntegerOption((opt: any) =>
    opt
      .setName("months")
      .setDescription("How many months to look back (default: 6)")
      .setRequired(false)
      .addChoices(
        { name: "3 months", value: 3 },
        { name: "6 months", value: 6 },
        { name: "12 months", value: 12 },
      ),
  );

const USER_OPTION = (sub: any) =>
  sub.addUserOption((opt: any) =>
    opt
      .setName("user")
      .setDescription("Check another user's timeline (optional)")
      .setRequired(false),
  );

export const timelineCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("timeline")
    .setDescription("Visualize your listening evolution over time.")
    .addSubcommand((sub) =>
      MONTHS_OPTION(USER_OPTION(sub.setName("artists").setDescription("Unique artists per month"))),
    )
    .addSubcommand((sub) =>
      MONTHS_OPTION(USER_OPTION(sub.setName("albums").setDescription("Unique albums per month"))),
    )
    .addSubcommand((sub) =>
      MONTHS_OPTION(USER_OPTION(sub.setName("tracks").setDescription("Scrobbles per month"))),
    )
    .addSubcommand((sub) =>
      MONTHS_OPTION(USER_OPTION(sub.setName("genres").setDescription("Top genre trends per month"))),
    )
    .addSubcommand((sub) =>
      MONTHS_OPTION(sub.setName("server").setDescription("Server-wide scrobbles per month")),
    ),

  execute: async (interaction) => {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case "artists": await timelineArtistsCommand.execute(interaction); break;
      case "albums":  await timelineAlbumsCommand.execute(interaction);  break;
      case "tracks":  await timelineTracksCommand.execute(interaction);  break;
      case "genres":  await timelineGenresCommand.execute(interaction);  break;
      case "server":  await timelineServerCommand.execute(interaction);  break;
      default: {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`${E.reject} Unknown subcommand.`),
        );
        await interaction.editReply({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    }
  },
};
