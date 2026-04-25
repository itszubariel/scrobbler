import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { cmdMention } from "../../utils.js";
import { fetchNowPlaying } from "../../nowplaying.js";

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = pkg;

function stripTagHtml(text: string): string {
  return text.replace(/<a\s[^>]*>.*?<\/a>/gi, '').replace(/<[^>]+>/g, '').trim();
}

export async function executeGenreInfo(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const dbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  const lfmUsername = dbUser?.lastfmUsername ?? null;

  let genreName = interaction.options.getString("genre") as string | null;

  // Default to top genre of now playing
  if (!genreName) {
    if (!lfmUsername) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} No genre specified and you haven't linked your Last.fm. Use ${cmdMention('link')} or specify a genre.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const np = await fetchNowPlaying(lfmUsername, apiKey);
    if (!np?.topGenre) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${E.reject} Couldn't detect a genre from what you're listening to. Please specify one.`)
      );
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    genreName = np.topGenre;
  }

  // Fetch tag info and top artists in parallel
  const [tagData, topArtistsData] = await Promise.all([
    fetch(`https://ws.audioscrobbler.com/2.0/?method=tag.getInfo&tag=${encodeURIComponent(genreName)}&api_key=${apiKey}&format=json`)
      .then(r => r.json()).catch(() => null),
    fetch(`https://ws.audioscrobbler.com/2.0/?method=tag.gettopartists&tag=${encodeURIComponent(genreName)}&limit=10&api_key=${apiKey}&format=json`)
      .then(r => r.json()).catch(() => null),
  ]);

  if (!tagData || tagData.error) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${E.reject} Couldn't find genre **${genreName}** on Last.fm.`)
    );
    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const tag = tagData.tag;
  const displayName = tag?.name ?? genreName;
  const reach = parseInt(tag?.reach ?? '0').toLocaleString('en-US');
  const taggings = parseInt(tag?.taggings ?? '0').toLocaleString('en-US');
  const tagUrl = `https://www.last.fm/tag/${encodeURIComponent(genreName)}`;

  // Wrap text at ~60 chars per line
  const wrapText = (text: string, maxLen = 60): string => {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if ((current + (current ? ' ' : '') + word).length > maxLen && current) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
    return lines.join('\n');
  };

  // Wiki — first 2 sentences, wrapped
  const rawWiki: string = tag?.wiki?.summary ?? '';
  const cleanWiki = rawWiki ? stripTagHtml(rawWiki) : '';
  let wiki: string | null = null;
  if (cleanWiki) {
    const sentences = cleanWiki.match(/[^.!?]+[.!?]+/g) ?? [];
    const twoSentences = sentences.slice(0, 2).join(' ').trim() || cleanWiki.slice(0, 300);
    wiki = wrapText(twoSentences);
  }

  const topArtists: string[] = (topArtistsData?.topartists?.artist ?? [])
    .slice(0, 10)
    .map((a: any) => a.name);

  // Wrap top artists line
  const artistsLine = topArtists.length > 0
    ? `**Top Artists:** ${wrapText(topArtists.join(', '))}`
    : null;

  // Build container
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${displayName}`)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.listening} **${reach}** listeners • ${E.musicLast} **${taggings}** taggings`
      )
    );

  if (wiki) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(wiki)
    );
  }

  if (artistsLine) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(artistsLine)
      );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(`${displayName} on Last.fm`)
      .setURL(tagUrl)
      .setStyle(ButtonStyle.Link)
  );
  container.addActionRowComponents(row as any);

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
