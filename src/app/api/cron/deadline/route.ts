import { NextResponse } from "next/server";
import { runDeadlineNet } from "@/agent/deadline";
import { syncPool } from "@/agent/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** HTTP trigger for the deadline net (the Render cron job runs scripts/cron-deadline.ts directly). */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const report = await runDeadlineNet();
  const added = await syncPool().catch(() => []);
  return NextResponse.json({ ok: true, report, poolAdded: added });
}
