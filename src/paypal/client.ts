import { disputeSchema, type Dispute, type Money, type TrackingInfo } from "./types";

/** Result of one PayPal call: what we called, what came back, and PayPal's debug ID for support/audit. */
export type PayPalResult<T> = { status: number; data: T; debugId: string | null; endpoint: string };

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId: string | null,
    readonly endpoint: string,
    readonly body: unknown,
    /** Request shape with secrets removed, so failures can be reported as the brief asks. */
    readonly requestShape: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

type RequestOpts = {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Idempotency key sent as PayPal-Request-Id on writes. */
  requestId?: string;
  /** Path template used for logs/timeline, e.g. "/v1/customer/disputes/{id}". */
  template?: string;
};

export type PayPalConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
};

export function paypalConfigFromEnv(): PayPalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  return { baseUrl: process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com", clientId, clientSecret };
}

/**
 * Typed server-side client for the PayPal REST endpoints Rebuttal needs and the agent toolkit lacks
 * (evidence, messages, accept-claim, webhook verification, tracking) plus the sandbox helpers.
 * All money-moving and state-changing calls go through here, never through the model.
 */
export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetch: typeof fetch;

  constructor(private readonly cfg: PayPalConfig) {
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  get baseUrl() {
    return this.cfg.baseUrl;
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetch(`${this.cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) {
      throw new PayPalError(`OAuth token request failed (${res.status})`, res.status, res.headers.get("paypal-debug-id"), "/v1/oauth2/token", body, { grant_type: "client_credentials" });
    }
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3000) * 1000 };
    return this.token.value;
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOpts = {}): Promise<PayPalResult<T>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}`, ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form;
    }
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    const endpoint = `${method} ${opts.template ?? path.split("?")[0]}`;
    const res = await this.fetch(`${this.cfg.baseUrl}${path}`, { method, headers, body });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    const debugId = res.headers.get("paypal-debug-id");
    if (!res.ok) {
      const shape = {
        method,
        path,
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, /authorization|assertion/i.test(k) ? "<redacted>" : v])),
        body: opts.json ?? (opts.form ? describeForm(opts.form) : undefined),
      };
      const issue = (data as { details?: { issue?: string }[]; message?: string; name?: string } | null)?.details?.[0]?.issue;
      const msg = issue ?? (data as { name?: string } | null)?.name ?? `HTTP ${res.status}`;
      throw new PayPalError(`${endpoint} failed: ${msg}`, res.status, debugId, endpoint, data, shape);
    }
    return { status: res.status, data: data as T, debugId, endpoint };
  }

  // ---- Disputes -------------------------------------------------------------------------------

  async getDispute(id: string): Promise<PayPalResult<Dispute>> {
    const r = await this.request("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`, { template: "/v1/customer/disputes/{id}" });
    return { ...r, data: disputeSchema.parse(r.data) };
  }

  listDisputes(query: Record<string, string> = {}) {
    const qs = new URLSearchParams({ page_size: "20", ...query }).toString();
    return this.request<{ items?: Array<Partial<Dispute> & { dispute_id: string }> }>("GET", `/v1/customer/disputes?${qs}`, {
      template: "/v1/customer/disputes",
    });
  }

  /** Multipart: an `input` JSON part with the evidences, as PayPal's provide-evidence requires. */
  provideEvidence(
    id: string,
    input: { evidences: Array<{ evidence_type: string; evidence_info?: { tracking_info?: TrackingInfo[]; refund_ids?: string[] }; notes?: string }> },
    requestId: string,
  ) {
    return this.request("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, {
      form: jsonPart(input),
      requestId,
      template: "/v1/customer/disputes/{id}/provide-evidence",
    });
  }

  sendMessage(id: string, message: string, requestId: string) {
    return this.request("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, {
      form: jsonPart({ message }),
      requestId,
      template: "/v1/customer/disputes/{id}/send-message",
    });
  }

  acceptClaim(id: string, body: { note: string; accept_claim_type?: string; refund_amount?: Money }, requestId: string) {
    return this.request("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, {
      form: jsonPart(body),
      requestId,
      template: "/v1/customer/disputes/{id}/accept-claim",
    });
  }

  /** Sandbox only: UNDER_REVIEW -> WAITING_FOR_SELLER_RESPONSE / WAITING_FOR_BUYER_RESPONSE. */
  requireEvidence(id: string, action: "SELLER_EVIDENCE" | "BUYER_EVIDENCE") {
    return this.request("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/require-evidence`, {
      json: { action },
      template: "/v1/customer/disputes/{id}/require-evidence",
    });
  }

  /** Sandbox only: settle an UNDER_REVIEW dispute. */
  adjudicate(id: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR") {
    return this.request("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/adjudicate`, {
      json: { adjudication_outcome: outcome },
      template: "/v1/customer/disputes/{id}/adjudicate",
    });
  }

  escalate(id: string, note: string) {
    return this.request("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/escalate`, {
      json: { note },
      template: "/v1/customer/disputes/{id}/escalate",
    });
  }

  // ---- Webhooks -------------------------------------------------------------------------------

  /** Verify a webhook with PayPal. `rawBody` must be the exact bytes received; it is parsed once, not re-serialised by us before parsing. */
  async verifyWebhookSignature(headers: Headers, rawBody: string, webhookId: string): Promise<{ verified: boolean; debugId: string | null }> {
    const h = (n: string) => headers.get(n) ?? "";
    const required = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
    if (required.some((n) => !headers.get(n))) return { verified: false, debugId: null };
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return { verified: false, debugId: null };
    }
    const r = await this.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      json: {
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      },
    });
    return { verified: r.data.verification_status === "SUCCESS", debugId: r.debugId };
  }

  listWebhooks() {
    return this.request<{ webhooks: Array<{ id: string; url: string; event_types: { name: string }[] }> }>("GET", "/v1/notifications/webhooks");
  }

  createWebhook(url: string, events: string[]) {
    return this.request<{ id: string }>("POST", "/v1/notifications/webhooks", {
      json: { url, event_types: events.map((name) => ({ name })) },
    });
  }

  updateWebhookUrl(id: string, url: string) {
    return this.request("PATCH", `/v1/notifications/webhooks/${id}`, {
      json: [{ op: "replace", path: "/url", value: url }],
      template: "/v1/notifications/webhooks/{id}",
    });
  }

  // ---- Orders & tracking ----------------------------------------------------------------------

  getOrder(id: string) {
    return this.request<Record<string, unknown>>("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`, { template: "/v2/checkout/orders/{id}" });
  }

  getCapture(id: string) {
    return this.request<Record<string, unknown>>("GET", `/v2/payments/captures/${encodeURIComponent(id)}`, { template: "/v2/payments/captures/{id}" });
  }

  addTracking(t: { transactionId: string; trackingNumber: string; carrier: string; status: "SHIPPED" | "DELIVERED"; shipmentDate?: string }, requestId?: string) {
    return this.request<{ tracker_identifiers?: unknown[]; errors?: unknown[] }>("POST", "/v1/shipping/trackers-batch", {
      json: {
        trackers: [
          {
            transaction_id: t.transactionId,
            tracking_number: t.trackingNumber,
            status: t.status,
            carrier: t.carrier,
            ...(t.shipmentDate ? { shipment_date: t.shipmentDate } : {}),
            notify_buyer: false,
          },
        ],
      },
      requestId,
    });
  }

  listTrackers(transactionId: string) {
    return this.request<{ trackers?: Array<Record<string, unknown>> }>("GET", `/v1/shipping/trackers?transaction_id=${encodeURIComponent(transactionId)}`, {
      template: "/v1/shipping/trackers",
    });
  }

  getTracker(transactionId: string, trackingNumber: string) {
    return this.request<Record<string, unknown>>("GET", `/v1/shipping/trackers/${encodeURIComponent(`${transactionId}-${trackingNumber}`)}`, {
      template: "/v1/shipping/trackers/{id}",
    });
  }

  /** Charge the demo buyer's vaulted sandbox wallet. Server-side; no browser approval needed. */
  chargeVaultedWallet(vaultId: string, amount: Money, description: string, requestId: string) {
    return this.request<{ id: string; status: string; purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; status: string; create_time?: string }> } }> }>(
      "POST",
      "/v2/checkout/orders",
      {
        headers: { Prefer: "return=representation" },
        json: {
          intent: "CAPTURE",
          purchase_units: [
            {
              description,
              amount,
              shipping: {
                name: { full_name: "Sandbox Buyer" },
                address: { address_line_1: "1 Main St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" },
              },
            },
          ],
          payment_source: { paypal: { vault_id: vaultId } },
        },
        requestId,
      },
    );
  }
}

function jsonPart(obj: unknown): FormData {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(obj)], { type: "application/json" }));
  return form;
}

function describeForm(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  form.forEach((v, k) => {
    out[k] = typeof v === "string" ? v : `<${v.type || "blob"} ${v.size} bytes>`;
  });
  return out;
}

let shared: PayPalClient | null = null;
export function getPayPal(): PayPalClient {
  shared ??= new PayPalClient(paypalConfigFromEnv());
  return shared;
}
