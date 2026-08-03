import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Home,
  Menu,
  MessageCircle,
  Phone,
  Route,
  ShieldCheck,
  Truck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "../../components/brand";

export const metadata: Metadata = { title: "Driver workspace" };

export default function DriverPage() {
  return (
    <div className="driver-shell">
      <header className="driver-header">
        <Brand compact />
        <div className="driver-date">
          <span>Monday</span>
          <strong>Aug 3</strong>
        </div>
        <button aria-label="Open driver menu" className="driver-menu" type="button">
          <Menu size={22} />
        </button>
      </header>

      <main className="driver-main">
        <section className="driver-greeting">
          <span className="driver-avatar">AJ</span>
          <div>
            <span>Good morning, Andre</span>
            <h1>Your road is clear.</h1>
          </div>
        </section>

        <section className="driver-empty-card">
          <div className="driver-empty-art" aria-hidden="true">
            <span className="driver-horizon" />
            <span className="driver-road" />
            <Truck size={54} strokeWidth={1.4} />
            <CheckCircle2 className="driver-check" size={30} />
          </div>
          <span className="status-chip">
            <CheckCircle2 size={15} /> All caught up
          </span>
          <h2>No assignments right now</h2>
          <p>
            Dispatch will notify you here as soon as a delivery, drop-off, or pickup is assigned.
          </p>
        </section>

        <section aria-label="Driver readiness" className="driver-readiness">
          <article>
            <span className="readiness-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <strong>Pre-trip complete</strong>
              <small>Truck #07 · 7:12 AM</small>
            </div>
            <CheckCircle2 className="is-complete" size={20} />
          </article>
          <article>
            <span className="readiness-icon">
              <ClipboardCheck size={20} />
            </span>
            <div>
              <strong>Equipment ready</strong>
              <small>No open inspection items</small>
            </div>
            <CheckCircle2 className="is-complete" size={20} />
          </article>
        </section>

        <div className="driver-actions">
          <a className="driver-action primary" href="tel:+14025550142">
            <Phone size={20} /> Call dispatch
          </a>
          <button className="driver-action" type="button">
            <MessageCircle size={20} /> Send a message
          </button>
        </div>
      </main>

      <nav aria-label="Driver navigation" className="driver-bottom-nav">
        <Link className="is-active" href="/driver">
          <Home size={21} />
          <span>Home</span>
        </Link>
        <Link href="/driver/route">
          <Route size={21} />
          <span>Route</span>
        </Link>
        <Link href="/driver/jobs">
          <ClipboardCheck size={21} />
          <span>Jobs</span>
        </Link>
        <Link href="/driver/schedule">
          <CalendarDays size={21} />
          <span>Schedule</span>
        </Link>
      </nav>
    </div>
  );
}
