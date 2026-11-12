import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { getDb, schema } from "@/db";
import type { CaseState } from "@/db/schema";
import { STATE_LABEL } from "@/lib/labels";
import { money, timeLeft } from "@/notify/message";
import type { SellerMessage } from "@/notify/message";

export const dynamic = "force-dynamic";

/** A plausible sample reply for the demo: USPS-format number, shipped two days before the case was opened. */
function sampleReply(opened: Date): string {
  const shipped = new Date(opened.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const digits = String(Math.floor(opened.getTime() / 1000)).slice(-8);
  return `USPS 94001112025558${digits} shipped ${shipped}`;
}

const ACTOR: Record<string, string> = { paypal: "PayPal", agent: "Agent", model: "Claude", system: "Rebuttal", policy: "Policy engine", seller: "Seller", cron: "Deadline net" };

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const [c] = await db.select().from(schema.cases).where(eq(schema.cases.id, id));
  if (!c) notFound();
  const events = await db.select().from(schema.timelineEvents).where(eq(schema.timelineEvents.caseId, id)).orderBy(asc(schema.timelineEvents.at), asc(schema.timelineEvents.id));
  const facts = await db.select().from(schema.facts).where(eq(schema.facts.caseId, id));
  const latestNotify = [...events].reverse().find((e) => e.kind === "notify" || e.kind === "reminder");
  const message = (latestNotify?.detail as { message?: SellerMessage } | null)?.message ?? (latestNotify ? { text: latestNotify.body ?? "", button: null, expectsReply: false } : null);
  const busy = ["NEW", "ANALYSING", "SUBMITTING"].includes(c.state) || (c.pool && !latestNotify);
  const label = STATE_LABEL[c.state as CaseState] ?? { text: c.state, tone: "" };
  const actionDone = ["RESPONDED", "CONCEDED", "RESOLVED"].includes(c.state);

  return (
    <main>
      <AutoRefresh active={busy || actionDone} intervalMs={busy ? 2500 : 15000} />
      <p className="small muted">
        <Link href="/cases">← All cases</Link>
      </p>
      <h1 style={{ marginTop: 8 }}>
        {money(c.amountValue, c.amountCurrency)} · item not received
      </h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`pill ${label.tone}`}>{label.text}</span>
        <span className="pill">{timeLeft(c.sellerResponseDueDate)}</span>
        <span className="pill">PayPal: {c.paypalStatus?.toLowerCase().replace(/_/g, " ") ?? "unknown"}</span>
        {c.pool && <span className="pill">Real sandbox dispute from the demo pool</span>}
      </div>
      {sp.notice && <div className="notice">{sp.notice}</div>}

      <h2>What the seller sees</h2>
      {message ? (
        <div className="phone">
          <div className="bot">Rebuttal bot</div>
          <div className="bubble">{message.text}</div>
          {message.button && !actionDone && (
            <a className="btn btn-primary btn-block" href={message.button.url}>
              {message.button.label}
            </a>
          )}
          {message.expectsReply && <p className="small muted">In Telegram the seller replies with the tracking number in plain text.</p>}
        </div>
      ) : null}
      {message && c.state === "NEEDS_INPUT" && c.pool && c.claimedAt ? (
        <form action="/api/demo/reply" method="post" className="card stack" style={{ marginTop: 12 }}>
          <strong>Reply as the seller</strong>
          <span className="small muted">
            You&apos;re playing the seller who shipped the order but never added tracking. This sample reply is what they would send the bot. Rebuttal adds it to the PayPal order, then
            re-checks the case.
          </span>
          <input type="hidden" name="caseId" value={c.id} />
          <input className="amount" name="reply" defaultValue={sampleReply(c.createdAt)} />
          <button className="btn btn-primary btn-block" type="submit">
            Send reply
          </button>
        </form>
      ) : null}
      {!message && <div className="card muted">The agent is reading the case. This usually takes 20–40 seconds.</div>}

      <h2>Timeline</h2>
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id} className={e.kind}>
            <span className="dot" />
            <div className="ev-title">{e.title}</div>
            <div className="ev-meta">
              {ACTOR[e.actor] ?? e.actor} · {e.at.toISOString().replace("T", " ").slice(0, 19)} UTC
            </div>
            {e.body && e.kind !== "notify" && <div className="ev-body">{e.body}</div>}
            {(e.endpoint || e.debugId || e.detail != null) && (
              <details className="tech">
                <summary>Technical details</summary>
                {e.endpoint && (
                  <div>
                    Endpoint: <span className="mono">{e.endpoint}</span>
                  </div>
                )}
                {e.debugId && (
                  <div>
                    PayPal debug ID: <span className="mono">{e.debugId}</span>
                  </div>
                )}
                {e.detail != null && <pre>{JSON.stringify(e.detail, null, 2)}</pre>}
              </details>
            )}
          </li>
        ))}
        {busy && (
          <li>
            <span className="dot" />
            <div className="ev-title muted">Working…</div>
          </li>
        )}
      </ol>

      <h2>Case details</h2>
      <dl className="kv card">
        <dt>PayPal dispute</dt>
        <dd className="mono">{c.disputeId}</dd>
        <dt>Stage</dt>
        <dd>{c.lifecycleStage ?? "-"}</dd>
        <dt>Deadline</dt>
        <dd>{c.sellerResponseDueDate ? c.sellerResponseDueDate.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "-"}</dd>
        <dt>Verdict</dt>
        <dd>{c.verdict ?? "-"}</dd>
        <dt>Outcome</dt>
        <dd>{c.outcome ?? "-"}</dd>
      </dl>
      {facts.length > 0 && (
        <details className="tech" style={{ marginTop: 12 }}>
          <summary>Facts the agent could cite ({facts.length})</summary>
          <pre>{JSON.stringify(facts.sort((a, b) => Number(a.factId.slice(1)) - Number(b.factId.slice(1))).map((f) => ({ id: f.factId, kind: f.kind, source: f.source, data: f.data })), null, 2)}</pre>
        </details>
      )}
    </main>
  );
}
