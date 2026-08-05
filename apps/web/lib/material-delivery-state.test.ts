import { describe, expect, it } from "vitest";

import {
  actionReadinessMessage,
  formatCents,
  formatQuantity,
  isDeliveryStage,
  isSupplierStage,
  nextLoadAction,
} from "./material-delivery-state";

describe("material delivery web state", () => {
  it("maps each load state to its explicit application command", () => {
    expect(nextLoadAction("planned")).toBe("ready-for-loading");
    expect(nextLoadAction("loading")).toBe("mark-loaded");
    expect(nextLoadAction("en_route")).toBe("arrive-customer");
    expect(nextLoadAction("unloading")).toBe("complete-delivery");
    expect(nextLoadAction("reconciled")).toBeUndefined();
  });

  it("keeps supplier and delivery stages distinct", () => {
    expect(isSupplierStage("loading")).toBe(true);
    expect(isSupplierStage("unloading")).toBe(false);
    expect(isDeliveryStage("at_customer")).toBe(true);
    expect(isDeliveryStage("at_supplier")).toBe(false);
  });

  it("surfaces authoritative prerequisites without calculating readiness", () => {
    expect(actionReadinessMessage("mark-loaded")).toContain("actual-load safety");
    expect(actionReadinessMessage("complete-delivery")).toContain("placement evidence");
    expect(actionReadinessMessage("start-loading")).toBeUndefined();
  });

  it("formats server-owned financial and quantity facts", () => {
    expect(formatCents(18_400)).toBe("$184.00");
    expect(formatQuantity("4.000", "cubic_yards")).toBe("4 cubic yards");
    expect(formatQuantity(null, "tons")).toBe("—");
  });
});
