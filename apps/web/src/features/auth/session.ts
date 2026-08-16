import type { SessionResponse } from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';

export const SESSION_QUERY_KEY = ['session'] as const;

export function fetchSession(): Promise<SessionResponse> {
  return apiRequest<SessionResponse>('/auth/me');
}

export function login(credentials: { email: string; password: string }): Promise<SessionResponse> {
  return apiRequest<SessionResponse>('/auth/login', { method: 'POST', body: credentials });
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST' });
}

export function switchOrganization(organizationId: string): Promise<SessionResponse> {
  return apiRequest<SessionResponse>('/auth/switch-organization', {
    method: 'POST',
    body: { organizationId },
  });
}
