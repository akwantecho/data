import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationMemberSummary } from '@sip/shared-types';
import { TeamPage } from './TeamPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

function member(overrides: Partial<OrganizationMemberSummary> = {}): OrganizationMemberSummary {
  return {
    userId: 'user-1',
    email: 'admin@alpha-medical.local',
    fullName: 'Alpha Admin',
    role: 'ORGANIZATION_ADMIN',
    status: 'ACTIVE',
    isDefault: true,
    lastLoginAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

describe('TeamPage', () => {
  it('lists members with role and sign-in state', async () => {
    stubFetch({
      '/auth/me': { body: adminSession },
      '/organization-users': {
        body: [
          member(),
          member({
            userId: 'user-2',
            email: 'analyst@alpha.local',
            fullName: 'Ana Analyst',
            role: 'ANALYST',
          }),
        ],
      },
    });

    renderWithProviders(<TeamPage />, { route: '/settings/team' });

    expect(await screen.findByText('Alpha Admin')).toBeInTheDocument();
    expect(screen.getByText('Ana Analyst')).toBeInTheDocument();
    expect(screen.getAllByText('Never')).toHaveLength(2);
  });

  it('shows roles as plain text to a non-admin, with no actions', async () => {
    stubFetch({
      '/auth/me': { body: analystSession },
      '/organization-users': { body: [member()] },
    });

    renderWithProviders(<TeamPage />, { route: '/settings/team' });

    expect(await screen.findByText('Organization Admin')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
  });

  it('changes a role through the API', async () => {
    const { calls } = stubFetch({
      '/auth/me': { body: adminSession },
      '/organization-users': {
        body: [member({ userId: 'user-2', fullName: 'Ana Analyst', role: 'ANALYST' })],
      },
      '/organization-users/user-2': { body: member({ userId: 'user-2', role: 'VIEWER' }) },
    });

    renderWithProviders(<TeamPage />, { route: '/settings/team' });

    await userEvent.selectOptions(await screen.findByLabelText('Role for Ana Analyst'), 'VIEWER');

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith('/organization-users/user-2'));
      expect(call?.init?.method).toBe('PATCH');
      expect(call?.init?.body).toBe(JSON.stringify({ role: 'VIEWER' }));
    });
  });

  it('reports the last-administrator rule from the server', async () => {
    stubFetch({
      '/auth/me': { body: adminSession },
      '/organization-users': { body: [member()] },
      '/organization-users/user-1': {
        status: 409,
        body: {
          code: 'CONFLICT',
          message:
            'This is the only administrator. Promote another member before changing this one.',
          details: [],
        },
      },
    });

    renderWithProviders(<TeamPage />, { route: '/settings/team' });

    await userEvent.click(await screen.findByRole('button', { name: 'Leave' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('only administrator');
  });

  it('adds an existing user with only email and role', async () => {
    const { calls } = stubFetch({
      '/auth/me': { body: adminSession },
      '/organization-users': { body: [member()] },
    });

    renderWithProviders(<TeamPage />, { route: '/settings/team' });

    await userEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    await userEvent.type(screen.getByLabelText('Email'), 'existing@alpha.local');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'VIEWER');
    await userEvent.click(screen.getByRole('button', { name: 'Add to organization' }));

    await waitFor(() => {
      const call = calls.find(
        (entry) => entry.url.endsWith('/organization-users') && entry.init?.method === 'POST',
      );
      expect(call?.init?.body).toBe(
        JSON.stringify({ email: 'existing@alpha.local', role: 'VIEWER' }),
      );
    });
  });

  it('requires a long initial password when creating an account', async () => {
    const { calls } = stubFetch({
      '/auth/me': { body: adminSession },
      '/organization-users': { body: [member()] },
    });

    renderWithProviders(<TeamPage />, { route: '/settings/team' });

    await userEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    await userEvent.type(screen.getByLabelText('Email'), 'new@alpha.local');
    await userEvent.type(screen.getByLabelText('Initial password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Add to organization' }));

    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument();
    expect(calls.some((entry) => entry.init?.method === 'POST')).toBe(false);
  });
});
