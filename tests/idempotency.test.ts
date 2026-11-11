import { beforeEach, describe, expect, it } from "vitest";
import "./helpers/db";
import { makeDispute, resetDb, schema } from "./helpers/db";
import { fakePayPal, fakeToolkit } from "./helpers/fakes";
import { executeAction } from "@/agent/executor";
import { runPipeline, upsertCase } from "@/agent/pipeline";
import { runDeadlineNet } from "@/agent/deadline";
import { consumeApproval } from "@/lib/approvals";
import type { Analyzer } from "@/agent/analyze";
import type { DB } from "@/db";

const contest: Analyzer = async ({ facts }) => {
  const t = facts.find((f) => f.kind === "shipment_tracking")!;
  return {
    modelId: "test",
    analysis: { verdict: "CONTEST", confidence: 0.9, reasoning_summary: "Tracking on file.", evidence_plan: [], rebuttal: [{ sentence: "The order shipped with USPS under tracking number 9400111202555842761049.", fact_ids: [t.id] }], missing: [] },
  };
};

let db: DB;
beforeEach(async () => {
  db = await resetDb();
});

async function preparedCase(dispute = makeDispute()) {
  const paypal = fakePayPal(dispute, { delayMs: 30 });
  const c = await upsertCase(dispute, db);
  await runPipeline(c.id, { db, paypal, toolkit: fakeToolkit(dispute), analyzer: contest, notify: async () => ({ sent: false }) });
  return { c, paypal };
}

describe("idempotency", () => {
  it("a concurrent double approval produces exactly one PayPal call", async () => {
    const { c, paypal } = await preparedCase();
    const [tok] = await db.select().from(schema.approvalTokens);
    // Two taps that both got past the approval check (worst case), racing into the executor.
    const runs = await Promise.all(Array.from({ length: 6 }, () => executeAction({ caseId: c.id, action: "PROVIDE_EVIDENCE", actor: "seller", approval: { jti: tok!.jti } }, { db, paypal })));
    expect(paypal.writes).toEqual(["provide-evidence"]);
    expect(runs.filter((r) => r.status === "SUCCEEDED")).toHaveLength(1);
    expect(await db.select().from(schema.actions)).toHaveLength(1);
  });

  it("the same request ID is sent to PayPal for the same case, action and draft", async () => {
    const { c, paypal } = await preparedCase();
    await executeAction({ caseId: c.id, action: "PROVIDE_EVIDENCE", actor: "seller", approval: { jti: "x" } }, { db, paypal });
    const reqId = (paypal.provideEvidence.mock.calls[0] as unknown[])[2];
    const [row] = await db.select().from(schema.actions);
    expect(reqId).toBe(row!.requestId);
  });

  it("seller tap and cron overlap: still one PayPal call", async () => {
    const due = new Date(Date.now() + 5 * 3_600_000).toISOString(); // 5h left: inside the cron window
    const { c, paypal } = await preparedCase(makeDispute({ seller_response_due_date: due }));
    const [tok] = await db.select().from(schema.approvalTokens);
    await Promise.all([
      executeAction({ caseId: c.id, action: "PROVIDE_EVIDENCE", actor: "seller", approval: { jti: tok!.jti } }, { db, paypal }),
      runDeadlineNet({ db, paypal, notify: async () => ({ sent: false }) }),
      runDeadlineNet({ db, paypal, notify: async () => ({ sent: false }) }),
    ]);
    expect(paypal.writes).toEqual(["provide-evidence"]);
  });

  it("an approval link can only be consumed once, so a repeated POST never reaches PayPal twice", async () => {
    const { c } = await preparedCase();
    const [tok] = await db.select().from(schema.approvalTokens);
    expect(tok).toBeDefined();
    const { encodeToken } = await import("@/lib/approvals");
    const token = encodeToken({ jti: tok!.jti, c: c.id, a: "PROVIDE_EVIDENCE", v: tok!.draftVersion, exp: tok!.expiresAt.getTime() });
    const results = await Promise.all([1, 2, 3].map(() => consumeApproval(token, { caseId: c.id, action: "PROVIDE_EVIDENCE" }, db)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
