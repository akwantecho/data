import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api-client';

/** Shared query defaults: never retry client-side errors, they will not fix themselves. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}
