import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMenu } from './UserMenu';
import { buildSession, renderWithProviders, stubFetch } from '../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const twoMemberships = buildSession({
  memberships: [
    {
      organizationId: 'org-1',
      organizationName: 'Alpha Medical Group',
      organizationSlug: 'alpha-medical',
      organizationStatus: 'ACTIVE',
      role: 'ORGANIZATION_ADMIN',
      isDefault: true,
    },
    {
      organizationId: 'org-2',
      organizationName: 'Azure Coast Resorts',
      organizationSlug: 'azure-resorts',
      organizationStatus: 'ACTIVE',
      role: 'ANALYST',
      isDefault: false,
    },
  ],
});

describe('UserMenu', () => {
  it('shows the user, organization and role', async () => {
    stubFetch({ '/auth/me': { body: buildSession() } });
    renderWithProviders(<UserMenu />);

    expect(await screen.findByText('Alpha Admin')).toBeInTheDocument();
    expect(screen.getByText('Alpha Medical Group · Organization Admin')).toBeInTheDocument();
  });

  it('labels platform staff without an organization', async () => {
    stubFetch({
      '/auth/me': {
        body: buildSession({
          user: {
            id: 'user-9',
            email: 'platform@sip.local',
            fullName: 'Platform Administrator',
            platformRole: 'PLATFORM_ADMIN',
          },
          memberships: [],
          activeOrganizationId: null,
          activeRole: null,
        }),
      },
    });
    renderWithProviders(<UserMenu />);

    expect(await screen.findByText('Platform · Platform administrator')).toBeInTheDocument();
  });

  it('offers no organization switcher for a single membership', async () => {
    stubFetch({ '/auth/me': { body: buildSession() } });
    renderWithProviders(<UserMenu />);

    await userEvent.click(await screen.findByRole('button', { name: /Alpha Admin/ }));

    expect(screen.queryByText('Switch organization')).not.toBeInTheDocument();
  });

  it('switches organization through the API', async () => {
    // The server re-scopes the session, so subsequent /auth/me calls follow suit.
    const switched = buildSession({
      ...twoMemberships,
      activeOrganizationId: 'org-2',
      activeRole: 'ANALYST',
    });
    let current = twoMemberships;

    const { calls } = stubFetch({
      '/auth/me': { body: () => current },
      '/auth/switch-organization': {
        body: () => {
          current = switched;
          return switched;
        },
      },
    });
    renderWithProviders(<UserMenu />);

    await userEvent.click(await screen.findByRole('button', { name: /Alpha Admin/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Azure Coast Resorts/ }));

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/auth/switch-organization'));
      expect(call?.init?.body).toBe(JSON.stringify({ organizationId: 'org-2' }));
    });

    expect(await screen.findByText('Azure Coast Resorts · Analyst')).toBeInTheDocument();
  });

  it('does not offer to switch to the organization already active', async () => {
    stubFetch({ '/auth/me': { body: twoMemberships } });
    renderWithProviders(<UserMenu />);

    await userEvent.click(await screen.findByRole('button', { name: /Alpha Admin/ }));

    expect(screen.getByRole('menuitem', { name: /Alpha Medical Group/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /Azure Coast Resorts/ })).toBeEnabled();
  });

  it('signs out through the API', async () => {
    const { calls } = stubFetch({
      '/auth/me': { body: buildSession() },
      '/auth/logout': { status: 204 },
    });
    renderWithProviders(<UserMenu />);

    await userEvent.click(await screen.findByRole('button', { name: /Alpha Admin/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => {
      expect(calls.some((entry) => entry.url.endsWith('/auth/logout'))).toBe(true);
    });
  });
});
