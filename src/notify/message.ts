import type { PolicyDecision } from "@/agent/policy";

/** "3 days left", "5 hours left", "under an hour left", "deadline passed". */
export function timeLeft(due: Date | string | null, now = new Date()): string {
  if (!due) return "no deadline set";
  const ms = new Date(due).getTime() - now.getTime();
  if (ms <= 0) return "deadline passed";
  const hours = ms / 3_600_000;
  if (hours < 1) return "under an hour left";
  if (hours < 48) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"} left`;
  const days = Math.floor(hours / 24);
  return `${days} days left`;
}

export function money(value: string | number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined) return "an unknown amount";
  const n = Number(value);
  const sym = currency === "USD" || !currency ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : `${currency} `;
  return `${sym}${n.toFixed(2)}`;
}

export type SellerMessage = {
  text: string;
  button: { label: string; url: string } | null;
  /** When true, the seller should reply to the bot in plain text (e.g. with a tracking number). */
  expectsReply: boolean;
};

/** One-line summary of what the buyer says, never quoting instructions verbatim at length. */
export function oneLineClaim(claim: string | null | undefined): string {
  const t = (claim ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "says the item never arrived";
  return `says: “${t.length > 110 ? `${t.slice(0, 107)}…` : t}”`;
}

export function buildSellerMessage(input: {
  amount: string | null;
  currency: string | null;
  buyerClaim: string | null;
  reasoningSummary: string | null;
  decision: PolicyDecision;
  due: Date | null;
  approvalLink: string | null;
  caseLink: string;
  missing?: string[];
  now?: Date;
}): SellerMessage {
  const amt = money(input.amount, input.currency);
  const left = timeLeft(input.due, input.now);
  const head = `A buyer opened a case for ${amt} and ${oneLineClaim(input.buyerClaim)}`;
  const why = input.reasoningSummary ? `\n\n${input.reasoningSummary}` : "";
  const d = input.decision;

  switch (d.action) {
    case "PROVIDE_EVIDENCE":
    case "SEND_MESSAGE":
      return {
        text: `${head}${why}\n\nMy recommendation: fight it. I'll send PayPal your shipping record.\n⏳ ${left}. If you don't reply, I'll send it automatically when 24 hours remain.`,
        button: input.approvalLink ? { label: "Send my evidence", url: input.approvalLink } : null,
        expectsReply: false,
      };
    case "ACCEPT_CLAIM":
      return {
        text: `${head}${why}\n\nMy recommendation: refund the buyer (${amt}). There's no shipping record I can use to fight this.\n⏳ ${left}. I will never refund without your approval.${d.approval === "TYPED_AMOUNT" ? `\nThis is above your one-tap limit, so you'll be asked to type the amount.` : ""}`,
        button: input.approvalLink ? { label: `Refund ${amt}`, url: input.approvalLink } : null,
        expectsReply: false,
      };
    case "ASK_SELLER":
      return {
        text: `${head}${why}\n\nI need one thing to fight this: ${(input.missing?.length ? input.missing.join("; ") : "the tracking number for this order")}.\nReply to this message with it (for example: USPS 9400111202555842761025) and I'll take it from there.\n⏳ ${left}.`,
        button: { label: "Open the case", url: input.caseLink },
        expectsReply: true,
      };
    case "WAIT":
      return { text: `Update on your ${amt} case: ${d.explanation} I'll tell you when something changes.`, button: { label: "Open the case", url: input.caseLink }, expectsReply: false };
    case "NONE":
      return { text: `Your ${amt} case is closed. ${d.explanation}`, button: { label: "Open the case", url: input.caseLink }, expectsReply: false };
    case "MANUAL_REVIEW":
    default:
      return {
        text: `${head}\n\nI couldn't safely answer this one on my own: ${d.explanation}\nWhat to do: open the case and respond in your PayPal Resolution Center before the deadline.\n⏳ ${left}.`,
        button: { label: "Open the case", url: input.caseLink },
        expectsReply: false,
      };
  }
}
