import { describe, expect, it } from "vitest";
import { authorizeExecution, decide, type Actor, type PolicyAction, type PolicyInput } from "@/agent/policy";
import { VERDICTS, type Verdict } from "@/agent/schema";

const NOW = new Date("2026-11-11T12:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const ALL_LINKS = ["self", "escalate", "make_offer", "send_message", "provide_evidence", "accept_claim"];

const base: PolicyInput = {
  verdict: "CONTEST",
  groundCheckOk: true,
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  status: "WAITING_FOR_SELLER_RESPONSE",
  linkRels: ALL_LINKS,
  sellerResponseDueDate: inHours(24 * 10),
  amount: 30,
  concedeCap: 100,
  hasTrackingFact: true,
  now: NOW,
};

describe("policy engine: decide()", () => {
  const table: Array<[string, Partial<PolicyInput>, PolicyAction, string]> = [
    ["contest with evidence link and tracking", {}, "PROVIDE_EVIDENCE", "ONE_TAP"],
    ["contest, hyphenated rel name", { linkRels: ["provide-evidence"] }, "PROVIDE_EVIDENCE", "ONE_TAP"],
    ["contest, no tracking fact -> message", { hasTrackingFact: false }, "SEND_MESSAGE", "ONE_TAP"],
    ["contest, only message link", { linkRels: ["self", "send_message"] }, "SEND_MESSAGE", "ONE_TAP"],
    ["contest, no response links", { linkRels: ["self"] }, "MANUAL_REVIEW", "NONE"],
    ["contest, ground-check failed", { groundCheckOk: false }, "MANUAL_REVIEW", "NONE"],
    ["concede under cap", { verdict: "CONCEDE" }, "ACCEPT_CLAIM", "ONE_TAP"],
    ["concede exactly at cap", { verdict: "CONCEDE", amount: 100 }, "ACCEPT_CLAIM", "ONE_TAP"],
    ["concede over cap", { verdict: "CONCEDE", amount: 100.01 }, "ACCEPT_CLAIM", "TYPED_AMOUNT"],
    ["concede, unknown amount", { verdict: "CONCEDE", amount: null }, "ACCEPT_CLAIM", "TYPED_AMOUNT"],
    ["concede without accept_claim link", { verdict: "CONCEDE", linkRels: ["self", "send_message"] }, "MANUAL_REVIEW", "NONE"],
    ["needs seller input", { verdict: "NEEDS_SELLER_INPUT" }, "ASK_SELLER", "NONE"],
    ["model says manual review", { verdict: "MANUAL_REVIEW" }, "MANUAL_REVIEW", "NONE"],
    ["no verdict (model failed)", { verdict: null }, "MANUAL_REVIEW", "NONE"],
    ["deadline passed", { sellerResponseDueDate: inHours(-1) }, "MANUAL_REVIEW", "NONE"],
    ["unsupported reason", { reason: "UNAUTHORISED" }, "MANUAL_REVIEW", "NONE"],
    ["resolved", { status: "RESOLVED" }, "NONE", "NONE"],
    ["under review", { status: "UNDER_REVIEW", linkRels: ["self"] }, "WAIT", "NONE"],
    ["waiting for buyer", { status: "WAITING_FOR_BUYER_RESPONSE" }, "WAIT", "NONE"],
  ];

  it.each(table)("%s", (_name, over, action, approval) => {
    const d = decide({ ...base, ...over });
    expect(d.action).toBe(action);
    expect(d.approval).toBe(approval);
  });

  it("never marks a concession as auto-submittable", () => {
    for (const amount of [1, 50, 100, 500, null]) {
      for (const hours of [1, 12, 23, 48, 400]) {
        const d = decide({ ...base, verdict: "CONCEDE", amount, sellerResponseDueDate: inHours(hours) });
        expect(d.autoSubmitEligible).toBe(false);
      }
    }
  });

  it("never proposes an action whose link PayPal did not offer", () => {
    const rels = ["provide_evidence", "send_message", "accept_claim"];
    const subsets = [[], ["provide_evidence"], ["send_message"], ["accept_claim"], ["provide_evidence", "accept_claim"], rels];
    const linkFor: Record<string, string> = { PROVIDE_EVIDENCE: "provide_evidence", SEND_MESSAGE: "send_message", ACCEPT_CLAIM: "accept_claim" };
    for (const verdict of VERDICTS) {
      for (const linkRels of subsets) {
        const d = decide({ ...base, verdict, linkRels });
        if (linkFor[d.action]) expect(linkRels).toContain(linkFor[d.action]);
      }
    }
  });
});

describe("policy engine: authorizeExecution()", () => {
  const actors: Actor[] = ["seller", "cron", "system", "model", "policy"];
  const verdicts: (Verdict | null)[] = [...VERDICTS, null];
  const writeActions: PolicyAction[] = ["PROVIDE_EVIDENCE", "SEND_MESSAGE", "ACCEPT_CLAIM"];

  it("no path concedes without a seller approval record", () => {
    for (const verdict of verdicts)
      for (const amount of [10, 100, 1000])
        for (const hours of [1, 23, 100])
          for (const actor of actors)
            for (const withApproval of [false, true]) {
              const decision = decide({ ...base, verdict, amount, sellerResponseDueDate: inHours(hours) });
              const res = authorizeExecution({
                decision,
                action: "ACCEPT_CLAIM",
                actor,
                amount,
                approval: withApproval ? { jti: "j", action: "ACCEPT_CLAIM", typedAmount: amount.toFixed(2) } : null,
              });
              if (res.allowed) {
                expect(actor).toBe("seller");
                expect(withApproval).toBe(true);
                expect(decision.action).toBe("ACCEPT_CLAIM");
              }
            }
  });

  it("only the seller (with approval) or the cron net can write; the model never can", () => {
    for (const verdict of verdicts)
      for (const action of writeActions) {
        const decision = decide({ ...base, verdict, sellerResponseDueDate: inHours(5) });
        for (const actor of ["model", "system", "policy"] as Actor[]) {
          expect(authorizeExecution({ decision, action, actor, amount: 30, approval: { jti: "j", action } }).allowed).toBe(false);
        }
      }
  });

  it("requires the typed amount over the cap", () => {
    const decision = decide({ ...base, verdict: "CONCEDE", amount: 250 });
    const ok = (typedAmount: string | null) => authorizeExecution({ decision, action: "ACCEPT_CLAIM", actor: "seller", amount: 250, approval: { jti: "j", action: "ACCEPT_CLAIM", typedAmount } }).allowed;
    expect(ok(null)).toBe(false);
    expect(ok("25")).toBe(false);
    expect(ok("250")).toBe(true);
    expect(ok("$250.00")).toBe(true);
  });

  it("rejects an approval for a different action", () => {
    const decision = decide({ ...base, verdict: "CONCEDE" });
    expect(authorizeExecution({ decision, action: "ACCEPT_CLAIM", actor: "seller", amount: 30, approval: { jti: "j", action: "PROVIDE_EVIDENCE" } }).allowed).toBe(false);
  });

  it("rejects an action the policy did not choose, even with approval", () => {
    const decision = decide({ ...base, verdict: "CONTEST" });
    expect(authorizeExecution({ decision, action: "ACCEPT_CLAIM", actor: "seller", amount: 30, approval: { jti: "j", action: "ACCEPT_CLAIM" } }).allowed).toBe(false);
  });

  it("cron submits a grounded contest only inside the last 24 hours", () => {
    const at = (hours: number) => authorizeExecution({ decision: decide({ ...base, sellerResponseDueDate: inHours(hours) }), action: "PROVIDE_EVIDENCE", actor: "cron", amount: 30 }).allowed;
    expect(at(48)).toBe(false);
    expect(at(24.5)).toBe(false);
    expect(at(23)).toBe(true);
    expect(at(1)).toBe(true);
  });

  it("cron never submits an ungrounded contest", () => {
    const decision = decide({ ...base, groundCheckOk: false, sellerResponseDueDate: inHours(2) });
    expect(authorizeExecution({ decision, action: "PROVIDE_EVIDENCE", actor: "cron", amount: 30 }).allowed).toBe(false);
  });
});
