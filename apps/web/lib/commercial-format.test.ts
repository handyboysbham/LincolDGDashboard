import { describe, expect, it } from "vitest";

import { formatMoney, humanizeCommercialValue } from "./commercial-format";

describe("commercial formatting", () => {
  it("formats integer cents without using a floating authoritative value", () => {
    expect(formatMoney(42_000)).toBe("$420.00");
    expect(formatMoney(-185)).toBe("-$1.85");
  });

  it("humanizes workflow values", () => {
    expect(humanizeCommercialValue("ready_to_send")).toBe("Ready to send");
  });
});
