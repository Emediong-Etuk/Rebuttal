// Spike: full pipeline with live sandbox reads AND live Claude (via OpenRouter in the dev container).
// Usage: tsx scripts/spike/12-pipeline-live-ai.ts <dispute_id>
import { eq } from "drizzle-orm";
import { upsertCase, runPipeline } from "@/agent/pipeline";
import { getDb, schema, closeDb } from "@/db";
import { getPayPal } from "@/paypal/client";

const id = process.argv[2]!;
const db = getDb();
const d = (await getPayPal().getDispute(id)).data;
const c = await upsertCase(d, db);
const t0 = Date.now();
const r = await runPipeline(c.id, { db, notify: async () => ({ sent: false, reason: "spike" }) });
console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(JSON.stringify({ analysis: r.analysis, ground: r.ground, decision: r.decision }, null, 1));
for (const e of await db.select().from(schema.timelineEvents).where(eq(schema.timelineEvents.caseId, c.id))) console.log(`- [${e.kind}] ${e.title}${e.endpoint ? ` <${e.endpoint}>` : ""}`);
await closeDb();
