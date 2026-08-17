import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalSummary } from '@sip/shared-types';
import { GoalsPage } from './GoalsPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

function buildGoal(overrides: Partial<GoalSummary> = {}): GoalSummary {
  return {
    id: 'goal-1',
    title: 'Lift quarterly revenue to 1,200',
    description: 'The board target for the first quarter.',
    ownerId: 'user-1',
    ownerName: 'Alpha Admin',
    status: 'AT_RISK',
    baselineValue: '800',
    targetValue: '1200',
    currentValue: '900',
    progressPct: '25',
    expectedProgressPct: '45',
    startDate: '2026-01-01',
    dueDate: '2026-03-31',
    daysRemaining: 20,
    primaryMetric: {
      metricId: 'metric-1',
      code: 'revenue',
      name: 'Revenue',
      unit: 'CURRENCY',
      isPrimary: true,
    },
    supportingMetrics: [],
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-03-11T09:00:00.000Z',
    ...overrides,
  };
}

function renderGoals(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/goals': { body: [buildGoal()] },
    ...overrides,
  });

  renderWithProviders(<GoalsPage />, { route: '/goals' });

  return stubs;
}

describe('GoalsPage', () => {
  it('shows progress against the pace the calendar expects', async () => {
    renderGoals();

    expect(await screen.findByText('Lift quarterly revenue to 1,200')).toBeInTheDocument();
    // Position alone would not say whether the goal is going well; the pace does.
    expect(screen.getByText('25% complete · 45% expected by now')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('at risk')).toBeInTheDocument();
  });

  it('says which metric the figure came from, so nobody thinks it was typed', async () => {
    renderGoals();

    // Formatted with the metric's own unit and the organization's currency, never
    // as a bare number.
    expect(await screen.findByText(/Revenue: \$900\.00 of \$1,200\.00/)).toBeInTheDocument();
    expect(screen.getByText(/20 days left/)).toBeInTheDocument();
  });

  it('says a goal without a metric is tracked by hand', async () => {
    renderGoals({
      '/goals': {
        body: [buildGoal({ primaryMetric: null, progressPct: null, expectedProgressPct: null })],
      },
    });

    expect(await screen.findByText(/no metric linked/)).toBeInTheDocument();
    expect(screen.getByText('No progress recorded')).toBeInTheDocument();
  });

  it('filters by status through the API rather than in the browser', async () => {
    const { calls } = renderGoals();

    await screen.findByText('Lift quarterly revenue to 1,200');
    await userEvent.click(screen.getByRole('button', { name: 'At risk' }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/goals?status=AT_RISK'))).toBe(true);
    });
  });

  it('reports what a recalculation actually did', async () => {
    renderGoals({
      '/goals/recalculate': { body: { evaluated: 4, changed: 0, achieved: 0 } },
    });

    await screen.findByText('Lift quarterly revenue to 1,200');
    await userEvent.click(screen.getByRole('button', { name: 'Recalculate' }));

    expect(
      await screen.findByText('Checked 4 goals; nothing has moved since the last run.'),
    ).toBeInTheDocument();
  });

  it('offers a viewer nothing to change', async () => {
    stubFetch({
      '/auth/me': {
        body: buildSession({
          activeRole: 'VIEWER',
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
        }),
      },
      '/goals': { body: [buildGoal()] },
    });

    renderWithProviders(<GoalsPage />, { route: '/goals' });

    await screen.findByText('Lift quarterly revenue to 1,200');
    expect(screen.queryByRole('button', { name: 'Set a goal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
  });

  it('says so when there are no goals yet', async () => {
    renderGoals({ '/goals': { body: [] } });

    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument();
  });

  it('reports a failure instead of an empty list', async () => {
    renderGoals({
      '/goals': { status: 500, body: { code: 'INTERNAL_ERROR', message: 'boom', details: [] } },
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
