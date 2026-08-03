import { describe, expect, it } from "vitest";

import {
  normalizeAddress,
  normalizeCustomerName,
  normalizeEmail,
  normalizePhone,
} from "./intake-normalization.js";

describe("intake duplicate normalization", () => {
  it("normalizes names, email addresses, and North American phone numbers", () => {
    expect(normalizeCustomerName("  López & Sons, LLC ")).toBe("lopez sons llc");
    expect(normalizeEmail(" CREW@Example.COM ")).toBe("crew@example.com");
    expect(normalizePhone("+1 (402) 555-0199")).toBe("4025550199");
  });

  it("normalizes a complete service address", () => {
    expect(
      normalizeAddress({
        addressLine1: "1840 W. Denton Rd",
        city: "Lincoln",
        postalCode: "68523",
        region: "NE",
      }),
    ).toBe("1840 w denton rd lincoln ne 68523");
  });
});
