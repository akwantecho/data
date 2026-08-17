import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IndustryPackOverview } from '@sip/shared-types';
import { IndustryPackCard } from './IndustryPackCard';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = buildSession();

function overview(overrides: Partial<IndustryPackOverview> = {}): IndustryPackOverview {
  return {
    industryId: 'industry-1',
    industryName: 'Healthcare',
    available: [
      {
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
      },
    ],
    healthModel: null,
    insightRuleCount: 0,
    alertRuleCount: 0,
    systemMetricCount: 0,
    ...overrides,
  };
}

const installed = overview({
  available: [
    {
      ...overview().available[0],
      installedVersion: '1.0.0',
      installedAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  systemMetricCount: 11,
  insightRuleCount: 3,
  alertRuleCount: 3,
  healthModel: {
    id: 'model-1',
    name: 'Healthcare Health Model',
    categories: [
      {
        code: 'financial',
        name: 'Financial',
        weight: '30.000',
        metrics: [
          { code: 'revenue', name: 'Revenue', weight: '50.000' },
          { code: 'revenue_per_patient', name: 'Revenue per Patient', weight: '50.000' },
        ],
      },
    ],
  },
});

function renderCard(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  const stubs = stubFetch({
    '/auth/me': { body: session },
    '/industry-packs': { body: overview() },
    ...overrides,
  });

  renderWithProviders(<IndustryPackCard />, { route: '/settings/organization' });

  return stubs;
}

describe('IndustryPackCard', () => {
  it('describes the pack that applies before it is installed', async () => {
    renderCard();

    expect(await screen.findByText('Healthcare Core')).toBeInTheDocument();
    expect(screen.getByText('Not installed')).toBeInTheDocument();
    expect(
      screen.getByText('11 metrics, 5 health categories, 3 insight rules and 3 alert rules.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install pack' })).toBeInTheDocument();
  });

  it('installs the pack and reports what it did', async () => {
    const { calls } = renderCard({
      '/industry-packs/pack-1/install': {
        body: {
          packCode: 'healthcare_core',
          version: '1.0.0',
          metricsCreated: 10,
          metricsKept: 1,
          healthModelCreated: true,
          healthCategoriesCreated: 5,
          insightRulesCreated: 3,
          insightRulesKept: 0,
          alertRulesCreated: 3,
          alertRulesKept: 0,
        },
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Install pack' }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/industry-packs/pack-1/install'));
      expect(call?.init?.method).toBe('POST');
    });

    // The count of metrics left alone is the reassurance that matters most.
    expect(
      await screen.findByText(/10 metrics added, 1 already present and left unchanged/),
    ).toBeInTheDocument();
  });

  it('shows the installed version and the health model it produced', async () => {
    renderCard({ '/industry-packs': { body: installed } });

    expect(await screen.findByText('Installed, version 1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Healthcare Health Model')).toBeInTheDocument();
    expect(screen.getByText('Revenue 50%, Revenue per Patient 50%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reinstall missing items' })).toBeInTheDocument();
  });

  it('asks for an industry when none is chosen', async () => {
    renderCard({
      '/industry-packs': {
        body: overview({ industryId: null, industryName: null, available: [] }),
      },
    });

    expect(
      await screen.findByText(
        'Select an industry to see the pack that applies to this organization.',
      ),
    ).toBeInTheDocument();
  });

  it('does not offer installation to an analyst', async () => {
    const analyst = buildSession({
      memberships: [
        {
          organizationId: 'org-1',
          organizationName: 'Alpha Medical Group',
          organizationSlug: 'alpha-medical',
          organizationStatus: 'ACTIVE',
          role: 'ANALYST',
          isDefault: true,
        },
      ],
      activeRole: 'ANALYST',
    });

    renderCard({ '/auth/me': { body: analyst } });

    expect(await screen.findByText('Healthcare Core')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install pack' })).not.toBeInTheDocument();
  });
});
