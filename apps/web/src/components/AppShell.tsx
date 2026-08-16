import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

interface NavItem {
  label: string;
  to?: string;
  /** Routes that arrive in later sprints are listed but not yet linkable. */
  section?: string;
}

/**
 * Navigation mirrors plan §41. Entries without a route are placeholders for the
 * sprints that build them; they are rendered disabled rather than hidden so the
 * information architecture is visible from Sprint 0.
 */
const NAV_ITEMS: NavItem[] = [
  { label: 'System Status', to: '/system' },
  { label: 'Overview' },
  { label: 'Analytics' },
  { label: 'Metrics' },
  { label: 'Goals' },
  { label: 'Insights' },
  { label: 'Decision Center' },
  { label: 'Reports' },
  { label: 'AI Analyst' },
  { label: 'Data Sources', section: 'Data' },
  { label: 'Imports' },
  { label: 'Data Quality' },
  { label: 'Branches', section: 'Organization' },
  { label: 'Departments' },
  { label: 'Team' },
  { label: 'Settings' },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <span className="brand">
          Strategic Intelligence
          <span className="brand__subtitle">Universal Core</span>
        </span>
        <nav className="nav" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavEntry key={item.label} item={item} />
          ))}
        </nav>
      </aside>

      <div className="app-shell__main">
        <header className="app-shell__topbar">
          <span className="state">Sprint 0 — platform foundation</span>
        </header>
        <main className="app-shell__content">{children}</main>
      </div>
    </div>
  );
}

function NavEntry({ item }: { item: NavItem }) {
  const link = item.to ? (
    <NavLink
      to={item.to}
      className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
    >
      {item.label}
    </NavLink>
  ) : (
    <span className="nav__link nav__link--disabled" aria-disabled="true">
      {item.label}
    </span>
  );

  return (
    <>
      {item.section ? <div className="nav__section">{item.section}</div> : null}
      {link}
    </>
  );
}
