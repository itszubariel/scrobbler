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
import { E } from "./emojis.js";

dotenv.config();

export interface Command {
  data: SlashCommandBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
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
import { tasteCommand } from "./commands/taste.js";
commands.set(tasteCommand.data.name, tasteCommand);
import { recentCommand } from "./commands/recent.js";
commands.set(recentCommand.data.name, recentCommand);
import { statsCommand } from "./commands/stats/stats.js";
commands.set(statsCommand.data.name, statsCommand);
import { chartCommand } from "./commands/charts/chart.js";
commands.set(chartCommand.data.name, chartCommand);

async function deployCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_DEV_GUILD_ID;

  if (!token || !clientId) {
    throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const commandData = commands.map((cmd) => cmd.data.toJSON());
  const isDev = process.env.NODE_ENV === "development";

  if (isDev && guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commandData,
    });
    console.log(`✅Registered ${commandData.length} guild command(s) to dev server`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), {
      body: commandData,
    });
    console.log(`✅Registered ${commandData.length} global command(s)`);
  }
}

client.once("ready", async (readyClient) => {
  console.log(`🎵 scrobbler is online as ${readyClient.user.tag}`);

  const statuses = [
    { name: '/link to start scrobbling', type: 0 },
    { name: 'through your music history', type: 3 },
    { name: 'your taste in music 👀', type: 3 },
    // { name: `music in ${readyClient.guilds.cache.size} servers`, type: 0 },
    // { name: `${readyClient.users.cache.size} music lovers`, type: 0 },
  ];

  let statusIndex = 0;
  const setNextStatus = () => {
    const s = statuses[statusIndex % statuses.length]!;
    readyClient.user.setPresence({
      activities: [{ name: s.name, type: s.type as any }],
      status: 'online',
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