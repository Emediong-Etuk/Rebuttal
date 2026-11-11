import { beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/db";
import { makeDispute, resetDb, schema } from "./helpers/db";
import { intakeWebhook } from "@/lib/webhook";
import { processDisputeEvent } from "@/agent/intake";
import type { DB } from "@/db";
import { eq } from "drizzle-orm";

const headers = () =>
  new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
    "paypal-transmission-id": "t-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-11-11T10:00:00Z",
  });
const event = (id = "WH-1", type = "CUSTOMER.DISPUTE.CREATED", resource: Record<string, unknown> = { dispute_id: "PP-R-TEST-0001", status: "RESOLVED" }) =>
  JSON.stringify({ id, event_type: type, resource });

let db: DB;
beforeEach(async () => {
  db = await resetDb();
});

describe("webhook intake", () => {
  it("rejects an invalid signature and records it in the audit log", async () => {
    const paypal = { verifyWebhookSignature: vi.fn().mockResolvedValue({ verified: false, debugId: "dbg" }) };
    const r = await intakeWebhook(event(), headers(), { db, paypal, webhookId: "WHID" });
    expect(r.status).toBe(401);
    expect(await db.select().from(schema.webhookEvents)).toHaveLength(0);
    const audit = await db.select().from(schema.auditLog);
    expect(audit.map((a) => a.decision)).toContain("INVALID_SIGNATURE");
  });

  it("rejects when PayPal's verify call itself fails", async () => {
    const paypal = { verifyWebhookSignature: vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { debugId: "d" })) };
    expect((await intakeWebhook(event(), headers(), { db, paypal, webhookId: "WHID" })).status).toBe(401);
  });

  it("verifies against the raw body, byte for byte", async () => {
    const raw = '{"id":"WH-2",  "event_type":"CUSTOMER.DISPUTE.UPDATED","resource":{"dispute_id":"PP-R-TEST-0001"}}';
    const paypal = { verifyWebhookSignature: vi.fn().mockResolvedValue({ verified: true, debugId: "d" }) };
    await intakeWebhook(raw, headers(), { db, paypal, webhookId: "WHID" });
    expect(paypal.verifyWebhookSignature.mock.calls[0]![1]).toBe(raw);
  });

  it("ignores a duplicate event ID, even when delivered concurrently", async () => {
    const paypal = { verifyWebhookSignature: vi.fn().mockResolvedValue({ verified: true, debugId: "d" }) };
    const results = await Promise.all(Array.from({ length: 5 }, () => intakeWebhook(event("WH-DUP"), headers(), { db, paypal, webhookId: "WHID" })));
    expect(results.filter((r) => r.status === 200 && !("duplicate" in r && r.duplicate))).toHaveLength(1);
    expect(results.filter((r) => r.status === 200 && "duplicate" in r && r.duplicate)).toHaveLength(4);
    expect(await db.select().from(schema.webhookEvents)).toHaveLength(1);
  });

  it("never trusts the payload: the re-fetched dispute is the source of truth", async () => {
    // Payload claims RESOLVED; PayPal says WAITING_FOR_SELLER_RESPONSE.
    const paypal = {
      getDispute: vi.fn().mockResolvedValue({ status: 200, data: makeDispute(), debugId: "dbg-refetch", endpoint: "GET /v1/customer/disputes/{id}" }),
      getCapture: vi.fn(),
      accessToken: vi.fn().mockResolvedValue("t"),
      listTrackers: vi.fn().mockResolvedValue({ data: { trackers: [] } }),
    };
    await db.insert(schema.settings).values({ id: "default", holdNewDisputesForDemo: true });
    const r = await processDisputeEvent(JSON.parse(event()), { db, paypal: paypal as never });
    expect(paypal.getDispute).toHaveBeenCalledWith("PP-R-TEST-0001");
    const [c] = await db.select().from(schema.cases).where(eq(schema.cases.disputeId, "PP-R-TEST-0001"));
    expect(c!.paypalStatus).toBe("WAITING_FOR_SELLER_RESPONSE");
    expect(c!.state).not.toBe("RESOLVED");
    expect(r).toMatchObject({ pooled: true });
  });
});
