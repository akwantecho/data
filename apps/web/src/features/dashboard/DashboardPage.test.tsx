import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DashboardOverview, MetricAnalytics } from '@sip/shared-types';
import { DashboardPage } from './DashboardPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

// ECharts needs layout APIs jsdom does not implement; the figures, not the
// drawing, are what these tests are about.
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
  metrics: [{ id: 'metric-1', code: 'revenue', name: 'Revenue', category: 'Financial' }],
  branches: [
    { id: 'branch-1', name: 'Seeb Beach Resort' },
    { id: 'branch-2', name: 'Nizwa Heritage Hotel' },
  ],
  departments: [{ id: 'dept-1', name: 'Front Office', branchId: 'branch-1' }],
  earliestPeriod: '2025-09-01',
  latestPeriod: '2026-02-01',
};

function metric(overrides: Partial<MetricAnalytics> = {}): MetricAnalytics {
  return {
    metricId: 'metric-1',
    code: 'revenue',
    name: 'Revenue',
    category: 'Financial',
    unit: 'CURRENCY',
    direction: 'HIGHER_IS_BETTER',
    aggregationType: 'SUM',
    formula: null,
    aggregation: 'SUM',
    current: '900',
    previous: '750',
    changePct: '20',
    target: '1000',
    targetPeriods: 3,
    comparedToTarget: '900',
    varianceToTargetPct: '-10',
    thresholdStatus: 'OK',
    series: [
      { periodStart: '2026-01-01', periodType: 'MONTH', value: '300' },
      { periodStart: '2026-02-01', periodType: 'MONTH', value: '600' },
    ],
    previousSeries: [],
    missingPeriods: 0,
    ...overrides,
  };
}

function overview(overrides: Partial<DashboardOverview> = {}): DashboardOverview {
  const revenue = metric();

  return {
    window: {
      from: '2025-09-01',
      to: '2026-02-01',
      previousFrom: '2025-03-01',
      previousTo: '2025-08-31',
      branchId: null,
      departmentId: null,
      branchName: null,
      departmentName: null,
    },
    kpis: [revenue],
    headline: revenue,
    performance: {
      ok: 2,
      warning: 1,
      critical: 0,
      unknown: 3,
      onTarget: 1,
      belowTarget: 2,
      withoutTarget: 3,
    },
    health: {
      modelName: 'Hospitality Health Model',
      overallScore: null,
      band: null,
      categories: [{ code: 'financial', name: 'Financial', weight: '30.000', score: null }],
    },
    dataQuality: null,
    attention: { alerts: [], insights: [], goals: [], decisions: [] },
    metricCount: 6,
    ...overrides,
  };
}

function renderDashboard(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/organizations/current': { body: organization },
    '/analytics/options': { body: options },
    '/dashboard/overview': { body: overview() },
    ...overrides,
  });

  renderWithProviders(<DashboardPage />, { route: '/dashboard' });

  return stubs;
}

describe('DashboardPage', () => {
  it('shows the KPI the API returned, with its change and target', async () => {
    renderDashboard();

    expect(await screen.findByText('Revenue')).toBeInTheDocument();
    expect(await screen.findByText('OMR 900.000')).toBeInTheDocument();
    expect(screen.getByText('+20%')).toBeInTheDocument();
    expect(screen.getByText('OMR 1,000.000')).toBeInTheDocument();
    expect(screen.getByText('(-10%)')).toBeInTheDocument();
  });

  it('states the window and the window it is compared with', async () => {
    renderDashboard();

    expect(
      await screen.findByText(
        '2025-09-01 to 2026-02-01, compared with 2025-03-01 to 2025-08-31, for the whole organization.',
      ),
    ).toBeInTheDocument();
  });

  it('sends the branch filter to every panel through one request', async () => {
    const { calls } = renderDashboard();

    await screen.findByText('Revenue');
    await userEvent.selectOptions(screen.getByLabelText('Branch'), 'branch-1');

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.url.includes('/dashboard/overview') && call.url.includes('branchId=branch-1'),
        ),
      ).toBe(true);
    });
  });

  it('applies a range preset against the latest period that has data', async () => {
    const { calls } = renderDashboard();

    await screen.findByText('Revenue');
    await userEvent.click(screen.getByRole('button', { name: 'Last 3 months' }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.includes('from=2025-12-01'));
      expect(call?.url).toContain('to=2026-02-01');
    });
  });

  it('clears the department when the branch changes, so the pair stays possible', async () => {
    const { calls } = renderDashboard();

    await screen.findByText('Revenue');
    await userEvent.selectOptions(screen.getByLabelText('Branch'), 'branch-1');
    await userEvent.selectOptions(await screen.findByLabelText('Department'), 'dept-1');
    await userEvent.selectOptions(screen.getByLabelText('Branch'), 'branch-2');

    await waitFor(() => {
      const last = calls.filter((call) => call.url.includes('/dashboard/overview')).at(-1);
      expect(last?.url).toContain('branchId=branch-2');
      expect(last?.url).not.toContain('departmentId');
    });
  });

  it('shows the health model without a score rather than a made-up one', async () => {
    renderDashboard();

    expect(await screen.findByText('Hospitality Health Model')).toBeInTheDocument();
    expect(screen.getByText('Not scored yet')).toBeInTheDocument();
  });

  it('says there have been no imports instead of scoring quality zero', async () => {
    renderDashboard();

    expect(await screen.findByText('No imports yet')).toBeInTheDocument();
  });

  it('explains an empty organization rather than showing zeros', async () => {
    renderDashboard({
      '/dashboard/overview': {
        body: overview({ kpis: [], headline: null, metricCount: 0, health: null }),
      },
    });

    expect(
      await screen.findByText(
        'No metrics have values in this range yet. Import data or widen the range.',
      ),
    ).toBeInTheDocument();
  });

  it('reports a failed load instead of an empty dashboard', async () => {
    renderDashboard({
      '/dashboard/overview': {
        status: 500,
        body: { code: 'INTERNAL_ERROR', message: 'boom', details: [] },
      },
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
