import { useQuery } from '@tanstack/react-query';
import type { OrganizationSummary } from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';
import { useSession } from '../auth/session-context';

const ORGANIZATION_QUERY_KEY = ['organization', 'current'] as const;

/**
 * The active organization's profile, cached once and shared by every screen that
 * needs its locale — currency formatting in particular, which must follow the
 * organization rather than a hardcoded default (plan §10).
 */
export function useOrganization(): {
  organization: OrganizationSummary | null;
  currencyCode: string;
  isLoading: boolean;
} {
  const { session } = useSession();

  const query = useQuery({
    queryKey: ORGANIZATION_QUERY_KEY,
    queryFn: () => apiRequest<OrganizationSummary>('/organizations/current'),
    // Platform staff have no organization, so there is nothing to fetch.
    enabled: Boolean(session?.activeOrganizationId),
    staleTime: 300_000,
  });

  return {
    organization: query.data ?? null,
    // USD is only a placeholder while the profile loads; it is never persisted.
    currencyCode: query.data?.currencyCode ?? 'USD',
    isLoading: query.isPending,
  };
}
