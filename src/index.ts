import pkg from "discord.js";
const {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  SlashCommandBuilder,
} = pkg;
import type { ChatInputCommandInteraction, Interaction } from "discord.js";
import * as dotenv from "dotenv";
import { handleButtonInteraction } from "./handlers/buttons.js";
import "./fonts.js";
import { E } from "./emojis.js";

dotenv.config();

export interface Command {
  data:
    | SlashCommandBuilder
    | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
});

// Extend the client to hold commands
const commands = new Collection<string, Command>();

import { linkCommand } from "./commands/link.js";
commands.set(linkCommand.data.name, linkCommand);
import { unlinkCommand } from "./commands/unlink.js";
commands.set(unlinkCommand.data.name, unlinkCommand);
import { helpCommand } from "./commands/help.js";
commands.set(helpCommand.data.name, helpCommand);
import { npCommand } from "./commands/np.js";
commands.set(npCommand.data.name, npCommand);
import { profileCommand } from "./commands/profile.js";
commands.set(profileCommand.data.name, profileCommand);
import { compatCommand } from "./commands/compat.js";
commands.set(compatCommand.data.name, compatCommand);
import { tasteCommand } from "./commands/taste/taste.js";
commands.set(tasteCommand.data.name, tasteCommand);
import { recentCommand } from "./commands/recent.js";
commands.set(recentCommand.data.name, recentCommand);
import { statsCommand } from "./commands/stats/stats.js";
commands.set(statsCommand.data.name, statsCommand);
import { chartCommand } from "./commands/charts/chart.js";
commands.set(chartCommand.data.name, chartCommand);
import { wkCommand } from "./commands/wk/wk.js";
commands.set(wkCommand.data.name, wkCommand);
import { handleWkAutocomplete } from "./commands/wk/autocomplete.js";
import { infoCommand } from "./commands/info/info.js";
commands.set(infoCommand.data.name, infoCommand);
import { handleInfoAutocomplete } from "./commands/info/autocomplete.js";
import { discoveryCommand } from "./commands/discovery.js";
commands.set(discoveryCommand.data.name, discoveryCommand);
import { personalityCommand } from "./commands/personality.js";
commands.set(personalityCommand.data.name, personalityCommand);
import { streakCommand } from "./commands/streak.js";
commands.set(streakCommand.data.name, streakCommand);
import { wrappedCommand } from "./commands/wrapped.js";
commands.set(wrappedCommand.data.name, wrappedCommand);
import { recCommand } from "./commands/rec/rec.js";
commands.set(recCommand.data.name, recCommand);
import { devCommand } from "./commands/developer/dev.js";
commands.set(devCommand.data.name, devCommand);

export const commandIds = new Map<string, string>();

async function deployCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_DEV_GUILD_ID;

  if (!token || !clientId) {
    throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const isDev = process.env.NODE_ENV === "development";

  // Separate dev commands from regular commands
  const devCommandData = [devCommand.data.toJSON()];
  const globalCommandData = commands
    .filter((cmd) => cmd !== devCommand)
    .map((cmd) => cmd.data.toJSON());

  if (isDev && guildId) {
    // In dev: register everything to the guild
    const allCommandData = commands.map((cmd) => cmd.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: allCommandData,
    });
    console.log(
      `✅ Registered ${allCommandData.length} guild command(s) to dev server`,
    );

    const registered = (await rest.get(
      Routes.applicationGuildCommands(clientId, guildId),
    )) as any[];
    for (const cmd of registered) commandIds.set(cmd.name, cmd.id);
  } else {
    // In production: register global commands (excluding dev)
    await rest.put(Routes.applicationCommands(clientId), {
      body: globalCommandData,
    });
    console.log(`✅ Registered ${globalCommandData.length} global command(s)`);

    const registeredGlobal = (await rest.get(
      Routes.applicationCommands(clientId),
    )) as any[];
    for (const cmd of registeredGlobal) commandIds.set(cmd.name, cmd.id);

    // Always register dev command as guild-only (requires DISCORD_DEV_GUILD_ID in prod too)
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: devCommandData,
      });
      console.log(
        `✅ Registered ${devCommandData.length} guild developer command(s) to dev server`,
      );

      const registeredGuild = (await rest.get(
        Routes.applicationGuildCommands(clientId, guildId),
      )) as any[];
      for (const cmd of registeredGuild) commandIds.set(cmd.name, cmd.id);
    }
  }
}

client.once("clientReady", async (readyClient) => {
  console.log(`🎵 scrobbler is online as ${readyClient.user.tag}`);

  let cachedLinkedUsers = 0;
  let cachedTotalMembers = 0;
  const fetchStats = async () => {
    try {
      const res = await fetch("https://api-scrobbler.netlify.app/stats");
      if (res.ok) {
        const data = (await res.json()) as any;
        cachedLinkedUsers = data.linkedUsers ?? cachedLinkedUsers;
        cachedTotalMembers = data.totalMembers ?? cachedTotalMembers;
      }
    } catch {
      /* keep last known values */
    }
  };
  await fetchStats();
  setInterval(fetchStats, 5 * 60 * 1000);

  const statuses = [
    { name: "/link to start scrobbling", type: 0 },
    { name: "through your music history", type: 3 },
    { name: "your taste in music 👀", type: 3 },
    () => ({
      name: `music in ${readyClient.guilds.cache.size} servers`,
      type: 0,
    }),
    () => ({ name: `${cachedTotalMembers.toLocaleString()} members`, type: 0 }),
    () => ({
      name: `${cachedLinkedUsers.toLocaleString()} music lovers`,
      type: 0,
    }),
  ];

  let statusIndex = 0;
  const setNextStatus = () => {
    const raw = statuses[statusIndex % statuses.length]!;
    const s = typeof raw === "function" ? raw() : raw;

    readyClient.user.setPresence({
      activities: [{ name: s.name, type: s.type as any }],
      status: "online",
    });
    statusIndex++;
  };

  setNextStatus();
  setInterval(setNextStatus, 15_000);

  try {
    await deployCommands();
  } catch (err) {
    console.error("Failed to deploy commands:", err);
  }
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  if ((interaction as any).isAutocomplete?.()) {
    if ((interaction as any).commandName === "wk") {
      await handleWkAutocomplete(interaction);
    } else if ((interaction as any).commandName === "info") {
      await handleInfoAutocomplete(interaction);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) {
    await interaction.reply({
      content: `${E.reject} Unknown command.`,
      ephemeral: true,
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);

    const errorMessage = {
      content: `${E.reject} Something went wrong running that command.`,
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("Missing DISCORD_TOKEN in .env");

client.login(token);
