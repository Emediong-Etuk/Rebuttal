// Applies SQL migrations in ./drizzle. Run on every deploy (Render pre-deploy command).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Prefer a direct (unpooled) connection for DDL when the host provides one (Neon on Vercel does).
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { max: 1, ssl: /sslmode=require|render\.com|neon\.tech/.test(url) ? "require" : undefined, onnotice: () => {} });
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
await sql.end();
console.log("migrations applied");
