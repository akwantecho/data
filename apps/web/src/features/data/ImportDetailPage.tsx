import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { describeApiError } from '../../lib/errors';
import { dataKeys, fetchImport, fetchImportRows } from './data-api';
import { DataLayout } from './DataLayout';
import { IssueTable } from './ImportWizardPage';
import { StatusBadge } from './ImportsPage';

const ROW_FILTERS = [
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'WARNING', label: 'Warnings' },
  { value: 'VALID', label: 'Valid' },
] as const;

/** The record of one import: what arrived, what was accepted, and why. */
export function ImportDetailPage() {
  const { id = '' } = useParams();
  const [rowFilter, setRowFilter] = useState<(typeof ROW_FILTERS)[number]['value']>('REJECTED');

  const importQuery = useQuery({
    queryKey: dataKeys.import(id),
    queryFn: () => fetchImport(id),
    enabled: id.length > 0,
  });

  const rowsQuery = useQuery({
    queryKey: dataKeys.importRows(id, rowFilter),
    queryFn: () => fetchImportRows(id, rowFilter),
    enabled: id.length > 0,
  });

  const summary = importQuery.data?.import;

  return (
    <DataLayout
      title="Import"
      description="What this file contained and what the platform did with it."
    >
      {importQuery.isPending ? <LoadingState label="Loading import…" /> : null}
      {importQuery.isError ? <ErrorState message={describeApiError(importQuery.error)} /> : null}

      {summary ? (
        <section className="card stack">
          <div className="section-header">
            <h2 className="card__title">{summary.fileName}</h2>
            <StatusBadge status={summary.status} />
          </div>

          <dl className="status-list">
            <Row label="Source" value={summary.dataSourceName ?? 'Direct upload'} />
            <Row label="Rows received" value={String(summary.rowsReceived)} />
            <Row label="Valid" value={String(summary.rowsValid)} />
            <Row label="Warnings" value={String(summary.rowsWarning)} />
            <Row label="Rejected" value={String(summary.rowsRejected)} />
            <Row label="Uploaded" value={new Date(summary.createdAt).toLocaleString()} />
            <Row
              label="Committed"
              value={summary.committedAt ? new Date(summary.committedAt).toLocaleString() : '—'}
            />
          </dl>
        </section>
      ) : null}

      {importQuery.data && importQuery.data.issues.length > 0 ? (
        <section className="card stack">
          <h2 className="card__title">Issues</h2>
          <IssueTable issues={importQuery.data.issues} />
        </section>
      ) : null}

      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">Rows as received</h2>
          <div className="tabs">
            {ROW_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`tabs__link${rowFilter === filter.value ? ' tabs__link--active' : ''}`}
                onClick={() => setRowFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {rowsQuery.isPending ? <LoadingState label="Loading rows…" /> : null}
        {rowsQuery.data?.items.length === 0 ? (
          <EmptyState message={`No ${rowFilter.toLowerCase()} rows in this import.`} />
        ) : null}

        {rowsQuery.data && rowsQuery.data.items.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {Object.keys(rowsQuery.data.items[0].data).map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                  <th scope="col">Problems</th>
                </tr>
              </thead>
              <tbody>
                {rowsQuery.data.items.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    {Object.keys(rowsQuery.data.items[0].data).map((column) => (
                      <td key={column}>{row.data[column]}</td>
                    ))}
                    <td>
                      {row.issues.length === 0
                        ? '—'
                        : row.issues.map((issue) => issue.message).join(' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </DataLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-list__row">
      <dt className="status-list__label">{label}</dt>
      <dd className="status-list__value" style={{ margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}
