import { describe, expect, it } from "vitest";

import { REQUIRED_PERMISSIONS } from "../auth/require-permissions.decorator.js";
import { PUBLIC_ROUTE } from "../auth/public.decorator.js";
import { FinancialCompletionController } from "./financial-completion.controller.js";
import { InvoicesController, PublicInvoicesController } from "./finance.controller.js";
import { PaymentsController } from "./payments.controller.js";
import { RefundsController } from "./refunds.controller.js";

describe("finance controller authorization", () => {
  it.each([
    ["list", ["finance:read"]],
    ["get", ["finance:read"]],
    ["create", ["finance:manage"]],
    ["revise", ["finance:manage"]],
    ["prepare", ["finance:manage"]],
    ["post", ["finance:manage"]],
    ["recordDelivery", ["finance:manage"]],
    ["createPublicLink", ["finance:manage"]],
    ["revokePublicLink", ["finance:manage"]],
    ["createAdjustment", ["finance:manage"]],
    ["approveAdjustment", ["finance:manage"]],
    ["postAdjustment", ["finance:manage"]],
    ["reverseAdjustment", ["finance:manage"]],
    ["voidInvoice", ["finance:manage"]],
    ["replaceInvoice", ["finance:manage"]],
  ] as const)("requires explicit permissions for InvoicesController.%s", (method, expected) => {
    const handler = (InvoicesController.prototype as unknown as Record<string, unknown>)[method];
    expect(handler).toBeTypeOf("function");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
  });
});

describe("public Invoice controller authorization", () => {
  it("marks the customer Invoice controller public", () => {
    expect(Reflect.getMetadata(PUBLIC_ROUTE, PublicInvoicesController)).toBe(true);
  });
});

describe("payments controller authorization", () => {
  it.each([
    ["listPayments", ["finance:read"]],
    ["getPayment", ["finance:read"]],
    ["createProjectPayment", ["finance:manage"]],
    ["createCustomerPayment", ["finance:manage"]],
    ["verifyPayment", ["finance:manage"]],
    ["settlePayment", ["finance:manage"]],
    ["reversePayment", ["finance:manage"]],
    ["allocatePayment", ["finance:manage"]],
    ["reversePaymentAllocation", ["finance:manage"]],
    ["createDepositBalance", ["finance:manage"]],
    ["listDepositBalances", ["finance:read"]],
    ["applyDeposit", ["finance:manage"]],
    ["reverseDepositApplication", ["finance:manage"]],
    ["listCustomerCredits", ["finance:read"]],
    ["createCustomerCredit", ["finance:manage"]],
    ["applyCustomerCredit", ["finance:manage"]],
    ["reverseCustomerCreditApplication", ["finance:manage"]],
  ] as const)("requires explicit permissions for PaymentsController.%s", (method, expected) => {
    const handler = (PaymentsController.prototype as unknown as Record<string, unknown>)[method];
    expect(handler).toBeTypeOf("function");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
  });
});

describe("refund controller authorization", () => {
  it.each([
    ["list", ["finance:read"]],
    ["get", ["finance:read"]],
    ["create", ["finance:manage"]],
    ["approve", ["finance:manage"]],
    ["process", ["finance:manage"]],
    ["settle", ["finance:manage"]],
    ["fail", ["finance:manage"]],
    ["cancel", ["finance:manage"]],
    ["reverse", ["finance:manage"]],
  ] as const)("requires explicit permissions for RefundsController.%s", (method, expected) => {
    const handler = (RefundsController.prototype as unknown as Record<string, unknown>)[method];
    expect(handler).toBeTypeOf("function");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
  });
});

describe("financial completion controller authorization", () => {
  it.each([
    ["evaluateProject", ["finance:manage"]],
    ["evaluateJob", ["finance:manage"]],
  ] as const)(
    "requires explicit permissions for FinancialCompletionController.%s",
    (method, expected) => {
      const handler = (
        FinancialCompletionController.prototype as unknown as Record<string, unknown>
      )[method];
      expect(handler).toBeTypeOf("function");
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
    },
  );
});
