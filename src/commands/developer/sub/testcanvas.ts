import { AttachmentBuilder } from "discord.js";
import { buildLeaderboardCanvas } from "../../stats/canvas.js";

export async function executeDevTestCanvas(interaction: any): Promise<void> {
  const testMembers = [
    { username: 'testuser1', count: 1000, displayCount: '1,000' },
    { username: 'testuser2', count: 800,  displayCount: '800' },
    { username: 'testuser3', count: 600,  displayCount: '600' },
    { username: 'testuser4', count: 400,  displayCount: '400' },
    { username: 'testuser5', count: 200,  displayCount: '200' },
  ];

  const buf = await buildLeaderboardCanvas(testMembers, 'Test Server', 'plays', 'Canvas render test ✅', 0);
  const attachment = new AttachmentBuilder(buf, { name: 'testcanvas.png' });
  await interaction.editReply({ files: [attachment] });
}
