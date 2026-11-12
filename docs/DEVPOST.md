# Devpost submission draft: Rebuttal

**Tagline:** An AI agent that answers every PayPal dispute before the deadline: it fights with real evidence, recommends a refund when you're wrong, and you resolve it with one tap.

**Links**
- Live demo: https://rebuttal-eta.vercel.app (no login, no PayPal account needed)
- Code: https://github.com/emediong-etuk/rebuttal (MIT)
- Pitch video: _add link_
- Technical walkthrough: _add link_

---

## Inspiration

A buyer says their order never arrived and opens a PayPal dispute. The seller has a short window to respond with evidence. Solo sellers are busy shipping, not watching a Resolution Center, so many miss the deadline or answer without the evidence PayPal asked for, and lose the money by default. That happens even when they shipped the item and the tracking number is already in PayPal.

PayPal's own Agent Toolkit has three dispute tools: list, get, and **accept** a claim. An AI agent connected to a seller's account today can read a dispute and concede it, but it can't fight it. We built the other half.

## What it does

Rebuttal answers every **item not received** dispute before the deadline:

- **Contests with real evidence** when PayPal holds a shipment record for the order. It sends `PROOF_OF_FULFILLMENT` with the tracking on file, plus a short rebuttal in which every sentence is traced to a PayPal record.
- **Recommends a refund** when there's no evidence. Conceding *always* needs the seller's tap, and above a set amount the seller has to type the amount.
- **Asks for the one missing thing** (usually a tracking number). The seller replies to the bot in plain text; Rebuttal adds it to the PayPal order and re-checks the case.
- **Never misses a deadline.** If the seller ignores a grounded "fight" recommendation, Rebuttal submits it automatically 24 hours before the deadline. It never refunds on its own.

The seller's whole experience is one Telegram message, written in plain language with no PayPal jargon ("3 days left"), and one button. There are no forms and no uploads.

## How we built it

- **Next.js (App Router) + TypeScript (strict)**, Postgres with **Drizzle ORM**, deployed on **Vercel** with Neon Postgres. A Render blueprint is included too.
- **PayPal webhooks** (`CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED`): the signature is verified against the raw body, events are de-duplicated by event ID, and the payload is treated only as a pointer. The dispute is always re-fetched from the Disputes API.
- **Agent pipeline**, with every step on a live case timeline:
  1. **Gather facts** with the **PayPal Agent Toolkit**, configured read-only: `get_dispute`, `get_shipment_tracking`, `list_transactions`, `get_order`. Every record gets a stable fact ID.
  2. **Analyse** with **Claude** through the **Vercel AI SDK**. The output is a Zod-validated object: verdict, confidence, plain-language reasoning, evidence plan, and a rebuttal where each sentence cites fact IDs.
  3. **Ground-check** (deterministic). Sentences with no citation, unknown fact IDs, or any tracking number, date, amount or ID not present in the cited facts are rejected. It retries once with the errors, then falls back to manual review.
  4. **Policy engine** (deterministic). Given the verdict, deadline, the actions PayPal currently offers (`links`) and the seller's limits, it returns the single permitted next action.
  5. **Notify** the seller with one message and one button: an HMAC-signed, single-use link that expires in 24 hours.
  6. **Execute** on approval: `provide-evidence` (multipart), `send-message` or `accept-claim`, each with a `PayPal-Request-Id` idempotency key. Then it follows the case through to resolution.
- **Deadline net**: every 30 minutes, run by a GitHub Actions schedule.
- **70 automated tests** (Vitest) plus a CI workflow.

## How PayPal is used

PayPal is the system of record, and Rebuttal never acts on its own assumptions. Only actions present in the dispute's HATEOAS `links` are ever attempted.

| What | Used for |
|---|---|
| Agent Toolkit (`@paypal/agent-toolkit`, AI SDK) | The agent's read-only investigation tools |
| Disputes API | Show, provide-evidence, send-message, accept-claim |
| Webhooks API | Verify-webhook-signature, event subscriptions |
| Add Tracking API | Put the seller's tracking on the transaction, and read it back |
| Orders v2 + vaulted wallet | Demo payments created server-side |

## Which AI tools are used, and how

- **Claude** via the **Vercel AI SDK** (`@ai-sdk/anthropic`, with an OpenRouter fallback) for the analysis, with structured output validated by **Zod**. During analysis the model can call the read-only PayPal toolkit tools to look up more records; each result becomes a citable fact before the model sees it.
- **The model only recommends.** It has no money-moving tools. The buyer's message reaches it inside a randomly delimited block marked as untrusted data. The system stays safe even if the model is fully fooled: we test that with a mocked, completely compromised model and assert zero PayPal writes.
- **Claude Code** was used as the coding agent to build the project.

## Challenges we ran into

- **Disputes can't be created by API in the PayPal sandbox.** The documented sandbox create-dispute call is refused for standard developer accounts. We documented every attempt with PayPal debug IDs. So the demo keeps a pool of **real** disputes, filed by a sandbox buyer and held until a visitor claims one. Everything after the claim is live.
- **Sandbox disputes with tracking become chargebacks.** When a payment already had tracking, the sandbox sent the buyer's "not received" filing straight to a chargeback review. So the "seller shipped" demo is the most common real situation: the seller shipped but never added tracking. Rebuttal asks for the number, the seller replies in one line, Rebuttal adds it to the PayPal order, and the agent contests with that record.
- **Getting a disputable payment without a browser.** Card processing isn't enabled on default sandbox merchants. We had the sandbox buyer approve one **vaulted** PayPal payment, then charged the vaulted wallet server-side for every demo order.
- **The toolkit bundles older AI SDK and Zod versions.** We re-wrap its tools for the current AI SDK and fail closed if it ever exposes a non-read tool.
- **Honest evidence.** Our first live run had tracking added *after* the dispute opened. Claude noticed and refused to contest. That's what we want, and the ground-check makes it structural rather than hoped-for.

## Accomplishments we're proud of

- A safety model where the *architecture*, not the prompt, guarantees that no refund happens without the seller and no claim reaches PayPal unless it traces to a PayPal record.
- Every step of every case is visible, with PayPal endpoints and debug IDs, on a timeline a judge can watch live.
- A seller experience that is genuinely one message and one tap.

## What we learned

- PayPal's HATEOAS `links` make an excellent state machine. Letting PayPal decide what's allowed removed a whole class of bugs.
- LLM output is most useful when deterministic checks surround it: schema, citations, policy, idempotency.

## What's next

- More dispute reasons (not as described, unauthorised) with their own evidence types.
- Pulling shipping data directly from carriers and storefronts (Shopify, WooCommerce).
- `make-offer` for partial refunds, and email notifications.
- Multi-merchant onboarding with PayPal's partner permissions.

## Built with

`nextjs` `typescript` `postgresql` `drizzle` `vercel-ai-sdk` `claude` `anthropic` `paypal-agent-toolkit` `paypal-disputes-api` `paypal-webhooks` `zod` `vitest` `telegram-bot-api` `vercel` `neon`
