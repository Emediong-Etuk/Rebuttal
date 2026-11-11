import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db";
import type { ActionKind, Case } from "@/db/schema";
import { getPayPal, PayPalError, type PayPalClient } from "@/paypal/client";
import { hasLink, type Dispute } from "@/paypal/types";
import { audit, timeline } from "@/lib/record";
import { trackingFromFacts } from "./facts";
import { authorizeExecution, decide, type Actor, type PolicyDecision } from "./policy";
import type { Analysis, FactRecord, Verdict } from "./schema";

export type PayPalWrites = Pick<PayPalClient, "getDispute" | "provideEvidence" | "sendMessage" | "acceptClaim">;

export type ExecuteResult =
  | { status: "SUCCEEDED"; debugId: string | null; paypalStatus: string | null }
  | { status: "DUPLICATE"; existingStatus: string }
  | { status: "REJECTED"; reason: string }
  | { status: "FAILED"; error: string; debugId: string | null };

export function requestIdFor(caseId: string, action: ActionKind, draftVersion: number): string {
  return createHash("sha256").update(`rebuttal:${caseId}:${action}:v${draftVersion}`).digest("hex").slice(0, 36);
}

export async function loadFacts(caseId: string, db: DB): Promise<FactRecord[]> {
  const rows = await db.select().from(schema.facts).where(eq(schema.facts.caseId, caseId));
  return rows
    .map((r) => ({ id: r.factId, kind: r.kind, source: r.source, fetchedAt: r.fetchedAt.toISOString(), data: r.data }))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

export async function concedeCap(db: DB): Promise<number> {
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.id, "default"));
  return Number(s?.concedeCap ?? process.env.CONCEDE_CAP ?? 100);
}

/** Recompute the policy decision from PayPal's live view of the dispute (the source of truth). */
export function decisionFor(c: Case, dispute: Dispute, facts: FactRecord[], cap: number, now = new Date()): PolicyDecision {
  const ground = c.groundCheck as { ok?: boolean } | null;
  return decide({
    verdict: (c.verdict as Verdict | null) ?? null,
    groundCheckOk: ground?.ok === true,
    reason: dispute.reason,
    status: dispute.status,
    linkRels: dispute.links.map((l) => l.rel),
    sellerResponseDueDate: dispute.seller_response_due_date ?? null,
    amount: dispute.dispute_amount ? Number(dispute.dispute_amount.value) : null,
    concedeCap: cap,
    hasTrackingFact: trackingFromFacts(facts) !== null,
    now,
  });
}

/**
 * The only path that writes to PayPal. Order of checks:
 * 1. Re-fetch the dispute; PayPal's `links` must offer the action.
 * 2. Policy engine recomputes the decision; authorizeExecution checks actor + approval.
 * 3. Insert an `actions` row keyed by a deterministic request ID. The unique index makes concurrent
 *    double taps, repeated webhooks and overlapping cron runs collapse to one PayPal call.
 * 4. Call PayPal with the same key as PayPal-Request-Id, so PayPal also deduplicates.
 */
