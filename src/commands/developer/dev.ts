import "dotenv/config";
import { SlashCommandBuilder } from "discord.js";
import { denyIfNotDev } from "./guard.js";
import { executeDevStats } from "./sub/stats.js";
import { executeDevStatus } from "./sub/status.js";
import { executeDevCache } from "./sub/cache.js";
import { executeDevUser } from "./sub/user.js";
import { executeDevLookup } from "./sub/lookup.js";
import { executeDevEval } from "./sub/eval.js";
import { executeDevTestCanvas } from "./sub/testcanvas.js";
import { executeDevBotStats } from "./sub/botstats.js";
import type { Command } from "../../index.js";

export const devCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("dev")
    .setDescription("Developer tools")
    .addSubcommand((s) =>
      s
        .setName("stats")
        .setDescription("Bot runtime stats (uptime, memory, ping)"),
    )
    .addSubcommand((s) =>
      s
        .setName("botstats")
        .setDescription("No cached member/server counts from DB"),
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("Live service health check"),
    )
    .addSubcommand((s) =>
      s.setName("cache").setDescription("Cache table row counts"),
    )
    .addSubcommand((s) =>
      s
        .setName("user")
        .setDescription("Look up a Discord user in the DB")
        .addUserOption((o) =>
          o.setName("user").setDescription("Discord user").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("lookup")
        .setDescription("Look up a Last.fm username in the DB")
        .addStringOption((o) =>
          o
            .setName("username")
            .setDescription("Last.fm username")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("eval")
        .setDescription("Evaluate a JS expression")
        .addStringOption((o) =>
          o.setName("code").setDescription("JS code").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("testcanvas")
        .setDescription("Render a test leaderboard canvas"),
    ),

  async execute(interaction) {
    if (await denyIfNotDev(interaction)) return;

    // Defer immediately so slow subcommands don't hit the 3s Discord timeout
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === "stats") return executeDevStats(interaction);
    if (sub === "botstats") return executeDevBotStats(interaction);
    if (sub === "status") return executeDevStatus(interaction);
    if (sub === "cache") return executeDevCache(interaction);
    if (sub === "user") return executeDevUser(interaction);
    if (sub === "lookup") return executeDevLookup(interaction);
    if (sub === "eval") return executeDevEval(interaction);
    if (sub === "testcanvas") return executeDevTestCanvas(interaction);
  },
};
