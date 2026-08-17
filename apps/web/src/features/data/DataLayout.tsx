import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';

const TABS = [
  { to: '/data/sources', label: 'Data Sources' },
  { to: '/data/imports', label: 'Imports' },
  { to: '/data/quality', label: 'Data Quality' },
];

export function DataLayout({
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

      <nav className="tabs" aria-label="Data sections">
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
