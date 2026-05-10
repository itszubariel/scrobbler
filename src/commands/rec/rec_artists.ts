import "dotenv/config";
import pkg from "discord.js";
import { prisma } from "../../db.js";
import { E } from "../../emojis.js";
import { cmdMention } from "../../utils.js";
import { getCache, setCache } from "../../cache.js";

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = pkg;

interface GroqRecommendation {
  artist: string;
  reason: string;
}

interface CachedRecommendation {
  items: Array<{
    name: string;
    reason: string;
    imageUrl: string;
  }>;
  topArtists: string[];
}

const PERIOD_LABELS: Record<string, string> = {
  "7day": "last 7 days",
  "1month": "last month",
  "3month": "last 3 months",
  "6month": "last 6 months",
  "12month": "last year",
  overall: "all time",
};

async function callGroq(
  topArtists: string[],
  recommendations: string[],
  periodLabel: string,
): Promise<GroqRecommendation[] | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const topArtistsStr = topArtists.join(", ");
  const recsStr = recommendations.join(", ");

  const systemPrompt =
    "You are a music recommendation assistant. You must respond with valid JSON only.";

  const userPrompt = `This user's top 10 artists from their ${periodLabel} of listening are: ${topArtistsStr}.

Based on their specific taste, here are 5 recommended artists: ${recsStr}.

For each recommended artist, write exactly one sentence per recommendation, at least 160 characters and up to 180 characters maximum. The sentence must mention one specific sonic or emotional quality and reference one of the user's actual top artists by name.

Every single item must have a reason field. If you cannot think of a specific reason, write a short generic but accurate one. Never leave the reason field empty or null.

Respond with a JSON object containing a key called "items" which is an array of exactly 5 objects, each with fields "artist" (string) and "reason" (string).`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1200,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      console.error(
        `Groq API error (artists): ${res.status} ${res.statusText}`,
      );
      return null;
    }

    const data = (await res.json()) as any;
    const text: string | null =
      data.choices?.[0]?.message?.content?.trim() ?? null;
    if (!text) {
      console.error("Groq API returned empty response (artists)");
      return null;
    }

    // Extract JSON from response
    let parsed: { items?: GroqRecommendation[] } | null = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to fix common JSON issues
      try {
        let fixedJson = text.replace(/,(\s*[}\]])/g, "$1");
        fixedJson = fixedJson.replace(/}(\s*){/g, "},{");
        fixedJson = fixedJson.replace(/[\x00-\x1F\x7F]/g, "");
        parsed = JSON.parse(fixedJson);
      } catch {
        return null;
      }
    }

    if (!parsed || !parsed.items || !Array.isArray(parsed.items)) {
      return null;
    }

    const recommendations = parsed.items;

    // Error recovery: ensure all items have valid reason fields
    const fallbackReason = "Matches your taste based on your listening history";
    recommendations.forEach((item) => {
      if (!item.reason || item.reason.trim() === "") {
        item.reason = fallbackReason;
      }
    });

    // Character limit enforcement: truncate reasons over 185 characters
    recommendations.forEach((item) => {
      if (item.reason.length > 185) {
        const truncated = item.reason.slice(0, 185);
        const lastSpace = truncated.lastIndexOf(" ");
        item.reason =
          (lastSpace > 100 ? truncated.slice(0, lastSpace) : truncated) + "...";
      }
    });

    return recommendations;
  } catch (error) {
    console.error("Groq API call failed (artists):", error);
    return null;
  }
}

