import type { Client } from "discord.js";
import type { PrismaClient } from "@prisma/client";

export type ServiceName = "website" | "bot" | "lastfm" | "database";
export type StatusLabel = "operational" | "degraded" | "down";

export interface CheckResult {
  service: ServiceName;
  status: StatusLabel;
  responseTime: number; // ms, or -1 on timeout
  available: boolean;
  checkedAt: Date;
}

export interface DailyRecord {
  date: string; // 'YYYY-MM-DD'
  availability: number | null;
  highestStatus: StatusLabel | null;
  downtimeMinutes: number | null;
}

export interface ServiceStatus {
  name: ServiceName;
  status: StatusLabel;
  responseTime: number;
  history: DailyRecord[];
}

export interface StatusResponse {
  overall: "operational" | "degraded" | "outage";
  checkedAt: string;
  services: ServiceStatus[];
}

const TIMEOUT_MS = 8000;

function makeTimeout(): Promise<{
  status: "down";
  responseTime: -1;
  available: false;
}> {
  return new Promise((resolve) =>
    setTimeout(
      () => resolve({ status: "down", responseTime: -1, available: false }),
      TIMEOUT_MS,
    ),
  );
}

// 3.1 — Website probe
export async function checkWebsite(): Promise<CheckResult> {
  const start = Date.now();

  const probe = fetch("https://scrobbler.netlify.app", { method: "GET" })
    .then((res) => {
      const responseTime = Date.now() - start;
      const is2xx = res.status >= 200 && res.status < 300;

      if (is2xx && responseTime <= 3000) {
        return {
          status: "operational" as StatusLabel,
          responseTime,
          available: true,
        };
      } else if (is2xx && responseTime > 3000) {
        return {
          status: "degraded" as StatusLabel,
          responseTime,
          available: true,
        };
      } else {
        // 4xx / 5xx
        return {
          status: "degraded" as StatusLabel,
          responseTime,
          available: false,
        };
      }
    })
    .catch(() => {
      const responseTime = Date.now() - start;
      return {
        status: "degraded" as StatusLabel,
        responseTime,
        available: false,
      };
    });

  const result = await Promise.race([probe, makeTimeout()]);

  return {
    service: "website",
    status: result.status,
    responseTime: result.responseTime,
    available: result.available,
    checkedAt: new Date(),
  };
}

// 3.2 — Bot probe
export async function checkBot(client: Client): Promise<CheckResult> {
  const start = Date.now();
  const ready = client.isReady();
  const responseTime = Date.now() - start;

  return {
    service: "bot",
    status: ready ? "operational" : "down",
    responseTime,
    available: ready,
    checkedAt: new Date(),
  };
}

// 3.3 — Last.fm probe
export async function checkLastfm(): Promise<CheckResult> {
  const start = Date.now();

  const probe = fetch(
    "https://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=test&format=json",
    { method: "GET" },
  )
    .then((res) => {
      const responseTime = Date.now() - start;
      // Any HTTP response means the API is reachable
      if (responseTime <= 5000) {
        return {
          status: "operational" as StatusLabel,
          responseTime,
          available: true,
        };
      } else {
        return {
          status: "degraded" as StatusLabel,
          responseTime,
          available: true,
        };
      }
    })
    .catch(() => {
      const responseTime = Date.now() - start;
      return {
        status: "degraded" as StatusLabel,
        responseTime,
        available: false,
      };
    });

  const result = await Promise.race([probe, makeTimeout()]);

  return {
    service: "lastfm",
    status: result.status,
    responseTime: result.responseTime,
    available: result.available,
    checkedAt: new Date(),
  };
}

// 3.4 — Database probe
export async function checkDatabase(
  prisma: PrismaClient,
): Promise<CheckResult> {
  const start = Date.now();

  const probe = (prisma.$queryRaw`SELECT 1` as Promise<unknown>)
    .then(() => {
      const responseTime = Date.now() - start;
      if (responseTime <= 2000) {
        return {
          status: "operational" as StatusLabel,
          responseTime,
          available: true,
        };
      } else {
        return {
          status: "degraded" as StatusLabel,
          responseTime,
          available: true,
        };
      }
    })
    .catch(() => {
      const responseTime = Date.now() - start;
      return { status: "down" as StatusLabel, responseTime, available: false };
    });

  const result = await Promise.race([probe, makeTimeout()]);

  return {
    service: "database",
    status: result.status,
    responseTime: result.responseTime,
    available: result.available,
    checkedAt: new Date(),
  };
}

// 4.1 — Derive overall status from check results
export function deriveOverallStatus(
  results: CheckResult[],
): "operational" | "degraded" | "outage" {
  const downCount = results.filter((r) => r.status === "down").length;
  const degradedCount = results.filter((r) => r.status === "degraded").length;
  const totalCount = results.length;

  // If more than half of services are down, it's an outage
  if (downCount > totalCount / 2) {
    return "outage";
  }

  // If any service is down (but not majority), it's degraded
  if (downCount > 0) {
    return "degraded";
  }

  // If more than half of services are degraded, overall is degraded
  if (degradedCount > totalCount / 2) {
    return "degraded";
  }

  // Otherwise, system is operational (majority are operational)
  return "operational";
}

// 4.3 — Persist check results to database
export async function persistResults(
  prisma: PrismaClient,
  results: CheckResult[],
): Promise<void> {
  try {
    await prisma.statusRecord.createMany({
      data: results.map((result) => ({
        service: result.service,
        checkedAt: result.checkedAt,
        responseTime: result.responseTime,
        status: result.status,
        available: result.available,
      })),
    });
  } catch (error) {
    console.error("Failed to persist health check results:", error);
    // Do not crash - log and continue
  }
}
