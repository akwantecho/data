import { createContext, useContext } from 'react';
import type { MembershipSummary, SessionResponse } from '@sip/shared-types';

export interface SessionContextValue {
  session: SessionResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Membership matching the organization the session is currently scoped to. */
  activeMembership: MembershipSummary | null;
  isPlatformAdmin: boolean;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used inside a SessionProvider');
  }

  return context;
}
