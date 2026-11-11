import { after, NextResponse } from "next/server";
import { claimFromPool, type Scenario } from "@/agent/intake";
import { runPipeline } from "@/agent/pipeline";
import { timeline } from "@/lib/record";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Claim one real pre-filed sandbox dispute from the demo pool and run the live pipeline on it. */
export async function POST(req: Request) {
  const form = await req.formData();
  const scenario = String(form.get("scenario") ?? "") as Scenario;
  if (!["A", "B", "C"].includes(scenario)) return NextResponse.redirect(new URL("/demo?error=scenario", req.url), 303);

  const ip = clientIp(req.headers);
  const perIp = await rateLimit(`demo:${ip}`, 3, 3600);
  const global = await rateLimit("demo:all", 30, 3600);
  if (!perIp.ok || !global.ok) return NextResponse.redirect(new URL("/demo?error=rate", req.url), 303);

  const c = await claimFromPool(scenario);
  if (!c) return NextResponse.redirect(new URL(`/demo?error=empty&scenario=${scenario}`, req.url), 303);

  await timeline({ caseId: c.id, kind: "claim", actor: "system", title: `Demo visitor claimed real sandbox dispute ${c.disputeId}`, body: `Scenario ${scenario}. Everything from here runs live against the PayPal sandbox.` });
  after(async () => {
    try {
      await runPipeline(c.id);
    } catch (e) {
      console.error("[demo] pipeline failed", c.id, e);
    }
  });
  return NextResponse.redirect(new URL(`/cases/${c.id}?demo=1`, req.url), 303);
}
