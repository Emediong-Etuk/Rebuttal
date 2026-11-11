# Technical walkthrough script (about 4–5 minutes)

Audience: judges scoring technical implementation. Show real sandbox calls with debug IDs, then the tests.
Keep PayPal logos off screen (no sandbox UI or developer dashboard). The site and the code have none.

## 1. Architecture (0:00–0:50)
- **Screen:** README on GitHub, scrolled to the Mermaid diagram.
- **Say:** "A PayPal webhook arrives. We verify its signature against the raw body, de-duplicate it on the event ID, and re-fetch the dispute, because the payload is only a pointer. Then six steps: gather facts with PayPal's Agent Toolkit in read-only mode, analyse with Claude, a deterministic ground-check, a deterministic policy engine, one message to the seller, and execution only on approval or by the deadline net."

## 2. A live case, step by step (0:50–2:40)
- **Screen:** `/demo` → Scenario A → the case page. Expand **Technical details** on each step.
  - **Webhook / claim:** dispute ID; the endpoint `GET /v1/customer/disputes/{id}` and its debug ID.
  - **Facts:** toolkit calls `get_dispute → F1, F2`, `get_shipment_tracking → F3`, `list_transactions → F4`, `get_order → F5`. Open "Facts the agent could cite" and point out F3's tracking number.
  - **Verdict:** the Zod-validated JSON. Show `rebuttal[].fact_ids`, and that the model label says Claude via the AI SDK.
  - **Ground-check passed:** "every claim traced to a fact".
  - **Policy:** `contest_with_evidence`, chosen because PayPal's `links` include `provide_evidence`.
- **Screen:** tap the seller button. The confirmation page opens; the URL is a signed token.
- **Say:** "Opening this link changes nothing. Chat apps prefetch links for previews, so only the POST acts. The token is HMAC-signed, single-use, bound to this case, this action and this draft, and expires in 24 hours."
- **Screen:** press **Send evidence**. On the timeline, "Evidence sent to PayPal" shows the endpoint `POST /v1/customer/disputes/{id}/provide-evidence`, the debug ID, the `PayPal-Request-Id`, the multipart payload with `PROOF_OF_FULFILLMENT` and the tracking taken from F3, and PayPal's status now `UNDER_REVIEW`.
- **Optional:** show `docs/SANDBOX_NOTES.md` with the spike's debug IDs, including why disputes can't be created by API (debug `f142901a918a7`, `ca58d31cb3fa7`).

## 3. Prompt injection (2:40–3:20)
- **Screen:** Scenario C case page.
- **Say:** "The buyer's message tries to instruct the AI. It sits in a randomly tagged, untrusted block. The model has no write tools; the toolkit is configured read-only and fails closed if that ever changes. Refunds need the seller. So even a compromised model can't pay out."
- **Screen:** `tests/injection.test.ts`. Point at the `compromised` analyzer and `expect(paypal.writes).toEqual([])`.

## 4. Tests (3:20–4:20)
- **Screen:** terminal running `npm test`, showing 70 tests passing:
  - `policy.test.ts`: table of every verdict, cap, deadline and links combination, plus "no path concedes without a seller approval record".
  - `groundCheck.test.ts`: invented tracking numbers, dates and amounts are rejected.
  - `webhook.test.ts`: invalid signature, duplicates, the payload is never trusted.
  - `approvals.test.ts`: tampered, expired, reused, wrong-action and concurrent tokens.
  - `idempotency.test.ts`: six racing taps produce one PayPal call; a tap racing two cron runs produces one call.
- **Screen:** `npm run test:sandbox` shows PASS lines with live debug IDs (order + capture with no browser, add tracking, read back).
- **Screen:** the GitHub Actions CI run, green.

## 5. Close (4:20–4:40)
- **Say:** "PayPal's own links drive the state machine, Claude only recommends, and deterministic code guards every write. The code is MIT licensed at github.com/emediong-etuk/rebuttal."