export async function executeAction(
  args: { caseId: string; action: ActionKind; actor: Actor; approval?: { jti: string; typedAmount?: string | null } | null },
  deps: { db?: DB; paypal?: PayPalWrites; now?: Date } = {},
): Promise<ExecuteResult> {
  const db = deps.db ?? getDb();
  const paypal = deps.paypal ?? getPayPal();
  const now = deps.now ?? new Date();

  const [c] = await db.select().from(schema.cases).where(eq(schema.cases.id, args.caseId));
  if (!c) return { status: "REJECTED", reason: "Case not found." };

  const requestId = requestIdFor(c.id, args.action, c.draftVersion);
  const [existing] = await db.select().from(schema.actions).where(eq(schema.actions.requestId, requestId));
  if (existing && existing.status !== "FAILED") return { status: "DUPLICATE", existingStatus: existing.status };

  const fresh = await paypal.getDispute(c.disputeId);
  const dispute = fresh.data;
  const facts = await loadFacts(c.id, db);
  const decision = decisionFor(c, dispute, facts, await concedeCap(db), now);
  const amount = dispute.dispute_amount ? Number(dispute.dispute_amount.value) : null;

  const auth = authorizeExecution({
    decision,
    action: args.action,
    actor: args.actor,
    amount,
    approval: args.approval ? { jti: args.approval.jti, action: args.action, typedAmount: args.approval.typedAmount } : null,
  });
  const linkRel = { PROVIDE_EVIDENCE: "provide_evidence", SEND_MESSAGE: "send_message", ACCEPT_CLAIM: "accept_claim" }[args.action];
  if (auth.allowed && !hasLink(dispute, linkRel)) Object.assign(auth, { allowed: false, reason: `PayPal no longer offers ${linkRel} on this case.` });

  await audit({ caseId: c.id, actor: args.actor === "seller" ? "seller" : args.actor === "cron" ? "cron" : "system", action: `authorize:${args.action}`, decision: auth.allowed ? "ALLOW" : "DENY", input: { decision, actor: args.actor, approval: args.approval?.jti ?? null }, data: { reason: auth.reason } }, db);
  if (!auth.allowed) {
    await timeline({ caseId: c.id, kind: "policy_block", actor: "policy", title: "Action blocked by policy", body: auth.reason, detail: { action: args.action, actor: args.actor, decision } }, db);
    return { status: "REJECTED", reason: auth.reason };
  }

  // Build the payload deterministically from facts. Model text is used only for the notes, and those
  // notes passed the ground-check.
  const analysis = c.analysis as Analysis | null;
  const notes = (analysis?.rebuttal ?? []).map((s) => s.sentence).join(" ").slice(0, 2000);
  let payload: unknown;
  if (args.action === "PROVIDE_EVIDENCE") {
    const t = trackingFromFacts(facts);
    if (!t) return { status: "REJECTED", reason: "No PayPal shipment record to send." };
    payload = { evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: t.carrier_name, tracking_number: t.tracking_number }] }, notes }] };
  } else if (args.action === "SEND_MESSAGE") {
    payload = { message: notes };
  } else {
    payload = { note: "The seller accepted this claim and agreed to refund the buyer in full.", accept_claim_type: "REFUND" };
  }

  // Claim the idempotency key. Only one caller gets a row back.
  const inserted = existing
    ? await db
        .update(schema.actions)
        .set({ status: "PENDING", actor: args.actor, approvalJti: args.approval?.jti ?? null, payload: payload as never, error: null })
        .where(and(eq(schema.actions.requestId, requestId), eq(schema.actions.status, "FAILED")))
        .returning({ id: schema.actions.id })
    : await db
        .insert(schema.actions)
        .values({ caseId: c.id, action: args.action, requestId, actor: args.actor, approvalJti: args.approval?.jti ?? null, payload: payload as never })
        .onConflictDoNothing({ target: schema.actions.requestId })
        .returning({ id: schema.actions.id });
  if (!inserted.length) return { status: "DUPLICATE", existingStatus: "PENDING" };
  const actionId = inserted[0]!.id;

  await db.update(schema.cases).set({ state: "SUBMITTING", updatedAt: now }).where(eq(schema.cases.id, c.id));

  try {
    const res =
      args.action === "PROVIDE_EVIDENCE"
        ? await paypal.provideEvidence(c.disputeId, payload as never, requestId)
        : args.action === "SEND_MESSAGE"
          ? await paypal.sendMessage(c.disputeId, (payload as { message: string }).message, requestId)
          : await paypal.acceptClaim(c.disputeId, payload as never, requestId);

    await db.update(schema.actions).set({ status: "SUCCEEDED", response: res.data as never, debugId: res.debugId, completedAt: new Date() }).where(eq(schema.actions.id, actionId));

    // Re-fetch so the timeline shows PayPal's resulting status.
    const after = await paypal.getDispute(c.disputeId).catch(() => null);
    const paypalStatus = after?.data.status ?? null;
    await db
      .update(schema.cases)
      .set({ state: args.action === "ACCEPT_CLAIM" ? "CONCEDED" : "RESPONDED", paypalStatus: paypalStatus ?? c.paypalStatus, updatedAt: new Date() })
      .where(eq(schema.cases.id, c.id));

    const titles: Record<ActionKind, string> = { PROVIDE_EVIDENCE: "Evidence sent to PayPal", SEND_MESSAGE: "Message sent to the buyer", ACCEPT_CLAIM: "Claim accepted; PayPal refunds the buyer" };
    await timeline({ caseId: c.id, kind: "action", actor: args.actor, title: titles[args.action], body: paypalStatus ? `PayPal status is now ${paypalStatus}.` : null, endpoint: res.endpoint, debugId: res.debugId, detail: { requestId, payload } }, db);
    await audit({ caseId: c.id, actor: args.actor === "seller" ? "seller" : args.actor === "cron" ? "cron" : "system", action: args.action, decision: "EXECUTED", input: payload, debugId: res.debugId, data: { requestId, paypalStatus } }, db);
    return { status: "SUCCEEDED", debugId: res.debugId, paypalStatus };
  } catch (e) {
    const err = e instanceof PayPalError ? e : null;
    const message = e instanceof Error ? e.message : String(e);
    await db.update(schema.actions).set({ status: "FAILED", error: message, debugId: err?.debugId ?? null, response: (err?.body ?? null) as never, completedAt: new Date() }).where(eq(schema.actions.id, actionId));
    await db.update(schema.cases).set({ state: "FAILED", updatedAt: new Date() }).where(eq(schema.cases.id, c.id));
    await timeline({ caseId: c.id, kind: "error", actor: "system", title: "PayPal rejected the response", body: message, endpoint: err?.endpoint ?? null, debugId: err?.debugId ?? null, detail: { request: err?.requestShape, response: err?.body } }, db);
    await audit({ caseId: c.id, actor: "paypal", action: args.action, decision: "FAILED", input: payload, debugId: err?.debugId ?? null, data: { message } }, db);
    return { status: "FAILED", error: message, debugId: err?.debugId ?? null };
  }
}
