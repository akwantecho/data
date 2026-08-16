import type {
  AddOrganizationMemberRequest,
  BranchSummary,
  CreateBranchRequest,
  CreateDepartmentRequest,
  DepartmentSummary,
  IndustrySummary,
  OrganizationMemberSummary,
  OrganizationSummary,
  UpdateBranchRequest,
  UpdateDepartmentRequest,
  UpdateOrganizationRequest,
} from '@sip/shared-types';
import { apiRequest } from '../../lib/api-client';

export const settingsKeys = {
  organization: ['organization', 'current'] as const,
  industries: ['industries'] as const,
  branches: (includeInactive: boolean) => ['branches', { includeInactive }] as const,
  departments: (includeInactive: boolean) => ['departments', { includeInactive }] as const,
  team: ['organization-users'] as const,
};

export function fetchOrganization(): Promise<OrganizationSummary> {
  return apiRequest<OrganizationSummary>('/organizations/current');
}

export function updateOrganization(body: UpdateOrganizationRequest): Promise<OrganizationSummary> {
  return apiRequest<OrganizationSummary>('/organizations/current', { method: 'PATCH', body });
}

export function setIndustry(industryId: string): Promise<OrganizationSummary> {
  return apiRequest<OrganizationSummary>('/organizations/current/industry', {
    method: 'PUT',
    body: { industryId },
  });
}

export function fetchIndustries(): Promise<IndustrySummary[]> {
  return apiRequest<IndustrySummary[]>('/industries');
}

export function fetchBranches(includeInactive: boolean): Promise<BranchSummary[]> {
  return apiRequest<BranchSummary[]>(`/branches?includeInactive=${includeInactive}`);
}

export function createBranch(body: CreateBranchRequest): Promise<BranchSummary> {
  return apiRequest<BranchSummary>('/branches', { method: 'POST', body });
}

export function updateBranch(id: string, body: UpdateBranchRequest): Promise<BranchSummary> {
  return apiRequest<BranchSummary>(`/branches/${id}`, { method: 'PATCH', body });
}

export function deleteBranch(id: string): Promise<void> {
  return apiRequest<void>(`/branches/${id}`, { method: 'DELETE' });
}

export function fetchDepartments(includeInactive: boolean): Promise<DepartmentSummary[]> {
  return apiRequest<DepartmentSummary[]>(`/departments?includeInactive=${includeInactive}`);
}

export function createDepartment(body: CreateDepartmentRequest): Promise<DepartmentSummary> {
  return apiRequest<DepartmentSummary>('/departments', { method: 'POST', body });
}

export function updateDepartment(
  id: string,
  body: UpdateDepartmentRequest,
): Promise<DepartmentSummary> {
  return apiRequest<DepartmentSummary>(`/departments/${id}`, { method: 'PATCH', body });
}

export function deleteDepartment(id: string): Promise<void> {
  return apiRequest<void>(`/departments/${id}`, { method: 'DELETE' });
}

export function fetchTeam(): Promise<OrganizationMemberSummary[]> {
  return apiRequest<OrganizationMemberSummary[]>('/organization-users');
}

export function addMember(body: AddOrganizationMemberRequest): Promise<OrganizationMemberSummary> {
  return apiRequest<OrganizationMemberSummary>('/organization-users', { method: 'POST', body });
}

export function updateMemberRole(
  userId: string,
  role: OrganizationMemberSummary['role'],
): Promise<OrganizationMemberSummary> {
  return apiRequest<OrganizationMemberSummary>(`/organization-users/${userId}`, {
    method: 'PATCH',
    body: { role },
  });
}

export function removeMember(userId: string): Promise<void> {
  return apiRequest<void>(`/organization-users/${userId}`, { method: 'DELETE' });
}
