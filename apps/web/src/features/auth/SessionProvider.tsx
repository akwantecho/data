import { useCallback, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api-client';
import { SessionContext, type SessionContextValue } from './session-context';
import {
  fetchSession,
  logout as logoutRequest,
  switchOrganization as switchOrganizationRequest,
  SESSION_QUERY_KEY,
} from './session';

/**
 * Single source of session state for the app.
 *
 * The session is server-owned: the client cannot read the httpOnly cookies, so it
 * asks the API who it is and caches the answer. Roles here drive navigation only —
 * every authorization decision is made server-side (ADR-0002).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isPending, isFetched } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    // 401 means "not signed in", which is an answer, not a failure to retry.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    staleTime: 60_000,
  });

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      // Everything cached belonged to the session that just ended.
      queryClient.clear();
    },
  });

  const switchMutation = useMutation({
    mutationFn: switchOrganizationRequest,
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      // Tenant-scoped data is now for a different organization.
      queryClient.invalidateQueries();
    },
  });

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      await switchMutation.mutateAsync(organizationId);
    },
    [switchMutation],
  );

  const value = useMemo<SessionContextValue>(() => {
    const session = data ?? null;

    return {
      session,
      isLoading: isPending && !isFetched,
      isAuthenticated: session !== null,
      activeMembership:
        session?.memberships.find(
          (membership) => membership.organizationId === session.activeOrganizationId,
        ) ?? null,
      isPlatformAdmin: session?.user.platformRole === 'PLATFORM_ADMIN',
      logout,
      switchOrganization,
    };
  }, [data, isPending, isFetched, logout, switchOrganization]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
