import { CalendarDays, ClipboardCheck, Home, Menu, Route } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "./brand";

export function DriverShell({
  active,
  children,
}: {
  active: "/driver" | "/driver/jobs" | "/driver/route" | "/driver/schedule";
  children: ReactNode;
}) {
  return (
    <div className="driver-shell">
      <header className="driver-header">
        <Brand compact />
        <div className="driver-date">
          <span>Lincoln Dirt &amp; Gravel</span>
          <strong>Driver operations</strong>
        </div>
        <button aria-label="Open driver menu" className="driver-menu" type="button">
          <Menu size={22} />
        </button>
      </header>
      {children}
      <nav aria-label="Driver navigation" className="driver-bottom-nav">
        <DriverNavLink active={active === "/driver"} href="/driver" icon={<Home size={21} />}>
          Home
        </DriverNavLink>
        <DriverNavLink
          active={active === "/driver/route"}
          href="/driver/route"
          icon={<Route size={21} />}
        >
          Route
        </DriverNavLink>
        <DriverNavLink
          active={active === "/driver/jobs"}
          href="/driver/jobs"
          icon={<ClipboardCheck size={21} />}
        >
          Jobs
        </DriverNavLink>
        <DriverNavLink
          active={active === "/driver/schedule"}
          href="/driver/schedule"
          icon={<CalendarDays size={21} />}
        >
          Schedule
        </DriverNavLink>
      </nav>
    </div>
  );
}

function DriverNavLink({
  active,
  children,
  href,
  icon,
}: {
  active: boolean;
  children: ReactNode;
  href: string;
  icon: ReactNode;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={active ? "is-active" : ""}
      href={href}
    >
      {icon}
      <span>{children}</span>
    </Link>
  );
}
