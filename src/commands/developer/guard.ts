export const DEV_IDS = new Set(["860384146778226699"]);

export function isDev(userId: string): boolean {
  return DEV_IDS.has(userId);
}

export async function denyIfNotDev(interaction: any): Promise<boolean> {
  if (!isDev(interaction.user.id)) {
    await interaction.reply({ content: "🚫 Developer only.", ephemeral: true });
    return true;
  }
  return false;
}
