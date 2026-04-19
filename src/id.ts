import "dotenv/config";
import pkg from "discord.js";
import * as readline from "readline";

const { REST, Routes } = pkg;

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;
const guildId = process.env.DISCORD_DEV_GUILD_ID;

const rest = new REST({ version: "10" }).setToken(token);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Command name: ", async (name) => {
  rl.close();
  const searchName = name.trim();

  try {
    const globalCommands = await rest.get(Routes.applicationCommands(clientId)) as any[];
    
    let guildCommands: any[] = [];
    if (guildId) {
      guildCommands = await rest.get(Routes.applicationGuildCommands(clientId, guildId)) as any[];
    }

    const globalMatch = globalCommands.find(c => c.name === searchName);
    const guildMatch = guildCommands.find(c => c.name === searchName);

    if (!globalMatch && !guildMatch) {
      console.log(`No command found with name "${searchName}"`);
      const allNames = [...new Set([...globalCommands.map(c => c.name), ...guildCommands.map(c => c.name)])];
      console.log("Available:", allNames.join(", "));
      return;
    }

    if (globalMatch) {
      console.log(`[Global] /${globalMatch.name} → ID: ${globalMatch.id}`);
    }

    if (guildMatch) {
      console.log(`[Guild] /${guildMatch.name} → ID: ${guildMatch.id}`);
    }
  } catch (error) {
    console.error("Error fetching commands:", error);
  }
});
