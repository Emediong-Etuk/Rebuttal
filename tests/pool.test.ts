import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import "./helpers/db";
import { resetDb, schema } from "./helpers/db";
import { claimFromPool, poolCounts } from "@/agent/intake";
import type { DB } from "@/db";

let db: DB;
beforeEach(async () => {
  db = await resetDb();
  await db.insert(schema.cases).values({ id: "c1", disputeId: "PP-1", mode: "LIVE", pool: true, scenario: "B", paypalStatus: "WAITING_FOR_SELLER_RESPONSE" });
});

describe("demo pool", () => {
  it("concurrent visitors never claim the same dispute", async () => {
    const r = await Promise.all([claimFromPool("B", db), claimFromPool("B", db), claimFromPool("B", db)]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it("a claimed dispute with no PayPal write becomes reusable after 10 minutes", async () => {
    expect(await claimFromPool("B", db)).not.toBeNull();
    await db.execute(sql`UPDATE cases SET state = 'AWAITING_SELLER' WHERE id = 'c1'`);
    expect(await claimFromPool("B", db)).toBeNull(); // too soon
    await db.execute(sql`UPDATE cases SET claimed_at = now() - interval '11 minutes' WHERE id = 'c1'`);
    expect((await poolCounts(db)).B).toBe(1);
    expect(await claimFromPool("B", db)).not.toBeNull();
  });

  it("a dispute that was answered (a PayPal write succeeded) is never reused", async () => {
    await claimFromPool("B", db);
    await db.execute(sql`UPDATE cases SET state = 'AWAITING_SELLER', claimed_at = now() - interval '1 hour' WHERE id = 'c1'`);
    await db.insert(schema.actions).values({ caseId: "c1", action: "ACCEPT_CLAIM", requestId: "r1", status: "SUCCEEDED", actor: "seller" });
    expect(await claimFromPool("B", db)).toBeNull();
    expect((await poolCounts(db)).B).toBe(0);
  });
});
