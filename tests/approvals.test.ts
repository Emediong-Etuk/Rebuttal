import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import "./helpers/db";
import { resetDb, schema } from "./helpers/db";
import { APPROVAL_TTL_MS, consumeApproval, decodeToken, encodeToken, inspectApproval, issueApproval } from "@/lib/approvals";
import type { DB } from "@/db";

let db: DB;
let caseId: string;

beforeEach(async () => {
  db = await resetDb();
  caseId = randomUUID();
  await db.insert(schema.cases).values({ id: caseId, disputeId: `PP-${caseId.slice(0, 8)}`, mode: "LIVE", draftVersion: 1 });
});

describe("approval links", () => {
  it("a valid token inspects OK and is consumed exactly once", async () => {
    const t = await issueApproval(caseId, "ACCEPT_CLAIM", 1, db);
    expect((await inspectApproval(t, db)).ok).toBe(true);
    expect((await consumeApproval(t, { caseId, action: "ACCEPT_CLAIM" }, db)).ok).toBe(true);
    const again = await consumeApproval(t, { caseId, action: "ACCEPT_CLAIM" }, db);
    expect(again).toEqual({ ok: false, error: "USED" });
  });

  it("inspecting (what a GET / link preview does) never consumes the token", async () => {
    const t = await issueApproval(caseId, "PROVIDE_EVIDENCE", 1, db);
    for (let i = 0; i < 5; i++) expect((await inspectApproval(t, db)).ok).toBe(true);
    const [row] = await db.select().from(schema.approvalTokens);
    expect(row!.usedAt).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const t = await issueApproval(caseId, "PROVIDE_EVIDENCE", 1, db);
    const [body, sig] = t.split(".") as [string, string];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, a: "ACCEPT_CLAIM" })).toString("base64url");
    expect(decodeToken(`${forgedBody}.${sig}`)).toEqual({ ok: false, error: "BAD_SIGNATURE" });
    expect(decodeToken(`${body}.${sig.slice(0, -2)}xx`).ok).toBe(false);
    expect(decodeToken("garbage").ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const issuedAt = Date.now() - APPROVAL_TTL_MS - 1000;
    const t = await issueApproval(caseId, "ACCEPT_CLAIM", 1, db, issuedAt);
    expect(await inspectApproval(t, db)).toEqual({ ok: false, error: "EXPIRED" });
    expect((await consumeApproval(t, { caseId, action: "ACCEPT_CLAIM" }, db)).ok).toBe(false);
  });

  it("rejects a token used for the wrong action or case", async () => {
    const t = await issueApproval(caseId, "PROVIDE_EVIDENCE", 1, db);
    expect(await consumeApproval(t, { caseId, action: "ACCEPT_CLAIM" }, db)).toEqual({ ok: false, error: "MISMATCH" });
    expect(await consumeApproval(t, { caseId: randomUUID(), action: "PROVIDE_EVIDENCE" }, db)).toEqual({ ok: false, error: "MISMATCH" });
    // still usable for the right action afterwards
    expect((await consumeApproval(t, { caseId, action: "PROVIDE_EVIDENCE" }, db)).ok).toBe(true);
  });

  it("rejects a correctly signed token that was never issued (not in the database)", async () => {
    const t = encodeToken({ jti: randomUUID(), c: caseId, a: "ACCEPT_CLAIM", v: 1, exp: Date.now() + 60_000 });
    expect(await inspectApproval(t, db)).toEqual({ ok: false, error: "UNKNOWN" });
  });

  it("concurrent double tap: exactly one consume succeeds", async () => {
    const t = await issueApproval(caseId, "ACCEPT_CLAIM", 1, db);
    const results = await Promise.all(Array.from({ length: 8 }, () => consumeApproval(t, { caseId, action: "ACCEPT_CLAIM" }, db)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
