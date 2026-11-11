import { vi } from "vitest";
import type { ReadToolkit } from "@/agent/toolkit";
import type { Dispute } from "@/paypal/types";
import { TRACKING } from "./db";

/** Read-only toolkit stand-in serving fixture data (unit tests only). */
export function fakeToolkit(dispute: Dispute, tracking: unknown = TRACKING): ReadToolkit {
  const data: Record<string, unknown> = {
    get_dispute: dispute,
    get_shipment_tracking: tracking,
    list_transactions: { transaction_details: [{ transaction_info: { transaction_id: "4KT96773NB9182150", transaction_amount: { currency_code: "USD", value: "33.00" } } }] },
    get_order: { id: "90H57680DU2061023", status: "COMPLETED" },
    list_disputes: { items: [] },
  };
  return {
    tools: {} as ReadToolkit["tools"],
    run: vi.fn(async (name: string) => ({ ok: true as const, data: data[name] })),
  };
}

/** PayPal client stand-in that counts writes. */
export function fakePayPal(dispute: Dispute, opts: { delayMs?: number } = {}) {
  const writes: string[] = [];
  const wait = () => new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
  return {
    writes,
    accessToken: vi.fn(async () => "token"),
    getCapture: vi.fn(async () => ({ status: 200, data: { supplementary_data: { related_ids: { order_id: "90H57680DU2061023" } } }, debugId: "d", endpoint: "GET /v2/payments/captures/{id}" })),
    getDispute: vi.fn(async () => ({ status: 200, data: dispute, debugId: "dbg-get", endpoint: "GET /v1/customer/disputes/{id}" })),
    provideEvidence: vi.fn(async () => (await wait(), writes.push("provide-evidence"), { status: 200, data: {}, debugId: "dbg-pe", endpoint: "POST /v1/customer/disputes/{id}/provide-evidence" })),
    sendMessage: vi.fn(async () => (await wait(), writes.push("send-message"), { status: 200, data: {}, debugId: "dbg-sm", endpoint: "POST /v1/customer/disputes/{id}/send-message" })),
    acceptClaim: vi.fn(async () => (await wait(), writes.push("accept-claim"), { status: 200, data: {}, debugId: "dbg-ac", endpoint: "POST /v1/customer/disputes/{id}/accept-claim" })),
  };
}
