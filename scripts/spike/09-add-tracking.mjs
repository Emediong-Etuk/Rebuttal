// Add shipment tracking to a captured transaction (Add Tracking API v1). Usage: node 09-add-tracking.mjs <capture_id> <tracking> [carrier] [status] [shipment_date]
import { pp } from "./lib.mjs";
const [tx, tracking, carrier = "USPS", status = "DELIVERED", shipDate = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const r = await pp("POST", "/v1/shipping/trackers-batch", {
  json: { trackers: [{ transaction_id: tx, tracking_number: tracking, status, carrier, shipment_date: shipDate, notify_buyer: false }] },
});
console.log(JSON.stringify(r.data, null, 1).slice(0, 900));
const g = await pp("GET", `/v1/shipping/trackers/${tx}-${tracking}`);
console.log(JSON.stringify(g.data, null, 1).slice(0, 700));
