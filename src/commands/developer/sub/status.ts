import { MessageFlags, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import { prisma } from "../../../db.js";
import { client } from "../../../index.js";
import { checkWebsite, checkBot, checkLastfm, checkDatabase } from "../../../../server/healthChecks.js";

export async function executeDevStatus(interaction: any): Promise<void> {
  const results = await Promise.allSettled([
    checkWebsite(),
    checkBot(client),
    checkLastfm(),
    checkDatabase(prisma as any),
  ]);

  const emoji = (s: string) => s === 'operational' ? '🟢' : s === 'degraded' ? '🟡' : '🔴';

  const lines = [
    `### 🔍 Service Status`,
    ...results.map(r => {
      if (r.status === 'fulfilled') {
        return `${emoji(r.value.status)} **${r.value.service}** — ${r.value.status} (${r.value.responseTime}ms)`;
      }
      return `🔴 **unknown** — error`;
    }),
  ].join('\n');

  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
