import { describe, expect, it } from "vitest";
import { parseTrackingReply } from "@/notify/telegram";

describe("seller's plain-text tracking reply", () => {
  it("reads carrier, number and ship date", () => {
    expect(parseTrackingReply("USPS 9400111202555812345678 shipped 2026-11-09")).toEqual({ carrier: "USPS", trackingNumber: "9400111202555812345678", shipDate: "2026-11-09" });
  });
  it("guesses the carrier from the number format", () => {
    expect(parseTrackingReply("here it is 1Z999AA10123456784")).toMatchObject({ carrier: "UPS", trackingNumber: "1Z999AA10123456784" });
  });
  it("returns null when there is no tracking number", () => {
    expect(parseTrackingReply("I shipped it last week")).toBeNull();
  });
});
