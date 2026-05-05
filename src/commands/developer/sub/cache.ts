import { MessageFlags, ContainerBuilder, TextDisplayBuilder } from "discord.js";
import { prisma } from "../../../db.js";

export async function executeDevCache(interaction: any): Promise<void> {
  const db = prisma as any;
  const [
    recent,
    tasteUser,
    tasteServer,
    scrobbles,
    artists,
    albums,
    genres,
    wk,
    wrapped,
  ] = await Promise.all([
    db.recentCache.count(),
    db.tasteUserCache.count(),
    db.tasteServerCache.count(),
    db.statsScrobblesCache.count(),
    db.statsArtistsCache.count(),
    db.statsAlbumsCache.count(),
    db.statsGenresCache.count(),
    db.wkCache.count(),
    db.wrappedCache.count(),
  ]);

  const lines = [
    `### 🗄️ Cache Rows`,
    `**RecentCache:** ${recent}`,
    `**TasteUserCache:** ${tasteUser}`,
    `**TasteServerCache:** ${tasteServer}`,
    `**StatsScrobblesCache:** ${scrobbles}`,
    `**StatsArtistsCache:** ${artists}`,
    `**StatsAlbumsCache:** ${albums}`,
    `**StatsGenresCache:** ${genres}`,
    `**WkCache:** ${wk}`,
    `**WrappedCache:** ${wrapped}`,
  ].join("\n");

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines),
  );
  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
