import { describe, expect, it } from "vitest";

import { PUBLIC_ROUTE } from "../auth/public.decorator.js";
import { REQUIRED_PERMISSIONS } from "../auth/require-permissions.decorator.js";
import {
  JobsController,
  MaterialDeliveryController,
  ProjectsController,
  PublicContractsController,
  SchedulingController,
} from "./operations.controller.js";
import { RentalController } from "./rental.controller.js";

describe("operations controller authorization", () => {
  it.each([
    [ProjectsController, "list", ["projects:read"]],
    [ProjectsController, "generateContract", ["operations:manage"]],
    [ProjectsController, "confirmDeposit", ["operations:manage"]],
    [ProjectsController, "transition", ["operations:manage"]],
    [ProjectsController, "signBusiness", ["operations:manage"]],
    [ProjectsController, "sendContract", ["operations:manage"]],
    [JobsController, "list", ["projects:read"]],
    [JobsController, "transition", ["operations:manage"]],
    [JobsController, "evaluate", ["operations:manage"]],
    [MaterialDeliveryController, "get", ["projects:read"]],
    [MaterialDeliveryController, "listMaterials", ["projects:read"]],
    [MaterialDeliveryController, "savePlan", ["operations:manage"]],
    [MaterialDeliveryController, "createLoad", ["operations:manage"]],
    [MaterialDeliveryController, "createItem", ["operations:manage"]],
    [MaterialDeliveryController, "reviseItem", ["operations:manage"]],
    [MaterialDeliveryController, "assignAsset", ["operations:manage"]],
    [MaterialDeliveryController, "evaluateSafety", ["operations:manage"]],
    [MaterialDeliveryController, "transitionLoad", ["operations:manage"]],
    [MaterialDeliveryController, "recordQuantities", ["operations:manage"]],
    [MaterialDeliveryController, "attachEvidence", ["operations:manage"]],
    [MaterialDeliveryController, "createVariance", ["operations:manage"]],
    [MaterialDeliveryController, "resolveVariance", ["operations:manage"]],
    [MaterialDeliveryController, "createExpense", ["finance:manage"]],
    [MaterialDeliveryController, "allocateExpense", ["finance:manage"]],
    [MaterialDeliveryController, "transitionExpense", ["finance:manage"]],
    [MaterialDeliveryController, "createJobCharge", ["finance:manage"]],
    [MaterialDeliveryController, "transitionJobCharge", ["finance:manage"]],
    [MaterialDeliveryController, "evaluateInvoiceReadiness", ["finance:manage"]],
    [RentalController, "get", ["projects:read"]],
    [RentalController, "savePlan", ["operations:manage"]],
    [RentalController, "revisePlan", ["operations:manage"]],
    [RentalController, "createDebrisReview", ["operations:manage"]],
    [RentalController, "decideDebrisReview", ["operations:manage"]],
    [RentalController, "planSchedule", ["scheduling:manage"]],
    [RentalController, "evaluateReadiness", ["operations:manage"]],
    [RentalController, "createInspection", ["operations:manage"]],
    [RentalController, "completeInspection", ["operations:manage"]],
    [RentalController, "createExtension", ["operations:manage"]],
    [RentalController, "transitionExtension", ["scheduling:manage"]],
    [RentalController, "createPickupAttempt", ["operations:manage"]],
    [RentalController, "transitionPickupAttempt", ["operations:manage"]],
    [RentalController, "createDisposalLoad", ["scheduling:manage"]],
    [RentalController, "transitionDisposalLoad", ["operations:manage"]],
    [RentalController, "recordDisposalEvidence", ["finance:manage"]],
    [RentalController, "reconcileDisposalLoad", ["finance:manage"]],
    [RentalController, "reconcileRental", ["finance:manage"]],
    [RentalController, "transitionDropoff", ["operations:manage"]],
    [SchedulingController, "createAsset", ["scheduling:manage"]],
    [SchedulingController, "createBlock", ["scheduling:manage"]],
  ] as const)("requires explicit permissions for %s.%s", (controller, method, expected) => {
    const handler = (controller.prototype as unknown as Record<string, unknown>)[method];
    expect(handler).toBeTypeOf("function");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
  });

  it("keeps capability-authenticated Contract actions public", () => {
    expect(Reflect.getMetadata(PUBLIC_ROUTE, PublicContractsController)).toBe(true);
  });
});
