"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";
import { humanizeCommercialValue } from "../lib/commercial-format";
import {
  actionReadinessMessage,
  formatQuantity,
  isDeliveryStage,
  isSupplierStage,
  loadActionLabel,
  nextLoadAction,
  type LoadExecutionAction,
} from "../lib/material-delivery-state";
import { DocumentUploadCard } from "./document-upload-card";

type Job = components["schemas"]["JobDetailDto"];
type Delivery = components["schemas"]["MaterialDeliveryDto"];
type Load = components["schemas"]["MaterialLoadDto"];
type Item = components["schemas"]["MaterialLoadItemDto"];
type EvidencePurpose = components["schemas"]["AttachMaterialEvidenceDto"]["purpose"];
type State =
  | { name: "loading" }
  | { message: string; name: "error" }
  | { delivery: Delivery; job: Job; name: "ready" };

export function DriverJob({ jobId }: { jobId: string }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    const [jobResponse, deliveryResponse] = await Promise.all([
      getApiClient().GET("/api/v1/jobs/{id}", { params: { path: { id: jobId } } }),
      getApiClient().GET("/api/v1/jobs/{id}/material-delivery", {
        params: { path: { id: jobId } },
      }),
    ]);
    if (!jobResponse.data || !deliveryResponse.data) {
      setState({
        message: apiErrorMessage(!jobResponse.data ? jobResponse.error : deliveryResponse.error),
        name: "error",
      });
      return;
    }
    setState({ delivery: deliveryResponse.data, job: jobResponse.data, name: "ready" });
  }, [jobId]);

  useEffect(() => void load(), [load]);

  const execute = async (loadId: string, action: LoadExecutionAction) => {
    setBusy(true);
    setActionError(undefined);
    setNotice(undefined);
    const response = await getApiClient().POST("/api/v1/material-loads/{id}/actions/{action}", {
      body: { occurredAt: new Date().toISOString() },
      params: {
        header: { "Idempotency-Key": crypto.randomUUID() },
        path: { action, id: loadId },
      },
    });
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else {
      setNotice(`${loadActionLabel(action)} recorded.`);
      await load();
    }
    setBusy(false);
  };

  const recordSupplierQuantities = async (
    event: SyntheticEvent<HTMLFormElement>,
    itemId: string,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(async () =>
      getApiClient().POST("/api/v1/material-load-items/{id}/actions/record-quantities", {
        body: {
          actualUnitCostCents: dollarsToCents(textValue(data, "actualUnitCost")),
          loadedQuantity: textValue(data, "loadedQuantity"),
          purchasedQuantity: textValue(data, "purchasedQuantity"),
        },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: itemId },
        },
      }),
    );
  };

  const recordDeliveryQuantities = async (
    event: SyntheticEvent<HTMLFormElement>,
    itemId: string,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const remainingQuantity = textValue(data, "remainingQuantity");
    await mutate(async () =>
      getApiClient().POST("/api/v1/material-load-items/{id}/actions/record-quantities", {
        body: {
          deliveredQuantity: textValue(data, "deliveredQuantity"),
          deliveryResult: selectValue(data, "deliveryResult", [
            "delivered",
            "partially_delivered",
            "not_delivered",
            "returned",
          ]),
          remainingDisposition:
            remainingQuantity === "0"
              ? "none"
              : selectValue(data, "remainingDisposition", [
                  "returned_to_supplier",
                  "retained_by_business",
                  "left_with_customer",
                  "disposed",
                  "follow_up_job",
                  "other",
                ]),
          remainingQuantity,
        },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: itemId },
        },
      }),
    );
  };

  const evaluateActualSafety = async (event: SyntheticEvent<HTMLFormElement>, loadId: string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(async () =>
      getApiClient().POST("/api/v1/material-loads/{id}/actions/evaluate-safety", {
        body: {
          compatibilityConfirmed: data.get("compatibilityConfirmed") === "on",
          separationConfirmed: data.get("separationConfirmed") === "on",
          validationType: "actual",
        },
        params: {
          header: { "Idempotency-Key": crypto.randomUUID() },
          path: { id: loadId },
        },
      }),
    );
  };

  const mutate = async (operation: () => Promise<{ data?: unknown; error?: unknown }>) => {
    setBusy(true);
    setActionError(undefined);
    setNotice(undefined);
    const response = await operation();
    if (!response.data) setActionError(apiErrorMessage(response.error));
    else {
      setNotice("Delivery record updated.");
      await load();
    }
    setBusy(false);
  };

  if (state.name === "loading") {
    return (
      <main className="driver-main">
        <section className="driver-state-card" role="status">
          <RefreshCw className="spin" size={24} />
          <h1>Loading delivery…</h1>
          <p>Checking load status, quantities, and evidence.</p>
        </section>
      </main>
    );
  }
  if (state.name === "error") {
    return (
      <main className="driver-main">
        <section className="driver-state-card is-error" role="alert">
          <AlertTriangle size={27} />
          <h1>Delivery unavailable</h1>
          <p>{state.message}</p>
          <Link className="driver-primary-button" href="/driver/jobs">
            Back to jobs
          </Link>
        </section>
      </main>
    );
  }

  const activeLoad =
    state.delivery.loads.find(
      (candidate) => !["cancelled", "reconciled", "rejected"].includes(candidate.status),
    ) ?? state.delivery.loads.findLast((candidate) => candidate.status === "reconciled");
  return (
    <main className="driver-main driver-job-main">
      <Link className="driver-back-link" href="/driver/jobs">
        <ArrowLeft size={17} /> Assignments
      </Link>
      <section className="driver-job-heading">
        <div>
          <span>{state.job.jobNumber}</span>
          <h1>{state.job.customerName}</h1>
          <p>{humanizeCommercialValue(state.delivery.deliveryType)} material delivery</p>
        </div>
        <span className={`commercial-status status-${state.job.status}`}>
          {humanizeCommercialValue(state.job.status)}
        </span>
      </section>

      {actionError && (
        <div className="driver-alert is-error" role="alert">
          <AlertTriangle size={18} /> {actionError}
        </div>
      )}
      {notice && (
        <div className="driver-alert is-success" role="status">
          <CheckCircle2 size={18} /> {notice}
        </div>
      )}

      {!activeLoad ? (
        <section className="driver-state-card">
          <Truck size={27} />
          <h2>No load assigned</h2>
          <p>Dispatch must finish the load plan before driver execution begins.</p>
        </section>
      ) : (
        <DriverLoad
          busy={busy}
          execute={execute}
          load={activeLoad}
          onEvidenceAttached={load}
          onRecordDelivery={recordDeliveryQuantities}
          onRecordSupplier={recordSupplierQuantities}
          onSafety={evaluateActualSafety}
        />
      )}
    </main>
  );
}

