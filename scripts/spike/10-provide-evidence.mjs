// Spike step 5: provide PROOF_OF_FULFILLMENT with tracking, then re-fetch the dispute.
import { pp } from "./lib.mjs";
const [id, carrier, tracking, notes] = process.argv.slice(2);
const f = new FormData();
const input = { evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: carrier, tracking_number: tracking }] }, notes }] };
f.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
const r = await pp("POST", `/v1/customer/disputes/${id}/provide-evidence`, { form: f, requestId: `spike-${id}-provide-evidence-1` });
console.log("request input:", JSON.stringify(input));
console.log("response:", JSON.stringify(r.data).slice(0, 600));
const d = await pp("GET", `/v1/customer/disputes/${id}`);
console.log({ status: d.data.status, stage: d.data.dispute_life_cycle_stage, links: d.data.links.map((l) => l.rel).join(" ") });
console.log("evidences:", JSON.stringify(d.data.evidences));
