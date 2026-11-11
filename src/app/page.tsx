import Link from "next/link";
import { REPO_URL } from "@/lib/site";

export default function Home() {
  return (
    <main>
      <h1>Every PayPal dispute, answered before the deadline.</h1>
      <p className="lead">
        When a buyer says an order never arrived, small sellers have days to respond with evidence, and most miss it and lose by default. Rebuttal reads the case,
        checks PayPal&apos;s own records, and either fights it with real evidence or tells you to refund. You just tap once.
      </p>
      <div className="row">
        <Link href="/demo" className="btn btn-primary">
          Simulate a dispute
        </Link>
        <a href={REPO_URL} className="btn btn-ghost">
          View the code
        </a>
      </div>

      <h2>How it works</h2>
      <ol className="steps">
        <li>PayPal tells Rebuttal a case was opened. Rebuttal verifies the message and re-reads the case from PayPal.</li>
        <li>An AI agent gathers the order, payment and shipment records with PayPal&apos;s read-only agent tools.</li>
        <li>Claude decides: fight, refund, or ask you for one missing thing. Every sentence it writes must cite a PayPal record, checked by code, not by the AI.</li>
        <li>A fixed rulebook picks the one allowed next step. You get one chat message with one button.</li>
        <li>If you forget, Rebuttal submits a grounded defence 24 hours before the deadline. It never refunds without you.</li>
      </ol>

      <h2>Built to be safe</h2>
      <div className="card stack small">
        <div>The AI cannot move money. Its PayPal tools are read-only.</div>
        <div>A buyer&apos;s message is treated as data. Telling the AI to “refund me” does nothing.</div>
        <div>Refunds need your tap, and above your limit you must type the amount.</div>
        <div>Approval links are signed, single-use, expire in 24 hours, and only act on a button press, never on a link preview.</div>
      </div>
    </main>
  );
}
