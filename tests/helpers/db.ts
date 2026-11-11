import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Dispute } from "@/paypal/types";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://rebuttal:rebuttal@localhost:5432/rebuttal_test";
process.env.DATABASE_URL = TEST_DB;
process.env.APPROVAL_SECRET ??= "test-approval-secret-test-approval-secret";
process.env.APP_URL ??= "https://rebuttal.test";

export async function resetDb() {
  const db = getDb();
  // audit_log is append-only by trigger; TRUNCATE is allowed (it is not UPDATE/DELETE) and only used in tests.
  await db.execute(sql`TRUNCATE cases, facts, timeline_events, actions, approval_tokens, webhook_events, rate_limits, settings, audit_log RESTART IDENTITY CASCADE`);
  return db;
}

export function makeDispute(over: Partial<Dispute> = {}): Dispute {
  return {
    dispute_id: "PP-R-TEST-0001",
    create_time: "2026-11-11T01:18:20.110Z",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_life_cycle_stage: "INQUIRY",
    dispute_amount: { currency_code: "USD", value: "30.00" },
    seller_response_due_date: "2026-12-01T01:18:20.110Z",
    disputed_transactions: [{ seller_transaction_id: "4KT96773NB9182150", buyer_transaction_id: "65F05326NA2473541", gross_amount: { currency_code: "USD", value: "33.00" }, create_time: "2026-11-11T01:09:59.000Z" }],
    messages: [{ posted_by: "BUYER", time_posted: "2026-11-11T01:18:20.110Z", content: "My package never came." }],
    evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", source: "REQUESTED_FROM_SELLER" }],
    links: ["self", "escalate", "make_offer", "send_message", "provide_evidence", "accept_claim"].map((rel) => ({ rel, href: `https://x/${rel}`, method: rel === "self" ? "GET" : "POST" })),
    ...over,
  } as Dispute;
}

export const TRACKING = { trackers: [{ transaction_id: "4KT96773NB9182150", tracking_number: "9400111202555842761049", carrier: "USPS", status: "DELIVERED", shipment_date: "2026-11-09", shipment_direction: "FORWARD" }] };

export { schema };
