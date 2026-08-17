import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionDetail } from '@sip/shared-types';
import { DecisionDetailPage } from './DecisionDetailPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

  return { ...actual, useParams: () => ({ id: 'decision-1' }) };
});

const session = buildSession();

function buildDecision(overrides: Partial<DecisionDetail> = {}): DecisionDetail {
  return {
    id: 'decision-1',
    title: 'Reduce paid advertising spend by 15%',
    problemStatement: 'Customer acquisition cost increased 28% against the prior quarter.',
    context: 'Agreed at the March management meeting.',
    ownerId: 'user-1',
    ownerName: 'Alpha Admin',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    decisionDate: '2026-03-20',
    expectedOutcome: 'Improve contribution margin within 60 days.',
    reviewDate: '2026-05-20',
    notes: null,
    evidenceCount: 3,
    openActions: 1,
    totalActions: 2,
    lastReviewResult: null,
    createdAt: '2026-03-20T09:00:00.000Z',
    updatedAt: '2026-03-21T09:00:00.000Z',
    evidence: {
      metrics: [
        { metricId: 'metric-1', code: 'revenue', name: 'Revenue', unit: 'CURRENCY' },
      ],
      alerts: [
        {
          alertId: 'alert-1',
          title: 'Revenue target missed',
          severity: 'HIGH',
          periodStart: '2026-03-01',
        },
      ],
      insights: [],
      goals: [
        {
          goalId: 'goal-1',
          title: 'Lift quarterly revenue to 1,200',
          status: 'AT_RISK',
          progressPct: '25',
        },
      ],
    },
    actions: [
      {
        id: 'action-1',
        title: 'Pause the two lowest-performing campaigns',
        description: null,
        ownerId: 'user-1',
        ownerName: 'Alpha Admin',
        dueDate: '2026-04-01',
        isCompleted: false,
        completedAt: null,
      },
    ],
    reviews: [],
    ...overrides,
  };
}

function renderDecision(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/decisions/decision-1': { body: buildDecision() },
    ...overrides,
  });

  renderWithProviders(<DecisionDetailPage />, { route: '/decisions/decision-1' });

  return stubs;
}

describe('DecisionDetailPage', () => {
  it('shows the evidence the decision was taken on, each linked back to its record', async () => {
    renderDecision();

    expect(await screen.findByText('Revenue target missed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revenue' })).toHaveAttribute(
      'href',
      '/metrics/metric-1',
    );
    expect(screen.getByRole('link', { name: 'Lift quarterly revenue to 1,200' })).toHaveAttribute(
      'href',
      '/goals/goal-1',
    );
    expect(screen.getByText('at risk · 25%')).toBeInTheDocument();
  });

  it('shows the outcome the decision was expected to produce', async () => {
    renderDecision();

    expect(
      await screen.findByText('Expected outcome: Improve contribution margin within 60 days.'),
    ).toBeInTheDocument();
  });

  it('records a review against that expectation', async () => {
    const reviewed = buildDecision({
      lastReviewResult: 'POSITIVE',
      reviews: [
        {
          id: 'review-1',
          expectedOutcome: 'Improve contribution margin within 60 days.',
          actualOutcome: 'Margin improved 4 points.',
          result: 'POSITIVE',
          notes: null,
          reviewerName: 'Alpha Admin',
          reviewedAt: '2026-05-21T09:00:00.000Z',
        },
      ],
    });

    const { calls } = renderDecision({ '/decisions/decision-1/review': { body: reviewed } });

    await screen.findByText('Revenue target missed');

    await userEvent.type(
      screen.getByLabelText('What actually happened'),
      'Margin improved 4 points.',
    );
    await userEvent.selectOptions(screen.getByLabelText('Result'), 'POSITIVE');
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/decisions/decision-1/review'));
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.init?.body))).toMatchObject({
        actualOutcome: 'Margin improved 4 points.',
        result: 'POSITIVE',
      });
    });
  });

  it('shows a past review with the expectation it was judged against', async () => {
    renderDecision({
      '/decisions/decision-1': {
        body: buildDecision({
          reviews: [
            {
              id: 'review-1',
              expectedOutcome: 'Improve contribution margin within 60 days.',
              actualOutcome: 'Margin improved 4 points.',
              result: 'POSITIVE',
              notes: 'Spend was cut as planned.',
              reviewerName: 'Alpha Admin',
              reviewedAt: '2026-05-21T09:00:00.000Z',
            },
          ],
        }),
      },
    });

    expect(await screen.findByText('Margin improved 4 points.')).toBeInTheDocument();
    expect(
      screen.getByText('Expected at the time: Improve contribution margin within 60 days.'),
    ).toBeInTheDocument();
  });

  it('will not offer a review on a decision that has not been taken', async () => {
    renderDecision({
      '/decisions/decision-1': { body: buildDecision({ status: 'DRAFT' }) },
    });

    expect(
      await screen.findByText('A decision that has not been taken yet cannot be reviewed.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record review' })).not.toBeInTheDocument();
  });

  it('completes an action against the decision', async () => {
    const { calls } = renderDecision({
      '/decisions/decision-1/actions/action-1': {
        body: buildDecision({ openActions: 0 }),
      },
    });

    await screen.findByText('Revenue target missed');
    await userEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/actions/action-1'));
      expect(JSON.parse(String(call?.init?.body))).toEqual({ isCompleted: true });
    });
  });

  it('reports a failure instead of a blank decision', async () => {
    renderDecision({
      '/decisions/decision-1': {
        status: 404,
        body: { code: 'NOT_FOUND', message: 'Decision not found.', details: [] },
      },
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
