// Try: create + capture an order paid by a sandbox test card (no buyer browser approval needed).
import { pp } from "./lib.mjs";
const amount = process.argv[2] ?? "24.00";
const r = await pp("POST", "/v2/checkout/orders", {
  headers: { Prefer: "return=representation" },
  json: {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: "spike-card", description: "Spike: ceramic mug", amount: { currency_code: "USD", value: amount } }],
    payment_source: { card: { number: "4111111111111111", expiry: "2030-12", security_code: "123", name: "Test Buyer" } },
  },
});
console.log(JSON.stringify(r.data, null, 1).slice(0, 2500));
