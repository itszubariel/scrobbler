import { MessageFlags, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import { client } from "../../../index.js";

export async function executeDevStats(interaction: any): Promise<void> {
  const uptimeSecs = Math.floor(process.uptime());
  const h = Math.floor(uptimeSecs / 3600);
  const m = Math.floor((uptimeSecs % 3600) / 60);
  const s = uptimeSecs % 60;
  const mem = process.memoryUsage();
  const toMB = (b: number) => (b / 1024 / 1024).toFixed(1) + ' MB';

  const lines = [
    `### 🤖 Bot Stats`,
    `**Uptime:** ${h}h ${m}m ${s}s`,
    `**Guilds:** ${client.guilds.cache.size}`,
    `**Ping:** ${client.ws.ping}ms`,
    `**Heap used:** ${toMB(mem.heapUsed)}`,
    `**Heap total:** ${toMB(mem.heapTotal)}`,
    `**RSS:** ${toMB(mem.rss)}`,
    `**Node:** ${process.version}`,
  ].join('\n');

  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
