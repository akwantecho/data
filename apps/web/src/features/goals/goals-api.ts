import type {
  CreateGoalRequest,
  GoalDetail,
  GoalProgressResult,
  GoalSummary,
  UpdateGoalRequest,
} from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';

export const goalKeys = {
  list: (query: Record<string, string | undefined>) => ['goals', query] as const,
  detail: (id: string) => ['goals', id] as const,
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

export function fetchGoals(query: Record<string, string | undefined>): Promise<GoalSummary[]> {
  return apiRequest<GoalSummary[]>(`/goals${toQueryString(query)}`);
}

export function fetchGoal(id: string): Promise<GoalDetail> {
  return apiRequest<GoalDetail>(`/goals/${id}`);
}

export function createGoal(body: CreateGoalRequest): Promise<GoalDetail> {
  return apiRequest<GoalDetail>('/goals', { method: 'POST', body });
}

export function updateGoal(id: string, body: UpdateGoalRequest): Promise<GoalDetail> {
  return apiRequest<GoalDetail>(`/goals/${id}`, { method: 'PATCH', body });
}

export function deleteGoal(id: string): Promise<void> {
  return apiRequest<void>(`/goals/${id}`, { method: 'DELETE' });
}

export function addGoalNote(id: string, note: string): Promise<GoalDetail> {
  return apiRequest<GoalDetail>(`/goals/${id}/notes`, { method: 'POST', body: { note } });
}

/** Refreshes every metric-linked goal from its metric. */
export function recalculateGoals(): Promise<GoalProgressResult> {
  return apiRequest<GoalProgressResult>('/goals/recalculate', { method: 'POST' });
}
