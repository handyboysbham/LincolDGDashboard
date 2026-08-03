"use client";

import type { components } from "@ldg/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  MapPin,
  PackageOpen,
  Phone,
  Truck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type SyntheticEvent, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";

type CreateLead = components["schemas"]["CreateIntakeLeadDto"];
type DuplicateWarning = components["schemas"]["DuplicateWarningDto"];
type ServiceType = CreateLead["serviceType"];

type SubmissionState =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "submitting" }
  | { leadId: string; leadNumber: string; name: "success" }
  | { message: string; name: "error" };

export function NewLeadForm() {
  const [serviceType, setServiceType] = useState<ServiceType>("material_delivery");
  const [state, setState] = useState<SubmissionState>({ name: "idle" });
  const [warnings, setWarnings] = useState<DuplicateWarning[]>([]);
  const [pendingLead, setPendingLead] = useState<CreateLead>();

  const create = async (body: CreateLead) => {
    setState({ name: "submitting" });
    try {
      const response = await getApiClient().POST("/api/v1/intake/leads", {
        body,
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
      });
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setWarnings([]);
      setPendingLead(undefined);
      setState({
        leadId: response.data.lead.id,
        leadNumber: response.data.lead.leadNumber,
        name: "success",
      });
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = buildLead(new FormData(event.currentTarget), serviceType);
    setPendingLead(body);
    setWarnings([]);
    setState({ name: "checking" });
    try {
      const duplicates = await getApiClient().POST("/api/v1/intake/actions/check-duplicates", {
        body: {
          ...(body.customer?.displayName ? { customerName: body.customer.displayName } : {}),
          ...(body.primaryContact?.email ? { email: body.primaryContact.email } : {}),
          ...(body.primaryContact?.phone ? { phone: body.primaryContact.phone } : {}),
          ...(body.serviceLocation ? { serviceLocation: body.serviceLocation } : {}),
        },
      });
      if (!duplicates.data) throw new Error(apiErrorMessage(duplicates.error));
      if (duplicates.data.warnings.length > 0) {
        setWarnings(duplicates.data.warnings);
        setState({ name: "idle" });
        return;
      }
      await create(body);
    } catch (error) {
      setState({ message: apiErrorMessage(error), name: "error" });
    }
  };

  if (state.name === "success") {
    return (
      <div className="intake-page new-lead-page">
        <section className="lead-created-card" aria-live="polite">
          <span className="lead-created-icon">
            <Check aria-hidden="true" size={28} />
          </span>
          <span className="page-eyebrow">Intake complete</span>
          <h1>{state.leadNumber} is ready.</h1>
          <p>The customer, contact, location, and Lead were saved together.</p>
          <div>
            <Link className="button button-primary" href={`/leads/${state.leadId}`}>
              Open Lead <ArrowRight size={16} />
            </Link>
            <Link className="button button-secondary" href="/leads">
              Back to pipeline
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="intake-page new-lead-page">
      <section className="intake-page-heading intake-page-heading-form">
        <div>
          <Link className="back-link" href="/leads">
            <ArrowLeft size={15} /> Leads
          </Link>
          <span className="page-eyebrow">New opportunity</span>
          <h1>Capture a complete Lead</h1>
          <p>Customer, service location, and request details save in one transaction.</p>
        </div>
        <span className="form-security-note">
          <ClipboardCheck aria-hidden="true" size={18} /> Draft values are not saved until creation
        </span>
      </section>

      <form
        className="lead-intake-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <section className="panel intake-form-section service-choice-section">
          <div className="form-section-heading">
            <span>01</span>
            <div>
              <h2>What does the customer need?</h2>
              <p>Each Lead can contain one service type.</p>
            </div>
          </div>
          <div className="service-choice-grid" role="radiogroup" aria-label="Service type">
            <button
              aria-checked={serviceType === "material_delivery"}
              className={
                serviceType === "material_delivery"
                  ? "service-choice is-selected"
                  : "service-choice"
              }
              onClick={() => {
                setServiceType("material_delivery");
              }}
              role="radio"
              type="button"
            >
              <span>
                <Truck aria-hidden="true" size={24} />
              </span>
              <strong>Material delivery</strong>
              <small>Rock, gravel, dirt, sand, or other bulk material</small>
              <i>
                <Check size={14} />
              </i>
            </button>
            <button
              aria-checked={serviceType === "dump_trailer_rental"}
              className={
                serviceType === "dump_trailer_rental"
                  ? "service-choice is-selected"
                  : "service-choice"
              }
              onClick={() => {
                setServiceType("dump_trailer_rental");
              }}
              role="radio"
              type="button"
            >
              <span>
                <PackageOpen aria-hidden="true" size={24} />
              </span>
              <strong>Dump trailer rental</strong>
              <small>Delivery, rental window, pickup, and disposal</small>
              <i>
                <Check size={14} />
              </i>
            </button>
          </div>
        </section>

        <section className="panel intake-form-section">
          <div className="form-section-heading">
            <span>02</span>
            <div>
              <h2>Customer and primary contact</h2>
              <p>Create the continuing account and the person to contact.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field field-wide">
              <span>
                <Building2 size={14} /> Customer or business name
              </span>
              <input maxLength={200} name="customerName" placeholder="Santos Residence" required />
            </label>
            <label className="field">
              <span>Customer type</span>
              <select defaultValue="individual" name="customerType">
                <option value="individual">Residential</option>
                <option value="business">Business</option>
              </select>
            </label>
            <label className="field">
              <span>Lead source</span>
              <select defaultValue="phone" name="source">
                <option value="phone">Phone call</option>
                <option value="website">Website</option>
                <option value="email">Email</option>
                <option value="referral">Referral</option>
                <option value="repeat">Repeat customer</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="field">
              <span>
                <UserRound size={14} /> First name
              </span>
              <input maxLength={100} name="firstName" placeholder="Maya" required />
            </label>
            <label className="field">
              <span>Last name</span>
              <input maxLength={100} name="lastName" placeholder="Santos" required />
            </label>
            <label className="field">
              <span>
                <Phone size={14} /> Phone
              </span>
              <input
                autoComplete="tel"
                maxLength={40}
                name="phone"
                placeholder="402-555-0177"
                required
                type="tel"
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                autoComplete="email"
                maxLength={320}
                name="email"
                placeholder="maya@example.com"
                type="email"
              />
            </label>
            <label className="field">
              <span>Preferred contact</span>
              <select defaultValue="text" name="preferredContactMethod">
                <option value="text">Text</option>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
              </select>
            </label>
          </div>
        </section>

        <section className="panel intake-form-section">
          <div className="form-section-heading">
            <span>03</span>
            <div>
              <h2>Service location</h2>
              <p>Capture reusable address and access facts for operations.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Location label</span>
              <input defaultValue="Job site" maxLength={120} name="locationLabel" required />
            </label>
            <label className="field field-wide">
              <span>
                <MapPin size={14} /> Street address
              </span>
              <input
                autoComplete="street-address"
                maxLength={200}
                name="addressLine1"
                placeholder="1840 West Denton Road"
                required
              />
            </label>
            <label className="field field-wide">
              <span>
                Address line 2 <small>Optional</small>
              </span>
              <input maxLength={200} name="addressLine2" placeholder="Building, unit, or lot" />
            </label>
            <label className="field">
              <span>City</span>
              <input
                autoComplete="address-level2"
                defaultValue="Lincoln"
                maxLength={120}
                name="city"
                required
              />
            </label>
            <label className="field field-small">
              <span>State</span>
              <input
                autoComplete="address-level1"
                defaultValue="NE"
                maxLength={80}
                name="region"
                required
              />
            </label>
            <label className="field field-small">
              <span>ZIP</span>
              <input
                autoComplete="postal-code"
                maxLength={20}
                name="postalCode"
                placeholder="68523"
                required
              />
            </label>
            <label className="field field-wide">
              <span>
                Access notes <small>Optional</small>
              </span>
              <textarea
                maxLength={2000}
                name="accessNotes"
                placeholder="Gate, grade, overhead clearance, call-ahead, or placement access"
                rows={3}
              />
            </label>
          </div>
        </section>

        <section className="panel intake-form-section">
          <div className="form-section-heading">
            <span>04</span>
            <div>
              <h2>Service request</h2>
              <p>Only fields for the selected service are collected.</p>
            </div>
          </div>
          <div className="form-grid">
            {serviceType === "material_delivery" ? (
              <>
                <label className="field field-wide">
                  <span>Material requested</span>
                  <input
                    maxLength={240}
                    name="materialDescription"
                    placeholder="#57 gravel, limestone, fill dirt…"
                    required
                  />
                </label>
                <label className="field">
                  <span>Estimated quantity</span>
                  <input
                    inputMode="decimal"
                    name="estimatedQuantity"
                    pattern="\d{1,9}(\.\d{1,3})?"
                    placeholder="4.5"
                    required
                  />
                </label>
                <label className="field">
                  <span>Unit</span>
                  <select defaultValue="tons" name="quantityUnit">
                    <option value="tons">Tons</option>
                    <option value="cubic_yards">Cubic yards</option>
                    <option value="loads">Loads</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Rental start</span>
                  <input name="rentalStartDate" required type="date" />
                </label>
                <label className="field">
                  <span>Rental end</span>
                  <input name="rentalEndDate" required type="date" />
                </label>
                <label className="field field-wide">
                  <span>Debris or material type</span>
                  <input
                    maxLength={160}
                    name="debrisType"
                    placeholder="Construction debris, brush, clean concrete…"
                    required
                  />
                </label>
              </>
            )}
            <label className="field field-wide">
              <span>Request summary</span>
              <input
                maxLength={300}
                name="summary"
                placeholder="Short description for the pipeline"
                required
              />
            </label>
            <label className="field field-wide">
              <span>
                Service instructions <small>Optional</small>
              </span>
              <textarea
                maxLength={2000}
                name="serviceInstructions"
                placeholder="Placement, delivery, pickup, or site-specific instructions"
                rows={4}
              />
            </label>
          </div>
        </section>

        {warnings.length > 0 && (
          <section className="duplicate-warning-panel" role="alert">
            <AlertTriangle aria-hidden="true" size={22} />
            <div>
              <h2>Review possible duplicates</h2>
              <p>Nothing was merged. Confirm these records before creating a separate customer.</p>
              <ul>
                {warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.entityId}`}>
                    <strong>{duplicateLabel(warning.code)}</strong> {warning.display}
                  </li>
                ))}
              </ul>
            </div>
            <button
              className="button button-secondary"
              disabled={!pendingLead}
              onClick={() => {
                if (pendingLead) void create(pendingLead);
              }}
              type="button"
            >
              Create separate Lead
            </button>
          </section>
        )}

        {state.name === "error" && (
          <div className="inline-form-error" role="alert">
            <AlertTriangle aria-hidden="true" size={18} />
            <span>{state.message}</span>
          </div>
        )}

        <div className="lead-form-actions">
          <Link className="button button-secondary" href="/leads">
            Cancel
          </Link>
          <button
            className="button button-primary"
            disabled={state.name === "checking" || state.name === "submitting"}
            type="submit"
          >
            {state.name === "checking"
              ? "Checking for duplicates…"
              : state.name === "submitting"
                ? "Creating Lead…"
                : "Review and create"}
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}

function buildLead(form: FormData, serviceType: ServiceType): CreateLead {
  const optional = (name: string) => {
    const value = requiredString(form, name, false);
    return value || undefined;
  };
  const preferredContactMethod = requiredString(form, "preferredContactMethod") as
    "email" | "phone" | "text";
  const serviceInstructions = optional("serviceInstructions");
  const email = optional("email");
  const accessNotes = optional("accessNotes");
  const addressLine2 = optional("addressLine2");
  return {
    customer: {
      customerType: requiredString(form, "customerType") as "business" | "individual",
      displayName: requiredString(form, "customerName"),
      preferredContactMethod,
    },
    ...(serviceType === "material_delivery"
      ? {
          materialDelivery: {
            ...(serviceInstructions ? { deliveryInstructions: serviceInstructions } : {}),
            estimatedQuantity: requiredString(form, "estimatedQuantity"),
            materialDescription: requiredString(form, "materialDescription"),
            quantityUnit: requiredString(form, "quantityUnit") as "cubic_yards" | "loads" | "tons",
          },
        }
      : {
          dumpTrailerRental: {
            debrisType: requiredString(form, "debrisType"),
            ...(serviceInstructions ? { deliveryInstructions: serviceInstructions } : {}),
            rentalEndDate: requiredString(form, "rentalEndDate"),
            rentalStartDate: requiredString(form, "rentalStartDate"),
          },
        }),
    primaryContact: {
      ...(email ? { email } : {}),
      firstName: requiredString(form, "firstName"),
      lastName: requiredString(form, "lastName"),
      phone: requiredString(form, "phone"),
      preferredContactMethod,
    },
    serviceLocation: {
      ...(accessNotes ? { accessNotes } : {}),
      addressLine1: requiredString(form, "addressLine1"),
      ...(addressLine2 ? { addressLine2 } : {}),
      city: requiredString(form, "city"),
      label: requiredString(form, "locationLabel"),
      postalCode: requiredString(form, "postalCode"),
      region: requiredString(form, "region"),
    },
    serviceType,
    source: requiredString(form, "source") as CreateLead["source"],
    summary: requiredString(form, "summary"),
  };
}

function requiredString(form: FormData, name: string, required = true): string {
  const value = form.get(name);
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new Error(`${name} is required`);
  return text;
}

function duplicateLabel(code: string): string {
  const labels: Record<string, string> = {
    contact_email: "Same email:",
    contact_phone: "Same phone:",
    customer_name: "Same name:",
    service_address: "Same address:",
  };
  return labels[code] ?? "Possible match:";
}
