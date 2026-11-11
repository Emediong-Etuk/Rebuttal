import { eq } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db";
import type { ActionKind } from "@/db/schema";
import { getPayPal } from "@/paypal/client";
import { approvalUrl, issueApproval } from "@/lib/approvals";
import { audit, timeline } from "@/lib/record";
import { buildSellerMessage, timeLeft } from "@/notify/message";
import { sendTelegram } from "@/notify/telegram";
import { concedeCap, decisionFor, executeAction, loadFacts, type PayPalWrites } from "./executor";
import { appUrl } from "./pipeline";

/** Reminder thresholds (hours left) for unanswered refund recommendations. Escalating, never auto-conceding. */
export const REMINDER_THRESHOLDS = [72, 24, 6];

export type DeadlineDeps = { db?: DB; paypal?: PayPalWrites; notify?: typeof sendTelegram; now?: Date };

/**
 * Deadline safety net (cron, every 30 minutes).
 * - Grounded CONTEST draft, no seller response, under 24h left -> submit automatically and tell the seller.
 * - CONCEDE recommendation -> escalating reminders. Never auto-concede.
 * Safe to run concurrently: executeAction's unique request ID collapses overlapping runs to one PayPal call.
 */
export async function runDeadlineNet(deps: DeadlineDeps = {}) {
  const db = deps.db ?? getDb();
  const paypal = deps.paypal ?? getPayPal();
  const notify = deps.notify ?? sendTelegram;
  const now = deps.now ?? new Date();
  const report: Array<{ caseId: string; did: string }> = [];

  const open = await db
    .select()
    .from(schema.cases)
    .where(eq(schema.cases.state, "AWAITING_SELLER"));

  for (const c of open) {
    if (c.pool && !c.claimedAt) continue;
    const dispute = (await paypal.getDispute(c.disputeId)).data;
    const facts = await loadFacts(c.id, db);
    const decision = decisionFor(c, dispute, facts, await concedeCap(db), now);
    const hours = decision.hoursLeft;

    if ((decision.action === "PROVIDE_EVIDENCE" || decision.action === "SEND_MESSAGE") && decision.autoSubmitEligible && hours !== null && hours > 0 && hours < 24) {
      const r = await executeAction({ caseId: c.id, action: decision.action as ActionKind, actor: "cron" }, { db, paypal, now });
      report.push({ caseId: c.id, did: `auto-submit:${r.status}` });
      if (r.status === "SUCCEEDED") {
        await notify({
          text: `The deadline on your ${c.amountValue ? `$${Number(c.amountValue).toFixed(2)} ` : ""}case was ${timeLeft(c.sellerResponseDueDate, now)} away and you hadn't replied, so I sent PayPal your shipping record as planned. Nothing else is needed from you.`,
          button: { label: "Open the case", url: appUrl(`/cases/${c.id}`) },
          expectsReply: false,
        });
      }
      continue;
    }

    if (decision.action === "ACCEPT_CLAIM" && hours !== null && hours > 0) {
      const due = REMINDER_THRESHOLDS.filter((t) => hours <= t).length; // how many thresholds we've crossed
      if (due > c.reminderCount) {
        const link = approvalUrl(await issueApproval(c.id, "ACCEPT_CLAIM", c.draftVersion, db, now.getTime()));
        const msg = buildSellerMessage({
          amount: c.amountValue,
          currency: c.amountCurrency,
          buyerClaim: c.buyerClaim,
          reasoningSummary: `Reminder ${due} of ${REMINDER_THRESHOLDS.length}: this case still needs your decision. I won't refund without you; if nobody responds, PayPal will decide on its own after the deadline.`,
          decision,
          due: c.sellerResponseDueDate,
          approvalLink: link,
          caseLink: appUrl(`/cases/${c.id}`),
          now,
        });
        await notify(msg);
        await db.update(schema.cases).set({ reminderCount: due, lastReminderAt: now }).where(eq(schema.cases.id, c.id));
        await timeline({ caseId: c.id, kind: "reminder", actor: "cron", title: `Reminder ${due} sent to the seller`, body: msg.text }, db);
        await audit({ caseId: c.id, actor: "cron", action: "remind", decision: "ACCEPT_CLAIM_PENDING", data: { hoursLeft: hours, reminder: due } }, db);
        report.push({ caseId: c.id, did: `reminder-${due}` });
      }
    }
  }
  return report;
}
