import type { OrganizationRole, PlatformRole } from '@sip/shared-types';

/** Claims carried by the access token. Kept small — it travels on every request. */
export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  email: string;
  /** Organization the token is scoped to; null for platform staff with no membership. */
  org: string | null;
  /** Role inside that organization. */
  role: OrganizationRole | null;
  platformRole: PlatformRole | null;
}

/** Claims carried by the refresh token. It authorises rotation only. */
export interface RefreshTokenPayload {
  sub: string;
  /** Refresh token row id — lets rotation revoke exactly this token. */
  jti: string;
  /** Rotation family; replaying a rotated token revokes the whole family. */
  fam: string;
}

/**
 * What the guards attach to the request. Controllers read this instead of trusting
 * anything the client sent (ADR-0002).
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  platformRole: PlatformRole | null;
  organizationId: string | null;
  organizationRole: OrganizationRole | null;
}

export interface RequestWithUser {
  user?: AuthenticatedUser;
}
