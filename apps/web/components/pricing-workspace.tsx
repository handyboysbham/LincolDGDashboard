"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, CheckCircle2, CircleDollarSign, Plus, RefreshCw } from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { formatMoney, humanizeCommercialValue } from "../lib/commercial-format";

type PricingConfiguration = components["schemas"]["PricingConfigurationListDto"];
type ServiceType = "dump_trailer_rental" | "material_delivery";
type PricingState =
  | { name: "loading" }
  | { message: string; name: "error" }
  | { data: PricingConfiguration; name: "ready" };

export function PricingWorkspace() {
  const [state, setState] = useState<PricingState>({ name: "loading" });
  const [showForm, setShowForm] = useState(false);
  const [serviceType, setServiceType] = useState<ServiceType>("material_delivery");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const load = useCallback(async () => {
    setState({ name: "loading" });
    const response = await getApiClient().GET("/api/v1/pricing/configurations");
    if (!response.data) {
      setState({ message: apiErrorMessage(response.error), name: "error" });
      return;
    }
    setState({ data: response.data, name: "ready" });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setActionError(undefined);
    const policyName = requiredText(data, "policyName");
    const body =
      serviceType === "material_delivery"
        ? {
            materialDelivery: {
              additionalSupplierStopCents: dollarsToCents(data, "additionalSupplierStop"),
              deliveryZone: {
                baseFeeCents: dollarsToCents(data, "baseFee"),
                code: requiredText(data, "zoneCode"),
                name: requiredText(data, "zoneName"),
              },
              depositMinimumCents: dollarsToCents(data, "depositMinimum"),
              depositRoundUpToCents: dollarsToCents(data, "depositRoundUp"),
              markupBasisPoints: Math.round(numberValue(data, "markupPercent") * 100),
              materials: [
                {
                  materialName: requiredText(data, "materialName"),
                  supplierLocationName: requiredText(data, "supplierLocationName"),
                  supplierName: requiredText(data, "supplierName"),
                  unit: requiredText(data, "unit") as "cubic_yards" | "loads" | "tons",
                  unitCostCents: dollarsToCents(data, "unitCost"),
                },
              ],
              separatePlacementCents: dollarsToCents(data, "separatePlacement"),
            },
            policyName,
            serviceType,
          }
        : {
            dumpTrailerRental: {
              additionalDayCents: dollarsToCents(data, "additionalDay"),
              includedDays: numberValue(data, "includedDays"),
              includedWeightPounds: numberValue(data, "includedWeight"),
              overageRateCentsPerPound: dollarsToCents(data, "overageRate"),
              packageAmountCents: dollarsToCents(data, "packageAmount"),
              securityDepositCents: dollarsToCents(data, "securityDeposit"),
            },
            policyName,
            serviceType,
          };
    try {
      const response = await getApiClient().POST("/api/v1/pricing/configurations", {
        body,
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      form.reset();
      setShowForm(false);
      await load();
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (pricingVersionId: string) => {
    setBusy(true);
    setActionError(undefined);
    const response = await getApiClient().POST("/api/v1/pricing/versions/{id}/actions/activate", {
      params: {
        header: { "Idempotency-Key": crypto.randomUUID() },
        path: { id: pricingVersionId },
      },
    });
    setBusy(false);
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else await load();
  };

  return (
    <div className="intake-page commercial-page">
      <section className="intake-page-heading">
        <div>
          <span className="page-eyebrow">Controlled pricing</span>
          <h1>Pricing</h1>
          <p>Versioned rates and approved rules for delivery and rental Estimates.</p>
        </div>
        <button
          className="button button-primary"
          onClick={() => {
            setShowForm((value) => !value);
          }}
        >
          <Plus size={17} /> New configuration
        </button>
      </section>

      {actionError && (
        <div className="inline-form-error" role="alert">
          <AlertTriangle size={17} /> {actionError}
        </div>
      )}

      {showForm && (
        <form
          className="panel commercial-form"
          onSubmit={(event) => {
            void create(event);
          }}
        >
          <div className="panel-heading compact">
            <div>
              <span className="panel-kicker">Guided setup</span>
              <h2>New Pricing Policy</h2>
            </div>
            <span className="server-owned-note">Server-calculated</span>
          </div>
          <div className="form-grid commercial-form-grid">
            <label className="field field-wide">
              <span>Policy name</span>
              <input name="policyName" placeholder="2026 standard pricing" required />
            </label>
            <label className="field field-wide">
              <span>Service</span>
              <select
                onChange={(event) => {
                  setServiceType(event.target.value as ServiceType);
                }}
                value={serviceType}
              >
                <option value="material_delivery">Material delivery</option>
                <option value="dump_trailer_rental">Dump trailer rental</option>
              </select>
            </label>
            {serviceType === "material_delivery" ? <MaterialFields /> : <RentalFields />}
          </div>
          <div className="commercial-form-actions">
            <button
              className="button button-secondary"
              onClick={() => {
                setShowForm(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button button-primary" disabled={busy} type="submit">
              Save draft
            </button>
          </div>
        </form>
      )}

      {state.name === "loading" && <CommercialLoading label="Loading pricing" />}
      {state.name === "error" && (
        <CommercialError
          message={state.message}
          retry={() => void load()}
          title="Pricing unavailable"
        />
      )}
      {state.name === "ready" && state.data.policies.length === 0 && !showForm && (
        <section className="panel intake-state commercial-empty">
          <CircleDollarSign size={28} />
          <h2>No Pricing Policies yet</h2>
          <p>Create a controlled configuration before building the first Estimate.</p>
          <button
            className="button button-primary"
            onClick={() => {
              setShowForm(true);
            }}
          >
            <Plus size={16} /> Create pricing
          </button>
        </section>
      )}
      {state.name === "ready" && state.data.policies.length > 0 && (
        <div className="commercial-two-column">
          <section className="panel commercial-record-panel">
            <div className="panel-heading compact">
              <div>
                <span className="panel-kicker">Policies</span>
                <h2>Pricing Versions</h2>
              </div>
              <span className="count-pill">{state.data.policies.length}</span>
            </div>
            {state.data.policies.map((policy) => (
              <article className="pricing-policy-card" key={policy.id}>
                <div>
                  <span className="commercial-status">
                    {humanizeCommercialValue(policy.status)}
                  </span>
                  <h3>{policy.name}</h3>
                  <p>{humanizeCommercialValue(policy.serviceType)}</p>
                </div>
                {policy.versions.map((version) => (
                  <div className="pricing-version-row" key={version.id}>
                    <span>Version {version.versionNumber}</span>
                    <strong>{version.rules.length} controlled rules</strong>
                    {version.status === "draft" ? (
                      <button
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => void activate(version.id)}
                      >
                        Activate
                      </button>
                    ) : (
                      <span className={`commercial-status status-${version.status}`}>
                        {version.status === "active" && <CheckCircle2 size={12} />}
                        {humanizeCommercialValue(version.status)}
                      </span>
                    )}
                  </div>
                ))}
              </article>
            ))}
          </section>
          <aside className="commercial-side-stack">
            <ReferencePanel title="Supplier costs" count={state.data.supplierCosts.length}>
              {state.data.supplierCosts.map((cost) => (
                <article className="reference-row" key={cost.id}>
                  <div>
                    <strong>{cost.materialName}</strong>
                    <span>
                      {cost.supplierName} · {cost.supplierLocationName}
                    </span>
                  </div>
                  <b>
                    {formatMoney(cost.unitCostCents)} / {humanizeCommercialValue(cost.unit)}
                  </b>
                </article>
              ))}
            </ReferencePanel>
            <ReferencePanel title="Delivery zones" count={state.data.deliveryZones.length}>
              {state.data.deliveryZones.map((zone) => (
                <article className="reference-row" key={zone.id}>
                  <div>
                    <strong>{zone.name}</strong>
                    <span>{zone.code}</span>
                  </div>
                  <b>{formatMoney(zone.baseFeeCents)}</b>
                </article>
              ))}
            </ReferencePanel>
          </aside>
        </div>
      )}
    </div>
  );
}

function MaterialFields() {
  return (
    <>
      <label className="field">
        <span>Material</span>
        <input name="materialName" placeholder="#57 limestone" required />
      </label>
      <label className="field">
        <span>Unit</span>
        <select name="unit">
          <option value="tons">Tons</option>
          <option value="cubic_yards">Cubic yards</option>
          <option value="loads">Loads</option>
        </select>
      </label>
      <label className="field">
        <span>Supplier</span>
        <input name="supplierName" placeholder="Supplier name" required />
      </label>
      <label className="field">
        <span>Supplier location</span>
        <input name="supplierLocationName" placeholder="Main yard" required />
      </label>
      <MoneyField label="Unit cost" name="unitCost" />
      <label className="field">
        <span>Markup percent</span>
        <input min="0" name="markupPercent" step="0.01" type="number" defaultValue="25" required />
      </label>
      <label className="field">
        <span>Zone code</span>
        <input name="zoneCode" placeholder="LINCOLN" required />
      </label>
      <label className="field">
        <span>Zone name</span>
        <input name="zoneName" placeholder="Lincoln metro" required />
      </label>
      <MoneyField label="Zone base fee" name="baseFee" />
      <MoneyField label="Additional supplier stop" name="additionalSupplierStop" />
      <MoneyField label="Separate placement" name="separatePlacement" />
      <MoneyField label="Deposit minimum" name="depositMinimum" />
      <MoneyField label="Deposit round-up increment" name="depositRoundUp" defaultValue="5.00" />
    </>
  );
}

function RentalFields() {
  return (
    <>
      <MoneyField label="Package amount" name="packageAmount" />
      <label className="field">
        <span>Included days</span>
        <input min="1" name="includedDays" type="number" defaultValue="3" required />
      </label>
      <MoneyField label="Additional day" name="additionalDay" />
      <label className="field">
        <span>Included weight (lb)</span>
        <input min="0" name="includedWeight" type="number" defaultValue="2000" required />
      </label>
      <MoneyField label="Overage per pound" name="overageRate" step="0.01" />
      <MoneyField label="Security deposit" name="securityDeposit" />
    </>
  );
}

function MoneyField({
  defaultValue,
  label,
  name,
  step = "0.01",
}: {
  defaultValue?: string;
  label: string;
  name: string;
  step?: string;
}) {
  return (
    <label className="field">
      <span>{label} ($)</span>
      <input defaultValue={defaultValue} min="0" name={name} step={step} type="number" required />
    </label>
  );
}

function ReferencePanel({
  children,
  count,
  title,
}: {
  children: React.ReactNode;
  count: number;
  title: string;
}) {
  return (
    <section className="panel reference-panel">
      <div className="panel-heading compact">
        <div>
          <span className="panel-kicker">Reference data</span>
          <h2>{title}</h2>
        </div>
        <span className="count-pill">{count}</span>
      </div>
      {count === 0 ? <p className="quiet-panel-copy">None configured.</p> : children}
    </section>
  );
}

function CommercialLoading({ label }: { label: string }) {
  return (
    <section aria-label={label} className="panel commercial-loading" role="status">
      <RefreshCw className="spin" size={22} />
      <span>{label}…</span>
    </section>
  );
}

function CommercialError({
  message,
  retry,
  title,
}: {
  message: string;
  retry: () => void;
  title: string;
}) {
  return (
    <section className="panel intake-state commercial-empty" role="alert">
      <AlertTriangle size={27} />
      <h2>{title}</h2>
      <p>{message}</p>
      <button className="button button-secondary" onClick={retry}>
        Try again
      </button>
    </section>
  );
}

function requiredText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(data: FormData, name: string): number {
  return Number(requiredText(data, name));
}

function dollarsToCents(data: FormData, name: string): number {
  return Math.round(numberValue(data, name) * 100);
}
