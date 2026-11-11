import { z } from "zod";

/** The subset of PayPal's show-dispute response that Rebuttal reads. Unknown fields are kept. */
export const money = z.object({ currency_code: z.string(), value: z.string() });

export const link = z.object({ href: z.string(), rel: z.string(), method: z.string().optional() });

export const disputeSchema = z
  .object({
    dispute_id: z.string(),
    create_time: z.string().optional(),
    update_time: z.string().optional(),
    reason: z.string(),
    status: z.string(),
    dispute_life_cycle_stage: z.string().optional(),
    dispute_channel: z.string().optional(),
    dispute_amount: money.optional(),
    seller_response_due_date: z.string().optional(),
    disputed_transactions: z
      .array(
        z
          .object({
            seller_transaction_id: z.string().optional(),
            buyer_transaction_id: z.string().optional(),
            create_time: z.string().optional(),
            transaction_status: z.string().optional(),
            gross_amount: money.optional(),
            invoice_number: z.string().optional(),
            custom: z.string().optional(),
            buyer: z.object({ name: z.string().optional() }).passthrough().optional(),
            seller: z.object({ merchant_id: z.string().optional(), name: z.string().optional() }).passthrough().optional(),
            items: z.array(z.object({ item_id: z.string().optional(), item_description: z.string().optional() }).passthrough()).optional(),
          })
          .passthrough(),
      )
      .optional(),
    messages: z
      .array(z.object({ posted_by: z.string(), time_posted: z.string().optional(), content: z.string().optional() }).passthrough())
      .optional(),
    evidences: z
      .array(
        z
          .object({
            evidence_type: z.string().optional(),
            source: z.string().optional(),
            notes: z.string().optional(),
            date: z.string().optional(),
            evidence_info: z.unknown().optional(),
          })
          .passthrough(),
      )
      .optional(),
    dispute_outcome: z.object({ outcome_code: z.string().optional(), amount_refunded: money.optional() }).passthrough().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
    links: z.array(link).default([]),
  })
  .passthrough();

export type Dispute = z.infer<typeof disputeSchema>;
export type Money = z.infer<typeof money>;

export type TrackingInfo = { carrier_name: string; tracking_number: string; carrier_name_other?: string; tracking_url?: string };

/** Normalise a HATEOAS rel so "provide_evidence" and "provide-evidence" compare equal. */
export function normRel(rel: string): string {
  return rel.toLowerCase().replace(/-/g, "_");
}

export function hasLink(d: Pick<Dispute, "links">, rel: string): boolean {
  const want = normRel(rel);
  return d.links.some((l) => normRel(l.rel) === want);
}

/** The buyer's own words: the first buyer message, falling back to buyer-submitted evidence notes. */
export function buyerClaimText(d: Dispute): string {
  const msgs = (d.messages ?? []).filter((m) => m.posted_by === "BUYER" && m.content).map((m) => m.content!.trim());
  if (msgs.length) return msgs.join("\n\n");
  const notes = (d.evidences ?? []).filter((e) => e.source === "SUBMITTED_BY_BUYER" && e.notes).map((e) => e.notes!.trim());
  return notes.join("\n\n");
}
