import type {
  CreateDecisionActionRequest,
  CreateDecisionRequest,
  DecisionCentre,
  DecisionDetail,
  DecisionSummary,
  Paginated,
  ReviewDecisionRequest,
  UpdateDecisionRequest,
} from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';

export const decisionKeys = {
  centre: ['decisions', 'centre'] as const,
  list: (query: Record<string, string | undefined>) => ['decisions', 'list', query] as const,
  detail: (id: string) => ['decisions', id] as const,
};

function toQueryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }

  const serialised = params.toString();

  return serialised ? `?${serialised}` : '';
}

export function fetchDecisionCentre(): Promise<DecisionCentre> {
  return apiRequest<DecisionCentre>('/decisions/centre');
}

export function fetchDecisions(
  query: Record<string, string | undefined>,
): Promise<Paginated<DecisionSummary>> {
  return apiRequest<Paginated<DecisionSummary>>(`/decisions${toQueryString(query)}`);
}

export function fetchDecision(id: string): Promise<DecisionDetail> {
  return apiRequest<DecisionDetail>(`/decisions/${id}`);
}

export function createDecision(body: CreateDecisionRequest): Promise<DecisionDetail> {
  return apiRequest<DecisionDetail>('/decisions', { method: 'POST', body });
}

export function updateDecision(
  id: string,
  body: UpdateDecisionRequest,
): Promise<DecisionDetail> {
  return apiRequest<DecisionDetail>(`/decisions/${id}`, { method: 'PATCH', body });
}

export function addDecisionAction(
  id: string,
  body: CreateDecisionActionRequest,
): Promise<DecisionDetail> {
  return apiRequest<DecisionDetail>(`/decisions/${id}/actions`, { method: 'POST', body });
}

export function setDecisionActionState(
  id: string,
  actionId: string,
  isCompleted: boolean,
): Promise<DecisionDetail> {
  return apiRequest<DecisionDetail>(`/decisions/${id}/actions/${actionId}`, {
    method: 'PATCH',
    body: { isCompleted },
  });
}

export function reviewDecision(
  id: string,
  body: ReviewDecisionRequest,
): Promise<DecisionDetail> {
  return apiRequest<DecisionDetail>(`/decisions/${id}/review`, { method: 'POST', body });
}
