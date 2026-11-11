import { eq } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import { APPROVAL_ERRORS, inspectApproval } from "@/lib/approvals";
import { money, timeLeft } from "@/notify/message";
import type { PolicyDecision } from "@/agent/policy";
import type { Analysis } from "@/agent/schema";

export const dynamic = "force-dynamic";
// Chat apps fetch links to build previews. This page only READS; the action runs on the POST below.
export const metadata = { robots: { index: false, follow: false } };

const VERB: Record<string, { title: string; button: string; explain: string }> = {
  PROVIDE_EVIDENCE: { title: "Send your evidence to PayPal", button: "Send evidence", explain: "Rebuttal will send PayPal the shipment record it holds for this order, with the short explanation below." },
  SEND_MESSAGE: { title: "Reply to the buyer", button: "Send reply", explain: "Rebuttal will send this message to the buyer through PayPal." },
  ACCEPT_CLAIM: { title: "Refund the buyer", button: "Refund now", explain: "PayPal will close the case in the buyer's favour and refund them from your balance." },
};

export default async function Approve({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const check = await inspectApproval(decodeURIComponent(token));
  if (!check.ok) {
    return (
      <main>
        <h1>This link can&apos;t be used</h1>
        <div className="notice warn">{APPROVAL_ERRORS[check.error]}</div>
        <Link href="/cases" className="btn btn-ghost">
          Go to your cases
        </Link>
      </main>
    );
  }
  const { c: caseId, a: action } = check.payload;
  const [c] = await getDb().select().from(schema.cases).where(eq(schema.cases.id, caseId));
  if (!c) return <main><h1>Case not found</h1></main>;
  const decision = c.policy as PolicyDecision | null;
  const analysis = c.analysis as Analysis | null;
  const typed = action === "ACCEPT_CLAIM" && decision?.approval === "TYPED_AMOUNT";
  const v = VERB[action]!;
  const amt = money(c.amountValue, c.amountCurrency);

  return (
    <main>
      <h1>{v.title}</h1>
      <p className="lead">
        {amt} case · {timeLeft(c.sellerResponseDueDate)}
      </p>
      {sp.error && <div className="notice bad">{APPROVAL_ERRORS[sp.error as keyof typeof APPROVAL_ERRORS] ?? "Something went wrong."}</div>}
      <div className="card stack">
        <div>{v.explain}</div>
        {action !== "ACCEPT_CLAIM" && analysis?.rebuttal?.length ? (
          <div className="bubble">{analysis.rebuttal.map((s) => s.sentence).join(" ")}</div>
        ) : null}
        {c.reasoningSummary && <div className="small muted">Why: {c.reasoningSummary}</div>}
        <form action="/api/approve" method="post" className="stack">
          <input type="hidden" name="token" value={decodeURIComponent(token)} />
          {typed && (
            <label className="stack">
              <span>
                This is above your one-tap limit. Type the amount to confirm: <strong>{amt}</strong>
              </span>
              <input className="amount" name="typed_amount" inputMode="decimal" autoComplete="off" required placeholder={Number(c.amountValue).toFixed(2)} />
            </label>
          )}
          <button className={`btn btn-block ${action === "ACCEPT_CLAIM" ? "btn-danger" : "btn-primary"}`} type="submit">
            {v.button}
          </button>
        </form>
        <p className="small muted">This link works once and expires 24 hours after it was sent. Opening it does nothing until you press the button.</p>
      </div>
      <p className="small" style={{ marginTop: 16 }}>
        <Link href={`/cases/${caseId}`}>See the full case</Link>
      </p>
    </main>
  );
}
