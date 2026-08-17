import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ImportStatus } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { dataKeys, fetchImports } from './data-api';
import { DataLayout } from './DataLayout';

export function ImportsPage() {
  const { activeMembership } = useSession();
  const role = activeMembership?.role;
  const canImport = role === 'ORGANIZATION_ADMIN' || role === 'ANALYST';

  const importsQuery = useQuery({ queryKey: dataKeys.imports(1), queryFn: () => fetchImports(1) });

  return (
    <DataLayout
      title="Imports"
      description="Every upload, what it contained and what happened to it. Imports are auditable operations, not one-off actions."
    >
      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">Import history</h2>
          {canImport ? (
            <Link className="button button--primary" to="/data/imports/new">
              New import
            </Link>
          ) : null}
        </div>

        {importsQuery.isPending ? <LoadingState label="Loading imports…" /> : null}
        {importsQuery.isError ? (
          <ErrorState message={describeApiError(importsQuery.error)} />
        ) : null}
        {importsQuery.data?.items.length === 0 ? (
          <EmptyState message="No imports yet. Upload a CSV to bring in your first numbers." />
        ) : null}

        {importsQuery.data && importsQuery.data.items.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Source</th>
                <th scope="col">Rows</th>
                <th scope="col">Rejected</th>
                <th scope="col">Status</th>
                <th scope="col">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {importsQuery.data.items.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <Link to={`/data/imports/${entry.id}`}>{entry.fileName}</Link>
                    <span className="data-table__meta">
                      {(entry.fileSizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </td>
                  <td>{entry.dataSourceName ?? '—'}</td>
                  <td>{entry.rowsReceived}</td>
                  <td>{entry.rowsRejected > 0 ? entry.rowsRejected : '—'}</td>
                  <td>
                    <StatusBadge status={entry.status} />
                  </td>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </DataLayout>
  );
}

export function StatusBadge({ status }: { status: ImportStatus }) {
  const tone =
    status === 'COMMITTED'
      ? 'badge--positive'
      : status === 'FAILED' || status === 'CANCELLED'
        ? 'badge--negative'
        : '';

  return <span className={`badge ${tone}`}>{status}</span>;
}
