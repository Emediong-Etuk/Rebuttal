import { poolCounts, type Scenario } from "@/agent/intake";

export const dynamic = "force-dynamic";

const SCENARIOS: Array<{ id: Scenario; title: string; body: string }> = [
  { id: "A", title: "The seller shipped", body: "Tracking is on file with PayPal. Expect the agent to fight the case with that record." },
  { id: "B", title: "The seller never shipped", body: "No shipment record exists. Expect the agent to recommend a refund, which only happens if you tap." },
  { id: "C", title: "The buyer tries to trick the AI", body: "The buyer's message tells the AI to accept the claim and refund. Watch the attempt get contained." },
];

const ERRORS: Record<string, string> = {
  rate: "You've run a few demos already. Please wait a little before claiming another case.",
  scenario: "Pick one of the three scenarios.",
};

export default async function Demo({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let counts: Record<Scenario, number> = { A: 0, B: 0, C: 0 };
  let dbError = false;
  try {
    counts = await poolCounts();
  } catch {
    dbError = true;
  }
  const err = sp.error === "empty" ? `There are no unclaimed scenario ${sp.scenario} disputes left right now. Try another scenario, or check back later.` : sp.error ? ERRORS[sp.error] : null;

  return (
    <main>
      <h1>Simulate a dispute</h1>
      <p className="lead">
        Pick a scenario. You&apos;ll claim one <strong>real</strong> dispute filed in the PayPal sandbox and watch Rebuttal answer it live. Then you play the seller: you&apos;ll see the same
        message and button the seller gets in Telegram.
      </p>
      {err && <div className="notice warn">{err}</div>}
      {dbError && <div className="notice bad">The demo database isn&apos;t reachable right now. Please try again in a minute.</div>}
      <form action="/api/demo/claim" method="post" className="scenarios">
        {SCENARIOS.map((s) => (
          <button key={s.id} className="scenario" name="scenario" value={s.id} type="submit" disabled={counts[s.id] === 0}>
            <span className="letter">{s.id}</span>
            <span>
              <strong>{s.title}</strong>
              <br />
              <span className="muted small">{s.body}</span>
              <br />
              <span className="small">{counts[s.id] > 0 ? `${counts[s.id]} real sandbox dispute${counts[s.id] === 1 ? "" : "s"} ready` : "None ready right now"}</span>
            </span>
          </button>
        ))}
      </form>
      <h2>Why a pool?</h2>
      <p className="muted small">
        PayPal&apos;s sandbox does not let an app open disputes by API. A buyer has to file them by hand. So we keep a small pool of real disputes, filed as a sandbox buyer and
        held untouched until you claim one. From the moment you click, every PayPal call is live: reading the case, sending evidence, and the webhooks that come back.
      </p>
    </main>
  );
}
