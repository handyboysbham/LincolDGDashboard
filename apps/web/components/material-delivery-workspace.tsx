"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  PackagePlus,
  Receipt,
  RefreshCw,
  Route,
  Scale,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorCode, apiErrorMessage, getApiClient } from "../lib/api-client";
import { humanizeCommercialValue } from "../lib/commercial-format";
import { formatCents, formatQuantity } from "../lib/material-delivery-state";

type Job = components["schemas"]["JobDetailDto"];
type Delivery = components["schemas"]["MaterialDeliveryDto"];
type CatalogItem = components["schemas"]["MaterialCatalogItemDto"];
type Asset = components["schemas"]["AssetDto"];
type Expense = components["schemas"]["ExpenseDto"];
type State =
  | { name: "loading" }
  | { message: string; name: "error" }
  | { assets: Asset[]; materials: CatalogItem[]; name: "missing" }
  | { assets: Asset[]; delivery: Delivery; materials: CatalogItem[]; name: "ready" };

export function MaterialDeliveryWorkspace({ job }: { job: Job }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [readiness, setReadiness] = useState<components["schemas"]["InvoiceReadinessDto"]>();

  const load = useCallback(async () => {
    const [deliveryResponse, materialsResponse, assetsResponse] = await Promise.all([
      getApiClient().GET("/api/v1/jobs/{id}/material-delivery", {
        params: { path: { id: job.id } },
      }),
      getApiClient().GET("/api/v1/materials"),
      getApiClient().GET("/api/v1/assets"),
    ]);
    if (!materialsResponse.data || !assetsResponse.data) {
      setState({
        message: apiErrorMessage(
          !materialsResponse.data ? materialsResponse.error : assetsResponse.error,
        ),
        name: "error",
      });
      return;
    }
    if (!deliveryResponse.data) {
      if (apiErrorCode(deliveryResponse.error) === "MATERIAL_DELIVERY_NOT_FOUND") {
        setState({
          assets: assetsResponse.data.items,
          materials: materialsResponse.data.items,
          name: "missing",
        });
      } else {
        setState({ message: apiErrorMessage(deliveryResponse.error), name: "error" });
      }
      return;
    }
    setState({
      assets: assetsResponse.data.items,
      delivery: deliveryResponse.data,
      materials: materialsResponse.data.items,
      name: "ready",
    });
  }, [job.id]);

  useEffect(() => void load(), [load]);

  const mutate = async (
    operation: () => Promise<{ data?: unknown; error?: unknown }>,
    success = "Material Delivery updated.",
  ) => {
    setBusy(true);
    setActionError(undefined);
    setNotice(undefined);
    const response = await operation();
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else {
      setNotice(success);
      await load();
    }
    setBusy(false);
  };

  const createPlan = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/jobs/{id}/material-delivery", {
          body: {
            deliveryType: selectValue(data, "deliveryType", ["bulk", "placed", "spread"]),
            placementEvidenceRequired: data.get("placementEvidenceRequired") === "on",
            plannedLoadCount: integerValue(data, "plannedLoadCount"),
          },
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { id: job.id },
          },
        }),
      "Material Delivery plan created.",
    );
  };

  if (state.name === "loading") {
    return (
      <section className="panel material-delivery-panel commercial-loading" role="status">
        <RefreshCw className="spin" size={22} /> Loading Material Delivery…
      </section>
    );
  }
  if (state.name === "error") {
    return (
      <section className="panel material-delivery-panel commercial-empty" role="alert">
        <AlertTriangle size={26} />
        <h2>Material Delivery unavailable</h2>
        <p>{state.message}</p>
        <button className="button button-secondary" onClick={() => void load()} type="button">
          Try again
        </button>
      </section>
    );
  }
  if (state.name === "missing") {
    return (
      <section className="panel material-delivery-panel">
        <DeliveryPanelHeading
          copy="Create the service-specific Detail before planning physical Loads."
          title="Material Delivery plan"
        />
        <form className="material-form-grid" onSubmit={(event) => void createPlan(event)}>
          <label>
            Delivery type
            <select name="deliveryType">
              <option value="placed">Placed</option>
              <option value="bulk">Bulk</option>
              <option value="spread">Spread</option>
            </select>
          </label>
          <label>
            Planned Loads
            <input defaultValue="1" max="20" min="1" name="plannedLoadCount" type="number" />
          </label>
          <label className="material-check-row field-wide">
            <input defaultChecked name="placementEvidenceRequired" type="checkbox" />
            Require placement evidence for every Item
          </label>
          <button className="button button-primary field-wide" disabled={busy}>
            <PackagePlus size={16} /> Create delivery plan
          </button>
        </form>
      </section>
    );
  }

  const { assets, delivery, materials } = state;
  const items = delivery.loads.flatMap((loadRecord) => loadRecord.items);
  return (
    <section className="material-delivery-workspace">
      <div className="panel material-delivery-panel">
        <DeliveryPanelHeading
          copy="One continuous scheduled operation with server-owned quantities and financial facts."
          title="Material Delivery"
        />
        {actionError && (
          <div className="inline-form-error" role="alert">
            <AlertTriangle size={17} /> {actionError}
          </div>
        )}
        {notice && (
          <div className="inline-form-success" role="status">
            <CheckCircle2 size={17} /> {notice}
          </div>
        )}
        <div className="material-summary-grid">
          <SummaryFact label="Delivery" value={humanizeCommercialValue(delivery.status)} />
          <SummaryFact label="Capacity" value={humanizeCommercialValue(delivery.capacityStatus)} />
          <SummaryFact label="Receipts" value={humanizeCommercialValue(delivery.receiptStatus)} />
          <SummaryFact
            label="Placement"
            value={humanizeCommercialValue(delivery.placementEvidenceStatus)}
          />
          <SummaryFact
            label="Planned volume"
            value={formatQuantity(delivery.plannedVolumeCubicYards, "cubic_yards")}
          />
          <SummaryFact
            label="Delivered volume"
            value={formatQuantity(delivery.actualDeliveredVolumeCubicYards, "cubic_yards")}
          />
        </div>
      </div>

      <DispatcherPlanner
        assets={assets}
        busy={busy}
        delivery={delivery}
        job={job}
        materials={materials}
        mutate={mutate}
      />
      <VarianceWorkspace busy={busy} delivery={delivery} items={items} mutate={mutate} />
      <ExpenseWorkspace
        busy={busy}
        delivery={delivery}
        items={items}
        jobId={job.id}
        mutate={mutate}
      />
      <ChargeWorkspace
        busy={busy}
        delivery={delivery}
        items={items}
        jobId={job.id}
        mutate={mutate}
      />

      <section className="panel material-delivery-panel material-readiness-panel">
        <div>
          <span className="page-eyebrow">Finance handoff</span>
          <h2>Invoice readiness</h2>
          <p>
            The server evaluates operational completion, evidence, Expenses, Allocations, variances,
            and Charges together.
          </p>
        </div>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() =>
            void mutate(async () => {
              const response = await getApiClient().POST(
                "/api/v1/jobs/{id}/actions/evaluate-invoice-readiness",
                {
                  params: {
                    header: { "Idempotency-Key": crypto.randomUUID() },
                    path: { id: job.id },
                  },
                },
              );
              if (response.data) setReadiness(response.data);
              return response;
            }, "Invoice readiness evaluated.")
          }
          type="button"
        >
          <ClipboardCheck size={16} /> Evaluate invoice readiness
        </button>
        {readiness && (
          <div className={`material-readiness-result is-${readiness.result}`}>
            <strong>{humanizeCommercialValue(readiness.result)}</strong>
            {readiness.blockers.map((blocker) => (
              <span key={blocker}>{blocker}</span>
            ))}
            {readiness.warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function DispatcherPlanner({
  assets,
  busy,
  delivery,
  job,
  materials,
  mutate,
}: {
  assets: Asset[];
  busy: boolean;
  delivery: Delivery;
  job: Job;
  materials: CatalogItem[];
  mutate: Mutation;
}) {
  const supplierStops = job.routeStops.filter((stop) => stop.stopType === "supplier");
  const placementStops = job.routeStops.filter((stop) => stop.stopType === "customer");
  const nextItemSequence =
    delivery.loads.reduce(
      (highest, load) =>
        load.items.reduce((itemHighest, item) => Math.max(itemHighest, item.sequence), highest),
      0,
    ) + 1;
  const createLoad = async () =>
    mutate(
      async () =>
        getApiClient().POST("/api/v1/jobs/{id}/material-loads", {
          body: { sequence: delivery.loads.length + 1 },
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { id: job.id },
          },
        }),
      "Material Load created.",
    );
  const createItem = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const loadId = textValue(data, "loadId");
    const selectedMaterial = materials.find(
      (material) => material.id === textValue(data, "materialId"),
    );
    const compartment = optionalText(data, "compartment");
    const separationInstructions = optionalText(data, "separationInstructions");
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/material-loads/{id}/items", {
          body: {
            ...(compartment ? { compartment } : {}),
            loadingSequence: integerValue(data, "loadingSequence"),
            materialId: textValue(data, "materialId"),
            placementRouteStopId: textValue(data, "placementRouteStopId"),
            plannedQuantity: textValue(data, "plannedQuantity"),
            plannedUnitCostCents: dollarsToCents(textValue(data, "plannedUnitCost")),
            quantityUnit: selectValue(data, "quantityUnit", ["tons", "cubic_yards", "loads"]),
            ...(separationInstructions ? { separationInstructions } : {}),
            sequence: integerValue(data, "sequence"),
            supplierRouteStopId: textValue(data, "supplierRouteStopId"),
            unitVolumeCubicYards: textValue(data, "unitVolumeCubicYards"),
            unitWeightPounds: textValue(data, "unitWeightPounds"),
            unloadingSequence: integerValue(data, "unloadingSequence"),
          },
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { id: loadId },
          },
        }),
      `${selectedMaterial?.name ?? "Material"} added to the Load.`,
    );
  };
  return (
    <section className="panel material-delivery-panel">
      <div className="material-section-heading">
        <div>
          <span className="page-eyebrow">Dispatcher</span>
          <h2>Load planner</h2>
          <p>Plan materials, stops, hauling assets, and immutable safety evaluations.</p>
        </div>
        <button
          className="button button-secondary"
          disabled={busy || delivery.loads.length >= delivery.plannedLoadCount}
          onClick={() => void createLoad()}
          type="button"
        >
          <Truck size={16} /> Add Load
        </button>
      </div>
      {delivery.loads.length === 0 ? (
        <p className="muted-copy">No physical Loads are planned yet.</p>
      ) : (
        <div className="material-load-list">
          {delivery.loads.map((load) => (
            <LoadPlannerCard
              assets={assets}
              busy={busy}
              key={load.id}
              load={load}
              mutate={mutate}
            />
          ))}
        </div>
      )}
      {delivery.loads.length > 0 && (
        <form
          className="material-form-grid material-subform"
          onSubmit={(event) => void createItem(event)}
        >
          <h3 className="field-wide">Add Material Item</h3>
          <label>
            Load
            <select name="loadId">
              {delivery.loads.map((load) => (
                <option key={load.id} value={load.id}>
                  Load {load.sequence}
                </option>
              ))}
            </select>
          </label>
          <label>
            Material
            <select name="materialId">
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supplier stop
            <select name="supplierRouteStopId" required>
              <option value="">Choose…</option>
              {supplierStops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Placement stop
            <select name="placementRouteStopId" required>
              <option value="">Choose…</option>
              {placementStops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Planned quantity
            <input inputMode="decimal" name="plannedQuantity" placeholder="4.000" required />
          </label>
          <label>
            Unit
            <select name="quantityUnit">
              <option value="cubic_yards">Cubic yards</option>
              <option value="tons">Tons</option>
              <option value="loads">Loads</option>
            </select>
          </label>
          <label>
            Weight per unit (lb)
            <input inputMode="decimal" name="unitWeightPounds" placeholder="1500.000" required />
          </label>
          <label>
            Volume per unit (yd³)
            <input inputMode="decimal" name="unitVolumeCubicYards" placeholder="1.000" required />
          </label>
          <label>
            Planned unit cost ($)
            <input inputMode="decimal" name="plannedUnitCost" placeholder="32.00" required />
          </label>
          <label>
            Item sequence
            <input defaultValue={nextItemSequence} min="1" name="sequence" type="number" />
          </label>
          <label>
            Loading sequence
            <input defaultValue={nextItemSequence} min="1" name="loadingSequence" type="number" />
          </label>
          <label>
            Unloading sequence
            <input defaultValue={nextItemSequence} min="1" name="unloadingSequence" type="number" />
          </label>
          <label>
            Compartment
            <input name="compartment" placeholder="Front compartment" />
          </label>
          <label className="field-wide">
            Separation instructions
            <textarea
              name="separationInstructions"
              placeholder="Keep gravel and sand separated by divider"
            />
          </label>
          {(supplierStops.length === 0 || placementStops.length === 0) && (
            <p className="inline-form-error field-wide">
              Add at least one supplier and one customer Route Stop above before creating Items.
            </p>
          )}
          <button
            className="button button-primary field-wide"
            disabled={
              busy ||
              supplierStops.length === 0 ||
              placementStops.length === 0 ||
              materials.length === 0
            }
          >
            <PackagePlus size={16} /> Add Item
          </button>
        </form>
      )}
    </section>
  );
}

function LoadPlannerCard({
  assets,
  busy,
  load,
  mutate,
}: {
  assets: Asset[];
  busy: boolean;
  load: Delivery["loads"][number];
  mutate: Mutation;
}) {
  const assignAsset = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/material-loads/{id}/assets", {
          body: {
            assetId: textValue(data, "assetId"),
            role: selectValue(data, "role", ["truck", "trailer", "equipment"]),
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: load.id } },
        }),
      "Hauling Asset assigned.",
    );
  };
  const evaluate = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/material-loads/{id}/actions/evaluate-safety", {
          body: {
            compatibilityConfirmed: data.get("compatibilityConfirmed") === "on",
            separationConfirmed: data.get("separationConfirmed") === "on",
            validationType: selectValue(data, "validationType", ["planning", "dispatch"]),
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: load.id } },
        }),
      "Safety evaluation recorded.",
    );
  };
  const release = async () =>
    mutate(
      async () =>
        getApiClient().POST("/api/v1/material-loads/{id}/actions/{action}", {
          body: {},
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { action: "ready-for-loading", id: load.id },
          },
        }),
      "Load released to the driver.",
    );
  const reconcile = async () =>
    mutate(
      async () =>
        getApiClient().POST("/api/v1/material-loads/{id}/actions/{action}", {
          body: {},
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { action: "reconcile", id: load.id },
          },
        }),
      "Load reconciled.",
    );
  return (
    <article className="material-load-card">
      <div className="material-load-heading">
        <div>
          <span>Load {load.sequence}</span>
          <h3>{humanizeCommercialValue(load.status)}</h3>
        </div>
        <b>{formatQuantity(load.plannedWeightPounds, "lb")}</b>
      </div>
      <div className="material-load-facts">
        <span>
          <Scale size={15} /> {humanizeCommercialValue(load.capacityResult)}
        </span>
        <span>
          <ShieldCheck size={15} /> {humanizeCommercialValue(load.compatibilityResult)}
        </span>
        <span>
          <Route size={15} /> {load.items.length} Items
        </span>
      </div>
      {load.items.map((item) => (
        <div className="material-item-row" key={item.id}>
          <div>
            <strong>{item.materialName ?? `Material ${String(item.sequence)}`}</strong>
            <small>
              {item.supplierStopLabel} → {item.placementStopLabel}
            </small>
          </div>
          <span>{formatQuantity(item.plannedQuantity, item.quantityUnit)}</span>
        </div>
      ))}
      {load.status === "planned" && (
        <>
          <form className="material-inline-form" onSubmit={(event) => void assignAsset(event)}>
            <label>
              Asset
              <select name="assetId">
                {assets
                  .filter((asset) => asset.status === "available")
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.assetNumber} · {asset.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Role
              <select name="role">
                <option value="truck">Truck</option>
                <option value="trailer">Trailer</option>
                <option value="equipment">Equipment</option>
              </select>
            </label>
            <button className="button button-secondary" disabled={busy || assets.length === 0}>
              Assign
            </button>
          </form>
          <form className="material-safety-form" onSubmit={(event) => void evaluate(event)}>
            <label>
              Evaluation
              <select name="validationType">
                <option value="planning">Planning</option>
                <option value="dispatch">Dispatch</option>
              </select>
            </label>
            <label className="material-check-row">
              <input name="compatibilityConfirmed" type="checkbox" /> Compatibility confirmed
            </label>
            <label className="material-check-row">
              <input name="separationConfirmed" type="checkbox" /> Separation confirmed
            </label>
            <button className="button button-secondary" disabled={busy}>
              <ShieldCheck size={16} /> Evaluate safety
            </button>
          </form>
          <button
            className="button button-primary"
            disabled={busy || load.items.length === 0}
            onClick={() => void release()}
            type="button"
          >
            Release to driver
          </button>
        </>
      )}
      {load.status === "reconciling" && (
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() => void reconcile()}
          type="button"
        >
          <CheckCircle2 size={16} /> Reconcile Load
        </button>
      )}
      {load.validations.at(-1)?.blockers.map((blocker) => (
        <p className="material-blocker" key={blocker}>
          <AlertTriangle size={14} /> {blocker}
        </p>
      ))}
    </article>
  );
}

