import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../features/auth/session-context';
import { UserMenu } from './UserMenu';

interface NavItem {
  label: string;
  to?: string;
  /** Routes that arrive in later sprints are listed but not yet linkable. */
  section?: string;
}

/**
 * Navigation mirrors plan §41. Entries without a route are placeholders for the
 * sprints that build them; they are rendered disabled rather than hidden so the
 * information architecture is visible from the start.
 */
const TENANT_NAV: NavItem[] = [
  { label: 'System Status', to: '/system' },
  { label: 'Overview', to: '/dashboard' },
  { label: 'Analytics', to: '/analytics' },
  { label: 'Metrics', to: '/metrics' },
  { label: 'Goals' },
  { label: 'Insights' },
  { label: 'Decision Center' },
  { label: 'Reports' },
  { label: 'AI Analyst' },
  { label: 'Data Sources', to: '/data/sources', section: 'Data' },
  { label: 'Imports', to: '/data/imports' },
  { label: 'Data Quality', to: '/data/quality' },
  { label: 'Organization', to: '/settings/organization', section: 'Organization' },
  { label: 'Branches', to: '/settings/branches' },
  { label: 'Departments', to: '/settings/departments' },
  { label: 'Team', to: '/settings/team' },
];

/** Platform staff get their own navigation — they never see tenant screens. */
const PLATFORM_NAV: NavItem[] = [
  { label: 'System Status', to: '/system' },
  { label: 'Organizations', to: '/platform/organizations', section: 'Platform' },
  { label: 'Industry Packs', to: '/platform/industry-packs' },
  { label: 'Industries' },
  { label: 'Default Metrics' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { isPlatformAdmin, activeMembership } = useSession();
  const items = isPlatformAdmin ? PLATFORM_NAV : TENANT_NAV;

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <span className="brand">
          Strategic Intelligence
          <span className="brand__subtitle">
            {isPlatformAdmin
              ? 'Platform administration'
              : (activeMembership?.organizationName ?? 'Universal Core')}
          </span>
        </span>
        <nav className="nav" aria-label="Main">
          {items.map((item) => (
            <NavEntry key={item.label} item={item} />
          ))}
        </nav>
      </aside>

      <div className="app-shell__main">
        <header className="app-shell__topbar">
          <span className="state">Sprint 6 — dashboard and analytics</span>
          <UserMenu />
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
