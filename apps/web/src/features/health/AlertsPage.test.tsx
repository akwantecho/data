import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertDetail, AlertSummary } from '@sip/shared-types';
import { AlertsPage } from './AlertsPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

function alert(overrides: Partial<AlertSummary> = {}): AlertSummary {
  return {
    id: 'alert-1',
    ruleCode: 'no_show_above',
    ruleName: 'No-show rate above threshold',
    ruleType: 'METRIC_ABOVE_THRESHOLD',
    metricId: 'metric-1',
    metricCode: 'no_show_rate',
    metricName: 'No-Show Rate',
    severity: 'CRITICAL',
    status: 'OPEN',
    title: 'No-Show Rate is above its critical threshold',
    description: 'No-Show Rate reached 12, which is above the critical threshold of 10.',
    periodType: 'MONTH',
    periodStart: '2026-02-01',
    evidence: {
      statement: '12 is above the critical threshold of 10.',
      figures: [
        { label: 'No-Show Rate', value: '12' },
        { label: 'Critical threshold', value: '10' },
        { label: 'Target', value: '6' },
      ],
    },
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
    ...overrides,
  };
}

const detail: AlertDetail = {
  ...alert(),
  events: [
    {
      id: 'event-1',
      fromStatus: null,
      toStatus: 'OPEN',
      note: 'Raised by the alerts engine.',
      actorName: null,
      createdAt: '2026-03-01T09:00:00.000Z',
    },
  ],
};

function renderAlerts(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/alerts': { body: { items: [alert()], page: 1, pageSize: 25, total: 1 } },
    '/alerts/alert-1': { body: detail },
    ...overrides,
  });

  renderWithProviders(<AlertsPage />, { route: '/alerts' });

  return stubs;
}

describe('AlertsPage', () => {
  it('lists the alert with its metric, period and severity', async () => {
    renderAlerts();

    expect(
      await screen.findByText('No-Show Rate is above its critical threshold'),
    ).toBeInTheDocument();
    expect(screen.getByText('2026-02-01')).toBeInTheDocument();
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByText('12 is above the critical threshold of 10.')).toBeInTheDocument();
  });

  it('opens the evidence that produced the alert', async () => {
    renderAlerts();

    await userEvent.click(await screen.findByRole('button', { name: 'Evidence' }));

    const drawer = await screen.findByRole('dialog');

    expect(drawer).toHaveTextContent('Critical threshold');
    expect(drawer).toHaveTextContent('10');
    expect(drawer).toHaveTextContent('Raised by the alerts engine.');
  });

  it('acknowledges an alert with a note', async () => {
    const { calls } = renderAlerts({
      '/alerts/alert-1/status': { body: { ...detail, status: 'ACKNOWLEDGED' } },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Evidence' }));
    await userEvent.type(
      await screen.findByLabelText('Note (optional)'),
      'Clinic manager is reviewing.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/alerts/alert-1/status'));
      expect(call?.init?.method).toBe('PATCH');
      expect(call?.init?.body).toBe(
        JSON.stringify({ status: 'ACKNOWLEDGED', note: 'Clinic manager is reviewing.' }),
      );
    });
  });

  it('filters by status', async () => {
    const { calls } = renderAlerts();

    await screen.findByText('No-Show Rate is above its critical threshold');
    await userEvent.click(screen.getByRole('button', { name: 'Resolved' }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('status=RESOLVED'))).toBe(true);
    });
  });

  it('offers no decision to a viewer', async () => {
    const viewer = buildSession({
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

    renderAlerts({ '/auth/me': { body: viewer } });

    await userEvent.click(await screen.findByRole('button', { name: 'Evidence' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
  });

  it('says so when there is nothing to show', async () => {
    renderAlerts({ '/alerts': { body: { items: [], page: 1, pageSize: 25, total: 0 } } });

    expect(
      await screen.findByText('No open alerts. Rules are evaluated after every import.'),
    ).toBeInTheDocument();
  });

  it('offers no reopening of an alert someone already closed', async () => {
    renderAlerts({
      '/alerts/alert-1': { body: { ...detail, status: 'RESOLVED' } },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Evidence' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});