function VarianceWorkspace({
  busy,
  delivery,
  items,
  mutate,
}: {
  busy: boolean;
  delivery: Delivery;
  items: Delivery["loads"][number]["items"];
  mutate: Mutation;
}) {
  const create = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const itemId = textValue(data, "itemId");
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/material-load-items/{id}/variances", {
          body: {
            actualQuantity: textValue(data, "actualQuantity"),
            expectedQuantity: textValue(data, "expectedQuantity"),
            responsibility: selectValue(data, "responsibility", [
              "customer",
              "business",
              "shared",
              "supplier",
              "vendor",
              "insurance",
              "unknown",
              "disputed",
              "not_applicable",
            ]),
            varianceType: selectValue(data, "varianceType", [
              "purchase",
              "loading",
              "delivery",
              "remaining",
            ]),
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: itemId } },
        }),
      "Quantity variance opened.",
    );
  };
  const resolve = async (
    form: HTMLFormElement,
    varianceId: string,
    action: "resolve" | "waive",
  ) => {
    const data = new FormData(form);
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/material-quantity-variances/{id}/actions/{action}", {
          body: {
            reason: textValue(data, "reason"),
            resolutionType: selectValue(data, "resolutionType", [
              "charge",
              "credit",
              "no_charge",
              "follow_up_job",
              "supplier_adjustment",
              "customer_acceptance",
              "other",
            ]),
          },
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { action, id: varianceId },
          },
        }),
      `Variance ${action === "waive" ? "waived" : "resolved"}.`,
    );
  };
  return (
    <section className="panel material-delivery-panel">
      <div className="material-section-heading">
        <div>
          <span className="page-eyebrow">Quantity control</span>
          <h2>Variances</h2>
          <p>Expected and actual quantities remain immutable facts with controlled resolution.</p>
        </div>
        <Scale size={21} />
      </div>
      {delivery.variances.length === 0 ? (
        <p className="muted-copy">No quantity variances recorded.</p>
      ) : (
        delivery.variances.map((variance) => (
          <article className="reconciliation-row" key={variance.id}>
            <div>
              <strong>
                {humanizeCommercialValue(variance.varianceType)} variance ·{" "}
                {variance.varianceQuantity}
              </strong>
              <small>
                {humanizeCommercialValue(variance.responsibility)} ·{" "}
                {humanizeCommercialValue(variance.status)}
              </small>
            </div>
            {variance.status === "open" && (
              <form
                className="reconciliation-action-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void resolve(event.currentTarget, variance.id, "resolve");
                }}
              >
                <select name="resolutionType">
                  <option value="no_charge">No charge</option>
                  <option value="charge">Charge</option>
                  <option value="credit">Credit</option>
                  <option value="supplier_adjustment">Supplier adjustment</option>
                  <option value="follow_up_job">Follow-up Job</option>
                  <option value="customer_acceptance">Customer acceptance</option>
                  <option value="other">Other</option>
                </select>
                <input name="reason" placeholder="Resolution reason" required />
                <button className="button button-secondary" disabled={busy}>
                  Resolve
                </button>
                <button
                  className="button button-quiet"
                  disabled={busy}
                  onClick={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget.form;
                    if (form) void resolve(form, variance.id, "waive");
                  }}
                  type="button"
                >
                  Waive
                </button>
              </form>
            )}
          </article>
        ))
      )}
      {items.length > 0 && (
        <form
          className="material-inline-form material-subform"
          onSubmit={(event) => void create(event)}
        >
          <label>
            Item
            <select name="itemId">
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.materialName ?? `Item ${String(item.sequence)}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="varianceType">
              <option value="delivery">Delivery</option>
              <option value="purchase">Purchase</option>
              <option value="loading">Loading</option>
              <option value="remaining">Remaining</option>
            </select>
          </label>
          <label>
            Expected
            <input inputMode="decimal" name="expectedQuantity" required />
          </label>
          <label>
            Actual
            <input inputMode="decimal" name="actualQuantity" required />
          </label>
          <label>
            Responsibility
            <select name="responsibility">
              <option value="supplier">Supplier</option>
              <option value="business">Business</option>
              <option value="customer">Customer</option>
              <option value="shared">Shared</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <button className="button button-secondary" disabled={busy}>
            Open variance
          </button>
        </form>
      )}
    </section>
  );
}

function ExpenseWorkspace({
  busy,
  delivery,
  items,
  jobId,
  mutate,
}: {
  busy: boolean;
  delivery: Delivery;
  items: Delivery["loads"][number]["items"];
  jobId: string;
  mutate: Mutation;
}) {
  const receipts = items.flatMap((item) =>
    item.evidence.filter((evidence) => evidence.purpose === "supplier_receipt"),
  );
  const create = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const receiptDocumentId = optionalText(data, "receiptDocumentId");
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/jobs/{id}/expenses", {
          body: {
            amountCents: dollarsToCents(textValue(data, "amount")),
            description: textValue(data, "description"),
            expenseType: selectValue(data, "expenseType", [
              "material_purchase",
              "supplier_fee",
              "delivery",
              "disposal",
              "other",
            ]),
            incurredAt: new Date().toISOString(),
            ...(receiptDocumentId ? { receiptDocumentId } : {}),
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: jobId } },
        }),
      "Supplier Expense created.",
    );
  };
  return (
    <section className="panel material-delivery-panel">
      <div className="material-section-heading">
        <div>
          <span className="page-eyebrow">Actual company cost</span>
          <h2>Expenses &amp; Allocations</h2>
          <p>Amounts use integer cents and require exact active allocation before approval.</p>
        </div>
        <Receipt size={21} />
      </div>
      {delivery.expenses.length === 0 ? (
        <p className="muted-copy">No supplier Expenses recorded.</p>
      ) : (
        delivery.expenses.map((expense) => (
          <ExpenseRow
            busy={busy}
            expense={expense}
            items={items}
            key={expense.id}
            mutate={mutate}
          />
        ))
      )}
      <form
        className="material-inline-form material-subform"
        onSubmit={(event) => void create(event)}
      >
        <label>
          Type
          <select name="expenseType">
            <option value="material_purchase">Material purchase</option>
            <option value="supplier_fee">Supplier fee</option>
            <option value="delivery">Delivery</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Amount ($)
          <input inputMode="decimal" name="amount" placeholder="128.00" required />
        </label>
        <label>
          Description
          <input name="description" placeholder="Gravel supplier purchase" required />
        </label>
        <label>
          Receipt
          <select name="receiptDocumentId">
            <option value="">Attach later / waiver required</option>
            {receipts.map((receipt) => (
              <option key={receipt.documentId} value={receipt.documentId}>
                {receipt.originalFilename}
              </option>
            ))}
          </select>
        </label>
        <button className="button button-secondary" disabled={busy}>
          Create Expense
        </button>
      </form>
    </section>
  );
}

function ExpenseRow({
  busy,
  expense,
  items,
  mutate,
}: {
  busy: boolean;
  expense: Expense;
  items: Delivery["loads"][number]["items"];
  mutate: Mutation;
}) {
  const allocate = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/expenses/{id}/allocations", {
          body: {
            amountCents: dollarsToCents(textValue(data, "amount")),
            materialLoadItemId: textValue(data, "itemId"),
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: expense.id } },
        }),
      "Expense Allocation created.",
    );
  };
  const transition = async (action: "approve" | "reconcile") =>
    mutate(
      async () =>
        getApiClient().POST("/api/v1/expenses/{id}/actions/{action}", {
          body: {},
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { action, id: expense.id },
          },
        }),
      `Expense ${action}d.`,
    );
  const waive = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/expenses/{id}/actions/{action}", {
          body: { reason: textValue(data, "reason") },
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { action: "waive-receipt", id: expense.id },
          },
        }),
      "Receipt requirement waived.",
    );
  };
  const allocated = expense.allocations
    .filter((allocation) => allocation.status === "active")
    .reduce((sum, allocation) => sum + allocation.amountCents, 0);
  return (
    <article className="reconciliation-row">
      <div>
        <strong>
          {expense.expenseNumber} · {formatCents(expense.amountCents)}
        </strong>
        <small>
          {humanizeCommercialValue(expense.expenseType)} · {humanizeCommercialValue(expense.status)}{" "}
          · {formatCents(allocated)} allocated
        </small>
      </div>
      <div className="reconciliation-actions">
        {expense.receiptStatus === "missing" && (
          <form className="reconciliation-action-form" onSubmit={(event) => void waive(event)}>
            <input name="reason" placeholder="Receipt waiver reason" required />
            <button className="button button-quiet" disabled={busy}>
              Waive receipt
            </button>
          </form>
        )}
        {["draft", "evidence_required", "pending_review"].includes(expense.status) &&
          allocated < expense.amountCents && (
            <form className="reconciliation-action-form" onSubmit={(event) => void allocate(event)}>
              <select name="itemId">
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.materialName ?? `Item ${String(item.sequence)}`}
                  </option>
                ))}
              </select>
              <input
                defaultValue={((expense.amountCents - allocated) / 100).toFixed(2)}
                inputMode="decimal"
                name="amount"
              />
              <button className="button button-secondary" disabled={busy}>
                Allocate
              </button>
            </form>
          )}
        {["draft", "evidence_required", "pending_review"].includes(expense.status) && (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void transition("approve")}
            type="button"
          >
            Approve
          </button>
        )}
        {expense.status === "approved" && (
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => void transition("reconcile")}
            type="button"
          >
            Reconcile
          </button>
        )}
      </div>
    </article>
  );
}

function ChargeWorkspace({
  busy,
  delivery,
  items,
  jobId,
  mutate,
}: {
  busy: boolean;
  delivery: Delivery;
  items: Delivery["loads"][number]["items"];
  jobId: string;
  mutate: Mutation;
}) {
  const create = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const sourceId = textValue(data, "sourceId");
    const chargeType = textValue(data, "chargeType");
    await mutate(
      async () =>
        getApiClient().POST("/api/v1/jobs/{id}/job-charges", {
          body: {
            calculationSnapshot: { origin: "staff_material_delivery_reconciliation", version: 1 },
            chargeKind: selectValue(data, "chargeKind", [
              "charge",
              "credit",
              "no_charge",
              "informational",
            ]),
            chargeType,
            customerAuthorizationStatus: selectValue(data, "customerAuthorizationStatus", [
              "not_required",
              "authorized",
              "waived",
            ]),
            customerDescription: textValue(data, "customerDescription"),
            dedupeKey: `${chargeType}:${sourceId}`,
            evidenceStatus: selectValue(data, "evidenceStatus", [
              "complete",
              "waived",
              "not_required",
            ]),
            internalApprovalStatus: selectValue(data, "internalApprovalStatus", [
              "not_required",
              "approved",
              "waived",
            ]),
            occurredAt: new Date().toISOString(),
            quantity: textValue(data, "quantity"),
            rateCents: dollarsToCents(textValue(data, "rate")),
            responsibility: selectValue(data, "responsibility", [
              "customer",
              "business",
              "shared",
              "supplier",
              "vendor",
              "insurance",
              "not_applicable",
            ]),
            sourceId,
            sourceType: "material_load_item",
            taxBehavior: selectValue(data, "taxBehavior", [
              "taxable",
              "non_taxable",
              "tax_included",
            ]),
            unit: textValue(data, "unit"),
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() }, path: { id: jobId } },
        }),
      "Operational Job Charge created.",
    );
  };
  const approve = async (chargeId: string) =>
    mutate(
      async () =>
        getApiClient().POST("/api/v1/job-charges/{id}/actions/{action}", {
          body: {},
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { action: "approve", id: chargeId },
          },
        }),
      "Job Charge approved and ready to invoice.",
    );
  return (
    <section className="panel material-delivery-panel">
      <div className="material-section-heading">
        <div>
          <span className="page-eyebrow">Billing decision</span>
          <h2>Operational Job Charges</h2>
          <p>
            The server calculates quantity × accepted rate and rejects duplicate active dedupe keys.
          </p>
        </div>
        <Calculator size={21} />
      </div>
      {delivery.jobCharges.length === 0 ? (
        <p className="muted-copy">No operational Job Charges recorded.</p>
      ) : (
        delivery.jobCharges.map((charge) => (
          <article className="reconciliation-row" key={charge.id}>
            <div>
              <strong>
                {charge.chargeNumber} ·{" "}
                {formatCents(charge.calculatedAmountCents ?? charge.proposedAmountCents)}
              </strong>
              <small>
                {charge.customerDescription} · {humanizeCommercialValue(charge.status)}
              </small>
            </div>
            {charge.status === "draft" && (
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void approve(charge.id)}
                type="button"
              >
                Approve
              </button>
            )}
          </article>
        ))
      )}
      {items.length > 0 && (
        <form
          className="material-form-grid material-subform"
          onSubmit={(event) => void create(event)}
        >
          <label>
            Source Item
            <select name="sourceId">
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.materialName ?? `Item ${String(item.sequence)}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select name="chargeKind">
              <option value="charge">Charge</option>
              <option value="credit">Credit</option>
              <option value="no_charge">No charge</option>
              <option value="informational">Informational</option>
            </select>
          </label>
          <label>
            Charge type
            <input name="chargeType" placeholder="quantity_adjustment" required />
          </label>
          <label>
            Responsibility
            <select name="responsibility">
              <option value="customer">Customer</option>
              <option value="business">Business</option>
              <option value="shared">Shared</option>
              <option value="supplier">Supplier</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </label>
          <label>
            Quantity
            <input inputMode="decimal" name="quantity" placeholder="0.100" required />
          </label>
          <label>
            Unit
            <input defaultValue="cubic_yards" name="unit" required />
          </label>
          <label>
            Rate ($)
            <input inputMode="decimal" name="rate" placeholder="28.00" required />
          </label>
          <label>
            Tax
            <select name="taxBehavior">
              <option value="taxable">Taxable</option>
              <option value="non_taxable">Non-taxable</option>
              <option value="tax_included">Tax included</option>
            </select>
          </label>
          <label>
            Evidence
            <select name="evidenceStatus">
              <option value="complete">Complete</option>
              <option value="waived">Waived</option>
              <option value="not_required">Not required</option>
            </select>
          </label>
          <label>
            Customer authorization
            <select name="customerAuthorizationStatus">
              <option value="not_required">Not required</option>
              <option value="authorized">Authorized</option>
              <option value="waived">Waived</option>
            </select>
          </label>
          <label>
            Internal approval
            <select name="internalApprovalStatus">
              <option value="approved">Approved</option>
              <option value="not_required">Not required</option>
              <option value="waived">Waived</option>
            </select>
          </label>
          <label className="field-wide">
            Customer description
            <input
              name="customerDescription"
              placeholder="Additional delivered material"
              required
            />
          </label>
          <button className="button button-secondary field-wide" disabled={busy}>
            Calculate Job Charge
          </button>
        </form>
      )}
    </section>
  );
}

function DeliveryPanelHeading({ copy, title }: { copy: string; title: string }) {
  return (
    <div className="material-section-heading">
      <div>
        <span className="page-eyebrow">Sprint 1.6 operations</span>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      <Truck size={22} />
    </div>
  );
}
function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
type Mutation = (
  operation: () => Promise<{ data?: unknown; error?: unknown }>,
  success?: string,
) => Promise<void>;
function textValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function optionalText(data: FormData, key: string): string | undefined {
  return textValue(data, key) || undefined;
}
function integerValue(data: FormData, key: string): number {
  return Number.parseInt(textValue(data, key), 10);
}
function dollarsToCents(value: string): number {
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}
function selectValue<const T extends string>(
  data: FormData,
  key: string,
  options: readonly T[],
): T {
  const value = textValue(data, key);
  const match = options.find((option) => option === value);
  if (!match) throw new Error(`Invalid ${key}`);
  return match;
}
