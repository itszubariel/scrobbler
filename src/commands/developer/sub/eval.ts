import { MessageFlags, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import { prisma } from "../../../db.js";
import { client } from "../../../index.js";

export async function executeDevEval(interaction: any): Promise<void> {
  const code = interaction.options.getString("code", true);
  let result: string;
  try {
    // eslint-disable-next-line no-eval
    let output = eval(code);
    if (output instanceof Promise) output = await output;
    result =
      typeof output === "object"
        ? JSON.stringify(output, null, 2)
        : String(output);
  } catch (err: any) {
    result = `❌ ${err?.message ?? err}`;
  }

  const truncated =
    result.length > 1800 ? result.slice(0, 1800) + "\n...(truncated)" : result;
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ⚡ Eval\n\`\`\`js\n${code}\n\`\`\`\n**Output:**\n\`\`\`\n${truncated}\n\`\`\``,
    ),
  );
  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
