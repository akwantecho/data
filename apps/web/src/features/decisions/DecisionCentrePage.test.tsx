import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionCentre } from '@sip/shared-types';
import { DecisionCentrePage } from './DecisionCentrePage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

const centre: DecisionCentre = {
  criticalIssues: [
    {
      id: 'alert-1',
      title: 'No-show rate above acceptable threshold',
      severity: 'CRITICAL',
      metricName: 'No-Show Rate',
      periodStart: '2026-03-01',
    },
  ],
  warnings: [
    {
      id: 'alert-2',
      title: 'Revenue target missed',
      severity: 'HIGH',
      metricName: 'Revenue',
      periodStart: '2026-03-01',
    },
  ],
  opportunities: [
    {
      id: 'insight-1',
      title: 'Demand is growing while capacity is spare',
      narrative: 'Appointment demand is rising while doctors are under three quarters utilized.',
      periodStart: '2026-03-01',
    },
  ],
  openDecisions: [
    {
      id: 'decision-1',
      title: 'Reduce paid advertising spend by 15%',
      problemStatement: 'Acquisition cost rose 28%.',
      context: null,
      ownerId: null,
      ownerName: null,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      decisionDate: '2026-03-20',
      expectedOutcome: null,
      reviewDate: null,
      notes: null,
      evidenceCount: 3,
      openActions: 1,
      totalActions: 2,
      lastReviewResult: null,
      createdAt: '2026-03-20T09:00:00.000Z',
      updatedAt: '2026-03-21T09:00:00.000Z',
    },
  ],
  recentlyReviewed: [],
  goalsAtRisk: [
    {
      id: 'goal-1',
      title: 'Lift quarterly revenue to 1,200',
      description: null,
      ownerId: null,
      ownerName: null,
      status: 'OFF_TRACK',
      baselineValue: '800',
      targetValue: '1200',
      currentValue: '850',
      progressPct: '12.5',
      expectedProgressPct: '80',
      startDate: '2026-01-01',
      dueDate: '2026-03-31',
      daysRemaining: 6,
      primaryMetric: null,
      supportingMetrics: [],
      createdAt: '2026-01-01T09:00:00.000Z',
      updatedAt: '2026-03-25T09:00:00.000Z',
    },
  ],
};

function renderCentre(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/decisions/centre': { body: centre },
    '/alerts': { body: { items: [], page: 1, pageSize: 25, total: 0 } },
    '/insights': { body: { items: [], page: 1, pageSize: 25, total: 0 } },
    '/metrics': { body: [] },
    '/goals': { body: [] },
    ...overrides,
  });

  renderWithProviders(<DecisionCentrePage />, { route: '/decisions' });

  return stubs;
}

describe('DecisionCentrePage', () => {
  it('gathers each section the plan asks for', async () => {
    renderCentre();

    expect(await screen.findByText('No-show rate above acceptable threshold')).toBeInTheDocument();
    expect(screen.getByText('Revenue target missed')).toBeInTheDocument();
    expect(screen.getByText('Demand is growing while capacity is spare')).toBeInTheDocument();
    expect(screen.getByText('Reduce paid advertising spend by 15%')).toBeInTheDocument();
    expect(screen.getByText('No decision has been reviewed yet.')).toBeInTheDocument();
  });

  it('shows a goal that has fallen behind against the pace it should be keeping', async () => {
    renderCentre();

    expect(await screen.findByText('Lift quarterly revenue to 1,200')).toBeInTheDocument();
    expect(screen.getByText('12.5% complete · 80% expected by now')).toBeInTheDocument();
    expect(screen.getByText('off track')).toBeInTheDocument();
  });

  it('carries an alert straight into a decision with itself as the evidence', async () => {
    renderCentre();

    const critical = (await screen.findByText('Critical issues')).closest('section');
    await userEvent.click(
      within(critical as HTMLElement).getByRole('button', { name: 'Decide on this' }),
    );

    // The dialog opens with the alert already cited — the point of the panel.
    expect(
      await screen.findByRole('heading', { name: 'Record a decision' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record decision' })).toBeEnabled();
  });

  it('will not let a decision be recorded with nothing behind it', async () => {
    renderCentre();

    await screen.findByText('Critical issues');
    await userEvent.click(screen.getByRole('button', { name: 'Record a decision' }));

    expect(
      await screen.findByRole('heading', { name: 'Record a decision' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record decision' })).toBeDisabled();
  });

  it('offers a viewer nothing to decide', async () => {
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
      '/decisions/centre': { body: centre },
    });

    renderWithProviders(<DecisionCentrePage />, { route: '/decisions' });

    await screen.findByText('No-show rate above acceptable threshold');
    expect(screen.queryByRole('button', { name: 'Record a decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decide on this' })).not.toBeInTheDocument();
  });

  it('reports a failure instead of an empty centre', async () => {
    renderCentre({
      '/decisions/centre': {
        status: 500,
        body: { code: 'INTERNAL_ERROR', message: 'boom', details: [] },
      },
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
