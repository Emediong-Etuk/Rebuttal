import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db";
import type { ActionKind, Case } from "@/db/schema";
import { getPayPal, type PayPalClient } from "@/paypal/client";
import { buyerClaimText, type Dispute } from "@/paypal/types";
import { approvalUrl, issueApproval } from "@/lib/approvals";
import { audit, timeline } from "@/lib/record";
import { buildSellerMessage } from "@/notify/message";
import { sendTelegram } from "@/notify/telegram";
import { createClaudeAnalyzer, modelLabel, type Analyzer } from "./analyze";
import { concedeCap, decisionFor, loadFacts } from "./executor";
import { FactStore, investigate } from "./facts";
import { groundCheck, type GroundCheckResult } from "./groundCheck";
import type { PolicyDecision } from "./policy";
import type { Analysis, FactRecord } from "./schema";
import { createReadOnlyToolkit, type ReadToolkit } from "./toolkit";

export type PipelineDeps = {
  db?: DB;
  paypal?: Pick<PayPalClient, "getDispute" | "getCapture" | "accessToken">;
  toolkit?: ReadToolkit;
  analyzer?: Analyzer;
  notify?: typeof sendTelegram;
  now?: Date;
};

export function appUrl(path = ""): string {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}

/** Create or refresh the case row from PayPal's dispute. */
export async function upsertCase(dispute: Dispute, db: DB, extra: Partial<Case> = {}): Promise<Case> {
  const values = {
    reason: dispute.reason,
    paypalStatus: dispute.status,
    lifecycleStage: dispute.dispute_life_cycle_stage ?? null,
    amountValue: dispute.dispute_amount?.value ?? null,
    amountCurrency: dispute.dispute_amount?.currency_code ?? null,
    sellerResponseDueDate: dispute.seller_response_due_date ? new Date(dispute.seller_response_due_date) : null,
    buyerClaim: buyerClaimText(dispute) || null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(schema.cases)
    .values({ id: randomUUID(), disputeId: dispute.dispute_id, mode: "LIVE", ...values, ...extra })
    .onConflictDoUpdate({ target: schema.cases.disputeId, set: { ...values, ...extra } })
    .returning();
  return row!;
}

const ANALYSIS_SUMMARY = (a: Analysis) => `${a.verdict} (${Math.round(a.confidence * 100)}% confident)`;

/**
 * The agent pipeline for one dispute. Every step is persisted as a timeline event.
 * 1 gather facts (read-only toolkit) -> 2 analyse (Claude, Zod-validated) -> 3 ground-check (deterministic,
 * one retry) -> 4 policy (deterministic) -> 5 notify the seller with one primary button.
 * Execution (step 6) happens later in executor.ts, on approval or via the deadline net.
 */
export async function runPipeline(caseId: string, deps: PipelineDeps = {}) {
  const db = deps.db ?? getDb();
  const paypal = deps.paypal ?? getPayPal();
  const now = deps.now ?? new Date();
  const [c0] = await db.select().from(schema.cases).where(eq(schema.cases.id, caseId));
  if (!c0) throw new Error(`case ${caseId} not found`);

  await db.update(schema.cases).set({ state: "ANALYSING", updatedAt: now }).where(eq(schema.cases.id, caseId));

  // 1. Gather facts with the read-only toolkit.
  const token = await paypal.accessToken();
  const toolkit =
    deps.toolkit ??
    createReadOnlyToolkit({ clientId: process.env.PAYPAL_CLIENT_ID ?? "", clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "", accessToken: token, sandbox: !/api-m\.paypal\.com/.test(process.env.PAYPAL_BASE_URL ?? "") });
  const store = new FactStore();
  let dispute: Dispute;
  try {
    dispute = await investigate(store, toolkit, c0.disputeId, async (captureId) => {
      const r = await paypal.getCapture(captureId);
      return ((r.data as { supplementary_data?: { related_ids?: { order_id?: string } } }).supplementary_data?.related_ids?.order_id as string | undefined) ?? null;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(schema.cases).set({ state: "FAILED", updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
    await timeline({ caseId, kind: "error", actor: "system", title: "Could not read the case from PayPal", body: `${msg} Rebuttal will try again on the next update.` }, db);
    throw e;
  }
  const c = await upsertCase(dispute, db);

  await timeline(
    {
      caseId,
      kind: "facts",
      actor: "agent",
      title: `Gathered ${store.all.length} facts from PayPal`,
      body: store.calls.map((x) => `${x.ok ? "✓" : "✗"} ${x.tool}${x.ok ? ` → ${x.factIds.join(", ")}` : ` (${x.error})`}`).join("\n"),
      endpoint: [...new Set(store.calls.map((x) => x.endpoint))].join(" · "),
      detail: { calls: store.calls },
    },
    db,
  );

  // 2 + 3. Analyse, ground-check, retry once with the errors, else fall back to manual review.
  const analyzer = deps.analyzer ?? createClaudeAnalyzer({ toolkit, store });
  let analysis: Analysis | null = null;
  let ground: GroundCheckResult = { ok: false, issues: [], checkedSentences: 0 };
  let modelId = "";
  let feedback: string[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await analyzer({ facts: store.all, reason: dispute.reason, feedback });
      analysis = r.analysis;
      modelId = r.modelId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await timeline({ caseId, kind: "error", actor: "model", title: "The AI step failed", body: msg }, db);
      await audit({ caseId, actor: "model", action: "analyse", decision: "ERROR", data: { message: msg } }, db);
      analysis = null;
      break;
    }
    ground = groundCheck(analysis, store.all);
    await audit({ caseId, actor: "model", action: "analyse", decision: analysis.verdict, input: { facts: store.all, feedback }, data: { attempt, modelId, analysis } }, db);
    await timeline(
      {
        caseId,
        kind: "verdict",
        actor: "model",
        title: `Verdict: ${ANALYSIS_SUMMARY(analysis)}`,
        body: analysis.reasoning_summary,
        endpoint: deps.analyzer ? `analyzer: ${modelId}` : `${modelLabel()} (served: ${modelId})`,
        detail: { attempt, analysis },
      },
      db,
    );
    await timeline(
      {
        caseId,
        kind: "ground_check",
        actor: "system",
        title: ground.ok ? `Ground-check passed (${ground.checkedSentences} sentences, every claim traced to a fact)` : `Ground-check failed (${ground.issues.length} problem${ground.issues.length === 1 ? "" : "s"})`,
        body: ground.ok ? null : ground.issues.map((i) => i.detail).join("\n"),
        detail: ground,
      },
      db,
    );
    if (ground.ok) break;
    feedback = ground.issues.map((i) => i.detail);
    if (attempt === 2) {
      await timeline({ caseId, kind: "ground_check", actor: "system", title: "Draft rejected twice; sending to manual review", body: "Rebuttal will not send PayPal anything it cannot trace to a fetched record." }, db);
      analysis = { ...analysis, verdict: "MANUAL_REVIEW", rebuttal: [] };
      ground = { ok: false, issues: ground.issues, checkedSentences: 0 };
    }
  }

  // Persist facts as a fresh snapshot for this draft.
  await db.delete(schema.facts).where(eq(schema.facts.caseId, caseId));
  if (store.all.length) {
    await db.insert(schema.facts).values(
      store.all.map((f: FactRecord) => ({ caseId, factId: f.id, kind: f.kind, source: f.source, fetchedAt: new Date(f.fetchedAt), data: f.data as never, tool: f.source.match(/toolkit: (\w+)/)?.[1] ?? null })),
    );
  }

  // 4. Policy.
  const draftVersion = c.draftVersion + 1;
  const updated = {
    verdict: analysis?.verdict ?? null,
    confidence: analysis ? analysis.confidence.toFixed(3) : null,
    reasoningSummary: analysis?.reasoning_summary ?? null,
    analysis: (analysis ?? null) as never,
    groundCheck: ground as never,
    draftVersion,
  };
  const caseForPolicy = { ...c, ...updated } as Case;
  const decision: PolicyDecision = decisionFor(caseForPolicy, dispute, store.all, await concedeCap(db), now);
  const state =
    decision.action === "PROVIDE_EVIDENCE" || decision.action === "SEND_MESSAGE" || decision.action === "ACCEPT_CLAIM"
      ? "AWAITING_SELLER"
      : decision.action === "ASK_SELLER"
        ? "NEEDS_INPUT"
        : decision.action === "NONE"
          ? "RESOLVED"
          : decision.action === "WAIT"
            ? "RESPONDED"
            : "MANUAL_REVIEW";
  await db.update(schema.cases).set({ ...updated, policy: decision as never, state, updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
  await audit({ caseId, actor: "policy", action: "decide", decision: decision.action, input: { verdict: updated.verdict, ground: ground.ok, status: dispute.status, links: dispute.links.map((l) => l.rel), due: dispute.seller_response_due_date }, data: decision }, db);
  await timeline({ caseId, kind: "policy", actor: "policy", title: `Policy: ${decision.action.replace(/_/g, " ").toLowerCase()}`, body: `${decision.explanation} (rule: ${decision.rule})`, detail: decision }, db);

  // 5. Notify the seller: one message, one primary button.
  let link: string | null = null;
  if (decision.action === "PROVIDE_EVIDENCE" || decision.action === "SEND_MESSAGE" || decision.action === "ACCEPT_CLAIM") {
    link = approvalUrl(await issueApproval(caseId, decision.action as ActionKind, draftVersion, db));
  }
  const msg = buildSellerMessage({
    amount: c.amountValue,
    currency: c.amountCurrency,
    buyerClaim: c.buyerClaim,
    reasoningSummary: analysis?.reasoning_summary ?? null,
    decision,
    due: c.sellerResponseDueDate,
    approvalLink: link,
    caseLink: appUrl(`/cases/${caseId}`),
    missing: analysis?.missing,
    now,
  });
  const sent = await (deps.notify ?? sendTelegram)(msg);
  await timeline(
    {
      caseId,
      kind: "notify",
      actor: "system",
      title: sent.sent ? "Seller notified on Telegram" : "Seller message ready",
      body: msg.text,
      detail: { message: msg, telegram: sent },
    },
    db,
  );
  return { caseId, decision, analysis, ground };
}

/**
 * Telegram plain-text reply with a tracking number. Rebuttal does not cite the chat text directly:
 * it adds the tracking to the PayPal transaction (Add Tracking API), then re-runs the pipeline, which
 * re-fetches it from PayPal. Evidence therefore always traces to a PayPal-held record.
 */
export async function sellerProvidedTracking(
  caseId: string,
  carrier: string,
  trackingNumber: string,
  deps: PipelineDeps & { tracker?: Pick<PayPalClient, "addTracking"> } = {},
) {
  const db = deps.db ?? getDb();
  const facts = await loadFacts(caseId, db);
  const disputeFact = facts.find((f) => f.kind === "dispute")?.data as { disputed_transactions?: Array<{ seller_transaction_id?: string }> } | undefined;
  const txId = disputeFact?.disputed_transactions?.[0]?.seller_transaction_id;
  await timeline({ caseId, kind: "seller_input", actor: "seller", title: "Seller replied with a tracking number", body: `${carrier} ${trackingNumber}` }, db);
  await audit({ caseId, actor: "seller", action: "supply_tracking", input: { carrier, trackingNumber } }, db);
  if (!txId) {
    await timeline({ caseId, kind: "error", actor: "system", title: "Could not attach tracking", body: "The disputed transaction ID is unknown. Open the case in PayPal and add tracking there." }, db);
    return null;
  }
  const tracker = deps.tracker ?? getPayPal();
  try {
    const r = await tracker.addTracking({ transactionId: txId, trackingNumber, carrier, status: "SHIPPED" });
    await timeline({ caseId, kind: "action", actor: "seller", title: "Tracking added to the PayPal transaction", body: `${carrier} ${trackingNumber} on ${txId}`, endpoint: r.endpoint, debugId: r.debugId }, db);
  } catch (e) {
    const err = e as { message?: string; debugId?: string; endpoint?: string };
    await timeline({ caseId, kind: "error", actor: "system", title: "PayPal did not accept the tracking number", body: `${err.message ?? e} Check the number and reply again.`, endpoint: err.endpoint ?? null, debugId: err.debugId ?? null }, db);
    return null;
  }
  return runPipeline(caseId, deps);
}

/** Most recent case waiting for seller input (Telegram replies are matched to it). */
export async function latestCaseNeedingInput(db: DB = getDb()) {
  const rows = await db.select().from(schema.cases).where(like(schema.cases.state, "NEEDS_INPUT"));
  return rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
}
