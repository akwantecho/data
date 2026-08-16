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
