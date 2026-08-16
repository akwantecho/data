import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';

const TABS = [
  { to: '/settings/organization', label: 'Organization' },
  { to: '/settings/branches', label: 'Branches' },
  { to: '/settings/departments', label: 'Departments' },
  { to: '/settings/team', label: 'Team' },
];

export function SettingsLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="stack">
      <PageHeader title={title} description={description} />

      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `tabs__link${isActive ? ' tabs__link--active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {children}
    </div>
  );
}
