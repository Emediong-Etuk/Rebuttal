import { NextResponse } from "next/server";
import { runDeadlineNet } from "@/agent/deadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** HTTP trigger for the deadline net (the Render cron job runs scripts/cron-deadline.ts directly). */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, report: await runDeadlineNet() });
}
