import { MessageFlags, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import { client } from "../../../index.js";

export async function executeDevBotStats(interaction: any): Promise<void> {
  const res = await fetch('https://api-scrobbler.netlify.app/stats').catch(() => null);
  const data = res?.ok ? await res.json() as any : null;

  const linkedUsers   = data?.linkedUsers   ?? '—';
  const totalMembers  = data?.totalMembers  ?? '—';

  const lines = [
    `### 📊 Bot Stats`,
    `**Linked members:** ${typeof linkedUsers === 'number' ? linkedUsers.toLocaleString() : linkedUsers}`,
    `**Total members:** ${typeof totalMembers === 'number' ? totalMembers.toLocaleString() : totalMembers}`,
    `**Total Servers:** ${client.guilds.cache.size.toLocaleString()}`,
    `**API status:** ${res?.ok ? '✅ online' : '❌ offline'}`,
  ].join('\n');

  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
