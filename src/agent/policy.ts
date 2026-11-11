import { normRel } from "@/paypal/types";
import type { Verdict } from "./schema";

/**
 * Deterministic policy engine. No model involved.
 *
 * Given the verdict, the ground-check result, PayPal's current view of the dispute (status, deadline,
 * allowed `links`) and the seller's settings, it returns the single action Rebuttal may take next.
 * PayPal's `links` drive the state machine: an action is only ever proposed if its rel is present.
 */
export type PolicyAction = "PROVIDE_EVIDENCE" | "SEND_MESSAGE" | "ACCEPT_CLAIM" | "ASK_SELLER" | "MANUAL_REVIEW" | "WAIT" | "NONE";
export type ApprovalMode = "ONE_TAP" | "TYPED_AMOUNT" | "NONE";

export type PolicyInput = {
  verdict: Verdict | null;
  groundCheckOk: boolean;
  reason: string;
  status: string;
  linkRels: string[];
  sellerResponseDueDate: string | null;
  amount: number | null;
  concedeCap: number;
  /** Whether a PayPal-held shipment record exists to build PROOF_OF_FULFILLMENT from. */
  hasTrackingFact: boolean;
  now: Date;
};

export type PolicyDecision = {
  action: PolicyAction;
  approval: ApprovalMode;
  /** The deadline net may submit this without a tap when under 24 hours remain. Never true for ACCEPT_CLAIM. */
  autoSubmitEligible: boolean;
  hoursLeft: number | null;
  rule: string;
  explanation: string;
};

export const SUPPORTED_REASON = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
export const AUTO_SUBMIT_WINDOW_HOURS = 24;

const has = (rels: string[], rel: string) => rels.some((r) => normRel(r) === normRel(rel));

export function hoursUntil(due: string | null, now: Date): number | null {
  if (!due) return null;
  const t = Date.parse(due);
  return Number.isNaN(t) ? null : (t - now.getTime()) / 3_600_000;
}

export function decide(input: PolicyInput): PolicyDecision {
  const hoursLeft = hoursUntil(input.sellerResponseDueDate, input.now);
  const d = (action: PolicyAction, rule: string, explanation: string, approval: ApprovalMode = "NONE", autoSubmitEligible = false): PolicyDecision => ({
    action,
    approval,
    autoSubmitEligible,
    hoursLeft,
    rule,
    explanation,
  });

  if (input.status === "RESOLVED") return d("NONE", "resolved", "PayPal has closed this case.");
  if (hoursLeft !== null && hoursLeft <= 0) return d("MANUAL_REVIEW", "deadline_passed", "The response deadline has passed.");
  if (input.reason !== SUPPORTED_REASON) return d("MANUAL_REVIEW", "unsupported_reason", `Rebuttal handles item-not-received cases only; this one is ${input.reason}.`);
  if (input.status === "UNDER_REVIEW") return d("WAIT", "under_review", "PayPal is reviewing the case. Nothing to do until it asks for something.");
  if (input.status === "WAITING_FOR_BUYER_RESPONSE") return d("WAIT", "waiting_for_buyer", "PayPal is waiting for the buyer.");

  switch (input.verdict) {
    case null:
    case "MANUAL_REVIEW":
      return d("MANUAL_REVIEW", "verdict_manual", "The agent could not reach a safe recommendation.");

    case "NEEDS_SELLER_INPUT":
      return d("ASK_SELLER", "needs_input", "The seller needs to supply something before Rebuttal can respond.");

    case "CONTEST": {
      if (!input.groundCheckOk) return d("MANUAL_REVIEW", "ground_check_failed", "The draft response could not be traced to PayPal's records.");
      if (has(input.linkRels, "provide_evidence") && input.hasTrackingFact)
        return d("PROVIDE_EVIDENCE", "contest_with_evidence", "Send the shipment record to PayPal as proof of delivery.", "ONE_TAP", true);
      if (has(input.linkRels, "send_message"))
        return d("SEND_MESSAGE", "contest_with_message", "Reply to the buyer with the shipment details.", "ONE_TAP", true);
      return d("MANUAL_REVIEW", "no_response_link", "PayPal is not accepting a response on this case right now.");
    }

    case "CONCEDE": {
      if (!has(input.linkRels, "accept_claim")) return d("MANUAL_REVIEW", "no_accept_link", "PayPal is not offering a refund option on this case right now.");
      const overCap = input.amount === null || input.amount > input.concedeCap;
      return d(
        "ACCEPT_CLAIM",
        overCap ? "concede_over_cap" : "concede",
        overCap ? "Refund the buyer. The amount is above your one-tap limit, so you must type it to confirm." : "Refund the buyer.",
        overCap ? "TYPED_AMOUNT" : "ONE_TAP",
        false,
      );
    }
  }
}

export type Actor = "seller" | "cron" | "system" | "model" | "policy";

export type ExecutionRequest = {
  decision: PolicyDecision;
  action: PolicyAction;
  actor: Actor;
  /** A consumed, verified approval record (from an approval link the seller confirmed). */
  approval?: { jti: string; action: PolicyAction; typedAmount?: string | null } | null;
  amount: number | null;
};

/**
 * The last gate before any PayPal write. Pure function, so every path is table-tested.
 * Conceding requires a seller approval record; the model and the cron job can never concede.
 */
export function authorizeExecution(req: ExecutionRequest): { allowed: boolean; reason: string } {
  const { decision, action, actor, approval } = req;
  if (action !== decision.action) return { allowed: false, reason: `Requested ${action} but policy allows only ${decision.action}.` };
  if (!["PROVIDE_EVIDENCE", "SEND_MESSAGE", "ACCEPT_CLAIM"].includes(action)) return { allowed: false, reason: `${action} is not a PayPal write.` };

  if (actor === "seller") {
    if (!approval) return { allowed: false, reason: "No seller approval record." };
    if (approval.action !== action) return { allowed: false, reason: "Approval was for a different action." };
    if (action === "ACCEPT_CLAIM" && decision.approval === "TYPED_AMOUNT") {
      const typed = Number((approval.typedAmount ?? "").replace(/[^0-9.]/g, ""));
      if (req.amount === null || !Number.isFinite(typed) || typed.toFixed(2) !== req.amount.toFixed(2))
        return { allowed: false, reason: "Typed amount does not match the dispute amount." };
    }
    return { allowed: true, reason: "Seller approved." };
  }

  if (actor === "cron") {
    if (action === "ACCEPT_CLAIM") return { allowed: false, reason: "The deadline net never concedes." };
    if (!decision.autoSubmitEligible) return { allowed: false, reason: "Not eligible for automatic submission." };
    if (decision.hoursLeft === null || decision.hoursLeft > AUTO_SUBMIT_WINDOW_HOURS || decision.hoursLeft <= 0)
      return { allowed: false, reason: "Outside the 24-hour automatic submission window." };
    return { allowed: true, reason: "Deadline net: grounded contest with under 24 hours left." };
  }

  return { allowed: false, reason: `Actor "${actor}" may not trigger PayPal writes.` };
}
