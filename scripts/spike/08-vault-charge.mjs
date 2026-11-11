// Charge the vaulted sandbox buyer wallet server-side: no browser needed. Usage: node 08-vault-charge.mjs <vault_id> [amount]
import { pp } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const [vaultId, amount = "24.00"] = process.argv.slice(2);
const r = await pp("POST", "/v2/checkout/orders", {
  headers: { Prefer: "return=representation" },
  json: {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: "demo", description: "Rebuttal demo: ceramic mug", amount: { currency_code: "USD", value: amount },
      shipping: { name: { full_name: "Sandbox Buyer" }, address: { address_line_1: "1 Main St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" } } }],
    payment_source: { paypal: { vault_id: vaultId } },
  },
});
writeFileSync(new URL(`./out/vault-charge-${r.data?.id}.json`, import.meta.url), JSON.stringify(r.data, null, 1));
const cap = r.data?.purchase_units?.[0]?.payments?.captures?.[0];
console.log("order:", r.data?.id, r.data?.status, "| capture:", cap?.id, cap?.status);
if (!r.ok) console.log(JSON.stringify(r.data, null, 1).slice(0, 1500));
