"use client";

import type { components } from "@ldg/api-client";
import {
  Activity,
  BadgeDollarSign,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Factory,
  History,
  LoaderCircle,
  Search,
  ShieldCheck,
  Truck,
  UserCog,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";

import { apiErrorMessage, getApiClient } from "../lib/api-client";

type Workspace = components["schemas"]["AdministrationWorkspaceDto"];
type SearchResult = components["schemas"]["AdministrationSearchResultDto"];
type Section = "overview" | "people" | "reference" | "payments" | "checklists" | "audit";

const sections: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People & roles" },
  { id: "reference", label: "Reference data" },
  { id: "payments", label: "Payment accounts" },
  { id: "checklists", label: "Checklists" },
  { id: "audit", label: "Audit events" },
];

export function AdministrationWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const response = await getApiClient().GET("/api/v1/administration");
    if (!response.data) setError(apiErrorMessage(response.error));
    else setWorkspace(response.data);
    setLoading(false);
  }, []);

  useEffect(() => void load(), [load]);

  const runCommand = async (operation: () => Promise<{ error?: unknown }>, success: string) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const response = await operation();
    if (response.error) setError(apiErrorMessage(response.error));
    else {
      setNotice(success);
      await load();
    }
    setBusy(false);
  };

  const search = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setError("Enter at least two characters to search.");
      return;
    }
    setSearching(true);
    setError(undefined);
    const response = await getApiClient().GET("/api/v1/administration/search", {
      params: { query: { q: query } },
    });
    if (!response.data) setError(apiErrorMessage(response.error));
    else setSearchResults(response.data.items);
    setSearching(false);
  };

  if (loading && !workspace) {
    return (
      <div aria-live="polite" className="administration-state">
        <LoaderCircle aria-hidden="true" className="spin" />
        <h1>Loading administration</h1>
        <p>Gathering configuration, operating signals, and audit history.</p>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="administration-state">
        <ShieldCheck aria-hidden="true" />
        <h1>Administration is unavailable</h1>
        <p>{error ?? "The workspace could not be loaded."}</p>
        <button className="button button-primary" onClick={() => void load()} type="button">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="administration-workspace">
      <header className="administration-heading">
        <div>
          <span className="page-eyebrow">Sprint 1.10 · Administration</span>
          <h1>Settings and operations control</h1>
          <p>Manage controlled business configuration and see what needs operational attention.</p>
        </div>
        <div className="administration-links">
          <Link className="button button-secondary" href="/pricing">
            Pricing versions <ExternalLink aria-hidden="true" size={15} />
          </Link>
          <Link className="button button-secondary" href="/communications">
            Notifications <ExternalLink aria-hidden="true" size={15} />
          </Link>
        </div>
      </header>

      <form
        className="administration-search"
        id="administration-search"
        onSubmit={(event) => {
          void search(event);
        }}
      >
        <Search aria-hidden="true" size={19} />
        <label className="sr-only" htmlFor="administration-query">
          Search customers, Projects, Jobs, Invoices, and Payments
        </label>
        <input
          id="administration-query"
          onChange={(event) => {
            setSearchQuery(event.target.value);
          }}
          placeholder="Search customers, Projects, Jobs, Invoices, or Payments"
          value={searchQuery}
        />
        <button className="button button-primary" disabled={searching} type="submit">
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {searchResults.length > 0 && (
        <div aria-label="Search results" className="administration-search-results">
          {searchResults.map((result) => (
            <Link href={result.path} key={`${result.type}-${result.id}`}>
              <span className="status-pill">{titleCase(result.type)}</span>
              <strong>{result.primaryLabel}</strong>
              <small>{result.secondaryLabel}</small>
              <span>{titleCase(result.status)}</span>
            </Link>
          ))}
        </div>
      )}

      {error && (
        <div aria-live="assertive" className="inline-alert inline-alert-error">
          {error}
        </div>
      )}
      {notice && (
        <div aria-live="polite" className="inline-alert inline-alert-success">
          {notice}
        </div>
      )}

      <nav aria-label="Administration sections" className="administration-tabs">
        {sections.map((item) => (
          <button
            aria-current={section === item.id ? "page" : undefined}
            className={section === item.id ? "is-active" : undefined}
            key={item.id}
            onClick={() => {
              setSection(item.id);
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {section === "overview" && <Overview workspace={workspace} />}
      {section === "people" && (
        <People
          busy={busy}
          onCommand={runCommand}
          roles={workspace.roles}
          users={workspace.users}
        />
      )}
      {section === "reference" && (
        <ReferenceData
          assets={workspace.assets}
          busy={busy}
          onCommand={runCommand}
          suppliers={workspace.suppliers}
        />
      )}
      {section === "payments" && (
        <PaymentAccounts accounts={workspace.paymentAccounts} busy={busy} onCommand={runCommand} />
      )}
      {section === "checklists" && (
        <ChecklistTemplates
          busy={busy}
          onCommand={runCommand}
          templates={workspace.checklistTemplates}
        />
      )}
      {section === "audit" && <AuditEvents events={workspace.recentAuditEvents} />}
    </div>
  );
}

function Overview({ workspace }: Readonly<{ workspace: Workspace }>) {
  const metrics = [
    { icon: UserCog, label: "Users", metric: workspace.overview.users },
    { icon: Truck, label: "Assets", metric: workspace.overview.assets },
    { icon: Factory, label: "Suppliers", metric: workspace.overview.suppliers },
    {
      icon: BadgeDollarSign,
      label: "Payment accounts",
      metric: workspace.overview.paymentAccounts,
    },
    {
      icon: ClipboardCheck,
      label: "Checklist versions",
      metric: workspace.overview.checklistTemplates,
    },
  ];
  return (
    <div className="administration-section">
      <div className="administration-metrics">
        {metrics.map(({ icon: Icon, label, metric }) => (
          <article key={label}>
            <Icon aria-hidden="true" size={20} />
            <span>{label}</span>
            <strong>{metric.total}</strong>
            <small>
              {metric.attention
                ? `${String(metric.attention)} need attention`
                : "No attention needed"}
            </small>
          </article>
        ))}
      </div>
      <div className="administration-callouts">
        <article>
          <Activity aria-hidden="true" />
          <div>
            <span>Open Jobs</span>
            <strong>{workspace.overview.openJobs}</strong>
            <p>Jobs that are neither closed nor cancelled.</p>
          </div>
        </article>
        <article>
          <BadgeDollarSign aria-hidden="true" />
          <div>
            <span>Past-due Invoices</span>
            <strong>{workspace.overview.pastDueInvoices}</strong>
            <p>Posted obligations requiring financial follow-up.</p>
          </div>
        </article>
      </div>
      <AuditEvents events={workspace.recentAuditEvents.slice(0, 8)} compact />
    </div>
  );
}

function People({
  busy,
  onCommand,
  roles,
  users,
}: Readonly<{
  busy: boolean;
  onCommand: CommandRunner;
  roles: Workspace["roles"];
  users: Workspace["users"];
}>) {
  const assignRole = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = text(form, "userId");
    const roleId = text(form, "roleId");
    const action = text(form, "action") as "assign" | "revoke";
    void onCommand(
      async () =>
        getApiClient().POST("/api/v1/administration/users/{id}/roles/actions/{action}", {
          body: { roleId },
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { action, id: userId },
          },
        }),
      `Role ${action === "assign" ? "assigned" : "revoked"}.`,
    );
  };
  return (
    <div className="administration-section administration-split">
      <section className="panel administration-panel">
        <div className="administration-panel-heading">
          <div>
            <span className="page-eyebrow">Tenant access</span>
            <h2>Users and assigned roles</h2>
          </div>
        </div>
        <div className="administration-list">
          {users.map((user) => (
            <article key={user.id}>
              <div>
                <strong>{user.displayName}</strong>
                <small>{user.email}</small>
              </div>
              <div className="administration-badges">
                {user.roles.map((role) => (
                  <span className="status-pill" key={role.id}>
                    {role.name}
                  </span>
                ))}
                {user.roles.length === 0 && <span className="muted">No role</span>}
              </div>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() =>
                  void onCommand(
                    async () =>
                      getApiClient().POST("/api/v1/administration/users/{id}/actions/{action}", {
                        params: {
                          header: { "Idempotency-Key": crypto.randomUUID() },
                          path: {
                            action: user.status === "active" ? "deactivate" : "activate",
                            id: user.id,
                          },
                        },
                      }),
                    `User ${user.status === "active" ? "deactivated" : "activated"}.`,
                  )
                }
                type="button"
              >
                {user.status === "active" ? "Deactivate" : "Activate"}
              </button>
            </article>
          ))}
        </div>
      </section>
      <aside className="panel administration-panel">
        <h2>Change a role assignment</h2>
        <form className="compact-form" onSubmit={assignRole}>
          <label>
            User
            <select name="userId" required>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Active role
            <select name="roleId" required>
              {roles
                .filter((role) => role.status === "active")
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Action
            <select name="action">
              <option value="assign">Assign</option>
              <option value="revoke">Revoke</option>
            </select>
          </label>
          <button className="button button-primary" disabled={busy}>
            Apply role change
          </button>
        </form>
        <p className="administration-note">
          Role permissions are controlled server-side. Owner access cannot be inferred from the UI.
        </p>
      </aside>
    </div>
  );
}

function ReferenceData({
  assets,
  busy,
  onCommand,
  suppliers,
}: Readonly<{
  assets: Workspace["assets"];
  busy: boolean;
  onCommand: CommandRunner;
  suppliers: Workspace["suppliers"];
}>) {
  const createAsset = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onCommand(
      async () =>
        getApiClient().POST("/api/v1/assets", {
          body: {
            assetNumber: text(form, "assetNumber"),
            assetType: text(form, "assetType") as "equipment" | "trailer" | "truck",
            name: text(form, "assetName"),
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        }),
      "Asset created.",
    );
  };
  const createSupplier = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = text(new FormData(event.currentTarget), "name");
    void onCommand(
      async () =>
        getApiClient().POST("/api/v1/administration/suppliers", {
          body: { name },
          params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        }),
      "Supplier created.",
    );
  };
  const createFacility = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const supplierId = text(form, "supplierId");
    const addressSummary = text(form, "addressSummary");
    void onCommand(
      async () =>
        getApiClient().POST("/api/v1/administration/suppliers/{id}/facilities", {
          body: {
            ...(addressSummary ? { addressSummary } : {}),
            label: text(form, "label"),
          },
          params: {
            header: { "Idempotency-Key": crypto.randomUUID() },
            path: { id: supplierId },
          },
        }),
      "Supplier facility created.",
    );
  };
  return (
    <div className="administration-section administration-split">
      <section className="panel administration-panel">
        <h2>Assets</h2>
        <form className="compact-form administration-reference-form" onSubmit={createAsset}>
          <label>
            Asset number
            <input name="assetNumber" required />
          </label>
          <label>
            Name
            <input name="assetName" required />
          </label>
          <label>
            Type
            <select name="assetType">
              <option value="truck">Truck</option>
              <option value="trailer">Trailer</option>
              <option value="equipment">Equipment</option>
            </select>
          </label>
          <button className="button button-primary" disabled={busy}>
            Add asset
          </button>
        </form>
        {assets.length === 0 ? (
          <EmptyState label="No assets configured" />
        ) : (
          <div className="administration-list compact">
            {assets.map((asset) => (
              <article key={asset.id}>
                <Truck aria-hidden="true" size={18} />
                <div>
                  <strong>
                    {asset.assetNumber} · {asset.name}
                  </strong>
                  <small>{titleCase(asset.assetType)}</small>
                </div>
                <span className="status-pill">{titleCase(asset.status)}</span>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel administration-panel">
        <h2>Suppliers and facilities</h2>
        <form className="compact-form administration-inline-form" onSubmit={createSupplier}>
          <label>
            Supplier name
            <input name="name" required />
          </label>
          <button className="button button-primary" disabled={busy}>
            Add supplier
          </button>
        </form>
        {suppliers.length > 0 && (
          <form className="compact-form administration-reference-form" onSubmit={createFacility}>
            <label>
              Supplier
              <select name="supplierId">
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Facility label
              <input name="label" required />
            </label>
            <label>
              Address summary
              <input name="addressSummary" />
            </label>
            <button className="button button-secondary" disabled={busy}>
              Add facility
            </button>
          </form>
        )}
        {suppliers.length === 0 ? (
          <EmptyState label="No suppliers configured" />
        ) : (
          <div className="administration-list compact">
            {suppliers.map((supplier) => (
              <article className="administration-supplier" key={supplier.id}>
                <Factory aria-hidden="true" size={18} />
                <div>
                  <strong>{supplier.name}</strong>
                  <small>
                    {supplier.facilities.length
                      ? supplier.facilities.map((facility) => facility.label).join(" · ")
                      : "No facilities"}
                  </small>
                </div>
                <span className="status-pill">{titleCase(supplier.status)}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PaymentAccounts({
  accounts,
  busy,
  onCommand,
}: Readonly<{
  accounts: Workspace["paymentAccounts"];
  busy: boolean;
  onCommand: CommandRunner;
}>) {
  const create = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onCommand(
      async () =>
        getApiClient().POST("/api/v1/administration/payment-accounts", {
          body: {
            accountReference: text(form, "accountReference"),
            code: text(form, "code"),
            isDefault: form.get("isDefault") === "on",
            name: text(form, "name"),
            paymentMethod: text(form, "paymentMethod") as
              | "bank_transfer"
              | "card"
              | "cash"
              | "cash_app"
              | "check"
              | "paypal"
              | "venmo"
              | "zelle",
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        }),
      "Company payment account created.",
    );
  };
  return (
    <div className="administration-section administration-split">
      <section className="panel administration-panel">
        <h2>Company-controlled receiving accounts</h2>
        <p className="administration-note">
          Store only a safe staff-facing reference. Never enter a password, token, raw card number,
          or an employee personal account.
        </p>
        {accounts.length === 0 ? (
          <EmptyState label="No company payment accounts configured" />
        ) : (
          <div className="administration-list">
            {accounts.map((account) => (
              <article key={account.id}>
                <BadgeDollarSign aria-hidden="true" size={18} />
                <div>
                  <strong>{account.name}</strong>
                  <small>
                    {titleCase(account.paymentMethod)} · {account.accountReference}
                  </small>
                </div>
                <div className="administration-badges">
                  {account.isDefault && <span className="status-pill">Default</span>}
                  <span>{titleCase(account.status)}</span>
                </div>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void onCommand(
                      async () =>
                        getApiClient().POST(
                          "/api/v1/administration/payment-accounts/{id}/actions/{action}",
                          {
                            params: {
                              header: { "Idempotency-Key": crypto.randomUUID() },
                              path: {
                                action: account.status === "active" ? "deactivate" : "activate",
                                id: account.id,
                              },
                            },
                          },
                        ),
                      `Payment account ${account.status === "active" ? "deactivated" : "activated"}.`,
                    )
                  }
                  type="button"
                >
                  {account.status === "active" ? "Deactivate" : "Activate"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
      <aside className="panel administration-panel">
        <h2>Add receiving account</h2>
        <form className="compact-form" onSubmit={create}>
          <label>
            Code
            <input name="code" pattern="[a-z][a-z0-9-]{2,79}" required />
          </label>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Method
            <select name="paymentMethod">
              <option value="zelle">Zelle</option>
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="venmo">Venmo</option>
              <option value="cash_app">Cash App</option>
              <option value="paypal">PayPal</option>
            </select>
          </label>
          <label>
            Safe account reference
            <input name="accountReference" required />
          </label>
          <label className="checkbox-row">
            <input name="isDefault" type="checkbox" /> Default for this method
          </label>
          <button className="button button-primary" disabled={busy}>
            Add account
          </button>
        </form>
      </aside>
    </div>
  );
}

function ChecklistTemplates({
  busy,
  onCommand,
  templates,
}: Readonly<{
  busy: boolean;
  onCommand: CommandRunner;
  templates: Workspace["checklistTemplates"];
}>) {
  const create = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = text(form, "items")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    void onCommand(
      async () =>
        getApiClient().POST("/api/v1/administration/checklist-templates", {
          body: {
            items: lines.map((label, index) => ({
              label,
              requiresEvidence: false,
              responseType: "confirmation" as const,
              sequence: index + 1,
            })),
            name: text(form, "name"),
            required: true,
            serviceType: text(form, "serviceType") as "dump_trailer_rental" | "material_delivery",
            templateCode: text(form, "templateCode"),
          },
          params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        }),
      "Checklist draft created.",
    );
  };
  return (
    <div className="administration-section administration-split">
      <section className="panel administration-panel">
        <h2>Versioned checklist templates</h2>
        {templates.length === 0 ? (
          <EmptyState label="No checklist templates configured" />
        ) : (
          <div className="administration-list checklist-list">
            {templates.map((template) => (
              <article key={template.id}>
                <ClipboardCheck aria-hidden="true" size={18} />
                <div>
                  <strong>
                    {template.name} · v{template.version}
                  </strong>
                  <small>
                    {template.items.length} items ·{" "}
                    {titleCase(template.serviceType ?? "all services")}
                  </small>
                </div>
                <span className="status-pill">{titleCase(template.status)}</span>
                {template.status === "draft" && (
                  <button
                    className="button button-primary"
                    disabled={busy || template.items.length === 0}
                    onClick={() =>
                      void onCommand(
                        async () =>
                          getApiClient().POST(
                            "/api/v1/administration/checklist-templates/{id}/actions/publish",
                            {
                              params: {
                                header: { "Idempotency-Key": crypto.randomUUID() },
                                path: { id: template.id },
                              },
                            },
                          ),
                        "Checklist version published.",
                      )
                    }
                    type="button"
                  >
                    Publish
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <aside className="panel administration-panel">
        <h2>Create checklist draft</h2>
        <form className="compact-form" onSubmit={create}>
          <label>
            Template code
            <input name="templateCode" pattern="[a-z][a-z0-9-]{2,99}" required />
          </label>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Service
            <select name="serviceType">
              <option value="material_delivery">Material delivery</option>
              <option value="dump_trailer_rental">Dump trailer rental</option>
            </select>
          </label>
          <label>
            Items, one per line
            <textarea name="items" required rows={6} />
          </label>
          <button className="button button-primary" disabled={busy}>
            Create draft
          </button>
        </form>
      </aside>
    </div>
  );
}

function AuditEvents({
  compact = false,
  events,
}: Readonly<{ compact?: boolean; events: Workspace["recentAuditEvents"] }>) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    if (!filter.trim()) return events;
    const query = filter.trim().toLowerCase();
    return events.filter((event) =>
      `${event.eventType} ${event.entityType} ${event.commandName} ${event.actorDisplayName ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [events, filter]);
  return (
    <section className="panel administration-panel administration-audit">
      <div className="administration-panel-heading">
        <div>
          <span className="page-eyebrow">Append-only evidence</span>
          <h2>{compact ? "Recent changes" : "Audit Event viewer"}</h2>
        </div>
        {!compact && (
          <label>
            <span className="sr-only">Filter Audit Events</span>
            <input
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              placeholder="Filter events"
              value={filter}
            />
          </label>
        )}
      </div>
      {visible.length === 0 ? (
        <EmptyState label="No Audit Events match" />
      ) : (
        <div className="administration-timeline">
          {visible.map((event) => (
            <article key={event.id}>
              <History aria-hidden="true" size={17} />
              <div>
                <strong>{titleCase(event.eventType.replaceAll(".", " "))}</strong>
                <small>
                  {event.entityType} · {event.actorDisplayName ?? "System"}
                </small>
              </div>
              <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState({ label }: Readonly<{ label: string }>) {
  return (
    <div className="administration-empty">
      <CheckCircle2 aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

type CommandRunner = (
  operation: () => Promise<{ error?: unknown }>,
  success: string,
) => Promise<void>;

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
