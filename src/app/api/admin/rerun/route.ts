import { after, NextResponse } from "next/server";
import { runPipeline } from "@/agent/pipeline";
import { timeline } from "@/lib/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Operator: re-run the agent pipeline for one case (e.g. after fixing an AI key). Protected by CRON_SECRET. */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const caseId = new URL(req.url).searchParams.get("case");
  if (!caseId) return NextResponse.json({ ok: false, error: "case is required" }, { status: 400 });
  await timeline({ caseId, kind: "rerun", actor: "system", title: "Operator re-ran the agent", body: "A fresh analysis was requested after a configuration fix." });
  after(async () => {
    try {
      await runPipeline(caseId);
    } catch (e) {
      console.error("[rerun] failed", caseId, e);
    }
  });
  return NextResponse.json({ ok: true, caseId });
}