async function fetchDeezerImage(artistName: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`,
    );
    const data = (await res.json()) as any;
    return data.data?.[0]?.picture_xl ?? null;
  } catch {
    return null;
  }
}

export async function executeRecArtists(interaction: any): Promise<void> {
  const apiKey = process.env.LASTFM_API_KEY!;
  const targetDiscordUser =
    interaction.options.getUser("user") ?? interaction.user;
  const isOwnProfile = targetDiscordUser.id === interaction.user.id;
  const period = (interaction.options.getString("period") ??
    "overall") as string;
  const periodLabel = PERIOD_LABELS[period] ?? "all time";

  // Check cache first
  const cacheKey = `rec_artists_${targetDiscordUser.id}_${period}`;
  const cached = await getCache<CachedRecommendation>(cacheKey);

  if (cached) {
    // Rebuild container from cached data
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${E.artists} Recommended Artists for ${targetDiscordUser.username}`,
      ),
      new TextDisplayBuilder().setContent(
        `-# Based on your top artists including ${cached.topArtists.join(" • ")}`,
      ),
    );

    cached.items.forEach((item, idx) => {
      const rank = idx + 1;
      const section = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`### ${rank}. ${item.name}`),
          new TextDisplayBuilder().setContent(`-# ${item.reason}`),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(item.imageUrl));

      container.addSectionComponents(section);

      if (idx < cached.items.length - 1) {
        container.addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(false)
            .setSpacing(SeparatorSpacingSize.Small),
        );
      }
    });

    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Based on top 50 artists, tracks & albums • ${periodLabel}`,
        ),
      );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const dbUser = await prisma.user.findUnique({
    where: { discordId: targetDiscordUser.id },
  });

  if (!dbUser?.lastfmUsername) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isOwnProfile
          ? `${E.reject} You haven't linked your Last.fm account yet! Use ${cmdMention("link")} to get started.`
          : `${E.reject} **${targetDiscordUser.username}** hasn't linked their Last.fm account yet.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const lfmUsername = dbUser.lastfmUsername;

  // Fetch user's top 50 artists for exclusion
  const topArtistsRes = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lfmUsername)}&period=${period}&limit=50&api_key=${apiKey}&format=json`,
  );
  const topArtistsData = (await topArtistsRes.json()) as any;

  if (topArtistsData.error || !topArtistsData.topartists?.artist) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} Couldn't fetch Last.fm data for **${lfmUsername}**.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const topArtists = (
    Array.isArray(topArtistsData.topartists.artist)
      ? topArtistsData.topartists.artist
      : [topArtistsData.topartists.artist]
  ).slice(0, 50);

  if (topArtists.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} **${lfmUsername}** doesn't have enough listening history yet.`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const topArtistNames = topArtists.map((a: any) => a.name);
  const top10Artists = topArtists.slice(0, 10);

  // Fetch similar artists for top 10 artists in parallel
  const similarResults = await Promise.all(
    top10Artists.map((artist: any) =>
      fetch(
        `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artist.name)}&limit=20&api_key=${apiKey}&format=json`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ),
  );

  // Collect all similar artists
  const allSimilar: Array<{ name: string; sourceArtist: string }> = [];
  similarResults.forEach((result, idx) => {
    if (!result?.similarartists?.artist) return;
    const artists = Array.isArray(result.similarartists.artist)
      ? result.similarartists.artist
      : [result.similarartists.artist];
    artists.forEach((a: any) => {
      allSimilar.push({
        name: a.name,
        sourceArtist: top10Artists[idx]!.name,
      });
    });
  });

  // Filter out artists already in user's top 50
  const topArtistNamesLower = topArtistNames.map((n: string) =>
    n.toLowerCase(),
  );
  const filtered = allSimilar.filter(
    (a) => !topArtistNamesLower.includes(a.name.toLowerCase()),
  );

  // Score by how many top 10 artists they're similar to
  const scoreMap = new Map<string, number>();
  filtered.forEach((a) => {
    const lower = a.name.toLowerCase();
    scoreMap.set(lower, (scoreMap.get(lower) ?? 0) + 1);
  });

  // Get unique artists with scores
  const uniqueArtists = Array.from(
    new Map(filtered.map((a) => [a.name.toLowerCase(), a.name])).values(),
  );
  const scored = uniqueArtists.map((name) => ({
    name,
    score: scoreMap.get(name.toLowerCase()) ?? 0,
  }));

  // Sort by score descending, then alphabetically ascending for deterministic order
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  const top5Recommendations = scored.slice(0, 5).map((s) => s.name);

  if (top5Recommendations.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E.reject} Couldn't find enough recommendations. Try listening to more artists!`,
      ),
    );
    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  // Get Groq reasons and Deezer images in parallel
  const [groqReasons, ...deezerImages] = await Promise.all([
    callGroq(
      topArtists.slice(0, 10).map((a: any) => a.name),
      top5Recommendations,
      periodLabel,
    ),
    ...top5Recommendations.map((name) => fetchDeezerImage(name)),
  ]);

  // Build container
  const top5Names = topArtists
    .slice(0, 5)
    .map((a: any) => a.name)
    .join(" • ");

  // Prepare data for caching
  const cacheData: CachedRecommendation = {
    items: top5Recommendations.map((artistName, idx) => {
      const groqReason = groqReasons?.find(
        (r) => r.artist.toLowerCase() === artistName.toLowerCase(),
      );
      const reasonText = groqReason?.reason ?? "Similar to your top artists";
      const imageUrl =
        deezerImages[idx] ??
        "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png";

      return {
        name: artistName,
        reason: reasonText,
        imageUrl,
      };
    }),
    topArtists: top5Names.split(" • "),
  };

  // Save to cache (360 minutes TTL)
  await setCache(cacheKey, cacheData, 360);

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E.artists} Recommended Artists for ${lfmUsername}`,
    ),
    new TextDisplayBuilder().setContent(
      `-# Based on your top artists including ${top5Names}`,
    ),
  );

  // Add each recommendation as a section with thumbnail
  cacheData.items.forEach((item, idx) => {
    const rank = idx + 1;

    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${rank}. ${item.name}`),
        new TextDisplayBuilder().setContent(`-# ${item.reason}`),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(item.imageUrl));

    container.addSectionComponents(section);

    // Add separator between sections (but not after the last one)
    if (idx < cacheData.items.length - 1) {
      container.addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(false)
          .setSpacing(SeparatorSpacingSize.Small),
      );
    }
  });

  container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Based on top 50 artists, tracks & albums • ${periodLabel}`,
      ),
    );

  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
