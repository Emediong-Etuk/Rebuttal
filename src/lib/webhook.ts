import { eq } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db";
import type { PayPalClient } from "@/paypal/client";
import { audit } from "./record";

export type WebhookIntake =
  | { status: 401; reason: string }
  | { status: 200; duplicate: true; eventId: string }
  | { status: 200; duplicate: false; eventId: string; event: { id: string; event_type: string; resource?: Record<string, unknown> } };

/**
 * Verify the signature against the RAW body, then record the event ID. The primary key on
 * webhook_events makes repeated deliveries a no-op, even under concurrency.
 */
export async function intakeWebhook(
  rawBody: string,
  headers: Headers,
  deps: { db?: DB; paypal: Pick<PayPalClient, "verifyWebhookSignature">; webhookId?: string },
): Promise<WebhookIntake> {
  const db = deps.db ?? getDb();
  const webhookId = deps.webhookId ?? process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return { status: 401, reason: "PAYPAL_WEBHOOK_ID is not configured" };

  let verified = false;
  let debugId: string | null = null;
  try {
    const r = await deps.paypal.verifyWebhookSignature(headers, rawBody, webhookId);
    verified = r.verified;
    debugId = r.debugId;
  } catch (e) {
    debugId = (e as { debugId?: string }).debugId ?? null;
  }
  if (!verified) {
    await audit({ actor: "system", action: "webhook_rejected", decision: "INVALID_SIGNATURE", input: rawBody, debugId, data: { transmissionId: headers.get("paypal-transmission-id") } }, db);
    console.warn(`[webhook] rejected: signature did not verify (transmission ${headers.get("paypal-transmission-id") ?? "?"}, debug ${debugId ?? "-"})`);
    return { status: 401, reason: "signature verification failed" };
  }

  const event = JSON.parse(rawBody) as { id: string; event_type: string; resource?: Record<string, unknown> };
  const inserted = await db
    .insert(schema.webhookEvents)
    .values({ eventId: event.id, eventType: event.event_type, resourceId: (event.resource?.dispute_id as string | undefined) ?? null })
    .onConflictDoNothing({ target: schema.webhookEvents.eventId })
    .returning({ id: schema.webhookEvents.eventId });
  if (!inserted.length) return { status: 200, duplicate: true, eventId: event.id };
  return { status: 200, duplicate: false, eventId: event.id, event };
}

export async function markWebhookProcessed(eventId: string, error: string | null, db: DB = getDb()) {
  await db.update(schema.webhookEvents).set({ processedAt: new Date(), error }).where(eq(schema.webhookEvents.eventId, eventId));
}
