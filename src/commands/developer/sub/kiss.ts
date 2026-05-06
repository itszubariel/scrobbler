import "dotenv/config";
import pkg from "discord.js";

const { MessageFlags, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = pkg;

export async function executeDevKiss(interaction: any): Promise<void> {
  const targetUser = interaction.options.getUser("user");
  const executor = interaction.user;

  try {
    const response = await fetch("https://nekos.best/api/v2/kiss");
    const data = (await response.json()) as any;

    if (!data?.results?.[0]?.url) {
      await interaction.editReply({
        content: "❌ Failed to fetch kiss GIF from API",
      });
      return;
    }

    const gifUrl = data.results[0].url;

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `💋 **${executor.username}** kissed **${targetUser.username}**!`
        ),
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(gifUrl),
        ),
      );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    console.error("Error in /dev kiss:", error);
    await interaction.editReply({
      content: "❌ Something went wrong fetching the kiss GIF",
    });
  }
}
