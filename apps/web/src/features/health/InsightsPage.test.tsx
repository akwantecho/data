import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InsightSummary } from '@sip/shared-types';
import { InsightsPage } from './InsightsPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

const insight: InsightSummary = {
  id: 'insight-1',
  ruleCode: 'volume_up_monetization_down',
  ruleName: 'Volume up, monetization down',
  title: 'Volume up, monetization down',
  narrative:
    'Patient volume is increasing but monetization per patient is declining. Check pricing and case mix.',
  category: 'Financial',
  severity: 'WARNING',
  periodType: 'MONTH',
  periodStart: '2026-02-01',
  evidence: [
    {
      metricId: 'metric-1',
      label: 'Patients',
      value: '120',
      changePct: '20.0000',
      detail: { measure: 'CHANGE_PCT', operator: 'GT', threshold: 0, actual: 20 },
    },
    {
      metricId: 'metric-2',
      label: 'Revenue per Patient',
      value: '7.5',
      changePct: '-25.0000',
      detail: { measure: 'CHANGE_PCT', operator: 'LT', threshold: 0, actual: -25 },
    },
    { metricId: 'metric-3', label: 'Revenue', value: '900', changePct: '-10.0000', detail: null },
  ],
  createdAt: '2026-03-01T09:00:00.000Z',
};

function renderInsights(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/insights': { body: { items: [insight], page: 1, pageSize: 25, total: 1 } },
    ...overrides,
  });

  renderWithProviders(<InsightsPage />, { route: '/insights' });

  return stubs;
}

describe('InsightsPage', () => {
  it('shows the narrative the rule was written with', async () => {
    renderInsights();

    expect(await screen.findByText('Volume up, monetization down')).toBeInTheDocument();
    expect(screen.getByText(/monetization per patient is declining/)).toBeInTheDocument();
    expect(
      screen.getByText(/Financial · 2026-02-01 · rule volume_up_monetization_down/),
    ).toBeInTheDocument();
  });

  it('shows the figures behind it, and what each condition read', async () => {
    renderInsights();

    expect(await screen.findByText('Patients')).toBeInTheDocument();
    expect(screen.getByText('+20%')).toBeInTheDocument();
    expect(screen.getByText('change pct above 0')).toBeInTheDocument();
    expect(screen.getByText('change pct below 0')).toBeInTheDocument();
    // A figure quoted for context, not tested by a condition, says so.
    expect(screen.getByText('Quoted as context')).toBeInTheDocument();
  });

  it('links each metric to its analytics', async () => {
    renderInsights();

    const link = await screen.findByRole('link', { name: 'Patients' });

    expect(link).toHaveAttribute('href', '/analytics?metric=metric-1');
  });

  it('says so when nothing has been noticed yet', async () => {
    renderInsights({ '/insights': { body: { items: [], page: 1, pageSize: 25, total: 0 } } });

    expect(
      await screen.findByText('No insights yet. Rules are evaluated after every import.'),
    ).toBeInTheDocument();
  });

  it('reports a failure instead of an empty feed', async () => {
    renderInsights({
      '/insights': {
        status: 500,
        body: { code: 'INTERNAL_ERROR', message: 'boom', details: [] },
      },
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
