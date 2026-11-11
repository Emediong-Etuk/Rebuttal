import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator diagnostics (no secrets returned). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getDb();
  const cases = await db
    .select({ id: schema.cases.id, disputeId: schema.cases.disputeId, state: schema.cases.state, paypalStatus: schema.cases.paypalStatus, stage: schema.cases.lifecycleStage, pool: schema.cases.pool, scenario: schema.cases.scenario, claimedAt: schema.cases.claimedAt, verdict: schema.cases.verdict, amount: schema.cases.amountValue })
    .from(schema.cases)
    .orderBy(desc(schema.cases.updatedAt))
    .limit(30);
  const webhooks = await db.select().from(schema.webhookEvents).orderBy(desc(schema.webhookEvents.receivedAt)).limit(20);
  const audit = await db
    .select({ at: schema.auditLog.at, actor: schema.auditLog.actor, action: schema.auditLog.action, decision: schema.auditLog.decision, debugId: schema.auditLog.debugId, caseId: schema.auditLog.caseId })
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.id))
    .limit(30);
  const settings = await db.select().from(schema.settings);
  return NextResponse.json({
    ok: true,
    config: {
      ai: process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENROUTER_API_KEY ? `openrouter:${process.env.OPENROUTER_MODEL ?? "default"}` : "none",
      webhookIdSet: !!process.env.PAYPAL_WEBHOOK_ID,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      appUrl: process.env.APP_URL ?? null,
    },
    settings,
    cases,
    webhooks,
    audit,
  });
}
