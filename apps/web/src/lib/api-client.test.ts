import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api-client';

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('returns the parsed JSON body on success', async () => {
    mockFetch({ json: async () => ({ status: 'ok' }) });

    await expect(apiRequest<{ status: string }>('/health')).resolves.toEqual({ status: 'ok' });
  });

  it('sends JSON bodies with the right content type', async () => {
    const fetchMock = mockFetch({});

    await apiRequest('/things', { method: 'POST', body: { name: 'Branch A' } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'Branch A' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws ApiError carrying the platform error envelope', async () => {
    mockFetch({
      ok: false,
      status: 403,
      json: async () => ({ code: 'FORBIDDEN', message: 'No access.', details: [] }),
    });

    await expect(apiRequest('/organizations/current')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No access.',
    });
  });

  it('falls back to a safe error for non-JSON failures', async () => {
    mockFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });

    const error = await apiRequest('/health').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INTERNAL_ERROR');
  });

  it('returns undefined for 204 responses', async () => {
    mockFetch({ status: 204 });

    await expect(apiRequest('/things/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('refresh on 401', () => {
  /** Queues responses per call so a refresh-and-retry sequence can be scripted. */
  function scriptFetch(responses: Array<{ status: number; body?: unknown }>) {
    let index = 0;
    const urls: string[] = [];

    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      const next = responses[index] ?? responses[responses.length - 1];
      index += 1;

      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body ?? {},
      } as unknown as Response;
    });

    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, urls };
  }

  it('refreshes once and retries the original request', async () => {
    const { urls } = scriptFetch([
      { status: 401 },
      { status: 200 },
      { status: 200, body: { id: 'org-1' } },
    ]);

    await expect(apiRequest<{ id: string }>('/organizations/current')).resolves.toEqual({
      id: 'org-1',
    });

    expect(urls).toEqual([
      '/api/organizations/current',
      '/api/auth/refresh',
      '/api/organizations/current',
    ]);
  });

  it('gives up when the refresh also fails', async () => {
    const unauthenticated = {
      status: 401,
      body: { code: 'UNAUTHENTICATED', message: 'Session expired.', details: [] },
    };
    const { urls } = scriptFetch([unauthenticated, unauthenticated]);

    await expect(apiRequest('/organizations/current')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    // One refresh attempt, then the original 401 is surfaced — no retry loop.
    expect(urls).toEqual(['/api/organizations/current', '/api/auth/refresh']);
  });

  it('does not try to refresh a failed login', async () => {
    const { urls } = scriptFetch([{ status: 401 }]);

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: { email: 'a@b.c', password: 'x' } }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(urls).toEqual(['/api/auth/login']);
  });

  it('shares one refresh between concurrent requests', async () => {
    const { urls } = scriptFetch([
      { status: 401 },
      { status: 401 },
      { status: 200 },
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);

    await Promise.all([apiRequest('/metrics'), apiRequest('/goals')]);

    // Rotating the refresh token twice would trip server-side reuse detection.
    expect(urls.filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  });
});
