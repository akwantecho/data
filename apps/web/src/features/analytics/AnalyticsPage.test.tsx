import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComparisonResult, MetricAnalytics, MetricAnalyticsDetail } from '@sip/shared-types';
import { AnalyticsPage } from './AnalyticsPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="chart" />,
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

const organization = {
  id: 'org-1',
  name: 'Azure Coast Resorts',
  slug: 'azure-resorts',
  industryId: 'industry-1',
  industryName: 'Hospitality & Tourism',
  countryCode: 'OM',
  currencyCode: 'OMR',
  timezone: 'Asia/Muscat',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const options = {
  metrics: [
    { id: 'metric-revpar', code: 'revpar', name: 'RevPAR', category: 'Financial' },
    { id: 'metric-revenue', code: 'revenue', name: 'Revenue', category: 'Financial' },
  ],
  branches: [{ id: 'branch-1', name: 'Seeb Beach Resort' }],
  departments: [],
  earliestPeriod: '2025-09-01',
  latestPeriod: '2026-02-01',
};

function analytics(overrides: Partial<MetricAnalytics> = {}): MetricAnalytics {
  return {
    metricId: 'metric-revpar',
    code: 'revpar',
    name: 'RevPAR',
    category: 'Financial',
    unit: 'CURRENCY',
    direction: 'HIGHER_IS_BETTER',
    aggregationType: 'FORMULA',
    formula: 'revenue / available_rooms',
    aggregation: 'RECOMPUTED_FROM_INPUTS',
    current: '15',
    previous: '12',
    changePct: '25',
    target: null,
    targetPeriods: 0,
    comparedToTarget: '15',
    varianceToTargetPct: null,
    thresholdStatus: 'UNKNOWN',
    series: [{ periodStart: '2026-01-01', periodType: 'MONTH', value: '15' }],
    previousSeries: [{ periodStart: '2025-12-01', periodType: 'MONTH', value: '12' }],
    missingPeriods: 1,
    ...overrides,
  };
}

const window = {
  from: '2025-09-01',
  to: '2026-02-01',
  previousFrom: '2025-03-01',
  previousTo: '2025-08-31',
  branchId: null,
  departmentId: null,
  branchName: null,
  departmentName: null,
};

const detail: MetricAnalyticsDetail = {
  window,
  metric: analytics(),
  inputs: [
    analytics({
      metricId: 'metric-revenue',
      code: 'revenue',
      name: 'Revenue',
      aggregationType: 'SUM',
      aggregation: 'SUM',
      formula: null,
      current: '900',
      changePct: '20',
    }),
  ],
  dependents: [],
  related: [],
};

const comparison: ComparisonResult = {
  window,
  breakdown: 'BRANCH',
  metric: { id: 'metric-revpar', code: 'revpar', name: 'RevPAR', unit: 'CURRENCY' },
  rows: [
    {
      key: 'branch-1',
      label: 'Seeb Beach Resort',
      current: '18',
      previous: '14',
      changePct: '28.57',
      target: null,
      varianceToTargetPct: null,
      series: [{ periodStart: '2026-01-01', periodType: 'MONTH', value: '18' }],
    },
  ],
};

function renderAnalytics(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/organizations/current': { body: organization },
    '/analytics/options': { body: options },
    '/analytics/comparison': { body: comparison },
    '/analytics/metric/metric-revpar': { body: detail },
    ...overrides,
  });

  renderWithProviders(<AnalyticsPage />, { route: '/analytics?metric=metric-revpar' });

  return stubs;
}

describe('AnalyticsPage', () => {
  it('shows the range figure, the previous one and the change', async () => {
    renderAnalytics();

    expect(await screen.findByText('OMR 15.000')).toBeInTheDocument();
    expect(screen.getByText('OMR 12.000')).toBeInTheDocument();
    expect(screen.getByText('+25%')).toBeInTheDocument();
  });

  it('says how a calculated metric’s range figure was produced', async () => {
    renderAnalytics();

    expect(
      await screen.findByText(
        /Calculated for this range from its inputs \(revenue \/ available_rooms\), not averaged/,
      ),
    ).toBeInTheDocument();
    // And admits what it could not cover.
    expect(screen.getByText(/1 period in this range reported nothing/)).toBeInTheDocument();
  });

  it('describes a plain aggregation just as plainly', async () => {
    renderAnalytics({
      '/analytics/metric/metric-revpar': {
        body: {
          ...detail,
          metric: analytics({ aggregation: 'SUM', aggregationType: 'SUM', missingPeriods: 0 }),
        },
      },
    });

    expect(await screen.findByText('Summed across the range.')).toBeInTheDocument();
  });

  it('compares the metric across branches', async () => {
    renderAnalytics();

    // The branch appears twice — in the filter and in the comparison — so the
    // assertion is on the row's figures. Waiting on them also waits for the
    // organization profile, which carries the currency.
    expect(await screen.findByText('OMR 18.000')).toBeInTheDocument();
    expect(screen.getByText('OMR 14.000')).toBeInTheDocument();
    expect(screen.getByText('+28.6%')).toBeInTheDocument();
    expect(screen.getAllByText('Seeb Beach Resort').length).toBeGreaterThan(1);
  });

  it('switches the breakdown to departments', async () => {
    const { calls } = renderAnalytics();

    await screen.findByText('OMR 18.000');
    await userEvent.click(screen.getByRole('button', { name: 'By department' }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('breakdown=DEPARTMENT'))).toBe(true);
    });
  });

  it('lists the inputs a calculated metric is made of', async () => {
    renderAnalytics();

    expect(await screen.findByText('Inputs this metric is calculated from')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revenue' })).toBeInTheDocument();
    expect(await screen.findByText('OMR 900.000')).toBeInTheDocument();
  });

  it('keeps the chosen metric in the URL so a link opens the same figure', async () => {
    const { calls } = renderAnalytics({
      '/analytics/metric/metric-revenue': {
        body: { ...detail, metric: analytics({ metricId: 'metric-revenue', name: 'Revenue' }) },
      },
    });

    await screen.findByText('OMR 15.000');
    await userEvent.selectOptions(screen.getByLabelText('Metric'), 'metric-revenue');

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/analytics/metric/metric-revenue'))).toBe(
        true,
      );
    });
  });
});
