// Sandbox-only: create a dispute as the buyer. Usage: node 06-create-dispute.mjs <transaction_id> [amount] [reason]
import { pp, buyerAssertion } from "./lib.mjs";
const [txn, amount = "12.00", reason = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"] = process.argv.slice(2);
const form = new FormData();
form.append("input", new Blob([JSON.stringify({
  disputed_transactions: [{ buyer_transaction_id: txn }],
  reason,
  dispute_amount: { currency_code: "USD", value: amount },
  extensions: { merchant_contacted: true, merchant_contacted_outcome: "NO_RESPONSE", merchandize_dispute_properties: { issue_type: "PRODUCT" } },
})], { type: "application/json" }));
const r = await pp("POST", "/v1/customer/disputes", { form, headers: { "PayPal-Auth-Assertion": buyerAssertion(process.env.PAYPAL_CLIENT_ID_PUBLIC, process.env.BUYER_EMAIL) } });
console.log(JSON.stringify(r.data, null, 1).slice(0, 1500));