function DriverLoad({
  busy,
  execute,
  load,
  onEvidenceAttached,
  onRecordDelivery,
  onRecordSupplier,
  onSafety,
}: {
  busy: boolean;
  execute: (loadId: string, action: LoadExecutionAction) => Promise<void>;
  load: Load;
  onEvidenceAttached: () => Promise<void>;
  onRecordDelivery: (event: SyntheticEvent<HTMLFormElement>, itemId: string) => Promise<void>;
  onRecordSupplier: (event: SyntheticEvent<HTMLFormElement>, itemId: string) => Promise<void>;
  onSafety: (event: SyntheticEvent<HTMLFormElement>, loadId: string) => Promise<void>;
}) {
  const action = nextLoadAction(load.status);
  const driverAction =
    action === "ready-for-loading" || action === "reconcile" ? undefined : action;
  const latestActualValidation = load.validations.findLast(
    (validation) => validation.validationType === "actual",
  );
  return (
    <>
      <section className="driver-load-summary">
        <div>
          <span>Load {load.sequence}</span>
          <h2>{humanizeCommercialValue(load.status)}</h2>
        </div>
        <div className="driver-load-facts">
          <span>
            <Truck size={16} />{" "}
            {load.assets.map((asset) => asset.assetNumber).join(" + ") || "No assets"}
          </span>
          <span>
            <ShieldCheck size={16} /> {humanizeCommercialValue(load.capacityResult)}
          </span>
        </div>
      </section>

      <section aria-label="Load route" className="driver-stop-list">
        {load.items.map((item) => (
          <article key={item.id}>
            <span className="driver-stop-number">{item.loadingSequence}</span>
            <div>
              <small>Supplier</small>
              <strong>
                {item.supplierStopLabel ?? `Supplier stop ${String(item.loadingSequence)}`}
              </strong>
              <p>
                {item.materialName ?? `Material ${String(item.sequence)}`} ·{" "}
                {formatQuantity(item.plannedQuantity, item.quantityUnit)}
              </p>
            </div>
            <MapPin size={19} />
          </article>
        ))}
        {load.items.map((item) => (
          <article key={`${item.id}-placement`}>
            <span className="driver-stop-number is-placement">{item.unloadingSequence}</span>
            <div>
              <small>Placement</small>
              <strong>
                {item.placementStopLabel ?? `Placement ${String(item.unloadingSequence)}`}
              </strong>
              <p>{item.materialName ?? `Material ${String(item.sequence)}`}</p>
            </div>
            <MapPin size={19} />
          </article>
        ))}
      </section>

      {isSupplierStage(load.status) && (
        <section className="driver-work-section">
          <div className="driver-section-heading">
            <span>Supplier facts</span>
            <h2>Record the load</h2>
            <p>Use the supplier ticket values. The server recalculates authoritative totals.</p>
          </div>
          {load.items.map((item) => (
            <article className="driver-material-card" key={item.id}>
              <MaterialHeading item={item} />
              <form
                className="driver-form-grid"
                onSubmit={(event) => void onRecordSupplier(event, item.id)}
              >
                <label>
                  Purchased ({humanizeCommercialValue(item.quantityUnit)})
                  <input
                    defaultValue={item.purchasedQuantity ?? item.plannedQuantity}
                    inputMode="decimal"
                    name="purchasedQuantity"
                    pattern="^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$"
                    required
                  />
                </label>
                <label>
                  Loaded ({humanizeCommercialValue(item.quantityUnit)})
                  <input
                    defaultValue={item.loadedQuantity ?? item.plannedQuantity}
                    inputMode="decimal"
                    name="loadedQuantity"
                    pattern="^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$"
                    required
                  />
                </label>
                <label className="field-wide">
                  Unit cost from ticket (dollars)
                  <input
                    defaultValue={
                      item.actualUnitCostCents ? (item.actualUnitCostCents / 100).toFixed(2) : ""
                    }
                    inputMode="decimal"
                    name="actualUnitCost"
                    placeholder="32.00"
                    required
                  />
                </label>
                <button className="driver-secondary-button field-wide" disabled={busy}>
                  Save supplier quantities
                </button>
              </form>
              <EvidenceUpload
                item={item}
                onAttached={onEvidenceAttached}
                purpose="supplier_ticket"
                title="Supplier ticket"
              />
              <EvidenceUpload
                item={item}
                onAttached={onEvidenceAttached}
                purpose="supplier_receipt"
                title="Supplier receipt"
              />
            </article>
          ))}
          <form className="driver-safety-card" onSubmit={(event) => void onSafety(event, load.id)}>
            <div>
              <ShieldCheck size={22} />
              <h3>Actual-load safety</h3>
              <p>
                {latestActualValidation
                  ? humanizeCommercialValue(latestActualValidation.result)
                  : "Not evaluated"}
              </p>
            </div>
            <label className="driver-check-row">
              <input name="compatibilityConfirmed" type="checkbox" /> Materials are compatible
            </label>
            <label className="driver-check-row">
              <input name="separationConfirmed" type="checkbox" /> Separation matches the plan
            </label>
            <button className="driver-secondary-button" disabled={busy}>
              Run actual safety check
            </button>
            {latestActualValidation?.blockers.map((blocker) => (
              <p className="driver-blocker" key={blocker}>
                {blocker}
              </p>
            ))}
          </form>
        </section>
      )}

      {isDeliveryStage(load.status) && (
        <section className="driver-work-section">
          <div className="driver-section-heading">
            <span>Customer delivery</span>
            <h2>Confirm placement</h2>
            <p>Delivered and remaining quantities stay separate from purchased and loaded facts.</p>
          </div>
          {load.items.map((item) => (
            <article className="driver-material-card" key={item.id}>
              <MaterialHeading item={item} />
              <form
                className="driver-form-grid"
                onSubmit={(event) => void onRecordDelivery(event, item.id)}
              >
                <label>
                  Delivered ({humanizeCommercialValue(item.quantityUnit)})
                  <input
                    defaultValue={
                      item.deliveredQuantity ?? item.loadedQuantity ?? item.plannedQuantity
                    }
                    inputMode="decimal"
                    name="deliveredQuantity"
                    required
                  />
                </label>
                <label>
                  Remaining
                  <input
                    defaultValue={item.remainingQuantity ?? "0"}
                    inputMode="decimal"
                    name="remainingQuantity"
                    required
                  />
                </label>
                <label>
                  Delivery result
                  <select
                    defaultValue={
                      item.deliveryResult === "pending" ? "delivered" : item.deliveryResult
                    }
                    name="deliveryResult"
                  >
                    <option value="delivered">Delivered</option>
                    <option value="partially_delivered">Partially delivered</option>
                    <option value="not_delivered">Not delivered</option>
                    <option value="returned">Returned</option>
                  </select>
                </label>
                <label>
                  Remaining disposition
                  <select
                    defaultValue={item.remainingDisposition ?? "returned_to_supplier"}
                    name="remainingDisposition"
                  >
                    <option value="returned_to_supplier">Returned to supplier</option>
                    <option value="retained_by_business">Retained by business</option>
                    <option value="left_with_customer">Left with customer</option>
                    <option value="disposed">Disposed</option>
                    <option value="follow_up_job">Follow-up Job</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <button className="driver-secondary-button field-wide" disabled={busy}>
                  Save delivery result
                </button>
              </form>
              <EvidenceUpload
                item={item}
                onAttached={onEvidenceAttached}
                purpose="placement_evidence"
                title="Placement evidence"
              />
              <EvidenceUpload
                item={item}
                onAttached={onEvidenceAttached}
                purpose="delivery_photo"
                title="Delivery photo"
              />
            </article>
          ))}
        </section>
      )}

      {load.status === "planned" && (
        <div className="driver-alert">
          <AlertTriangle size={18} /> Dispatch must release this Load for loading.
        </div>
      )}
      {load.status === "reconciling" && (
        <div className="driver-alert is-success">
          <CheckCircle2 size={18} /> Driver work is complete. Operations owns final reconciliation.
        </div>
      )}
      {load.status === "reconciled" && (
        <div className="driver-alert is-success">
          <CheckCircle2 size={18} /> This Load is reconciled and complete.
        </div>
      )}
      {driverAction && (
        <section className="driver-next-action">
          {actionReadinessMessage(driverAction) && <p>{actionReadinessMessage(driverAction)}</p>}
          <button
            className="driver-primary-button"
            disabled={busy}
            onClick={() => void execute(load.id, driverAction)}
            type="button"
          >
            {busy ? "Saving…" : loadActionLabel(driverAction)}
          </button>
        </section>
      )}
    </>
  );
}

