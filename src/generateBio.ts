import "dotenv/config";

/**
 * Generates a short AI music personality bio using the Groq API.
 */
export async function generateBio(
  topArtists: string[],
  topGenres: string[],
  totalScrobbles: number,
): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const artistList = topArtists.slice(0, 5).join(", ");
  const genreList =
    topGenres.length > 0 ? topGenres.slice(0, 3).join(", ") : null;

  const prompt = [
    `Write a single punchy sentence (max 100 characters) as a music personality bio.`,
    `Top artists: ${artistList}.`,
    genreList ? `Genres: ${genreList}.` : null,
    `Fun and witty. No username. Just the sentence, nothing else.`,
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 40,
        temperature: 0.85,
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const text: string | null =
      data.choices?.[0]?.message?.content?.trim() ?? null;
    if (!text) return null;
    // Hard cap at 120 chars, break at last space to avoid cutting mid-word
    if (text.length <= 120) return text;
    const truncated = text.slice(0, 120);
    const lastSpace = truncated.lastIndexOf(" ");
    return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + "…";
  } catch {
    return null;
  }
}
