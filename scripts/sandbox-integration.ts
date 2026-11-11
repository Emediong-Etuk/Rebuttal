// Sandbox integration test (needs real sandbox credentials; not part of `npm test`).
//   npm run test:sandbox                      -> order + capture (vaulted buyer) + tracking + read-back
//   npm run test:sandbox -- --dispute <id>    -> also: provide evidence on that dispute and confirm the status change
// Disputes cannot be created by API in the sandbox (see docs/SANDBOX_NOTES.md), so the dispute step uses
// one filed by the sandbox buyer.
import { getPayPal } from "@/paypal/client";
import { hasLink } from "@/paypal/types";

const paypal = getPayPal();
const vault = process.env.DEMO_VAULT_ID;
const step = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) process.exitCode = 1;
};

const token = await paypal.accessToken();
step("OAuth token", token.length > 20);

if (vault) {
  const order = await paypal.chargeVaultedWallet(vault, { currency_code: "USD", value: "11.11" }, "Rebuttal integration test", `it-${Date.now()}`);
  const cap = order.data.purchase_units?.[0]?.payments?.captures?.[0];
  step("Create + capture order (vaulted sandbox buyer)", order.data.status === "COMPLETED" && !!cap, `order ${order.data.id}, capture ${cap?.id}, debug ${order.debugId}`);
  if (cap) {
    const tn = `9400111202555${String(Date.now()).slice(-9)}`;
    const t = await paypal.addTracking({ transactionId: cap.id, trackingNumber: tn, carrier: "USPS", status: "DELIVERED", shipmentDate: new Date().toISOString().slice(0, 10) });
    step("Add tracking", (t.data.errors ?? []).length === 0, `debug ${t.debugId}`);
    const back = await paypal.getTracker(cap.id, tn);
    step("Read tracking back", (back.data as { tracking_number?: string }).tracking_number === tn, `debug ${back.debugId}`);
  }
} else console.log("SKIP  order/capture (set DEMO_VAULT_ID to the vaulted sandbox buyer token)");

const i = process.argv.indexOf("--dispute");
if (i > -1) {
  const id = process.argv[i + 1]!;
  const before = (await paypal.getDispute(id)).data;
  step("Read dispute", !!before.status, `${before.status}, links: ${before.links.map((l) => l.rel).join(" ")}`);
  if (hasLink(before, "provide_evidence")) {
    const tx = before.disputed_transactions?.[0]?.seller_transaction_id;
    const trackers = tx ? (await paypal.listTrackers(tx)).data.trackers ?? [] : [];
    const t = trackers[0] as { carrier?: string; tracking_number?: string } | undefined;
    if (!t?.tracking_number) step("Tracking on file for disputed transaction", false);
    else {
      const r = await paypal.provideEvidence(
        id,
        { evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: t.carrier ?? "USPS", tracking_number: t.tracking_number }] }, notes: "Integration test: shipment record on file." }] },
        `it-${id}-${Date.now()}`,
      );
      step("provide-evidence", r.status === 200, `debug ${r.debugId}`);
      const after = (await paypal.getDispute(id)).data;
      step("Status changed", after.status !== before.status, `${before.status} -> ${after.status}`);
    }
  } else console.log(`SKIP  provide-evidence (PayPal does not offer it on ${id} now)`);
}
