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

  const commands: any[] = guildId
    ? await rest.get(Routes.applicationGuildCommands(clientId, guildId)) as any[]
    : await rest.get(Routes.applicationCommands(clientId)) as any[];

  const match = commands.find(c => c.name === name.trim());

  if (!match) {
    console.log(`No command found with name "${name.trim()}"`);
    console.log("Available:", commands.map(c => c.name).join(", "));
  } else {
    console.log(`/${match.name} → ID: ${match.id}`);
  }
});
