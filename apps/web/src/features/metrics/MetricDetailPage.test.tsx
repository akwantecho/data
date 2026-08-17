import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MetricDetail } from '@sip/shared-types';
import { MetricDetailPage } from './MetricDetailPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

// ECharts needs layout APIs jsdom does not implement; the chart itself is not
// what these tests are about.
vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="trend-chart" />,
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
  name: 'Alpha Medical Group',
  slug: 'alpha-medical',
  industryId: null,
  industryName: null,
  countryCode: 'OM',
  currencyCode: 'OMR',
  timezone: 'Asia/Muscat',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function detail(overrides: Partial<MetricDetail> = {}): MetricDetail {
  return {
    metric: {
      id: 'metric-1',
      code: 'revenue',
      name: 'Revenue',
      description: null,
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      isCalculated: false,
      formula: null,
      isSystem: false,
      isActive: true,
      valueCount: 2,
      latestValue: null,
    },
    dependencies: [],
    dependents: ['net_margin'],
    currentValue: {
      periodType: 'MONTH',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      value: '128400',
      branchId: null,
      branchName: null,
      departmentId: null,
      departmentName: null,
      isCalculated: false,
      sourceType: 'CSV',
      updatedAt: '2026-03-01T09:00:00.000Z',
    },
    previousValue: {
      periodType: 'MONTH',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      value: '116900',
      branchId: null,
      branchName: null,
      departmentId: null,
      departmentName: null,
      isCalculated: false,
      sourceType: 'CSV',
      updatedAt: '2026-02-01T09:00:00.000Z',
    },
    changePct: '9.84',
    target: {
      id: 'target-1',
      periodType: 'MONTH',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      targetValue: '130000',
      minValue: null,
      maxValue: null,
      branchId: null,
    },
    varianceToTargetPct: '-1.23',
    threshold: { warningValue: '120000', criticalValue: '100000', isRelativeToTarget: false },
    thresholdStatus: 'OK',
    trend: [],
    lastUpdatedAt: '2026-03-01T09:00:00.000Z',
    ...overrides,
  };
}

function renderDetail(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/organizations/current': { body: organization },
    '/metrics/metric-1': { body: detail() },
    ...overrides,
  });

  renderWithProviders(
    <Routes>
      <Route path="/metrics/:id" element={<MetricDetailPage />} />
    </Routes>,
    { route: '/metrics/metric-1' },
  );

  return stubs;
}

describe('MetricDetailPage', () => {
  it('shows the value, change, target and variance the API calculated', async () => {
    renderDetail();

    expect(await screen.findByText('Revenue')).toBeInTheDocument();
    // Formatted in the organization's currency, at that currency's own precision:
    // the Omani rial has three decimal places, not the assumed two (plan §10). The
    // profile loads separately, so this waits for it rather than assuming order.
    expect(await screen.findByText('OMR 128,400.000')).toBeInTheDocument();
    expect(screen.getByText('OMR 116,900.000')).toBeInTheDocument();
    expect(screen.getByText('+9.8%')).toBeInTheDocument();
    expect(screen.getByText('OMR 130,000.000')).toBeInTheDocument();
    expect(screen.getByText('-1.2% to target')).toBeInTheDocument();
  });

  it('reports the threshold status', async () => {
    renderDetail();

    expect(await screen.findByText('OK')).toBeInTheDocument();
  });

  it('shows a breached threshold as a negative badge', async () => {
    renderDetail({
      '/metrics/metric-1': { body: detail({ thresholdStatus: 'CRITICAL' }) },
    });

    expect(await screen.findByText('CRITICAL')).toBeInTheDocument();
  });

  it('shows a calculated metric’s formula and its dependencies', async () => {
    const calculated = detail();
    calculated.metric = {
      ...calculated.metric,
      name: 'Net Margin',
      isCalculated: true,
      formula: 'net_profit / revenue * 100',
      unit: 'PERCENTAGE',
    };
    calculated.dependencies = ['net_profit', 'revenue'];

    renderDetail({ '/metrics/metric-1': { body: calculated } });

    expect(await screen.findByText('Calculated: net_profit / revenue * 100')).toBeInTheDocument();
    expect(screen.getByText('net_profit, revenue')).toBeInTheDocument();
  });

  it('does not offer manual entry for a calculated metric', async () => {
    const calculated = detail();
    calculated.metric = { ...calculated.metric, isCalculated: true, formula: 'a / b' };

    renderDetail({ '/metrics/metric-1': { body: calculated } });

    expect(await screen.findByRole('button', { name: 'Set target' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter value' })).not.toBeInTheDocument();
  });

  it('records a manual value', async () => {
    const { calls } = renderDetail({
      '/metrics/metric-1/values': { body: detail().currentValue },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Enter value' }));
    await userEvent.type(screen.getByLabelText('Period'), '2026-03');
    await userEvent.type(screen.getByLabelText('Value'), '131000');
    await userEvent.click(screen.getByRole('button', { name: 'Save value' }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/metrics/metric-1/values'));
      expect(call?.init?.method).toBe('POST');
      expect(call?.init?.body).toBe(JSON.stringify({ period: '2026-03', value: '131000' }));
    });
  });

  it('validates a manual value before sending it', async () => {
    const { calls } = renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Enter value' }));
    await userEvent.type(screen.getByLabelText('Period'), '2026-03');
    await userEvent.type(screen.getByLabelText('Value'), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Save value' }));

    expect(await screen.findByText('Enter a number, e.g. 1250.75')).toBeInTheDocument();
    expect(calls.some((entry) => entry.url.endsWith('/metrics/metric-1/values'))).toBe(false);
  });

  it('surfaces the server’s reason when a period does not fit the frequency', async () => {
    renderDetail({
      '/metrics/metric-1/values': {
        status: 400,
        body: {
          code: 'VALIDATION_ERROR',
          message: 'The request could not be processed.',
          details: [{ field: 'period', message: '"Revenue" is reported monthly' }],
        },
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Enter value' }));
    await userEvent.type(screen.getByLabelText('Period'), '2026-03-15');
    await userEvent.type(screen.getByLabelText('Value'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save value' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('reported monthly');
  });

  it('sets a target', async () => {
    const { calls } = renderDetail({
      '/metrics/metric-1/target': { body: detail().target },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Set target' }));
    await userEvent.type(screen.getByLabelText('Period'), '2026-03');
    await userEvent.type(screen.getByLabelText('Target'), '135000');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/metrics/metric-1/target'));
      expect(call?.init?.method).toBe('PUT');
      expect(call?.init?.body).toBe(JSON.stringify({ period: '2026-03', targetValue: '135000' }));
    });
  });

  it('explains the threshold direction before it is set', async () => {
    const lower = detail();
    lower.metric = { ...lower.metric, direction: 'LOWER_IS_BETTER' };

    renderDetail({ '/metrics/metric-1': { body: lower } });

    await userEvent.click(await screen.findByRole('button', { name: 'Set thresholds' }));

    expect(
      screen.getByText(/better when lower, so a value above a threshold is a breach/),
    ).toBeInTheDocument();
  });

  it('hides every editing control from a viewer', async () => {
    const viewerSession = buildSession({
      memberships: [
        {
          organizationId: 'org-1',
          organizationName: 'Alpha Medical Group',
          organizationSlug: 'alpha-medical',
          organizationStatus: 'ACTIVE',
          role: 'VIEWER',
          isDefault: true,
        },
      ],
      activeRole: 'VIEWER',
    });

    renderDetail({ '/auth/me': { body: viewerSession } });

    expect(await screen.findByText('Revenue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter value' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set target' })).not.toBeInTheDocument();
  });
});
