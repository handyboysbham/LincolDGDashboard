import { describe, expect, it } from "vitest";

import {
  humanizeIntakeValue,
  isLeadIntakeAction,
  isTerminalLeadStatus,
  leadTimelineLabel,
  nextLeadAction,
} from "./intake-state";

describe("Customer Intake presentation state", () => {
  it.each([
    ["new", "start-contacting"],
    ["contacting", "qualify"],
    ["qualified", "start-estimating"],
  ])("maps %s to its controlled forward action", (status, action) => {
    expect(nextLeadAction(status)?.action).toBe(action);
  });

  it.each(["estimating", "lost", "cancelled", "duplicate", "disqualified"])(
    "does not offer an intake-owned forward action from %s",
    (status) => {
      expect(nextLeadAction(status)).toBeUndefined();
    },
  );

  it("recognizes terminal outcomes and rejects arbitrary actions", () => {
    expect(isTerminalLeadStatus("lost")).toBe(true);
    expect(isTerminalLeadStatus("estimating")).toBe(false);
    expect(isLeadIntakeAction("mark-duplicate")).toBe(true);
    expect(isLeadIntakeAction("accepted")).toBe(false);
  });

  it("presents service and audit values as staff-readable copy", () => {
    expect(humanizeIntakeValue("dump_trailer_rental")).toBe("Dump trailer rental");
    expect(leadTimelineLabel("lead.document_linked")).toBe("Document linked");
    expect(leadTimelineLabel("lead.custom_activity")).toBe("Custom activity");
  });
});
