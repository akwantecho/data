import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IndustryPackDetail, IndustryPackSummary } from '@sip/shared-types';
import { PlatformPacksPage } from './PlatformPacksPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession({
  user: {
    id: 'user-1',
    email: 'platform@sip.local',
    fullName: 'Platform Administrator',
    platformRole: 'PLATFORM_ADMIN',
  },
  memberships: [],
  activeOrganizationId: null,
  activeRole: null,
});

const summary: IndustryPackSummary = {
  id: 'pack-1',
  code: 'healthcare_core',
  name: 'Healthcare Core',
  description: 'Default metrics, health model and rules for clinics.',
  version: '1.0.0',
  industryId: 'industry-1',
  industryName: 'Healthcare',
  metricCount: 11,
  insightRuleCount: 3,
  alertRuleCount: 3,
  healthCategoryCount: 5,
  installedVersion: null,
  installedAt: null,
};

const detail: IndustryPackDetail = {
  ...summary,
  metrics: [
    {
      code: 'revenue',
      name: 'Revenue',
      description: null,
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      formula: null,
    },
    {
      code: 'revenue_per_patient',
      name: 'Revenue per Patient',
      description: null,
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'FORMULA',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      formula: 'revenue / patients',
    },
  ],
  healthModel: {
    name: 'Healthcare Health Model',
    categories: [
      {
        code: 'financial',
        name: 'Financial',
        weight: '30',
        metrics: [{ code: 'revenue', weight: '50' }],
      },
    ],
  },
  insightRules: [
    {
      code: 'volume_up_monetization_down',
      name: 'Volume up, monetization down',
      description: null,
      severity: 'WARNING',
      metrics: ['appointments', 'revenue_per_patient'],
    },
  ],
  alertRules: [
    {
      code: 'no_show_rate_above_threshold',
      name: 'No-show rate above acceptable threshold',
      description: null,
      severity: 'WARNING',
      metrics: ['no_show_rate'],
    },
  ],
};

function renderPage(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/platform/industry-packs': { body: [summary] },
    '/platform/industry-packs/pack-1': { body: detail },
    ...overrides,
  });

  renderWithProviders(<PlatformPacksPage />, { route: '/platform/industry-packs' });

  return stubs;
}

describe('PlatformPacksPage', () => {
  it('lists the published packs with what each installs', async () => {
    renderPage();

    expect(await screen.findByText('Healthcare Core')).toBeInTheDocument();
    expect(screen.getByText('Healthcare')).toBeInTheDocument();
    expect(screen.getByText('3 insight, 3 alert')).toBeInTheDocument();
  });

  it('shows a pack’s metrics, health model and rules on request', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Inspect' }));

    expect(await screen.findByText('Formula: revenue / patients')).toBeInTheDocument();
    expect(screen.getByText('Healthcare Health Model')).toBeInTheDocument();
    expect(screen.getByText('Volume up, monetization down')).toBeInTheDocument();
    expect(screen.getByText('No-show rate above acceptable threshold')).toBeInTheDocument();
  });

  it('syncs the catalogue and says what changed', async () => {
    const { calls } = renderPage({
      '/platform/industry-packs/sync': {
        body: {
          packs: [
            {
              code: 'healthcare_core',
              version: '1.0.0',
              templateMetricsCreated: 0,
              templateMetricsUpdated: 11,
              insightRules: 3,
              alertRules: 3,
            },
          ],
        },
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Sync catalogue' }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/platform/industry-packs/sync'));
      expect(call?.init?.method).toBe('POST');
    });

    expect(
      await screen.findByText(/healthcare_core 1\.0\.0 \(\+0 new, 11 updated\)/),
    ).toBeInTheDocument();
  });

  it('reports a failed sync instead of claiming success', async () => {
    renderPage({
      '/platform/industry-packs/sync': {
        status: 500,
        body: { code: 'INTERNAL_ERROR', message: 'Industry pack "x" is invalid', details: [] },
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Sync catalogue' }));

    // An internal failure is shown generically on purpose — the server's own
    // message may name internals — but it is shown, and nothing claims success.
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText(/Catalogue synced/)).not.toBeInTheDocument();
  });
});
