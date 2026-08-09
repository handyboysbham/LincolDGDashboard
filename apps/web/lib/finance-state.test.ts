import { describe, expect, it } from "vitest";

import {
  actionLabel,
  formText,
  invoiceVersionAction,
  parseMoneyInputToCents,
  refundAction,
} from "./finance-state";

describe("finance web state", () => {
  it.each([
    ["185", 18_500],
    ["235.00", 23_500],
    ["0.01", 1],
    ["12.5", 1_250],
  ])("parses %s without floating-point money", (value, expected) => {
    expect(parseMoneyInputToCents(value)).toBe(expected);
  });

  it.each(["", "0", "1.234", "-2", "2e3", "12."])("rejects invalid amount %s", (value) => {
    expect(parseMoneyInputToCents(value)).toBeUndefined();
  });

  it("derives explicit Invoice Version actions", () => {
    expect(invoiceVersionAction("draft")).toBe("prepare");
    expect(invoiceVersionAction("ready_to_post")).toBe("post");
    expect(invoiceVersionAction("posted")).toBeUndefined();
    expect(invoiceVersionAction("superseded")).toBeUndefined();
  });

  it("derives controlled Refund actions", () => {
    expect(refundAction("review_required")).toBe("approve");
    expect(refundAction("approved")).toBe("process");
    expect(refundAction("processed")).toBe("settle");
    expect(refundAction("settled")).toBe("reverse");
    expect(refundAction("cancelled")).toBeUndefined();
  });

  it("humanizes action labels", () => {
    expect(actionLabel("customer_credit")).toBe("Customer credit");
  });

  it("reads text fields without stringifying files", () => {
    const form = new FormData();
    form.set("name", "  Casey  ");
    form.set("attachment", new File(["x"], "ticket.txt"));
    expect(formText(form, "name")).toBe("Casey");
    expect(formText(form, "attachment")).toBe("");
  });
});
