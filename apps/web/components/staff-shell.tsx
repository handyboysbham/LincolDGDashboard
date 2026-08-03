import {
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  Menu,
  Receipt,
  Search,
  Settings,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Brand } from "./brand";

const primaryNavigation = [
  { href: "/", icon: LayoutDashboard, label: "Overview" },
  { href: "/inbox", icon: Inbox, label: "Inbox", badge: "4" },
  { href: "/schedule", icon: CalendarDays, label: "Schedule" },
  { href: "/jobs", icon: Truck, label: "Jobs" },
  { href: "/customers", icon: Users, label: "Customers" },
];

const businessNavigation = [
  { href: "/documents", icon: FileText, label: "Documents" },
  { href: "/billing", icon: Receipt, label: "Billing" },
];

export function StaffShell({
  active = "/",
  children,
}: Readonly<{ active?: string; children: React.ReactNode }>) {
  return (
    <div className="staff-shell">
      <aside className="staff-sidebar">
        <Brand />
        <button className="workspace-switcher" type="button">
          <span className="workspace-avatar">L</span>
          <span>
            <strong>Lincoln D&amp;G</strong>
            <small>Operations</small>
          </span>
          <ChevronDown aria-hidden="true" size={16} />
        </button>

        <nav aria-label="Staff navigation" className="staff-navigation">
          <span className="nav-eyebrow">Workspace</span>
          {primaryNavigation.map(({ badge, href, icon: Icon, label }) => (
            <Link
              className={href === active ? "nav-link is-active" : "nav-link"}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {badge && <span className="nav-badge">{badge}</span>}
            </Link>
          ))}
          <span className="nav-eyebrow nav-eyebrow-spaced">Business</span>
          {businessNavigation.map(({ href, icon: Icon, label }) => (
            <Link
              className={href === active ? "nav-link is-active" : "nav-link"}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="dispatch-card">
            <CircleHelp aria-hidden="true" size={18} />
            <div>
              <strong>Need a hand?</strong>
              <span>Open the operations guide</span>
            </div>
          </div>
          <Link
            className={active === "/settings" ? "nav-link is-active" : "nav-link"}
            href="/settings"
          >
            <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>Settings</span>
          </Link>
          <div className="staff-profile">
            <span className="profile-avatar">KD</span>
            <span>
              <strong>Kaleb Duncan</strong>
              <small>Owner</small>
            </span>
            <ChevronDown aria-hidden="true" size={15} />
          </div>
        </div>
      </aside>

      <div className="staff-content">
        <header className="staff-topbar">
          <button aria-label="Open navigation" className="icon-button mobile-only" type="button">
            <Menu aria-hidden="true" size={20} />
          </button>
          <div className="global-search">
            <Search aria-hidden="true" size={18} />
            <span>Search customers, jobs, invoices…</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-date">
            <span>Monday</span>
            <strong>Aug 3</strong>
          </div>
        </header>
        <main>{children}</main>
      </div>

      <nav aria-label="Mobile staff navigation" className="mobile-nav">
        <Link className={active === "/" ? "is-active" : undefined} href="/">
          <LayoutDashboard aria-hidden="true" size={20} />
          <span>Home</span>
        </Link>
        <Link className={active === "/schedule" ? "is-active" : undefined} href="/schedule">
          <CalendarDays aria-hidden="true" size={20} />
          <span>Schedule</span>
        </Link>
        <Link className={active === "/jobs" ? "is-active" : undefined} href="/jobs">
          <ClipboardList aria-hidden="true" size={20} />
          <span>Jobs</span>
        </Link>
        <Link className={active === "/customers" ? "is-active" : undefined} href="/customers">
          <Users aria-hidden="true" size={20} />
          <span>Customers</span>
        </Link>
      </nav>
    </div>
  );
}
