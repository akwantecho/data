import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type {
  ImportCommitResult,
  ImportMappingRequest,
  ImportPreview,
  ImportValidationReport,
} from '@sip/shared-types';
import { ErrorState, LoadingState } from '../../components/states';
import { FormField } from '../../components/FormField';
import { describeApiError } from '../../lib/errors';
import {
  cancelImport,
  commitImport,
  dataKeys,
  fetchDataSources,
  mapImport,
  uploadImport,
  validateImport,
} from './data-api';
import { DataLayout } from './DataLayout';

type Step = 'upload' | 'map' | 'validate' | 'done';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'upload', label: '1. Upload' },
  { id: 'map', label: '2. Map columns' },
  { id: 'validate', label: '3. Validate' },
  { id: 'done', label: '4. Import' },
];

/** Fields the importer needs; only the first three are required. */
const MAPPING_FIELDS: Array<{ key: keyof ImportMappingRequest; label: string; required: boolean }> =
  [
    { key: 'metricCode', label: 'Metric code', required: true },
    { key: 'period', label: 'Period', required: true },
    { key: 'value', label: 'Value', required: true },
    { key: 'branchCode', label: 'Branch code', required: false },
    { key: 'departmentCode', label: 'Department code', required: false },
    { key: 'currency', label: 'Currency', required: false },
  ];

/**
 * Upload → preview and map → validate → commit (plan §14).
 *
 * Nothing reaches the metrics until the last step, and the validation report is
 * shown in full before it does — an import is a decision the user makes with the
 * evidence in front of them.
 */
export function ImportWizardPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [dataSourceId, setDataSourceId] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ImportMappingRequest | null>(null);
  const [report, setReport] = useState<ImportValidationReport | null>(null);
  const [result, setResult] = useState<ImportCommitResult | null>(null);

  const sourcesQuery = useQuery({ queryKey: dataKeys.sources, queryFn: fetchDataSources });

  const uploadMutation = useMutation({
    mutationFn: () => uploadImport(file as File, dataSourceId || undefined),
    onSuccess: (response) => {
      setPreview(response);
      setMapping(response.suggestedMapping);
      setStep('map');
    },
  });

  const validateMutation = useMutation({
    mutationFn: async (values: ImportMappingRequest) => {
      const importId = preview!.import.id;
      await mapImport(importId, values);
      return validateImport(importId);
    },
    onSuccess: (response) => {
      setReport(response);
      setStep('validate');
    },
  });

  const commitMutation = useMutation({
    mutationFn: () => commitImport(preview!.import.id),
    onSuccess: (response) => {
      setResult(response);
      setStep('done');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelImport(preview!.import.id),
    onSuccess: () => navigate('/data/imports'),
  });

  return (
    <DataLayout
      title="New import"
      description="Upload a CSV, tell the platform what each column means, review what it found, then import."
    >
      <ol className="steps">
        {STEPS.map((entry) => (
          <li
            key={entry.id}
            className={`steps__item${entry.id === step ? ' steps__item--active' : ''}`}
            aria-current={entry.id === step ? 'step' : undefined}
          >
            {entry.label}
          </li>
        ))}
      </ol>

      {step === 'upload' ? (
        <section className="card stack">
          <h2 className="card__title">Choose a file</h2>
          <p className="state">
            One row per measurement: a metric code, a period such as 2026-01, and a value.
            Optionally a branch or department code.
          </p>

          <FormField label="CSV file" htmlFor="import-file">
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="form-field__input"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </FormField>

          <FormField label="Data source" htmlFor="import-source" hint="Optional.">
            <select
              id="import-source"
              className="form-field__input"
              value={dataSourceId}
              onChange={(event) => setDataSourceId(event.target.value)}
            >
              <option value="">Not linked to a source</option>
              {(sourcesQuery.data ?? [])
                .filter((source) => source.status === 'ACTIVE')
                .map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
            </select>
          </FormField>

          {uploadMutation.isError ? (
            <ErrorState message={describeApiError(uploadMutation.error)} />
          ) : null}

          <div className="form-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={!file || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload and preview'}
            </button>
          </div>
        </section>
      ) : null}

      {step === 'map' && preview && mapping ? (
        <MappingStep
          preview={preview}
          mapping={mapping}
          onChange={setMapping}
          isValidating={validateMutation.isPending}
          error={validateMutation.isError ? describeApiError(validateMutation.error) : null}
          onCancel={() => cancelMutation.mutate()}
          onValidate={() => validateMutation.mutate(mapping)}
        />
      ) : null}

      {step === 'validate' && report ? (
        <ValidationStep
          report={report}
          isCommitting={commitMutation.isPending}
          error={commitMutation.isError ? describeApiError(commitMutation.error) : null}
          onBack={() => setStep('map')}
          onCancel={() => cancelMutation.mutate()}
          onCommit={() => commitMutation.mutate()}
        />
      ) : null}

      {step === 'done' && result ? (
        <section className="card stack">
          <h2 className="card__title">Import complete</h2>
          <dl className="status-list">
            <SummaryRow label="File" value={result.import.fileName} />
            <SummaryRow label="Metric values written" value={String(result.valuesWritten)} />
            <SummaryRow label="Rows received" value={String(result.import.rowsReceived)} />
            <SummaryRow label="Rejected" value={String(result.import.rowsRejected)} />
          </dl>
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => navigate(`/data/imports/${result.import.id}`)}
            >
              View import
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => navigate('/data/imports')}
            >
              Back to imports
            </button>
          </div>
        </section>
      ) : null}

      {sourcesQuery.isPending && step === 'upload' ? (
        <LoadingState label="Loading sources…" />
      ) : null}
    </DataLayout>
  );
}

