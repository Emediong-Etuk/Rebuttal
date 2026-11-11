// Sets up the demo merchant:
//   1. settings row (concede cap, demo pool on)
//   2. PayPal webhook subscription for APP_URL (prints the webhook ID to set as PAYPAL_WEBHOOK_ID)
//   3. optional demo payments charged to the vaulted sandbox buyer (DEMO_VAULT_ID), with tracking for scenarios A and C
//   4. pulls existing open sandbox disputes into the demo pool
// Usage: APP_URL=https://your-app.onrender.com npm run seed [-- --payments A,B,C]
import { eq } from "drizzle-orm";
import { DISPUTE_EVENTS, syncPool } from "@/agent/intake";
import { closeDb, getDb, schema } from "@/db";
import { getPayPal } from "@/paypal/client";

const db = getDb();
const paypal = getPayPal();

await db.insert(schema.settings).values({ id: "default", concedeCap: process.env.CONCEDE_CAP ?? "100" }).onConflictDoNothing();
console.log("settings: ok");

const appUrl = process.env.APP_URL;
if (appUrl && appUrl.startsWith("https://")) {
  const url = `${appUrl.replace(/\/$/, "")}/api/webhooks/paypal`;
  const list = await paypal.listWebhooks();
  const existing = list.data.webhooks.find((w) => w.url === url);
  if (existing) console.log(`webhook: already registered ${existing.id} -> ${url}`);
  else {
    const r = await paypal.createWebhook(url, [...DISPUTE_EVENTS]);
    console.log(`webhook: registered ${r.data.id} -> ${url} (debug ${r.debugId})`);
  }
  console.log("Set PAYPAL_WEBHOOK_ID to the ID above.");
} else console.log("webhook: skipped (APP_URL must be an https URL)");

const arg = process.argv.indexOf("--payments");
const vault = process.env.DEMO_VAULT_ID;
if (arg > -1 && vault) {
  const wanted = (process.argv[arg + 1] ?? "A,B,C").split(",");
  for (const [i, s] of wanted.entries()) {
    const amount = { currency_code: "USD", value: (20 + Math.floor(Math.random() * 30) + i * 0.01).toFixed(2) };
    const r = await paypal.chargeVaultedWallet(vault, amount, `Rebuttal demo order (scenario ${s})`, `seed-${Date.now()}-${i}`);
    const cap = r.data.purchase_units?.[0]?.payments?.captures?.[0];
    if (cap && (s === "A" || s === "C")) {
      const tn = `94001112025558${String(Date.now()).slice(-8)}`;
      await paypal.addTracking({ transactionId: cap.id, trackingNumber: tn, carrier: "USPS", status: "DELIVERED", shipmentDate: new Date().toISOString().slice(0, 10) });
      console.log(`payment ${s}: $${amount.value} capture ${cap.id} with tracking USPS ${tn}`);
    } else console.log(`payment ${s}: $${amount.value} capture ${cap?.id} (no tracking)`);
  }
  console.log("Now file an 'item not received' dispute on each payment as the sandbox buyer.");
}

const added = await syncPool();
console.log(`demo pool: added ${added.length} dispute(s) ${added.join(", ")}`);
const [s] = await db.select().from(schema.settings).where(eq(schema.settings.id, "default"));
console.log(`hold new disputes for demo: ${s?.holdNewDisputesForDemo}`);
await closeDb();
