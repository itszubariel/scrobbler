import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Client } from 'discord.js';
import {
  checkWebsite,
  checkBot,
  checkLastfm,
  checkDatabase,
  deriveOverallStatus,
  persistResults,
} from '../healthChecks.js';
import type { DailyRecord, ServiceName, StatusLabel, StatusResponse } from '../healthChecks.js';

// Raw query row shape returned by Prisma $queryRaw
interface AggRow {
  service: string;
  day: Date;
  total: number;
  up_count: number;
  worst_status: number;
}

// 5.1 — Daily aggregation query for the last 90 days
async function queryDailyHistory(
  prisma: PrismaClient,
): Promise<Map<ServiceName, DailyRecord[]>> {
  const rows = await prisma.$queryRaw<AggRow[]>`
    SELECT
      service,
      DATE("checkedAt") AS day,
      COUNT(*)::int AS total,
      SUM(CASE WHEN available THEN 1 ELSE 0 END)::int AS up_count,
      MAX(CASE status
        WHEN 'down' THEN 2
        WHEN 'degraded' THEN 1
        ELSE 0
      END)::int AS worst_status
    FROM status_records
    WHERE "checkedAt" >= NOW() - INTERVAL '90 days'
    GROUP BY service, DATE("checkedAt")
    ORDER BY service, day ASC
  `;

  // Build a map of service → date string → aggregated row
  const byService = new Map<ServiceName, Map<string, AggRow>>();

  for (const row of rows) {
    const svc = row.service as ServiceName;
    if (!byService.has(svc)) {
      byService.set(svc, new Map());
    }
    // DATE() returns a Date object from Prisma; convert to YYYY-MM-DD
    const dateStr = toDateString(row.day);
    byService.get(svc)!.set(dateStr, row);
  }

  // Generate the last 90 calendar days (oldest first)
  const days = last90Days();

  const result = new Map<ServiceName, DailyRecord[]>();

  for (const [svc, dateMap] of byService) {
    result.set(svc, buildPaddedHistory(days, dateMap));
  }

  // Ensure all four services are present even if they have no rows yet
  const allServices: ServiceName[] = ['website', 'bot', 'lastfm', 'database'];
  for (const svc of allServices) {
    if (!result.has(svc)) {
      result.set(svc, buildPaddedHistory(days, new Map()));
    }
  }

  return result;
}

/** Returns an array of 90 YYYY-MM-DD strings, oldest first, ending today. */
function last90Days(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(toDateString(d));
  }
  return days;
}

/** Convert a Date (or date-only value from Postgres) to 'YYYY-MM-DD'. */
function toDateString(d: Date): string {
  // Postgres DATE columns come back as Date objects set to midnight UTC
  const iso = d instanceof Date ? d.toISOString() : String(d);
  return iso.slice(0, 10);
}

/** Build a padded 90-entry DailyRecord array from a date→row map. */
function buildPaddedHistory(
  days: string[],
  dateMap: Map<string, AggRow>,
): DailyRecord[] {
  return days.map((dateStr) => {
    const row = dateMap.get(dateStr);
    if (!row) {
      return { date: dateStr, availability: null, highestStatus: null, downtimeMinutes: null };
    }

    const availability = row.total > 0 ? (row.up_count / row.total) * 100 : null;

    const highestStatus: StatusLabel =
      row.worst_status === 2 ? 'down' : row.worst_status === 1 ? 'degraded' : 'operational';

    // Estimate downtime: unavailable checks × 5 minutes each
    const unavailableChecks = row.total - row.up_count;
    const downtimeMinutes = unavailableChecks * 5;

    return { date: dateStr, availability, highestStatus, downtimeMinutes };
  });
}

// 5.3 — getStatus handler
async function getStatus(
  req: Request,
  res: Response,
  prisma: PrismaClient,
  client: Client,
): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  try {
    // Run all four probes in parallel
    const results = await Promise.all([
      checkWebsite(),
      checkBot(client),
      checkLastfm(),
      checkDatabase(prisma),
    ]);

    // Persist results (errors are caught inside persistResults)
    await persistResults(prisma, results);

    // Query 90-day history
    const historyMap = await queryDailyHistory(prisma);

    // Build StatusResponse
    const overall = deriveOverallStatus(results);
    const checkedAt = results[0].checkedAt.toISOString();

    const response: StatusResponse = {
      overall,
      checkedAt,
      services: results.map((r) => ({
        name: r.service,
        status: r.status,
        responseTime: r.responseTime,
        history: historyMap.get(r.service) ?? [],
      })),
    };

    res.status(200).json(response);
  } catch (err) {
    console.error('getStatus error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
}

// Factory function — avoids circular deps by accepting prisma and client as params
export function createStatusRouter(prisma: PrismaClient, client: Client): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    getStatus(req, res, prisma, client);
  });

  return router;
}
