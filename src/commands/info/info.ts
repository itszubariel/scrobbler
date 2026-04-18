import "dotenv/config";
import pkg from "discord.js";
import { E } from "../../emojis.js";
import { executeArtistInfo } from "./info_artist.js";
import { executeAlbumInfo } from "./info_album.js";
import { executeTrackInfo } from "./info_track.js";
import { executeGenreInfo } from "./info_genre.js";

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
} = pkg;

import type { Command } from "../../index.js";

export const infoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Get detailed info about an artist, album, track or genre")
    .addSubcommand(sub =>
      sub
        .setName("artist")
        .setDescription("Get info about an artist")
        .addStringOption(option =>
          option.setName("artist").setDescription("Artist name (defaults to now playing)").setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("album")
        .setDescription("Get info about an album")
        .addStringOption(option =>
          option.setName("album").setDescription("Album name (defaults to now playing)").setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("track")
        .setDescription("Get info about a track")
        .addStringOption(option =>
          option.setName("track").setDescription("Track name (defaults to now playing)").setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("genre")
        .setDescription("Get info about a genre")
        .addStringOption(option =>
          option.setName("genre").setDescription("Genre name (defaults to your top genre now playing)").setRequired(false).setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();

    if (sub === "artist") {
      await executeArtistInfo(interaction);
    } else if (sub === "album") {
      await executeAlbumInfo(interaction);
    } else if (sub === "track") {
      await executeTrackInfo(interaction);
    } else if (sub === "genre") {
      await executeGenreInfo(interaction);
    } else {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Unknown subcommand.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
  },
};
