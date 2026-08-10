"use client";

import type { components } from "@ldg/api-client";
import { AlertTriangle, BellRing, Check, Mail, MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";

type Contact = components["schemas"]["ContactDto"];
type Preference = components["schemas"]["NotificationPreferenceDto"];

const notificationTypes = [
  ["quote", "Quotes"],
  ["contract", "Contracts"],
  ["schedule", "Schedule confirmations"],
  ["reminder", "Service reminders"],
  ["on_the_way", "On-the-way updates"],
  ["completion", "Completion updates"],
  ["invoice", "Invoices"],
  ["receipt", "Payment receipts"],
  ["refund", "Refund updates"],
] as const;

export function CustomerNotificationPreferences({
  contacts,
  customerId,
}: {
  contacts: Contact[];
  customerId: string;
}) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [preferences, setPreferences] = useState<Preference[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const response = await getApiClient().GET(
        "/api/v1/customers/{customerId}/notification-preferences",
        { params: { path: { customerId } } },
      );
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setPreferences(response.data.items);
      setError(undefined);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="panel customer-preferences-panel">
      <div className="panel-heading compact">
        <div>
          <span className="panel-kicker">Customer choice</span>
          <h2>Notification preferences</h2>
        </div>
        <BellRing aria-hidden="true" size={19} />
      </div>
      <p className="preference-intro">
        Choose which transactional updates each Contact receives. Email defaults on; SMS stays off
        until explicitly enabled.
      </p>
      {contacts.length === 0 ? (
        <div className="preference-error" role="status">
          <AlertTriangle aria-hidden="true" size={17} /> Add a Contact before setting notification
          preferences.
        </div>
      ) : contacts.length > 1 ? (
        <label className="preference-contact-select">
          Contact
          <select
            onChange={(event) => {
              setContactId(event.target.value);
            }}
            value={contactId}
          >
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {contacts.length === 0 ? null : error ? (
        <div className="preference-error" role="alert">
          <AlertTriangle size={17} /> {error}
        </div>
      ) : preferences ? (
        <div className="preference-list">
          {notificationTypes.map(([type, label]) => {
            const preference = preferences.find(
              (candidate) =>
                candidate.contactId === contactId && candidate.notificationType === type,
            );
            return (
              <PreferenceRow
                contactId={contactId}
                customerId={customerId}
                initialEmail={preference?.emailEnabled ?? true}
                initialSms={preference?.smsEnabled ?? false}
                key={`${contactId}-${type}-${preference?.emailEnabled.toString() ?? "default"}-${preference?.smsEnabled.toString() ?? "default"}`}
                label={label}
                notificationType={type}
              />
            );
          })}
        </div>
      ) : (
        <div
          aria-label="Loading notification preferences"
          className="preference-list"
          role="status"
        >
          {[0, 1, 2].map((item) => (
            <div className="skeleton preference-row" key={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function PreferenceRow({
  contactId,
  customerId,
  initialEmail,
  initialSms,
  label,
  notificationType,
}: {
  contactId: string;
  customerId: string;
  initialEmail: boolean;
  initialSms: boolean;
  label: string;
  notificationType: string;
}) {
  const [emailEnabled, setEmailEnabled] = useState(initialEmail);
  const [smsEnabled, setSmsEnabled] = useState(initialSms);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    setStatus("saving");
    try {
      const response = await getApiClient().POST(
        "/api/v1/customers/{customerId}/notification-preferences",
        {
          body: { contactId, emailEnabled, notificationType, smsEnabled },
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { customerId },
          },
        },
      );
      if (!response.data) throw new Error(apiErrorMessage(response.error));
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <fieldset className="preference-row">
      <legend>{label}</legend>
      <label>
        <Mail aria-hidden="true" size={15} />
        <input
          checked={emailEnabled}
          onChange={(event) => {
            setEmailEnabled(event.target.checked);
            setStatus("idle");
          }}
          type="checkbox"
        />{" "}
        Email
      </label>
      <label>
        <MessageSquareText aria-hidden="true" size={15} />
        <input
          checked={smsEnabled}
          onChange={(event) => {
            setSmsEnabled(event.target.checked);
            setStatus("idle");
          }}
          type="checkbox"
        />{" "}
        SMS
      </label>
      <button
        className="button button-secondary button-small"
        disabled={status === "saving"}
        onClick={() => void save()}
        type="button"
      >
        {status === "saved" ? (
          <>
            <Check aria-hidden="true" size={14} /> Saved
          </>
        ) : status === "saving" ? (
          "Saving…"
        ) : (
          "Save"
        )}
      </button>
      {status === "error" && (
        <span className="preference-save-error" role="alert">
          Could not save
        </span>
      )}
    </fieldset>
  );
}
