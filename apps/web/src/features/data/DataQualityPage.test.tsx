import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataQualityReport } from '@sip/shared-types';
import { DataQualityPage } from './DataQualityPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

const report: DataQualityReport = {
  overallScore: 94,
  completenessPct: 96,
  validityPct: 92,
  freshness: 'GOOD',
  daysSinceLastImport: 3,
  errorCount: 16,
  lastUpdatedAt: '2026-02-01T10:00:00.000Z',
  confidence: 'GOOD',
  sources: [
    {
      dataSourceId: 'source-1',
      dataSourceName: 'Monthly CSV upload',
      lastImportAt: '2026-02-01T10:00:00.000Z',
      rowsReceived: 1000,
      rowsRejected: 16,
      validityPct: 96.3,
      freshness: 'GOOD',
    },
  ],
};

describe('DataQualityPage', () => {
  it('shows the quality figures the platform derived from real imports', async () => {
    stubFetch({ '/auth/me': { body: session }, '/data-quality': { body: report } });

    renderWithProviders(<DataQualityPage />, { route: '/data/quality' });

    expect(await screen.findByText('94/100')).toBeInTheDocument();
    expect(screen.getByText('96%')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    const rejected = screen.getByText('Rejected rows on record').closest('article') as HTMLElement;
    expect(within(rejected).getByText('16')).toBeInTheDocument();
    expect(screen.getByText(/3 days ago/)).toBeInTheDocument();
  });

  it('breaks quality down per source', async () => {
    stubFetch({ '/auth/me': { body: session }, '/data-quality': { body: report } });

    renderWithProviders(<DataQualityPage />, { route: '/data/quality' });

    const row = (await screen.findByText('Monthly CSV upload')).closest('tr') as HTMLElement;
    expect(within(row).getByText('1000')).toBeInTheDocument();
    expect(within(row).getByText('96.3%')).toBeInTheDocument();
    expect(within(row).getByText('GOOD')).toBeInTheDocument();
  });

  it('says plainly when there is nothing to assess yet', async () => {
    stubFetch({
      '/auth/me': { body: session },
      '/data-quality': {
        body: {
          ...report,
          overallScore: 0,
          completenessPct: 0,
          validityPct: 0,
          freshness: 'UNKNOWN',
          confidence: 'UNKNOWN',
          daysSinceLastImport: null,
          errorCount: 0,
          lastUpdatedAt: null,
          sources: [],
        },
      },
    });

    renderWithProviders(<DataQualityPage />, { route: '/data/quality' });

    expect(await screen.findByText(/No data has been imported yet/)).toBeInTheDocument();
    expect(screen.getByText('No data sources configured.')).toBeInTheDocument();
  });
});
