// Spike: run the real pipeline (live sandbox reads via the toolkit) with a stand-in analyzer, since the
// Anthropic API is not reachable from the dev container. Usage: tsx scripts/spike/11-pipeline-local.ts <dispute_id>
import { eq } from "drizzle-orm";
import { upsertCase, runPipeline } from "@/agent/pipeline";
import { getDb, schema, closeDb } from "@/db";
import { getPayPal } from "@/paypal/client";
import type { Analyzer } from "@/agent/analyze";

const id = process.argv[2]!;
const db = getDb();
const d = (await getPayPal().getDispute(id)).data;
const c = await upsertCase(d, db);
const standIn: Analyzer = async ({ facts }) => {
  const tr = facts.find((f) => f.kind === "shipment_tracking");
  const t = (tr?.data as { trackers?: Array<{ tracking_number: string; carrier: string; shipment_date: string }> })?.trackers?.[0];
  return {
    modelId: "stand-in (spike only)",
    analysis: t
      ? { verdict: "CONTEST", confidence: 0.9, reasoning_summary: "Tracking is on file.", evidence_plan: [{ evidence_type: "PROOF_OF_FULFILLMENT", satisfiable: true, fact_ids: [tr!.id] }], rebuttal: [{ sentence: `The order shipped with ${t.carrier} under tracking number ${t.tracking_number} on ${t.shipment_date}.`, fact_ids: [tr!.id] }], missing: [] }
      : { verdict: "CONCEDE", confidence: 0.8, reasoning_summary: "No tracking.", evidence_plan: [], rebuttal: [], missing: [] },
  };
};
const r = await runPipeline(c.id, { db, analyzer: standIn, notify: async () => ({ sent: false, reason: "spike" }) });
console.log(JSON.stringify({ decision: r.decision, ground: r.ground }, null, 1));
for (const e of await db.select().from(schema.timelineEvents).where(eq(schema.timelineEvents.caseId, c.id))) console.log(`- [${e.kind}] ${e.title}${e.body ? ` :: ${e.body.slice(0, 160).replace(/\n/g, " | ")}` : ""}`);
await closeDb();
