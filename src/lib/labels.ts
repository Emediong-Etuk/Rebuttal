import type { CaseState } from "@/db/schema";

export const STATE_LABEL: Record<CaseState, { text: string; tone: "good" | "warn" | "bad" | "" }> = {
  NEW: { text: "New", tone: "" },
  ANALYSING: { text: "Working on it", tone: "" },
  AWAITING_SELLER: { text: "Waiting for your tap", tone: "warn" },
  NEEDS_INPUT: { text: "Needs one thing from you", tone: "warn" },
  SUBMITTING: { text: "Sending to PayPal", tone: "" },
  RESPONDED: { text: "Answered; PayPal reviewing", tone: "good" },
  CONCEDED: { text: "Refunded", tone: "" },
  MANUAL_REVIEW: { text: "Needs you in PayPal", tone: "bad" },
  RESOLVED: { text: "Closed", tone: "good" },
  FAILED: { text: "Something went wrong", tone: "bad" },
};
