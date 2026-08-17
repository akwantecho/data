import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HealthCurrent } from '@sip/shared-types';
import { HealthPanel } from './HealthPanel';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

const health: HealthCurrent = {
  modelId: 'model-1',
  modelName: 'Clinic Health Model',
  bands: [
    { band: 'HEALTHY', min: 80, max: 100 },
    { band: 'ATTENTION', min: 60, max: 79.999999 },
    { band: 'RISK', min: 40, max: 59.999999 },
    { band: 'CRITICAL', min: 0, max: 39.999999 },
  ],
  current: {
    periodType: 'MONTH',
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    branchId: null,
    branchName: null,
    overallScore: 67.29,
    band: 'ATTENTION',
    categories: [
      {
        code: 'financial',
        name: 'Financial',
        weight: '60.000',
        effectiveWeight: '60.00',
        score: 75,
        band: 'ATTENTION',
        metrics: [
          {
            metricId: 'metric-1',
            code: 'revenue',
            name: 'Revenue',
            weight: '100.000',
            effectiveWeight: '100.00',
            value: '900',
            target: '1200',
            score: 75,
            basis: 'TARGET',
            contribution: 75,
          },
        ],
      },
      {
        code: 'operations',
        name: 'Operations',
        weight: '40.000',
        effectiveWeight: '40.00',
        score: 55.9,
        band: 'RISK',
        metrics: [
          {
            metricId: 'metric-2',
            code: 'no_show_rate',
            name: 'No-Show Rate',
            weight: '50.000',
            effectiveWeight: '100.00',
            value: '12',
            target: '6',
            score: 11.8,
            basis: 'TARGET_AND_THRESHOLDS',
            contribution: 11.8,
          },
          {
            metricId: 'metric-3',
            code: 'satisfaction',
            name: 'Satisfaction',
            weight: '50.000',
            effectiveWeight: '0',
            value: null,
            target: null,
            score: null,
            basis: 'NO_BENCHMARK',
            contribution: null,
          },
        ],
      },
    ],
    unscoredMetrics: 1,
    calculatedAt: '2026-03-01T09:00:00.000Z',
  },
  previous: null,
  changePoints: -4.2,
};

function renderPanel(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/health/current': { body: health },
    ...overrides,
  });

  renderWithProviders(<HealthPanel />, { route: '/dashboard' });

  return stubs;
}

describe('HealthPanel', () => {
  it('shows the score, its band and the move since the previous period', async () => {
    renderPanel();

    expect(await screen.findByText('67.29')).toBeInTheDocument();
    expect(screen.getByText('ATTENTION')).toBeInTheDocument();
    expect(screen.getByText(/-4.2 vs previous period/)).toBeInTheDocument();
  });

  it('lists the categories that produced it', async () => {
    renderPanel();

    expect(await screen.findByText('Financial')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('explains a category down to the metrics behind it', async () => {
    renderPanel();

    const rows = await screen.findAllByRole('button', { name: 'Why' });
    await userEvent.click(rows[1]);

    expect(await screen.findByText('No-Show Rate')).toBeInTheDocument();
    expect(screen.getByText('Target and thresholds')).toBeInTheDocument();
    // The metric that could not be scored says why rather than showing a zero.
    expect(screen.getByText('No target or threshold set')).toBeInTheDocument();
  });

  it('says when weights were redistributed, so the score still means 0–100', async () => {
    renderPanel();

    expect(
      await screen.findByText(/1 weighted metric could not be scored for this period/),
    ).toBeInTheDocument();
  });

  it('asks for a pack when no model is installed', async () => {
    renderPanel({
      '/health/current': {
        body: { ...health, modelId: null, modelName: null, current: null, changePoints: null },
      },
    });

    expect(
      await screen.findByText(
        'No health model is installed. Install the industry pack in settings.',
      ),
    ).toBeInTheDocument();
  });

  it('asks for data when the model has never been scored', async () => {
    renderPanel({
      '/health/current': { body: { ...health, current: null, changePoints: null } },
    });

    expect(await screen.findByText(/No score yet/)).toBeInTheDocument();
  });
});
