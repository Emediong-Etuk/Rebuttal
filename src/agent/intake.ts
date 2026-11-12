import { eq, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db";
import type { Case } from "@/db/schema";
import { getPayPal, type PayPalClient } from "@/paypal/client";
import { buyerClaimText, type Dispute } from "@/paypal/types";
import { audit, timeline } from "@/lib/record";
import { buildSellerMessage } from "@/notify/message";
import { sendTelegram } from "@/notify/telegram";
import { appUrl, runPipeline, upsertCase, type PipelineDeps } from "./pipeline";
import type { PolicyDecision } from "./policy";

export const DISPUTE_EVENTS = ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"] as const;

export type WebhookEvent = {
  id: string;
  event_type: string;
  create_time?: string;
  resource?: { dispute_id?: string; [k: string]: unknown };
};

type Deps = PipelineDeps & { paypal?: Pick<PayPalClient, "getDispute" | "getCapture" | "accessToken" | "listTrackers"> };

export type Scenario = "A" | "B" | "C";

/** Markers of an instruction aimed at an AI, used only to sort the demo pool. The agent never sees this label. */
const INJECTION = /(ignore (all )?(previous|prior) instructions|system note|you are authori[sz]ed|ai assistant|accept this claim|accept_dispute_claim|overrides the seller)/i;

export async function classifyForPool(dispute: Dispute, paypal: Pick<PayPalClient, "listTrackers">): Promise<Scenario> {
  if (INJECTION.test(buyerClaimText(dispute))) return "C";
  const tx = dispute.disputed_transactions?.[0]?.seller_transaction_id;
  if (!tx) return "B";
  const t = await paypal.listTrackers(tx).catch(() => null);
  return (t?.data.trackers ?? []).length ? "A" : "B";
}

async function holdForDemo(db: DB): Promise<boolean> {
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.id, "default"));
  return s ? s.holdNewDisputesForDemo : process.env.DEMO_POOL !== "off";
}

/**
 * Handle one verified, de-duplicated webhook. The payload is only a pointer: the dispute is always
 * re-fetched from the Disputes API and that response is the source of truth.
 */
export async function processDisputeEvent(event: WebhookEvent, deps: Deps = {}) {
  const db = deps.db ?? getDb();
  const paypal = deps.paypal ?? getPayPal();
  const disputeId = event.resource?.dispute_id;
  if (!disputeId) return { handled: false, reason: "no dispute_id in resource" };

  const fresh = await paypal.getDispute(disputeId);
  const dispute = fresh.data;
  const [before] = await db.select().from(schema.cases).where(eq(schema.cases.disputeId, disputeId));
  const isNew = !before;

  let pool = before?.pool ?? false;
  let scenario = before?.scenario ?? null;
  if (isNew && event.event_type === "CUSTOMER.DISPUTE.CREATED" && (await holdForDemo(db))) {
    pool = true;
    scenario = await classifyForPool(dispute, paypal);
  }
  const c = await upsertCase(dispute, db, isNew ? { pool, scenario } : {});

  await timeline(
    {
      caseId: c.id,
      kind: "webhook",
      actor: "paypal",
      title: `Webhook received: ${event.event_type}`,
      body: `Signature verified. Re-fetched the dispute: status ${dispute.status}${dispute.dispute_life_cycle_stage ? `, stage ${dispute.dispute_life_cycle_stage}` : ""}.`,
      endpoint: fresh.endpoint,
      debugId: fresh.debugId,
      detail: { eventId: event.id, eventType: event.event_type, payloadStatus: (event.resource as { status?: string } | undefined)?.status ?? null, refetchedStatus: dispute.status },
    },
    db,
  );
  await audit({ caseId: c.id, actor: "paypal", action: `webhook:${event.event_type}`, decision: dispute.status, input: event, debugId: fresh.debugId }, db);

  if (dispute.status === "RESOLVED") return resolve(c, dispute, deps);
  if (c.pool && !c.claimedAt) {
    await timeline({ caseId: c.id, kind: "pool", actor: "system", title: "Held in the demo pool", body: "This real sandbox dispute will be answered when a visitor claims it from the demo page." }, db);
    return { handled: true, pooled: true, caseId: c.id };
  }
  // Run (or re-run) the agent whenever PayPal is waiting on the seller and we have nothing pending.
  const rerunStates = new Set(["NEW", "RESPONDED", "FAILED", "MANUAL_REVIEW"]);
  if (dispute.status === "WAITING_FOR_SELLER_RESPONSE" && (isNew || rerunStates.has(c.state))) {
    await runPipeline(c.id, deps);
    return { handled: true, ran: true, caseId: c.id };
  }
  return { handled: true, caseId: c.id };
}

