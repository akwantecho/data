import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BranchSummary } from '@sip/shared-types';
import { BranchesPage } from './BranchesPage';
import { buildSession, renderWithProviders, stubFetch } from '../../test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

function branch(overrides: Partial<BranchSummary> = {}): BranchSummary {
  return {
    id: 'branch-1',
    name: 'Muscat Clinic',
    code: 'muscat',
    countryCode: 'OM',
    timezone: 'Asia/Muscat',
    isActive: true,
    departmentCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const adminSession = buildSession();
const viewerSession = buildSession({
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

describe('BranchesPage', () => {
  it('lists branches with their status', async () => {
    stubFetch({
      '/auth/me': { body: adminSession },
      '/branches?includeInactive=true': {
        body: [
          branch(),
          branch({ id: 'branch-2', name: 'Closed', code: 'closed', isActive: false }),
        ],
      },
    });

    renderWithProviders(<BranchesPage />, { route: '/settings/branches' });

    expect(await screen.findByText('Muscat Clinic')).toBeInTheDocument();
    const closedRow = screen.getByText('Closed').closest('tr') as HTMLElement;
    expect(within(closedRow).getByText('Inactive')).toBeInTheDocument();
  });

  it('shows an empty state when there are no branches', async () => {
    stubFetch({
      '/auth/me': { body: adminSession },
      '/branches?includeInactive=true': { body: [] },
    });

    renderWithProviders(<BranchesPage />, { route: '/settings/branches' });

    expect(await screen.findByText(/No branches yet/)).toBeInTheDocument();
  });

  it('hides every editing control from a viewer', async () => {
    stubFetch({
      '/auth/me': { body: viewerSession },
      '/branches?includeInactive=true': { body: [branch()] },
    });

    renderWithProviders(<BranchesPage />, { route: '/settings/branches' });

    expect(await screen.findByText('Muscat Clinic')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add branch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('creates a branch, sending null for the fields left blank', async () => {
    const { calls } = stubFetch({
      '/auth/me': { body: adminSession },
      '/branches?includeInactive=true': { body: [] },
      '/branches': { body: branch() },
    });

    renderWithProviders(<BranchesPage />, { route: '/settings/branches' });

    await userEvent.click(await screen.findByRole('button', { name: 'Add branch' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Salalah Clinic');
    await userEvent.type(screen.getByLabelText('Code'), 'salalah');
    await userEvent.click(screen.getByRole('button', { name: 'Save branch' }));

    await waitFor(() => {
      const call = calls.find(
        (entry) => entry.url.endsWith('/branches') && entry.init?.method === 'POST',
      );
      expect(call?.init?.body).toBe(
        JSON.stringify({
          name: 'Salalah Clinic',
          code: 'salalah',
          countryCode: null,
          timezone: null,
        }),
      );
    });
  });

  it('validates the code before calling the API', async () => {
    const { calls } = stubFetch({
      '/auth/me': { body: adminSession },
      '/branches?includeInactive=true': { body: [] },
    });

    renderWithProviders(<BranchesPage />, { route: '/settings/branches' });

    await userEvent.click(await screen.findByRole('button', { name: 'Add branch' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Bad Code');
    await userEvent.type(screen.getByLabelText('Code'), 'has spaces');
    await userEvent.click(screen.getByRole('button', { name: 'Save branch' }));

    expect(
      await screen.findByText('Use letters, numbers, hyphens and underscores'),
    ).toBeInTheDocument();
    expect(calls.some((entry) => entry.init?.method === 'POST')).toBe(false);
  });

  it('surfaces the server message when a code is already taken', async () => {
    stubFetch({
      '/auth/me': { body: adminSession },
      '/branches?includeInactive=true': { body: [] },
      '/branches': {
        status: 409,
        body: {
          code: 'CONFLICT',
          message: 'The code "muscat" is already used in this organization.',
          details: [],
        },
      },
    });

    renderWithProviders(<BranchesPage />, { route: '/settings/branches' });

    await userEvent.click(await screen.findByRole('button', { name: 'Add branch' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Duplicate');
    await userEvent.type(screen.getByLabelText('Code'), 'muscat');
    await userEvent.click(screen.getByRole('button', { name: 'Save branch' }));

    expect(
      await screen.findByText('The code "muscat" is already used in this organization.'),
    ).toBeInTheDocument();
  });

  it('explains why a branch with history cannot be deleted', async () => {
    stubFetch({
      '/auth/me': { body: adminSession },
      '/branches?includeInactive=true': { body: [branch()] },
      '/branches/branch-1': {
        status: 409,
        body: {
          code: 'CONFLICT',
          message: 'This branch has reported data and cannot be deleted. Deactivate it instead.',
          details: [],
        },
      },
    });

    renderWithProviders(<BranchesPage />, { route: '/settings/branches' });

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This branch has reported data and cannot be deleted.',
    );
  });
});
