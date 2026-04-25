import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../src/db.js';
import { client } from '../src/index.js';
import { createStatusRouter } from './routes/status.js';
import { startScheduler } from './scheduler.js';
import {
  checkWebsite,
  checkBot,
  checkLastfm,
  checkDatabase,
  deriveOverallStatus,
} from './healthChecks.js';
import type { CheckResult, DailyRecord, StatusResponse } from './healthChecks.js';

// Allowed CORS origins
const ALLOWED_ORIGINS = [
  'https://scrobbler.netlify.app',
  'https://scrobbler.anim8.world',
  'http://127.0.0.1:5500',
  'http://localhost:5500', 
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow http://localhost:<any port>
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

const app = express();

// CORS middleware — runs on every request
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin!);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

// Mount status router
app.use('/api/status', createStatusRouter(prisma, client));

// Root route
app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', name: 'scrobbler api', version: '1.1.1' });
});

// Start server
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  startScheduler(prisma, client);
});

// Exported for testing
export async function runHealthChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkWebsite(),
    checkBot(client),
    checkLastfm(),
    checkDatabase(prisma),
  ]);
}

export function buildStatusResponse(
  results: CheckResult[],
  history: DailyRecord[][],
): StatusResponse {
  const overall = deriveOverallStatus(results);
  const checkedAt = results[0]?.checkedAt.toISOString() ?? new Date().toISOString();

  return {
    overall,
    checkedAt,
    services: results.map((r, i) => ({
      name: r.service,
      status: r.status,
      responseTime: r.responseTime,
      history: history[i] ?? [],
    })),
  };
}

export default app;
