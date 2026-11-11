import { z } from "zod";

export const VERDICTS = ["CONTEST", "CONCEDE", "NEEDS_SELLER_INPUT", "MANUAL_REVIEW"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What the model must return. Validated with Zod before anything else looks at it. */
export const analysisSchema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.number().min(0).max(1),
  reasoning_summary: z
    .string()
    .min(1)
    .max(600)
    .describe("Two or three plain-language sentences for the seller. No PayPal jargon."),
  evidence_plan: z
    .array(
      z.object({
        evidence_type: z.string().describe("A requested PayPal evidence type, e.g. PROOF_OF_FULFILLMENT"),
        satisfiable: z.boolean(),
        fact_ids: z.array(z.string()).describe("IDs of the facts that satisfy it"),
      }),
    )
    .max(10),
  rebuttal: z
    .array(
      z.object({
        sentence: z.string().min(1).max(400),
        fact_ids: z.array(z.string()).describe("IDs of the facts that support this sentence"),
      }),
    )
    .max(8)
    .describe("The response PayPal will see, one sentence per item. Empty unless verdict is CONTEST."),
  missing: z.array(z.string()).max(5).describe("What the seller would need to supply, in plain language"),
});

export type Analysis = z.infer<typeof analysisSchema>;

/** A fact as shown to the model and to the ground-check. */
export type FactRecord = {
  id: string;
  kind: string;
  source: string;
  fetchedAt: string;
  data: unknown;
};
