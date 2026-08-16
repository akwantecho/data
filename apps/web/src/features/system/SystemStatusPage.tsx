import { useQuery } from '@tanstack/react-query';
import type { HealthCheckResponse } from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, LoadingState } from '../../components/states';

function fetchHealth(): Promise<HealthCheckResponse> {
  return apiRequest<HealthCheckResponse>('/health');
}

/**
 * Sprint 0 page: proves the full path browser → API → PostgreSQL is wired up.
 * Product screens arrive from Sprint 1 onwards.
 */
export function SystemStatusPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });

  return (
    <div className="stack">
      <PageHeader
        title="System Status"
        description="Foundation check for the platform: API availability and database connectivity."
      />

      <section className="card">
        {isPending ? <LoadingState label="Checking platform services…" /> : null}
        {isError ? <ErrorState message={`API unreachable: ${(error as Error).message}`} /> : null}

        {data ? (
          <dl className="status-list">
            <Row label="API">
              <span
                className={`badge ${data.status === 'ok' ? 'badge--positive' : 'badge--negative'}`}
              >
                {data.status === 'ok' ? 'Operational' : 'Degraded'}
              </span>
            </Row>
            <Row label="Database">
              <span
                className={`badge ${
                  data.checks.database === 'up' ? 'badge--positive' : 'badge--negative'
                }`}
              >
                {data.checks.database === 'up' ? 'Connected' : 'Unavailable'}
              </span>
            </Row>
            <Row label="Service">
              <span className="status-list__value">{data.service}</span>
            </Row>
            <Row label="Version">
              <span className="status-list__value">{data.version}</span>
            </Row>
            <Row label="Uptime">
              <span className="status-list__value">{data.uptimeSeconds}s</span>
            </Row>
          </dl>
        ) : null}
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="status-list__row">
      <dt className="status-list__label">{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}
