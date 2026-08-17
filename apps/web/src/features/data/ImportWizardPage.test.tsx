import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportPreview, ImportSummary, ImportValidationReport } from '@sip/shared-types';
import { ImportWizardPage } from './ImportWizardPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

function importSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id: 'import-1',
    fileName: 'january.csv',
    fileSizeBytes: 2048,
    status: 'UPLOADED',
    dataSourceId: null,
    dataSourceName: null,
    mapping: null,
    rowsReceived: 3,
    rowsValid: 0,
    rowsWarning: 0,
    rowsRejected: 0,
    committedAt: null,
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    ...overrides,
  };
}

const preview: ImportPreview = {
  import: importSummary(),
  columns: ['Metric', 'Period', 'Value', 'Branch'],
  suggestedMapping: {
    metricCode: 'Metric',
    period: 'Period',
    value: 'Value',
    branchCode: 'Branch',
    departmentCode: null,
    currency: null,
  },
  sampleRows: [
    {
      rowNumber: 1,
      data: { Metric: 'revenue', Period: '2026-01', Value: '125000', Branch: 'muscat' },
    },
    { rowNumber: 2, data: { Metric: 'oops', Period: '2026-01', Value: '5', Branch: 'muscat' } },
  ],
  availableMetricCodes: ['revenue', 'customers'],
};

const report: ImportValidationReport = {
  import: importSummary({
    status: 'VALIDATED',
    rowsReceived: 3,
    rowsValid: 1,
    rowsWarning: 1,
    rowsRejected: 1,
  }),
  issues: [
    {
      rowNumber: 2,
      column: 'Metric',
      code: 'UNKNOWN_METRIC',
      message: '"oops" is not a metric in this organization.',
      severity: 'ERROR',
    },
  ],
  issuesTruncated: false,
};

function stubWizard(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  return stubFetch({
    '/auth/me': { body: session },
    '/data-sources': { body: [] },
    '/imports/upload': { body: preview },
    '/imports/import-1/map': { body: importSummary({ status: 'MAPPED' }) },
    '/imports/import-1/validate': { body: report },
    '/imports/import-1/commit': {
      body: { import: importSummary({ status: 'COMMITTED' }), valuesWritten: 2 },
    },
    '/imports/import-1/cancel': { body: importSummary({ status: 'CANCELLED' }) },
    ...overrides,
  });
}

function csvFile(name = 'january.csv') {
  return new File(['Metric,Period,Value\nrevenue,2026-01,1\n'], name, { type: 'text/csv' });
}

async function uploadFile(calls: { url: string }[] | undefined = undefined) {
  await userEvent.upload(await screen.findByLabelText('CSV file'), csvFile());
  await userEvent.click(screen.getByRole('button', { name: 'Upload and preview' }));
  return calls;
}

describe('ImportWizardPage', () => {
  it('will not upload before a file is chosen', async () => {
    stubWizard();
    renderWithProviders(<ImportWizardPage />, { route: '/data/imports/new' });

    expect(await screen.findByRole('button', { name: 'Upload and preview' })).toBeDisabled();
  });

  it('uploads and shows the preview with the suggested mapping', async () => {
    const { calls } = stubWizard();
    renderWithProviders(<ImportWizardPage />, { route: '/data/imports/new' });

    await uploadFile();

    expect(await screen.findByText('Map columns')).toBeInTheDocument();
    expect(screen.getByLabelText('Metric code')).toHaveValue('Metric');
    expect(screen.getByLabelText('Period')).toHaveValue('Period');
    expect(screen.getByLabelText('Branch code (optional)')).toHaveValue('Branch');
    // The metric codes the organization accepts are spelled out.
    expect(screen.getByText(/revenue, customers/)).toBeInTheDocument();
    // Sample rows are shown before anything is imported.
    expect(screen.getByText('125000')).toBeInTheDocument();

    const upload = calls.find((call) => call.url.endsWith('/imports/upload'));
    expect(upload?.init?.method).toBe('POST');
    // Multipart: the browser sets the boundary, so no explicit content type.
    expect((upload?.init?.headers as Record<string, string>) ?? {}).not.toHaveProperty(
      'Content-Type',
    );
  });

  it('blocks validation until the required fields are mapped', async () => {
    stubWizard();
    renderWithProviders(<ImportWizardPage />, { route: '/data/imports/new' });

    await uploadFile();
    await userEvent.selectOptions(await screen.findByLabelText('Value'), '');

    expect(screen.getByRole('button', { name: 'Validate rows' })).toBeDisabled();
    expect(screen.getByText(/Still to map: Value/)).toBeInTheDocument();
  });

  it('maps then validates, and shows the counts and every issue', async () => {
    const { calls } = stubWizard();
    renderWithProviders(<ImportWizardPage />, { route: '/data/imports/new' });

    await uploadFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Validate rows' }));

    expect(await screen.findByText('Validation summary')).toBeInTheDocument();
    expect(screen.getByText('"oops" is not a metric in this organization.')).toBeInTheDocument();
    expect(screen.getByText(/Rejected rows are kept with their reasons/)).toBeInTheDocument();

    const mapCall = calls.find((call) => call.url.endsWith('/imports/import-1/map'));
    expect(JSON.parse(String(mapCall?.init?.body))).toMatchObject({
      metricCode: 'Metric',
      period: 'Period',
      value: 'Value',
      branchCode: 'Branch',
    });
  });

  it('imports the accepted rows and reports what was written', async () => {
    const { calls } = stubWizard();
    renderWithProviders(<ImportWizardPage />, { route: '/data/imports/new' });

    await uploadFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Validate rows' }));
    // Valid + warning rows are importable; the rejected one is not.
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 rows' }));

    expect(await screen.findByText('Import complete')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith('/imports/import-1/commit'))).toBe(true);
  });

  it('cannot import when every row was rejected', async () => {
    stubWizard({
      '/imports/import-1/validate': {
        body: {
          ...report,
          import: importSummary({
            status: 'VALIDATED',
            rowsReceived: 1,
            rowsValid: 0,
            rowsWarning: 0,
            rowsRejected: 1,
          }),
        },
      },
    });
    renderWithProviders(<ImportWizardPage />, { route: '/data/imports/new' });

    await uploadFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Validate rows' }));

    expect(await screen.findByRole('button', { name: 'Import 0 rows' })).toBeDisabled();
  });

  it('can cancel the import before committing', async () => {
    const { calls } = stubWizard();
    renderWithProviders(<ImportWizardPage />, { route: '/data/imports/new' });

    await uploadFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel import' }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/imports/import-1/cancel'))).toBe(true);
    });
  });

  it('shows the server message when the same file was already imported', async () => {
    stubWizard({
      '/imports/upload': {
        status: 409,
        body: {
          code: 'CONFLICT',
          message: 'This exact file was already imported as "january.csv".',
          details: [],
        },
      },
    });
    renderWithProviders(<ImportWizardPage />, { route: '/data/imports/new' });

    await uploadFile();

    expect(await screen.findByRole('alert')).toHaveTextContent('already imported');
  });
});
