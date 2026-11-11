import { desc, or, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import type { CaseState } from "@/db/schema";
import { STATE_LABEL } from "@/lib/labels";
import { money, timeLeft } from "@/notify/message";

export const dynamic = "force-dynamic";

export default async function Cases() {
  const rows = await getDb()
    .select()
    .from(schema.cases)
    .where(or(eq(schema.cases.pool, false), isNotNull(schema.cases.claimedAt)))
    .orderBy(desc(schema.cases.updatedAt))
    .limit(50);
  return (
    <main>
      <h1>Cases</h1>
      {rows.length === 0 ? (
        <p className="muted">
          No cases yet. <Link href="/demo">Simulate one</Link>.
        </p>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>Amount</th>
              <th>Status</th>
              <th>Time left</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const l = STATE_LABEL[c.state as CaseState] ?? { text: c.state, tone: "" };
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/cases/${c.id}`}>{money(c.amountValue, c.amountCurrency)}</Link>
                    <div className="small muted mono">{c.disputeId}</div>
                  </td>
                  <td>
                    <span className={`pill ${l.tone}`}>{l.text}</span>
                  </td>
                  <td className="small">{c.state === "RESOLVED" ? "closed" : timeLeft(c.sellerResponseDueDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
