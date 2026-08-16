import type { OrganizationRole, OrganizationStatus, PlatformRole } from './enums.js';

/** One organization the signed-in user belongs to. */
export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationStatus: OrganizationStatus;
  role: OrganizationRole;
  isDefault: boolean;
}

/** Organization profile returned to members of that organization. */
export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  industryId: string | null;
  industryName: string | null;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * The whole authenticated session, returned by `POST /auth/login`, `GET /auth/me`
 * and `POST /auth/switch-organization`. Tokens are never in the body — they are
 * httpOnly cookies (ADR-0006).
 */
export interface SessionResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    platformRole: PlatformRole | null;
  };
  memberships: MembershipSummary[];
  /** Organization the current access token is scoped to; null for platform staff. */
  activeOrganizationId: string | null;
  activeRole: OrganizationRole | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SwitchOrganizationRequest {
  organizationId: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string;
}

/** Platform-admin view of a tenant (`GET /platform/organizations`). */
export interface PlatformOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  industryName: string | null;
  countryCode: string;
  currencyCode: string;
  status: OrganizationStatus;
  memberCount: number;
  createdAt: string;
}

export interface UpdateOrganizationStatusRequest {
  status: OrganizationStatus;
}
