import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { sellerProvidedTracking } from "@/agent/pipeline";
import { getDb, schema } from "@/db";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { parseTrackingReply } from "@/notify/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Demo stand-in for the seller's Telegram reply. Only works on demo-pool cases that a visitor claimed and
 * that are waiting for the seller's input. Same code path as a real Telegram reply.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const caseId = String(form.get("caseId") ?? "");
  const reply = String(form.get("reply") ?? "");
  const back = (q: string) => NextResponse.redirect(new URL(`/cases/${caseId}?${q}`, req.url), 303);
  const [c] = await getDb().select().from(schema.cases).where(eq(schema.cases.id, caseId));
  if (!c || !c.pool || !c.claimedAt) return NextResponse.json({ ok: false }, { status: 404 });
  if (c.state !== "NEEDS_INPUT") return back(`notice=${encodeURIComponent("This case isn't waiting for a reply right now.")}`);
  const rl = await rateLimit(`reply:${clientIp(req.headers)}`, 5, 3600);
  if (!rl.ok) return back(`notice=${encodeURIComponent("Too many replies from you in the last hour. Please try again later.")}`);
  const parsed = parseTrackingReply(reply);
  if (!parsed) return back(`notice=${encodeURIComponent("I couldn't find a tracking number in that. Example: USPS 9400111202555842761025 shipped 2026-11-09")}`);
  after(async () => {
    try {
      await sellerProvidedTracking(caseId, parsed.carrier, parsed.trackingNumber, { shipDate: parsed.shipDate });
    } catch (e) {
      console.error("[demo reply] failed", caseId, e);
    }
  });
  return back(`notice=${encodeURIComponent(`Got it: ${parsed.carrier} ${parsed.trackingNumber}. Adding it to the PayPal order and re-checking the case…`)}`);
}
