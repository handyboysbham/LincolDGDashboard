import {
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Clock3,
  MapPin,
  MessageSquareText,
  Plus,
  Truck,
} from "lucide-react";

import { StaffShell } from "../components/staff-shell";
import { DocumentUploadCard } from "../components/document-upload-card";

const metrics = [
  { detail: "+2 since Friday", label: "New leads", tone: "sage", value: "6" },
  { detail: "3 in progress", label: "Jobs today", tone: "clay", value: "8" },
  { detail: "Review before noon", label: "Needs scheduling", tone: "gold", value: "3" },
  { detail: "5 open invoices", label: "Outstanding", tone: "stone", value: "$12,840" },
];

const attentionItems = [
  {
    badge: "Schedule",
    detail: "Material delivery · 4 yd limestone",
    name: "Santos residence",
    time: "Requested for Wednesday",
  },
  {
    badge: "Document",
    detail: "Rental #DTR-2026-0018",
    name: "Disposal ticket missing",
    time: "Pickup completed 46 min ago",
  },
  {
    badge: "Message",
    detail: "Quote #QTE-2026-0027",
    name: "Maya asked about driveway access",
    time: "12 minutes ago",
  },
];

export default function DashboardPage() {
  return (
    <StaffShell>
      <div className="dashboard-page">
        <section className="dashboard-heading">
          <div>
            <span className="page-eyebrow">Operations overview</span>
            <h1>Good morning, Kaleb.</h1>
            <p>Here’s what needs your attention across the yard and the road.</p>
          </div>
          <div className="heading-actions">
            <button className="button button-secondary" type="button">
              <CalendarClock aria-hidden="true" size={17} />
              View schedule
            </button>
            <button className="button button-primary" type="button">
              <Plus aria-hidden="true" size={17} />
              New lead
            </button>
          </div>
        </section>

        <section aria-label="Today at a glance" className="metric-grid">
          {metrics.map((metric) => (
            <article className={`metric-card metric-${metric.tone}`} key={metric.label}>
              <div className="metric-label">
                <span>{metric.label}</span>
                <ArrowUpRight aria-hidden="true" size={16} />
              </div>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </article>
          ))}
        </section>

        <div className="dashboard-columns">
          <div className="dashboard-primary-column">
            <section className="panel schedule-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">Monday · August 3</span>
                  <h2>Today’s route</h2>
                </div>
                <button className="text-button" type="button">
                  Full schedule <ChevronRight aria-hidden="true" size={16} />
                </button>
              </div>
              <div className="route-list">
                <article className="route-row">
                  <time>8:00</time>
                  <span className="route-line">
                    <i />
                  </span>
                  <div className="route-copy">
                    <span className="route-type">Material delivery</span>
                    <h3>6 yd #57 gravel</h3>
                    <p>
                      <MapPin aria-hidden="true" size={14} /> 1840 West Denton Road, Lincoln
                    </p>
                  </div>
                  <div className="route-assignee">
                    <span>MD</span>
                    <small>Mike</small>
                  </div>
                </article>
                <article className="route-row">
                  <time>10:30</time>
                  <span className="route-line route-line-gold">
                    <i />
                  </span>
                  <div className="route-copy">
                    <span className="route-type">Dump trailer drop-off</span>
                    <h3>14-yard trailer · #T-04</h3>
                    <p>
                      <MapPin aria-hidden="true" size={14} /> 9200 Rokeby Road, Roca
                    </p>
                  </div>
                  <div className="route-assignee">
                    <span>AJ</span>
                    <small>Andre</small>
                  </div>
                </article>
                <article className="route-row is-muted">
                  <time>2:00</time>
                  <span className="route-line route-line-stone">
                    <i />
                  </span>
                  <div className="route-copy">
                    <span className="route-type">Rental pickup</span>
                    <h3>Weekend rental · #T-02</h3>
                    <p>
                      <MapPin aria-hidden="true" size={14} /> 4565 South 84th Street, Lincoln
                    </p>
                  </div>
                  <div className="route-assignee">
                    <span>AJ</span>
                    <small>Andre</small>
                  </div>
                </article>
              </div>
            </section>

            <section className="panel attention-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">Work queue</span>
                  <h2>Needs attention</h2>
                </div>
                <span className="count-pill">3 items</span>
              </div>
              <div className="attention-list">
                {attentionItems.map((item, index) => (
                  <button className="attention-row" key={item.name} type="button">
                    <span className={`attention-icon attention-icon-${index.toString()}`}>
                      {index === 0 ? (
                        <Clock3 size={17} />
                      ) : index === 1 ? (
                        <CircleAlert size={17} />
                      ) : (
                        <MessageSquareText size={17} />
                      )}
                    </span>
                    <span className="attention-copy">
                      <strong>{item.name}</strong>
                      <span>{item.detail}</span>
                    </span>
                    <span className="attention-meta">
                      <small>{item.badge}</small>
                      <span>{item.time}</span>
                    </span>
                    <ChevronRight aria-hidden="true" size={17} />
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside className="dashboard-secondary-column">
            <section className="field-card">
              <div className="field-card-art" aria-hidden="true">
                <span className="sun" />
                <span className="road" />
                <Truck size={34} strokeWidth={1.5} />
              </div>
              <span className="panel-kicker">Field status</span>
              <h2>Crews are rolling.</h2>
              <p>Two drivers are active and all assigned equipment checked in this morning.</p>
              <button className="text-button light" type="button">
                Open field view <ChevronRight size={16} />
              </button>
            </section>
            <DocumentUploadCard />
          </aside>
        </div>
      </div>
    </StaffShell>
  );
}
