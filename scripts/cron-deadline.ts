// Render cron job (every 30 minutes): deadline safety net + pool sync.
import { runDeadlineNet } from "@/agent/deadline";
import { syncPool } from "@/agent/intake";
import { closeDb } from "@/db";

const report = await runDeadlineNet();
console.log("deadline net:", JSON.stringify(report));
const added = await syncPool().catch((e) => (console.error("pool sync failed", e), []));
console.log("pool sync added:", added);
await closeDb();
