// Fallback: a plain PayPal-wallet order (no vaulting). Buyer approves in a browser.
import { pp } from "./lib.mjs";
const r = await pp("POST", "/v2/checkout/orders", {
  headers: { Prefer: "return=representation" },
  json: {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: "spike-plain", description: "Rebuttal demo: ceramic mug", amount: { currency_code: "USD", value: "24.00" } }],
    payment_source: { paypal: { experience_context: { return_url: "https://example.com/rebuttal/approved", cancel_url: "https://example.com/rebuttal/cancel", user_action: "PAY_NOW", brand_name: "Rebuttal Demo Shop" } } },
  },
});
console.log(r.data.id, r.data.status, (r.data.links ?? []).find((l) => l.rel === "payer-action")?.href);
