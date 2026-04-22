import type { PrismaClient } from '@prisma/client';
import type { Client } from 'discord.js';
import {
  checkWebsite,
  checkBot,
  checkLastfm,
  checkDatabase,
  deriveOverallStatus,
  persistResults,
} from './healthChecks.js';

export async function cleanupOldRecords(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await prisma.statusRecord.deleteMany({
    where: { checkedAt: { lt: cutoff } },
  });
}

export function startScheduler(
  prisma: PrismaClient,
  client: Client,
  intervalMs: number = 5 * 60 * 1000,
): NodeJS.Timeout {
  async function runCycle(): Promise<void> {
    const results = await Promise.all([
      checkWebsite(),
      checkBot(client),
      checkLastfm(),
      checkDatabase(prisma),
    ]);

    await persistResults(prisma, results);
    await cleanupOldRecords(prisma);

    const overall = deriveOverallStatus(results);
    console.log(`[scheduler] overall=${overall}`);
    for (const r of results) {
      console.log(`[scheduler] ${r.service}: ${r.status} (${r.responseTime}ms)`);
    }
  }

  // Run immediately before the first interval fires
  void runCycle();

  return setInterval(() => void runCycle(), intervalMs);
}
