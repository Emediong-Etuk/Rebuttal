import { after, NextResponse } from "next/server";
import { DISPUTE_EVENTS, processDisputeEvent } from "@/agent/intake";
import { getPayPal } from "@/paypal/client";
import { intakeWebhook, markWebhookProcessed } from "@/lib/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Read the body exactly as sent. Re-serialised JSON is a known cause of false verification failures.
  const raw = await req.text();
  const r = await intakeWebhook(raw, req.headers, { paypal: getPayPal() });
  if (r.status === 401) return NextResponse.json({ error: r.reason }, { status: 401 });
  if (r.duplicate) return NextResponse.json({ ok: true, duplicate: true });

  const event = r.event;
  // Return 200 quickly; process after the response is sent.
  after(async () => {
    try {
      if ((DISPUTE_EVENTS as readonly string[]).includes(event.event_type)) await processDisputeEvent(event);
      await markWebhookProcessed(event.id, null);
    } catch (e) {
      console.error("[webhook] processing failed", event.id, e);
      await markWebhookProcessed(event.id, e instanceof Error ? e.message : String(e)).catch(() => {});
    }
  });
  return NextResponse.json({ ok: true });
}
