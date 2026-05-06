import { prisma } from "./db.js";

/**
 * Get cached data by key
 * Returns null if not found or expired
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const cached = await prisma.cache.findUnique({
      where: { key },
    });

    if (!cached) return null;

    // Check if expired
    if (cached.expiresAt < new Date()) {
      // Delete expired cache entry
      await prisma.cache.delete({ where: { key } }).catch(() => {});
      return null;
    }

    return cached.data as T;
  } catch {
    return null;
  }
}

/**
 * Set cache data with TTL in minutes
 */
export async function setCache(
  key: string,
  data: any,
  ttlMinutes: number,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await prisma.cache.upsert({
      where: { key },
      create: {
        key,
        data,
        expiresAt,
      },
      update: {
        data,
        expiresAt,
      },
    });
  } catch (error) {
    console.error(`Failed to set cache for key ${key}:`, error);
  }
}

/**
 * Invalidate (delete) a specific cache entry
 */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await prisma.cache.delete({ where: { key } });
  } catch {
    // Ignore if key doesn't exist
  }
}

/**
 * Invalidate all cache entries for a specific user
 * Used when user links/unlinks their Last.fm account
 */
export async function invalidateUserCache(discordId: string): Promise<void> {
  try {
    await prisma.cache.deleteMany({
      where: {
        key: {
          contains: discordId,
        },
      },
    });
  } catch (error) {
    console.error(`Failed to invalidate user cache for ${discordId}:`, error);
  }
}
