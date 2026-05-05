import "dotenv/config";
import pkg from "discord.js";
import { E } from "../../emojis.js";
import { executeTasteUser } from "./taste_user.js";
import { executeTasteServer } from "./taste_server.js";

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

export const tasteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("taste")
    .setDescription("A breakdown of top genres")
    .addSubcommand((sub) =>
      sub
        .setName("user")
        .setDescription("Your top 50 genres")
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
            .setDescription("Check another user's taste (optional)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("server")
        .setDescription(
          "This server's top 50 genres based on all linked members",
        )
        .addStringOption((option) =>
          option
            .setName("period")
            .setDescription("Time period")
            .setRequired(false)
            .addChoices(...periodChoices),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();

    if (sub === "user") {
      await executeTasteUser(interaction);
    } else if (sub === "server") {
      await executeTasteServer(interaction);
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

// Re-export helpers needed by buttons handler
export {
  TASTE_PAGE_SIZE,
  PERIOD_LABELS_TASTE,
  fetchTasteData,
  buildTasteCanvas,
  buildTasteContainer,
} from "./taste_helpers.js";
export { fetchServerTasteData, executeTasteServer } from "./taste_server.js";
