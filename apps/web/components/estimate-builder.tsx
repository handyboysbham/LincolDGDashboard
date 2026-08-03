"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, Calculator, CheckCircle2 } from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue } from "../lib/commercial-format";

type Lead = components["schemas"]["LeadDetailDto"];
type Pricing = components["schemas"]["PricingConfigurationListDto"];

export function EstimateBuilder({
  lead,
  onCreated,
}: {
  lead: Lead;
  onCreated?: (estimateVersionId: string) => void;
}) {
  const [pricing, setPricing] = useState<Pricing>();
  const [loadError, setLoadError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string>();

  useEffect(() => {
    void (async () => {
      const response = await getApiClient().GET("/api/v1/pricing/configurations");
      if (!response.data) setLoadError(apiErrorMessage(response.error));
      else setPricing(response.data);
    })();
  }, []);

  const activeVersions =
    pricing?.policies
      .filter((policy) => policy.serviceType === lead.serviceType)
      .flatMap((policy) => policy.versions.filter((version) => version.status === "active")) ?? [];

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setActionError(undefined);
    const pricingVersionId = textValue(data, "pricingVersionId");
    const body = {
      ...(lead.serviceType === "material_delivery"
        ? {
            materialDelivery: {
              additionalSupplierStops: numberValue(data, "additionalSupplierStops"),
              deliveryZoneId: textValue(data, "deliveryZoneId"),
              items: [
                {
                  quantity: textValue(data, "quantity"),
                  supplierCostVersionId: textValue(data, "supplierCostVersionId"),
                },
              ],
              separatePlacements: numberValue(data, "separatePlacements"),
            },
          }
        : {}),
      operationalAssessment: textValue(data, "operationalAssessment"),
      pricingVersionId,
      riskAssessment: textValue(data, "riskAssessment"),
    };
    try {
      const response = await getApiClient().POST("/api/v1/leads/{id}/estimate-versions", {
        body,
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: lead.id },
        },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setCreated(response.data.id);
      onCreated?.(response.data.id);
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (loadError)
    return (
      <div className="inline-form-error">
        <AlertTriangle size={16} /> {loadError}
      </div>
    );
  if (!pricing) return <p className="quiet-panel-copy">Loading active pricing…</p>;
  if (created)
    return (
      <div className="estimate-created-inline">
        <CheckCircle2 size={18} />
        <div>
          <strong>Estimate created</strong>
          <a href={`/estimates/${created}`}>Open the server-calculated Estimate</a>
        </div>
      </div>
    );
  if (activeVersions.length === 0)
    return (
      <div className="commercial-callout">
        <Calculator size={18} />
        <div>
          <strong>No active pricing for this service</strong>
          <p>
            Activate a {humanizeCommercialValue(lead.serviceType)} Pricing Version before
            estimating.
          </p>
          <a href="/pricing">Open Pricing</a>
        </div>
      </div>
    );

  return (
    <form
      className="estimate-builder-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <label className="field">
        <span>Pricing Version</span>
        <select name="pricingVersionId" required>
          {activeVersions.map((version) => (
            <option key={version.id} value={version.id}>
              Version {version.versionNumber}
            </option>
          ))}
        </select>
      </label>
      {lead.serviceType === "material_delivery" && (
        <>
          <label className="field">
            <span>Supplier cost</span>
            <select name="supplierCostVersionId" required>
              {pricing.supplierCosts
                .filter((cost) => cost.status === "active")
                .map((cost) => (
                  <option key={cost.id} value={cost.id}>
                    {cost.materialName} · {formatMoney(cost.unitCostCents)} /{" "}
                    {humanizeCommercialValue(cost.unit)}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Delivery zone</span>
            <select name="deliveryZoneId" required>
              {pricing.deliveryZones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name} · {formatMoney(zone.baseFeeCents)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Quantity</span>
            <input
              defaultValue={lead.materialDelivery?.estimatedQuantity}
              name="quantity"
              pattern="\d{1,9}(\.\d{1,3})?"
              required
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Additional supplier stops</span>
              <input
                defaultValue="0"
                min="0"
                name="additionalSupplierStops"
                type="number"
                required
              />
            </label>
            <label className="field">
              <span>Separate placements</span>
              <input defaultValue="0" min="0" name="separatePlacements" type="number" required />
            </label>
          </div>
        </>
      )}
      <label className="field">
        <span>Operational assessment</span>
        <textarea
          name="operationalAssessment"
          rows={3}
          placeholder="Access, placement, timing, or equipment considerations"
        />
      </label>
      <label className="field">
        <span>Risk assessment</span>
        <textarea name="riskAssessment" rows={3} placeholder="Known commercial or field risks" />
      </label>
      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={16} /> {actionError}
        </div>
      )}
      <button className="button button-primary" disabled={busy} type="submit">
        <Calculator size={16} /> Calculate Estimate
      </button>
      <small className="server-owned-copy">
        Costs, price, deposit, and margin are calculated and recorded by the API.
      </small>
    </form>
  );
}

function textValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(data: FormData, key: string): number {
  return Number(textValue(data, key));
}
