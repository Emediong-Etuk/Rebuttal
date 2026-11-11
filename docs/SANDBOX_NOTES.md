# Sandbox notes (Phase 0 spike)

Findings from probing the PayPal sandbox on 10–11 November 2026. Spike scripts are in
`scripts/spike/`. Every call they make is logged (request shape with secrets redacted, status,
`PayPal-Debug-Id`) to `scripts/spike/out/calls.log`, which is git-ignored.

Sources checked:

- PayPal's OpenAPI specs (`paypal/paypal-rest-api-specifications`, `customer_disputes_v1.json`).
- The docs as Markdown (`developer.paypal.com/<path>.md`, indexed by `developer.paypal.com/llms.txt`).
  The main page was `/disputes/test-go-live`.
- The `@paypal/agent-toolkit@1.11.0` package source.

## Results by spike step

| # | Step | Result |
|---|------|--------|
| 1 | OAuth token | **Works.** `POST /v1/oauth2/token` (client credentials). The token scope includes `disputes/read-seller`, `disputes/update-seller`, `disputes/create`, `applications/webhooks`. Debug `f960463999b09`. |
| 2 | Create and capture an order | **Create works, capture is blocked on buyer approval.** PayPal-wallet orders need the sandbox buyer to approve in a browser. Card orders (`payment_source.card`, which skip approval) fail with `422 PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` (debug `ca588a680ff7e`): the sandbox merchant isn't enabled for advanced card processing. Vault-on-success wallet orders are accepted (debug `f82008743c0a6`). Once one buyer approval succeeds, the app can charge the vaulted wallet server-side for any number of demo payments. Buyer approval hasn't succeeded yet: the buyer's login asked for a phone code, which the sandbox never sends. |
| 3 | Create a dispute by API | **The documented sandbox method exists but is limited for this app.** `POST /v1/customer/disputes` (multipart, `input` JSON part) is sandbox-only. With the documented unsigned `PayPal-Auth-Assertion` (`{"alg":"none"}` header, payload `{iss: <client id>, email: <buyer email>}`) it returns `400 invalid_request: No permissions to set target_client_id` (debug `f871683e57712`). **Without** the assertion the same call validates the request and returns `TRANSACTION_NOT_ELIGIBLE` for a made-up transaction ID (debug `f665257eb5f40`). That suggests it may succeed with a real transaction from the merchant side. Not yet confirmed: there's no real transaction yet (step 2). Manual route: the sandbox buyer files a case in the sandbox Resolution Center. |
| 4 | Get the dispute to `WAITING_FOR_SELLER_RESPONSE` | **Documented, not yet exercised.** Sandbox-only `POST /v1/customer/disputes/{id}/require-evidence` with `{"action":"SELLER_EVIDENCE"}` moves `UNDER_REVIEW` → `WAITING_FOR_SELLER_RESPONSE`. It's only allowed when the `require-evidence` link is present. `POST .../escalate` moves an `INQUIRY` to a claim. `POST .../adjudicate` with `{"adjudication_outcome":"SELLER_FAVOR"|"BUYER_FAVOR"}` settles an `UNDER_REVIEW` case. The docs say actions take "a few minutes" to appear after creation. |
| 5 | `provide-evidence` with tracking | **Not yet exercised** (needs a dispute). Shape per docs and spec: multipart; part `input` is JSON `{"evidences":[{"evidence_type":"PROOF_OF_FULFILLMENT","evidence_info":{"tracking_info":[{"carrier_name":"USPS","tracking_number":"..."}]},"notes":"..."}]}`; optional file parts `evidence-file`. Merchant may call it only in `WAITING_FOR_SELLER_RESPONSE` and only when the `provide_evidence` link is present. |
| 6 | Webhook register and verify | **Not yet exercised.** It needs a public HTTPS URL, which comes with the Render deploy. Listing webhooks works (`GET /v1/notifications/webhooks` → `[]`). Verification is `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time`, `webhook_id`, and the `webhook_event` parsed from the **raw** body. |

## Other confirmed facts

- **Agent toolkit.** `@paypal/agent-toolkit/ai-sdk` with
  `actions: { disputes: { list, get }, orders: { get }, shipment: { get }, transactions: { list } }`
  exposes exactly `get_shipment_tracking`, `get_order`, `list_disputes`, `get_dispute` and `list_transactions`.
  `accept_dispute_claim` is gated by a separate `disputes.create` key and is **not** exposed.
  `list_disputes` ran successfully against the sandbox through the toolkit.
- **Toolkit dependency mismatch.** The toolkit bundles `ai@4` and `zod@3`, so its tools use the v4
  shape `{ description, parameters, execute }`. Rebuttal re-wraps them for `ai@7`
  (`src/agent/toolkit.ts`). npm needs `legacy-peer-deps=true` (`.npmrc`), or it crashes resolving peers.
- **Transaction search** (`/v1/reporting/transactions`) returns `403 NOT_AUTHORIZED`
  (debug `f65864428ebc6`). The sandbox app doesn't have the Transaction Search feature enabled.
  The toolkit's `list_transactions` tool will return that error until it's enabled under
  **Apps & Credentials → app → Features**. The pipeline records the error as a fact and carries on.
- **Accept-claim body.** The spec documents `accept-claim` and `send-message` as `multipart/form-data`
  (file parts `accept-claim-document`, `message_document`) but doesn't show the JSON fields. Per the
  test guide: `accept_claim_type` (`REFUND`, `REFUND_WITH_RETURN`, `PARTIAL_REFUND`, …),
  `refund_amount`, `note`. The client sends them as an `input` JSON part, matching provide-evidence.
  Not yet verified against the sandbox.
- **Link `rel` names.** Taken from the docs' text (`provide_evidence`, `accept_claim`, `send_message`,
  `make_offer`, `require-evidence`, `adjudicate`, `escalate`). The policy engine matches rels with
  `_` and `-` treated as equal, so either spelling works.
- **Sandbox escalation timing** is controlled by the transaction amount: $5.00–5.99 escalates on
  day 5, $9.00–9.99 on day 9, $11.00 and up on day 11.

## Consequence for "Simulate a dispute" (brief section 9)

Live, API-created disputes are **not available yet**:

- Every route to a disputable transaction needs one successful sandbox-buyer browser login.
- The buyer-side create-dispute assertion is refused for this app.

**Decision (project owner, 11 Nov): stay live, no replay mode.** The plan:

1. The sandbox buyer approves one vault-on-success order in a browser (use phone code `111111` if asked).
2. Rebuttal charges the vaulted wallet server-side for each new demo payment.
3. It creates the dispute with `POST /v1/customer/disputes` from the merchant side, without the assertion.
   If that is refused, it falls back to a pool of disputes the sandbox buyer pre-filed in the Resolution Center.
4. The sandbox-only `require-evidence` method moves each dispute to `WAITING_FOR_SELLER_RESPONSE`.
