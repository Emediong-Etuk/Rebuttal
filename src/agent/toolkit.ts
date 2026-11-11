import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

/**
 * The agent's PayPal tools come from PayPal's own Agent Toolkit, configured READ-ONLY.
 * `accept_dispute_claim`, refunds, order creation and payouts are never enabled, so the model has no
 * way to move money. Only the policy engine + executor (src/agent/executor.ts) can write to PayPal.
 */
export const READ_ONLY_ACTIONS = {
  disputes: { list: true, get: true },
  orders: { get: true },
  shipment: { get: true },
  transactions: { list: true },
} as const;

export const READ_TOOL_NAMES = ["get_dispute", "list_disputes", "get_order", "get_shipment_tracking", "list_transactions"] as const;
export type ReadToolName = (typeof READ_TOOL_NAMES)[number];

/** The REST endpoint each toolkit tool calls, for the timeline's "technical details". */
export const TOOL_ENDPOINTS: Record<ReadToolName, string> = {
  get_dispute: "GET /v1/customer/disputes/{id}",
  list_disputes: "GET /v1/customer/disputes",
  get_order: "GET /v2/checkout/orders/{id}",
  get_shipment_tracking: "GET /v1/shipping/trackers",
  list_transactions: "GET /v1/reporting/transactions",
};

type ToolkitTool = { description: string; parameters: unknown; execute: (args: unknown, opts: unknown) => Promise<unknown> };

export type ReadToolkit = {
  tools: Record<ReadToolName, ToolkitTool>;
  run: (name: ReadToolName, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
};

export function createReadOnlyToolkit(opts: { clientId: string; clientSecret: string; accessToken?: string; sandbox?: boolean }): ReadToolkit {
  const tk = new PayPalAgentToolkit({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    configuration: { actions: READ_ONLY_ACTIONS as unknown as Record<string, Record<string, boolean>>, context: { sandbox: opts.sandbox ?? true } },
  });
  // Share the token Rebuttal's REST client already holds (avoids a second OAuth round trip).
  if (opts.accessToken) (tk as unknown as { client: { _accessToken?: string } }).client._accessToken = opts.accessToken;

  const all = tk.getTools() as unknown as Record<string, ToolkitTool>;
  const exposed = Object.keys(all).sort();
  const allowed = [...READ_TOOL_NAMES].sort();
  // Fail closed if a toolkit upgrade ever exposes anything beyond the read-only allowlist.
  if (exposed.join() !== allowed.join()) throw new Error(`Toolkit exposed unexpected tools: ${exposed.join(", ")}`);

  const tools = all as Record<ReadToolName, ToolkitTool>;
  return {
    tools,
    async run(name, args) {
      try {
        const raw = await tools[name].execute(args, {});
        const data = typeof raw === "string" ? safeJson(raw) : raw;
        const err = (data as { error?: { message?: string } } | null)?.error;
        if (err) return { ok: false, error: err.message ?? "PayPal returned an error" };
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
