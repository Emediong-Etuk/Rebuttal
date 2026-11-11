// Check @paypal/agent-toolkit ai-sdk tools: which are exposed with read-only config, and that list_disputes executes.
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
const tk = new PayPalAgentToolkit({
  clientId: process.env.PAYPAL_CLIENT_ID ?? "proxy-injected",
  clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "proxy-injected",
  configuration: { actions: { disputes: { list: true, get: true }, orders: { get: true }, shipment: { get: true }, transactions: { list: true } }, context: { sandbox: true, access_token: process.env.PP_TOKEN } },
});
if (process.env.PP_TOKEN) tk.client._accessToken = process.env.PP_TOKEN; // dev sandbox only: proxy holds the secret
const tools = tk.getTools();
console.log("tools:", Object.keys(tools));
console.log("tool shape keys:", Object.keys(tools.get_dispute));
try { const r = await tools.list_disputes.execute({ page_size: 5 }, {}); console.log("list_disputes ->", JSON.stringify(r).slice(0, 300)); }
catch (e) { console.log("list_disputes error:", e.message); }
