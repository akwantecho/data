import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SessionResponse } from '@sip/shared-types';
import { SessionProvider } from './features/auth/SessionProvider';

/** Renders a tree with the providers the app uses, isolated per test. */
export function renderWithProviders(
  ui: ReactNode,
  options: { route?: string; withSession?: boolean } = {},
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const withSession = options.withSession ?? true;
  const tree = withSession ? <SessionProvider>{ui}</SessionProvider> : ui;

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{tree}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export function buildSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    user: {
      id: 'user-1',
      email: 'admin@alpha-medical.local',
      fullName: 'Alpha Admin',
      platformRole: null,
    },
    memberships: [
      {
        organizationId: 'org-1',
        organizationName: 'Alpha Medical Group',
        organizationSlug: 'alpha-medical',
        organizationStatus: 'ACTIVE',
        role: 'ORGANIZATION_ADMIN',
        isDefault: true,
      },
    ],
    activeOrganizationId: 'org-1',
    activeRole: 'ORGANIZATION_ADMIN',
    ...overrides,
  };
}

interface StubRoute {
  status?: number;
  /** A function is evaluated per call, so a route can reflect earlier mutations. */
  body?: unknown | (() => unknown);
}

/**
 * Stubs `fetch` by path suffix. Anything unmatched resolves as 401, which is what
 * the API returns for an unauthenticated caller.
 */
export function stubFetch(routes: Record<string, StubRoute>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });

    const key = Object.keys(routes).find((route) => url.endsWith(route));
    const route = key ? routes[key] : undefined;
    const status = route?.status ?? (route ? 200 : 401);

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        const body = typeof route?.body === 'function' ? route.body() : route?.body;
        return (
          body ?? { code: 'UNAUTHENTICATED', message: 'Authentication is required.', details: [] }
        );
      },
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);

  return { fetchMock, calls };
}
