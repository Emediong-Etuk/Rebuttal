import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __rebuttalDb?: { db: DB; sql: postgres.Sql } };

function connect(url: string) {
  const sql = postgres(url, {
    // Serverless (Vercel) functions should hold one connection each; use the pooled connection string.
    max: Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 1 : 5)),
    // Render Postgres requires TLS on external connections; internal URLs work either way.
    ssl: /sslmode=require|render\.com|neon\.tech/.test(url) ? "require" : undefined,
    onnotice: () => {},
  });
  return { db: drizzle(sql, { schema }), sql };
}

export function getDb(): DB {
  if (!globalForDb.__rebuttalDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__rebuttalDb = connect(url);
  }
  return globalForDb.__rebuttalDb.db;
}

export async function closeDb() {
  await globalForDb.__rebuttalDb?.sql.end({ timeout: 5 });
  globalForDb.__rebuttalDb = undefined;
}

export { schema };
