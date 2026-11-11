import { describe, expect, it } from "vitest";
import { extractAmounts, extractDates, extractIdentifiers, groundCheck } from "@/agent/groundCheck";
import type { FactRecord } from "@/agent/schema";

const facts: FactRecord[] = [
  {
    id: "F1",
    kind: "dispute",
    source: "GET /v1/customer/disputes/{id}",
    fetchedAt: "2026-11-11T12:00:00Z",
    data: { dispute_id: "PP-R-AXP-10198570", create_time: "2026-11-11T01:18:20.110Z", dispute_amount: { currency_code: "USD", value: "30.00" }, gross: "33.00" },
  },
  {
    id: "F2",
    kind: "shipment_tracking",
    source: "GET /v1/shipping/trackers/{id}",
    fetchedAt: "2026-11-11T12:00:01Z",
    data: { transaction_id: "4KT96773NB9182150", tracking_number: "9400111202555842761049", carrier: "USPS", status: "DELIVERED", shipment_date: "2026-11-09" },
  },
];

const draft = (sentence: string, fact_ids: string[]) => ({ rebuttal: [{ sentence, fact_ids }] });

describe("ground-check", () => {
  it("accepts a fully cited draft", () => {
    const r = groundCheck(
      {
        rebuttal: [
          { sentence: "The order was shipped with USPS on 2026-11-09 under tracking number 9400111202555842761049.", fact_ids: ["F2"] },
          { sentence: "The carrier reports the parcel as delivered.", fact_ids: ["F2"] },
          { sentence: "The buyer opened this case on November 11, 2026 for $30.00.", fact_ids: ["F1"] },
        ],
      },
      facts,
    );
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("accepts an empty rebuttal (nothing to send)", () => {
    expect(groundCheck({ rebuttal: [] }, facts).ok).toBe(true);
  });

  it("rejects an uncited sentence", () => {
    const r = groundCheck(draft("The item was delivered.", []), facts);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.code).toBe("NO_CITATION");
  });

  it("rejects an unknown fact ID", () => {
    const r = groundCheck(draft("The item was delivered.", ["F9"]), facts);
    expect(r.issues[0]!.code).toBe("UNKNOWN_FACT");
  });

  it("rejects an invented tracking number", () => {
    const r = groundCheck(draft("Tracking number 9400111202555842760000 shows delivery.", ["F2"]), facts);
    expect(r.issues.map((i) => i.code)).toContain("UNSUPPORTED_IDENTIFIER");
  });

  it("rejects a real tracking number cited against the wrong fact", () => {
    const r = groundCheck(draft("Tracking number 9400111202555842761049 shows delivery.", ["F1"]), facts);
    expect(r.issues.map((i) => i.code)).toContain("UNSUPPORTED_IDENTIFIER");
  });

  it("rejects an invented date in any common format", () => {
    for (const s of ["It was delivered on 2026-11-05.", "It was delivered on November 5, 2026.", "It was delivered on 5 Nov 2026.", "It was delivered on 11/05/2026.", "It was delivered on November 5."]) {
      const r = groundCheck(draft(s, ["F2"]), facts);
      expect(r.issues.map((i) => i.code), s).toContain("UNSUPPORTED_DATE");
    }
  });

  it("rejects an invented amount", () => {
    for (const s of ["The buyer paid $45.00.", "The buyer paid 45 USD.", "The order total was 45.50."]) {
      const r = groundCheck(draft(s, ["F1"]), facts);
      expect(r.issues.map((i) => i.code), s).toContain("UNSUPPORTED_AMOUNT");
    }
  });

  it("accepts amounts and dates that match the cited facts in other formats", () => {
    const r = groundCheck(draft("The buyer paid $33 and the case was opened on Nov 11, 2026.", ["F1"]), facts);
    expect(r.issues).toEqual([]);
  });

  it("rejects an invented dispute or transaction ID", () => {
    const r = groundCheck(draft("This concerns transaction 9ZZ99999ZZ9999999.", ["F1", "F2"]), facts);
    expect(r.issues.map((i) => i.code)).toContain("UNSUPPORTED_IDENTIFIER");
  });
});

describe("extractors", () => {
  it("finds dates", () => {
    expect(extractDates("on 2026-11-09 and 3rd December 2026").map((d) => d.iso)).toEqual(["2026-11-09", "2026-12-03"]);
  });
  it("finds amounts", () => {
    expect(extractAmounts("$1,200.50 and 30 USD").map((a) => a.value)).toEqual(["1200.50", "30.00"]);
  });
  it("finds identifiers but not plain words", () => {
    expect(extractIdentifiers("USPS tracking 9400111202555842761049 for PP-R-AXP-10198570 delivered")).toEqual(["9400111202555842761049", "PP-R-AXP-10198570"]);
  });
});