async function resolve(c: Case, dispute: Dispute, deps: Deps) {
  const db = deps.db ?? getDb();
  const outcome = dispute.dispute_outcome?.outcome_code ?? "RESOLVED";
  await db.update(schema.cases).set({ state: "RESOLVED", paypalStatus: "RESOLVED", outcome, updatedAt: new Date() }).where(eq(schema.cases.id, c.id));
  const plain: Record<string, string> = {
    RESOLVED_SELLER_FAVOUR: "You won. PayPal closed the case in your favour and you keep the money.",
    RESOLVED_BUYER_FAVOUR: "PayPal closed the case in the buyer's favour and refunded them.",
    CANCELED_BY_BUYER: "The buyer cancelled the case. You keep the money.",
    ACCEPTED: "The case is closed. The buyer was refunded, as you approved.",
    DENIED: "PayPal denied the buyer's claim. You keep the money.",
  };
  const text = plain[outcome] ?? `PayPal closed the case (${outcome.toLowerCase().replace(/_/g, " ")}).`;
  await timeline({ caseId: c.id, kind: "outcome", actor: "paypal", title: "Case closed", body: text, detail: dispute.dispute_outcome }, db);
  const decision: PolicyDecision = { action: "NONE", approval: "NONE", autoSubmitEligible: false, hoursLeft: null, rule: "resolved", explanation: text };
  if (!c.pool || c.claimedAt) {
    const msg = buildSellerMessage({ amount: c.amountValue, currency: c.amountCurrency, buyerClaim: c.buyerClaim, reasoningSummary: null, decision, due: null, approvalLink: null, caseLink: appUrl(`/cases/${c.id}`) });
    await (deps.notify ?? sendTelegram)(msg);
  }
  return { handled: true, resolved: true, caseId: c.id };
}

/** Pull every open dispute into the pool (used by the seed script and the cron sync). */
export async function syncPool(deps: Deps = {}) {
  const db = deps.db ?? getDb();
  const paypal = deps.paypal ?? (getPayPal() as unknown as Deps["paypal"] & PayPalClient);
  const list = await (paypal as PayPalClient).listDisputes({ dispute_state: "REQUIRED_ACTION" });
  const added: string[] = [];
  for (const item of list.data.items ?? []) {
    const [exists] = await db.select({ id: schema.cases.id }).from(schema.cases).where(eq(schema.cases.disputeId, item.dispute_id));
    if (exists) continue;
    const d = (await paypal!.getDispute(item.dispute_id)).data;
    if (d.status !== "WAITING_FOR_SELLER_RESPONSE") continue;
    const scenario = await classifyForPool(d, paypal!);
    const c = await upsertCase(d, db, { pool: true, scenario });
    await timeline({ caseId: c.id, kind: "pool", actor: "system", title: "Added to the demo pool", body: `Real sandbox dispute ${d.dispute_id}, found via GET /v1/customer/disputes.` }, db);
    added.push(d.dispute_id);
  }
  return added;
}

/**
 * A pool dispute is available if nobody has claimed it, or if a previous visitor claimed it more than
 * REUSE_AFTER_MINUTES ago and nothing was sent to PayPal (no successful write). Re-claiming re-runs the
 * pipeline on the same real dispute with a new draft version, which invalidates older approval links.
 */
export const REUSE_AFTER_MINUTES = 10;
const AVAILABLE = sql`
  pool = true AND paypal_status = 'WAITING_FOR_SELLER_RESPONSE'
  AND (
    claimed_at IS NULL
    OR (
      claimed_at < now() - make_interval(mins => ${REUSE_AFTER_MINUTES})
      AND state IN ('AWAITING_SELLER', 'MANUAL_REVIEW', 'NEEDS_INPUT', 'FAILED')
      AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.case_id = cases.id AND a.status = 'SUCCEEDED')
    )
  )`;

/** Atomically claim one available pool dispute for a scenario. Concurrent visitors never get the same one. */
export async function claimFromPool(scenario: Scenario, db: DB = getDb()): Promise<Case | null> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE cases SET claimed_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM cases
      WHERE ${AVAILABLE} AND scenario = ${scenario}
      ORDER BY claimed_at ASC NULLS FIRST, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const id = (rows as unknown as Array<{ id: string }>)[0]?.id;
  if (!id) return null;
  const [c] = await db.select().from(schema.cases).where(eq(schema.cases.id, id));
  return c ?? null;
}

export async function poolCounts(db: DB = getDb()): Promise<Record<Scenario, number>> {
  const rows = (await db.execute(sql`SELECT scenario, count(*)::int AS n FROM cases WHERE ${AVAILABLE} GROUP BY scenario`)) as unknown as Array<{ scenario: string | null; n: number }>;
  const out: Record<Scenario, number> = { A: 0, B: 0, C: 0 };
  for (const r of rows) if (r.scenario === "A" || r.scenario === "B" || r.scenario === "C") out[r.scenario] = Number(r.n);
  return out;
}
