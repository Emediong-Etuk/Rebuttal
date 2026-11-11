import { sql } from "drizzle-orm";
import { getDb, type DB } from "@/db";

/** Fixed-window rate limit backed by Postgres, so it holds across instances and restarts. */
export async function rateLimit(key: string, limit: number, windowSeconds: number, db: DB = getDb()): Promise<{ ok: boolean; remaining: number }> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = (await db.execute(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart.toISOString()}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`)) as unknown as Array<{ count: number }>;
  const count = Number(rows[0]?.count ?? limit + 1);
  return { ok: count <= limit, remaining: Math.max(0, limit - count) };
}

export function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || headers.get("x-real-ip") || "unknown";
}
