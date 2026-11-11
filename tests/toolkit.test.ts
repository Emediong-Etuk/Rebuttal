import { describe, expect, it } from "vitest";
import { createReadOnlyToolkit, READ_TOOL_NAMES } from "@/agent/toolkit";

describe("PayPal Agent Toolkit configuration", () => {
  it("the real toolkit exposes exactly the read-only tools, and no accept_dispute_claim / refund / order creation", () => {
    const tk = createReadOnlyToolkit({ clientId: "test", clientSecret: "test", accessToken: "test" });
    const names = Object.keys(tk.tools).sort();
    expect(names).toEqual([...READ_TOOL_NAMES].sort());
    for (const forbidden of ["accept_dispute_claim", "create_refund", "create_order", "pay_order", "create_shipment_tracking"]) expect(names).not.toContain(forbidden);
  });
});
