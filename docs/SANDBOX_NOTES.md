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

The sandbox app was replaced on 11 Nov: the first app's business account was locked, so checkout
failed with `PAYEE_ACCOUNT_LOCKED_OR_CLOSED`. The current app is `APP-35D99178M87007202`, linked to
merchant `42AM6WMA753RC` (`sb-j9owx53830354@business.example.com`).

| # | Step | Result |
|---|------|--------|
| 1 | OAuth token | **Works.** `POST /v1/oauth2/token` (client credentials). Scope includes `disputes/read-seller`, `disputes/update-seller`, `disputes/create`, `applications/webhooks`, vault. |
| 2 | Create and capture an order | **Works.** The buyer approved a vault-on-success PayPal-wallet order once. Capture `8RX514794A220173K` (debug `f705770443e11`), vault token `6ws26313fr244171c`. After that, **orders charged to the vaulted wallet complete server-side with no browser**: `95P462672F991615E` $24.00 (debug `f889631532f43`), `4MV93340DD073160E` $18.00, `4KT96773NB9182150` $33.00. Card orders (no approval needed) fail with `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` (debug `ca588a680ff7e`). |
| 3 | Create a dispute | **API: not available. Manual route works.** The sandbox-only `POST /v1/customer/disputes` is refused in every form we tried. With the documented buyer `PayPal-Auth-Assertion` (by email or by payer ID): `400 No permissions to set target_client_id` (debug `f142901a918a7`, `ca58969a20f8e`). Without it: `TRANSACTION_NOT_ELIGIBLE`, using the seller ID (debug `f3222063dd96d`), the real buyer-side ID `65F05326NA2473541` (debug `ca58d31cb3fa7`), or `seller_transaction_id` (debug `ca589699fc90b`). **The buyer filing in the sandbox Resolution Center works**: dispute `PP-R-AXP-10198570` (item not received, $30.00 claimed on the $33.00 payment) appeared in `GET /v1/customer/disputes` about 3 minutes after filing. |
| 4 | Reach `WAITING_FOR_SELLER_RESPONSE` | **Immediate for item-not-received.** A buyer-filed case arrives as `INQUIRY` / `WAITING_FOR_SELLER_RESPONSE`, with `seller_response_due_date` 20 days out. Links: `escalate`, `make_offer`, `send_message`, `provide_evidence`, `accept_claim`. The `evidences` array contains `{"evidence_type":"PROOF_OF_FULFILLMENT","source":"REQUESTED_FROM_SELLER"}`. `allowed_response_options.accept_claim.accept_claim_types` is `["PARTIAL_REFUND","REFUND"]`. No sandbox `require-evidence` call is needed. The buyer's text is in `messages[].content` (`posted_by: BUYER`) and in the `CREATE` evidence `notes`. |
| 5 | `provide-evidence` with tracking | **Works.** Multipart, single part `input` (`application/json`): `{"evidences":[{"evidence_type":"PROOF_OF_FULFILLMENT","evidence_info":{"tracking_info":[{"carrier_name":"USPS","tracking_number":"9400111202555842761049"}]},"notes":"..."}]}`, with a `PayPal-Request-Id` header. Response 200 (debug `ca58d32171e1a`), body is just a `detail` link. Re-fetch: status `WAITING_FOR_SELLER_RESPONSE` → **`UNDER_REVIEW`**, links reduced to `self`, evidence recorded as `SUBMITTED_BY_SELLER`. |
| 6 | Webhook register and verify | **Works.** Registered by API: `POST /v1/notifications/webhooks` → webhook `82T468282C6122132` for `https://rebuttal-eta.vercel.app/api/webhooks/paypal` (debug `f70649491805e`). Real `CUSTOMER.DISPUTE.CREATED` deliveries verify with `POST /v1/notifications/verify-webhook-signature` → `SUCCESS` (debug `f3946736db5ae`) and were processed into cases. Two lessons: (a) the first deliveries were rejected because the deployed app had a wrong client secret, so the verify call itself failed (`invalid_client`); rejections now record `VERIFY_ERROR` separately from `INVALID_SIGNATURE`. (b) The event is embedded byte-for-byte from the raw body. `POST /v1/notifications/webhooks-events/{id}/resend` re-delivers an event, which is useful for recovery. |

Also verified: **Add Tracking**. `POST /v1/shipping/trackers-batch` with
`{transaction_id, tracking_number, status:"DELIVERED", carrier:"USPS", shipment_date}` returns 200
(debug `f37764538186b`). `GET /v1/shipping/trackers/{txn}-{tracking}` reads it back.

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

- **Payments can be created live.** The app charges the vaulted sandbox buyer on demand, with no browser.
- **Disputes cannot be created live.** The sandbox create-dispute API is refused for this account, and
  disputes only come from the buyer filing in the Resolution Center.
- **So "Simulate a dispute" claims one dispute from a pool of real, pre-filed sandbox disputes.** These
  are filed by the project owner as the sandbox buyer. Each one is real: PayPal holds it, sends its
  webhooks and accepts its responses.
- **Pool size limits the demo.** When the pool is empty, the demo page says so plainly; it does not
  fall back to fake data.
- **Replay mode is not built** (owner's decision, 11 Nov).

## Later findings (12 Nov)

- **Some buyer filings became chargebacks.** Disputes on payments whose tracking said `DELIVERED` arrived as
  `dispute_life_cycle_stage: CHARGEBACK`, status `UNDER_REVIEW`, with only a `provide_supporting_info` link.
  Rebuttal's policy treats them as manual review, as designed. Payments with tracking marked `SHIPPED` are
  used for scenario A instead.
- **Item-not-received inquiries arrive ready to answer.** They come in as `INQUIRY` / `WAITING_FOR_SELLER_RESPONSE`,
  with `provide_evidence`, `send_message`, `accept_claim`, `make_offer` and `escalate` links, and a due date 20 days out.
