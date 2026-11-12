import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator: tag a pool dispute with its demo scenario (A/B/C). Protected by CRON_SECRET. */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const u = new URL(req.url);
  const disputeId = u.searchParams.get("dispute") ?? "";
  const scenario = u.searchParams.get("scenario") ?? "";
  if (!["A", "B", "C"].includes(scenario)) return NextResponse.json({ ok: false, error: "scenario must be A, B or C" }, { status: 400 });
  const r = await getDb().update(schema.cases).set({ scenario }).where(eq(schema.cases.disputeId, disputeId)).returning({ id: schema.cases.id });
  return NextResponse.json({ ok: r.length === 1, updated: r.length });
}
