import { useState } from 'react';
import { useSession } from '../features/auth/session-context';

/**
 * Identity, organization switcher and sign-out.
 *
 * The switcher only lists memberships the API returned, and switching is applied
 * server-side — picking an organization here cannot grant access to one.
 */
export function UserMenu() {
  const { session, activeMembership, isPlatformAdmin, logout, switchOrganization } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  if (!session) {
    return null;
  }

  const roleLabel = isPlatformAdmin
    ? 'Platform administrator'
    : formatRole(activeMembership?.role ?? null);

  return (
    <div className="user-menu">
      <button
        type="button"
        className="user-menu__trigger"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="user-menu__name">{session.user.fullName}</span>
        <span className="user-menu__context">
          {activeMembership?.organizationName ?? 'Platform'} · {roleLabel}
        </span>
      </button>

      {isOpen ? (
        <div className="user-menu__panel" role="menu">
          <p className="user-menu__email">{session.user.email}</p>

          {session.memberships.length > 1 ? (
            <div className="user-menu__section">
              <span className="user-menu__section-title">Switch organization</span>
              {session.memberships.map((membership) => (
                <button
                  key={membership.organizationId}
                  type="button"
                  role="menuitem"
                  className="user-menu__item"
                  disabled={membership.organizationId === session.activeOrganizationId}
                  onClick={() => {
                    setIsOpen(false);
                    void switchOrganization(membership.organizationId);
                  }}
                >
                  {membership.organizationName}
                  <span className="user-menu__item-meta">{formatRole(membership.role)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            role="menuitem"
            className="user-menu__item user-menu__item--danger"
            onClick={() => {
              setIsOpen(false);
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatRole(role: string | null): string {
  if (!role) {
    return 'No organization';
  }

  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
