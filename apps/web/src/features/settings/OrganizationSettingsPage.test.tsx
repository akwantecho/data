import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationSummary } from '@sip/shared-types';
import { OrganizationSettingsPage } from './OrganizationSettingsPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const organization: OrganizationSummary = {
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

const industries = [
  { id: 'industry-1', code: 'healthcare', name: 'Healthcare', description: null },
  { id: 'industry-2', code: 'hospitality', name: 'Hospitality & Tourism', description: null },
];

const adminSession = buildSession();
const analystSession = buildSession({
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

function stubSettings(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  return stubFetch({
    '/auth/me': { body: adminSession },
    '/organizations/current': { body: organization },
    '/industries': { body: industries },
    ...overrides,
  });
}

describe('OrganizationSettingsPage', () => {
  it('shows the organization profile', async () => {
    stubSettings();

    renderWithProviders(<OrganizationSettingsPage />, { route: '/settings/organization' });

    expect(await screen.findByLabelText('Name')).toHaveValue('Alpha Medical Group');
    expect(screen.getByLabelText('Currency')).toHaveValue('OMR');
    expect(screen.getByText('No industry selected yet.', { exact: false })).toBeInTheDocument();
  });

  it('saves only the profile fields', async () => {
    const { calls } = stubSettings();

    renderWithProviders(<OrganizationSettingsPage />, { route: '/settings/organization' });

    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Alpha Medical Holdings');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.init?.method === 'PATCH');
      expect(JSON.parse(String(call?.init?.body))).toEqual({
        name: 'Alpha Medical Holdings',
        countryCode: 'OM',
        currencyCode: 'OMR',
        timezone: 'Asia/Muscat',
      });
    });
  });

  it('validates the currency code locally', async () => {
    const { calls } = stubSettings();

    renderWithProviders(<OrganizationSettingsPage />, { route: '/settings/organization' });

    const currency = await screen.findByLabelText('Currency');
    await userEvent.clear(currency);
    await userEvent.type(currency, 'OMRX');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Use a 3-letter ISO code')).toBeInTheDocument();
    expect(calls.some((entry) => entry.init?.method === 'PATCH')).toBe(false);
  });

  it('sets the industry', async () => {
    const { calls } = stubSettings({
      '/organizations/current/industry': { body: { ...organization, industryId: 'industry-2' } },
    });

    renderWithProviders(<OrganizationSettingsPage />, { route: '/settings/organization' });

    await userEvent.selectOptions(await screen.findByLabelText('Industry'), 'industry-2');

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/organizations/current/industry'));
      expect(call?.init?.method).toBe('PUT');
      expect(call?.init?.body).toBe(JSON.stringify({ industryId: 'industry-2' }));
    });
  });

  it('explains why the industry is locked once data exists', async () => {
    stubSettings({
      '/organizations/current/industry': {
        status: 409,
        body: {
          code: 'CONFLICT',
          message:
            'The industry cannot be changed after data has been imported. Contact platform support.',
          details: [],
        },
      },
    });

    renderWithProviders(<OrganizationSettingsPage />, { route: '/settings/organization' });

    await userEvent.selectOptions(await screen.findByLabelText('Industry'), 'industry-1');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The industry cannot be changed after data has been imported.',
    );
  });

  it('is read-only for an analyst', async () => {
    stubFetch({
      '/auth/me': { body: analystSession },
      '/organizations/current': { body: organization },
      '/industries': { body: industries },
    });

    renderWithProviders(<OrganizationSettingsPage />, { route: '/settings/organization' });

    expect(await screen.findByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Industry')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Only an organization administrator can change these details.'),
    ).toBeInTheDocument();
  });
});
