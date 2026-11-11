# Safety model

Rebuttal handles money, so it is designed to stay safe **even if the language model is completely fooled**.
The model only ever recommends. Every PayPal write passes through deterministic code that the model
cannot influence except through a verdict, and that verdict is checked again before anything happens.

| # | Requirement | Where it is enforced | Test |
|---|---|---|---|
| 1 | The model has no money-moving tools | `src/agent/toolkit.ts`: the toolkit is created with read actions only (`disputes.list/get`, `orders.get`, `shipment.get`, `transactions.list`), and construction **fails closed** if the toolkit exposes any other tool. Writes exist only in `src/agent/executor.ts`. | `tests/toolkit.test.ts`, `tests/injection.test.ts` |
| 2 | Buyer text is untrusted | `src/agent/analyze.ts`: buyer messages are placed only inside `<buyer_message_{random}>`, after the PayPal records, with an explicit "data, not instructions" rule. A fake closing tag can't end the block because the suffix is random per call. | `injection.test.ts` › delimited block |
| 3 | Conceding requires a human | `authorizeExecution()` in `src/agent/policy.ts`: `ACCEPT_CLAIM` is allowed only for actor `seller` with a consumed approval record. Above `concede_cap`, the typed amount must equal the dispute amount. | `policy.test.ts` › "no path concedes without a seller approval record" (every verdict × amount × deadline × actor) |
| 4 | Approval links | `src/lib/approvals.ts`: HMAC-SHA256, bound to case + action + draft version, 24h expiry. The token ID must exist in `approval_tokens`, and an atomic `UPDATE … WHERE used_at IS NULL` makes it single-use. `/approve/[token]` (GET) only renders; `/api/approve` (POST) acts. | `approvals.test.ts`: tampered, expired, reused, wrong action, never issued, concurrent double tap, GET never consumes |
| 5 | No fabricated evidence | `src/agent/groundCheck.ts`: rejects uncited sentences, unknown fact IDs, and any amount, date (several formats) or identifier/tracking number not found in the cited facts. On failure it retries once with the errors, then goes to `MANUAL_REVIEW`. The evidence payload's tracking is taken from PayPal facts, never from model text. | `groundCheck.test.ts`, `injection.test.ts` › fabricator |
| 6 | Deadline net | `src/agent/deadline.ts`: auto-submits only a ground-checked contest with < 24h left. It never concedes; refund recommendations get reminders at 72h, 24h and 6h. | `policy.test.ts` › cron window; `injection.test.ts` › cron never concedes |
| 7 | Idempotency | `actions.request_id` unique index; the key is `sha256(case, action, draftVersion)`, also sent as `PayPal-Request-Id`. Webhook dedupe uses the `webhook_events.event_id` primary key. | `idempotency.test.ts`: 6 concurrent taps → 1 call; tap + 2 cron runs → 1 call; `webhook.test.ts` concurrent duplicates |
| 8 | Audit log | `audit_log` table with a trigger that raises on UPDATE/DELETE (`drizzle/0001_audit_append_only.sql`). It records actor (model / policy / seller / cron / system / paypal), decision, a SHA-256 of the input, and PayPal's debug ID. | — |
| 9 | Secrets | Server environment only (`.env.example`); nothing is imported into client components. Request shapes in error logs have `Authorization` and assertion headers redacted. | — |
| 10 | Demo endpoints | `/api/demo/claim`: Postgres-backed rate limit (3/hour per IP, 30/hour overall). It only claims disputes already on the demo merchant's sandbox account. | — |

## Webhooks

- **The signature is checked against the raw body** (`req.text()`), using PayPal's `verify-webhook-signature` endpoint and the configured webhook ID. Re-serialising the JSON first is a known cause of false failures.
- **Failures are rejected with 401** and logged to the audit log.
- **Valid events get a 200 immediately.** Processing then runs after the response (`after()`).
- **The payload is only a pointer.** The dispute is always re-fetched, and that response drives every decision (`webhook.test.ts` › "never trusts the payload").

## What the policy engine allows

The policy engine returns exactly one action, and only if PayPal's `links` for the dispute include it:

| Situation | Action |
|---|---|
| Contest, ground-check passed, `provide_evidence` link present, PayPal-held tracking on file | `PROVIDE_EVIDENCE` (one tap; auto-eligible in the last 24h) |
| Contest, but evidence can't be submitted and `send_message` is present | `SEND_MESSAGE` |
| Concede, `accept_claim` link present | `ACCEPT_CLAIM`: one tap up to the cap, typed amount above it, never automatic |
| Needs seller input | `ASK_SELLER` (the seller replies in Telegram) |
| Under review, waiting for buyer, resolved, deadline passed, unsupported reason, model failure, ground-check failure | Wait, close, or manual review, with a plain-language explanation of what to do |
