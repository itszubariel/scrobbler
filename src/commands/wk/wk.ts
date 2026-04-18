import "dotenv/config";
import pkg from "discord.js";
import { E } from "../../emojis.js";
import { executeWkArtists } from "./wk_artists.js";
import { executeWkAlbums } from "./wk_albums.js";
import { executeWkTracks } from "./wk_tracks.js";
import { executeWkGenres } from "./wk_genres.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
} = pkg;

import type { Command } from "../../index.js";

export const wkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("wk")
    .setDescription("See who in this server knows a specific artist, album, track or genre")
    .addSubcommand(sub =>
      sub
        .setName("artist")
        .setDescription("Who has listened to this artist the most")
        .addStringOption(option =>
          option.setName("artist").setDescription("Artist name (defaults to now playing)").setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("album")
        .setDescription("Who has listened to this album the most")
        .addStringOption(option =>
          option.setName("album").setDescription("Album name (defaults to now playing)").setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("track")
        .setDescription("Who has listened to this track the most")
        .addStringOption(option =>
          option.setName("track").setDescription("Track name (defaults to now playing)").setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("genre")
        .setDescription("Who listens to this genre the most")
        .addStringOption(option =>
          option.setName("genre").setDescription("Genre name (defaults to your top genre now playing)").setRequired(false).setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();

    if (sub === "artist") {
      await executeWkArtists(interaction);
    } else if (sub === "album") {
      await executeWkAlbums(interaction);
    } else if (sub === "track") {
      await executeWkTracks(interaction);
    } else if (sub === "genre") {
      await executeWkGenres(interaction);
    } else {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Unknown subcommand.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
  },
};
