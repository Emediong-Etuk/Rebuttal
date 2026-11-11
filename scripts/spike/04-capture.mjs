// Capture an approved order and save the result (capture ID, vault ID).
import { pp } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const id = process.argv[2];
const r = await pp("POST", `/v2/checkout/orders/${id}/capture`, { headers: { Prefer: "return=representation" }, json: {} });
writeFileSync(new URL(`./out/capture-${id}.json`, import.meta.url), JSON.stringify(r.data, null, 1));
const pu = r.data?.purchase_units?.[0];
console.log("status:", r.data?.status, "| capture:", pu?.payments?.captures?.[0]?.id, pu?.payments?.captures?.[0]?.status);
console.log("vault:", JSON.stringify(r.data?.payment_source?.paypal?.attributes?.vault ?? null));
console.log("payer:", r.data?.payer?.payer_id, r.data?.payer?.email_address);
if (!r.ok) console.log(JSON.stringify(r.data, null, 1).slice(0, 1500));