function MaterialHeading({ item }: { item: Item }) {
  return (
    <div className="driver-material-heading">
      <div>
        <span>Item {item.sequence}</span>
        <h3>{item.materialName ?? `Material ${String(item.sequence)}`}</h3>
      </div>
      <span>{formatQuantity(item.plannedQuantity, item.quantityUnit)} planned</span>
    </div>
  );
}

function EvidenceUpload({
  item,
  onAttached,
  purpose,
  title,
}: {
  item: Item;
  onAttached: () => Promise<void>;
  purpose: EvidencePurpose;
  title: string;
}) {
  const existing = item.evidence.filter((evidence) => evidence.purpose === purpose);
  return (
    <div className="driver-evidence-block">
      {existing.length > 0 && (
        <div className="driver-evidence-list">
          {existing.map((evidence) => (
            <span key={evidence.documentId}>
              <FileCheck2 size={15} /> {evidence.originalFilename}
            </span>
          ))}
        </div>
      )}
      <DocumentUploadCard
        allowCustomerLink={false}
        kicker="Delivery evidence"
        onAvailable={async (document) => {
          const response = await getApiClient().POST("/api/v1/material-load-items/{id}/documents", {
            body: { documentId: document.id, purpose },
            params: {
              header: { "Idempotency-Key": crypto.randomUUID() },
              path: { id: item.id },
            },
          });
          if (!response.data) throw new Error(apiErrorMessage(response.error));
          await onAttached();
        }}
        title={`Upload ${title.toLowerCase()}`}
      />
    </div>
  );
}

function textValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
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
