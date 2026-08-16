import { useQuery } from '@tanstack/react-query';
import type { Paginated, PlatformOrganizationSummary } from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';

function fetchOrganizations(): Promise<Paginated<PlatformOrganizationSummary>> {
  return apiRequest<Paginated<PlatformOrganizationSummary>>('/platform/organizations?pageSize=50');
}

/** Platform-only view across tenants (plan §36). Tenant users get 403 from the API. */
export function PlatformOrganizationsPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['platform', 'organizations'],
    queryFn: fetchOrganizations,
  });

  return (
    <div className="stack">
      <PageHeader
        title="Organizations"
        description="Every tenant on the platform, with its industry, locale and current status."
      />

      <section className="card">
        {isPending ? <LoadingState label="Loading organizations…" /> : null}
        {isError ? <ErrorState message={(error as Error).message} /> : null}

        {data && data.items.length === 0 ? (
          <EmptyState message="No organizations have been created yet." />
        ) : null}

        {data && data.items.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Organization</th>
                <th scope="col">Industry</th>
                <th scope="col">Country</th>
                <th scope="col">Currency</th>
                <th scope="col">Members</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((organization) => (
                <tr key={organization.id}>
                  <td>
                    {organization.name}
                    <span className="data-table__meta">{organization.slug}</span>
                  </td>
                  <td>{organization.industryName ?? '—'}</td>
                  <td>{organization.countryCode}</td>
                  <td>{organization.currencyCode}</td>
                  <td>{organization.memberCount}</td>
                  <td>
                    <span
                      className={`badge ${
                        organization.status === 'ACTIVE' ? 'badge--positive' : 'badge--negative'
                      }`}
                    >
                      {organization.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