function MappingStep({
  preview,
  mapping,
  onChange,
  isValidating,
  error,
  onCancel,
  onValidate,
}: {
  preview: ImportPreview;
  mapping: ImportMappingRequest;
  onChange: (mapping: ImportMappingRequest) => void;
  isValidating: boolean;
  error: string | null;
  onCancel: () => void;
  onValidate: () => void;
}) {
  const missingRequired = MAPPING_FIELDS.filter(
    (field) => field.required && !mapping[field.key],
  ).map((field) => field.label);

  return (
    <>
      <section className="card stack">
        <h2 className="card__title">Map columns</h2>
        <p className="state">
          {preview.import.rowsReceived} rows found in {preview.import.fileName}. Metric codes this
          organization accepts: {preview.availableMetricCodes.join(', ') || 'none configured yet'}.
        </p>

        <div className="form-grid stack">
          {MAPPING_FIELDS.map((field) => (
            <FormField
              key={field.key}
              label={`${field.label}${field.required ? '' : ' (optional)'}`}
              htmlFor={`map-${field.key}`}
            >
              <select
                id={`map-${field.key}`}
                className="form-field__input"
                value={mapping[field.key] ?? ''}
                onChange={(event) =>
                  onChange({ ...mapping, [field.key]: event.target.value || null })
                }
              >
                <option value="">Not mapped</option>
                {preview.columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </FormField>
          ))}
        </div>

        {error ? <ErrorState message={error} /> : null}

        <div className="form-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={missingRequired.length > 0 || isValidating}
            onClick={onValidate}
          >
            {isValidating ? 'Validating…' : 'Validate rows'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel import
          </button>
          {missingRequired.length > 0 ? (
            <span className="state">Still to map: {missingRequired.join(', ')}</span>
          ) : null}
        </div>
      </section>

      <section className="card stack">
        <h2 className="card__title">File preview</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                {preview.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  {preview.columns.map((column) => (
                    <td key={column}>{row.data[column]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ValidationStep({
  report,
  isCommitting,
  error,
  onBack,
  onCancel,
  onCommit,
}: {
  report: ImportValidationReport;
  isCommitting: boolean;
  error: string | null;
  onBack: () => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const { rowsReceived, rowsValid, rowsWarning, rowsRejected } = report.import;
  const importable = rowsValid + rowsWarning;

  return (
    <>
      <section className="card stack">
        <h2 className="card__title">Validation summary</h2>
        <dl className="status-list">
          <SummaryRow label="Rows received" value={String(rowsReceived)} />
          <SummaryRow label="Valid" value={String(rowsValid)} />
          <SummaryRow label="Warnings (will be imported)" value={String(rowsWarning)} />
          <SummaryRow label="Rejected (will not be imported)" value={String(rowsRejected)} />
        </dl>

        {rowsRejected > 0 ? (
          <p className="state">
            Rejected rows are kept with their reasons so you can correct the file and import again —
            nothing is discarded silently.
          </p>
        ) : null}

        {error ? <ErrorState message={error} /> : null}

        <div className="form-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={importable === 0 || isCommitting}
            onClick={onCommit}
          >
            {isCommitting ? 'Importing…' : `Import ${importable} rows`}
          </button>
          <button type="button" className="button button--ghost" onClick={onBack}>
            Back to mapping
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel import
          </button>
        </div>
      </section>

      {report.issues.length > 0 ? (
        <section className="card stack">
          <h2 className="card__title">Issues</h2>
          <IssueTable issues={report.issues} />
          {report.issuesTruncated ? (
            <p className="state">Only the first issues are listed. Fix these and validate again.</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

export function IssueTable({ issues }: { issues: ImportValidationReport['issues'] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Column</th>
            <th scope="col">Severity</th>
            <th scope="col">Problem</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, index) => (
            <tr key={`${issue.rowNumber}-${issue.code}-${index}`}>
              <td>{issue.rowNumber ?? '—'}</td>
              <td>{issue.column ?? '—'}</td>
              <td>
                <span
                  className={`badge ${
                    issue.severity === 'ERROR' ? 'badge--negative' : 'badge--positive'
                  }`}
                >
                  {issue.severity}
                </span>
              </td>
              <td>{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-list__row">
      <dt className="status-list__label">{label}</dt>
      <dd className="status-list__value" style={{ margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}
