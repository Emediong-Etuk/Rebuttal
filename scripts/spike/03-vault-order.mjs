// Create an order paid with the buyer's PayPal wallet, asking PayPal to vault it on success.
// The buyer approves once in a browser; afterwards 04 can charge the vaulted wallet server-side.
import { pp } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const r = await pp("POST", "/v2/checkout/orders", {
  headers: { Prefer: "return=representation" },
  json: {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: "spike-vault", description: "Rebuttal setup: ceramic mug", amount: { currency_code: "USD", value: "12.00" } }],
    payment_source: { paypal: {
      attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } },
      experience_context: { return_url: "https://example.com/rebuttal/approved", cancel_url: "https://example.com/rebuttal/cancel", shipping_preference: "GET_FROM_FILE", user_action: "PAY_NOW", brand_name: "Rebuttal Demo Shop" },
    } },
  },
});
writeFileSync(new URL("./out/vault-order.json", import.meta.url), JSON.stringify(r.data, null, 1));
console.log(r.data.id, r.data.status);
for (const l of r.data.links ?? []) console.log(l.rel, l.href);
if (!r.ok) console.log(JSON.stringify(r.data, null, 1));
