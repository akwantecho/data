import type { OrganizationRole, UserStatus } from './enums.js';

export interface IndustrySummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

export interface BranchSummary {
  id: string;
  name: string;
  code: string;
  countryCode: string | null;
  timezone: string | null;
  isActive: boolean;
  departmentCount: number;
  createdAt: string;
}

export interface CreateBranchRequest {
  name: string;
  code: string;
  countryCode?: string | null;
  timezone?: string | null;
}

export type UpdateBranchRequest = Partial<CreateBranchRequest> & { isActive?: boolean };

export interface DepartmentSummary {
  id: string;
  name: string;
  code: string;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreateDepartmentRequest {
  name: string;
  code: string;
  /** Null means the department belongs to the organization rather than one branch. */
  branchId?: string | null;
}

export type UpdateDepartmentRequest = Partial<CreateDepartmentRequest> & { isActive?: boolean };

export interface OrganizationMemberSummary {
  userId: string;
  email: string;
  fullName: string;
  role: OrganizationRole;
  status: UserStatus;
  isDefault: boolean;
  lastLoginAt: string | null;
  joinedAt: string;
}

export interface AddOrganizationMemberRequest {
  email: string;
  role: OrganizationRole;
  /** Required only when the email does not already belong to a platform user. */
  fullName?: string;
  /** Initial password for a newly created user. Ignored for an existing user. */
  temporaryPassword?: string;
}

export interface UpdateOrganizationMemberRequest {
  role: OrganizationRole;
}

export interface SetIndustryRequest {
  industryId: string;
}
