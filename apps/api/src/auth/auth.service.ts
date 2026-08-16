import { Injectable, Logger } from '@nestjs/common';
import type { OrganizationRole, PlatformRole, SessionResponse } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import type { AccessTokenPayload, AuthenticatedUser } from './auth.types';
import { PasswordService } from './password.service';
import { hashToken, TokenService } from './token.service';

export interface IssuedSession {
  session: SessionResponse;
  accessToken: string;
  refreshToken: string;
}

/** Membership rows needed to build a session, in a stable order. */
const MEMBERSHIP_SELECT = {
  role: true,
  isDefault: true,
  organization: {
    select: { id: true, name: true, slug: true, status: true },
  },
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Verifies credentials and starts a new token family.
   *
   * Every failure path returns the same message and does comparable work, so the
   * response cannot be used to enumerate accounts.
   */
  async login(email: string, password: string): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { memberships: { select: MEMBERSHIP_SELECT, orderBy: { createdAt: 'asc' } } },
    });

    const passwordMatches = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verify(DUMMY_HASH, password);

    if (!user || !passwordMatches || user.status !== 'ACTIVE') {
      throw new ApiException('UNAUTHENTICATED', 'Email or password is incorrect.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const memberships = user.memberships;
    const active = pickActiveMembership(memberships);

    // A user with no usable organization and no platform role has nowhere to go.
    if (!active && !user.platformRole) {
      throw ApiException.forbidden('This account is not active in any organization.');
    }

    return this.issueSession(
      {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        platformRole: user.platformRole,
      },
      memberships,
      active?.organization.id ?? null,
    );
  }

  /**
   * Rotates a refresh token.
   *
   * Presenting a token that was already rotated means the token leaked: the whole
   * family is revoked so both the attacker and the victim are logged out, and the
   * event is logged for investigation.
   */
  async refresh(refreshToken: string): Promise<IssuedSession> {
    const payload = await this.tokens.verifyRefreshToken(refreshToken).catch(() => {
      throw new ApiException('UNAUTHENTICATED', 'Session expired. Please sign in again.');
    });

    const stored = await this.tokens.findStoredToken(payload.jti);

    if (!stored || stored.userId !== payload.sub || stored.tokenHash !== hashToken(refreshToken)) {
      throw new ApiException('UNAUTHENTICATED', 'Session expired. Please sign in again.');
    }

    if (stored.revokedAt) {
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; revoking family ${stored.familyId}`,
      );
      await this.tokens.revokeFamily(stored.familyId, 'REUSE_DETECTED');
      throw new ApiException('UNAUTHENTICATED', 'Session expired. Please sign in again.');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new ApiException('UNAUTHENTICATED', 'Session expired. Please sign in again.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { memberships: { select: MEMBERSHIP_SELECT, orderBy: { createdAt: 'asc' } } },
    });

    if (!user || user.status !== 'ACTIVE') {
      await this.tokens.revokeFamily(stored.familyId, 'MEMBERSHIP_CHANGED');
      throw new ApiException('UNAUTHENTICATED', 'Session expired. Please sign in again.');
    }

    await this.tokens.revokeToken(stored.id, 'ROTATED');

    const active = pickActiveMembership(user.memberships);

    return this.issueSession(
      { id: user.id, email: user.email, fullName: user.fullName, platformRole: user.platformRole },
      user.memberships,
      active?.organization.id ?? null,
      stored.familyId,
    );
  }

  /** Revokes the presented token's whole family. An invalid token is a no-op. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const payload = await this.tokens.verifyRefreshToken(refreshToken).catch(() => null);

    if (payload) {
      await this.tokens.revokeFamily(payload.fam, 'LOGOUT');
    }
  }

  /** Rebuilds the session for the current access token (`GET /auth/me`). */
  async currentSession(user: AuthenticatedUser): Promise<SessionResponse> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { memberships: { select: MEMBERSHIP_SELECT, orderBy: { createdAt: 'asc' } } },
    });

    if (!record || record.status !== 'ACTIVE') {
      throw new ApiException('UNAUTHENTICATED', 'Session expired. Please sign in again.');
    }

    return buildSession(
      {
        id: record.id,
        email: record.email,
        fullName: record.fullName,
        platformRole: record.platformRole,
      },
      record.memberships,
      user.organizationId,
    );
  }

  /**
   * Re-scopes the access token to another organization the user belongs to.
   * The refresh family is preserved: switching context is not a new login.
   */
  async switchOrganization(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<{ session: SessionResponse; accessToken: string }> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { memberships: { select: MEMBERSHIP_SELECT, orderBy: { createdAt: 'asc' } } },
    });

    if (!record || record.status !== 'ACTIVE') {
      throw new ApiException('UNAUTHENTICATED', 'Session expired. Please sign in again.');
    }

    const target = record.memberships.find(
      (membership) => membership.organization.id === organizationId,
    );

    // Not a member, or the organization is not usable: the same answer either way,
    // so membership of another tenant cannot be probed.
    if (!target || target.organization.status !== 'ACTIVE') {
      throw ApiException.forbidden('You do not have access to this organization.');
    }

    const session = buildSession(
      {
        id: record.id,
        email: record.email,
        fullName: record.fullName,
        platformRole: record.platformRole,
      },
      record.memberships,
      organizationId,
    );

    const accessToken = await this.tokens.signAccessToken(toAccessPayload(session));

    return { session, accessToken };
  }

  private async issueSession(
    user: { id: string; email: string; fullName: string; platformRole: PlatformRole | null },
    memberships: MembershipRow[],
    activeOrganizationId: string | null,
    familyId?: string,
  ): Promise<IssuedSession> {
    const session = buildSession(user, memberships, activeOrganizationId);

    const [accessToken, refresh] = await Promise.all([
      this.tokens.signAccessToken(toAccessPayload(session)),
      this.tokens.issueRefreshToken(user.id, familyId),
    ]);

    return { session, accessToken, refreshToken: refresh.token };
  }
}

interface MembershipRow {
  role: OrganizationRole;
  isDefault: boolean;
  organization: { id: string; name: string; slug: string; status: string };
}

/** Default membership first, otherwise the oldest active one. */
function pickActiveMembership(memberships: MembershipRow[]): MembershipRow | undefined {
  const usable = memberships.filter((membership) => membership.organization.status === 'ACTIVE');
  return usable.find((membership) => membership.isDefault) ?? usable[0];
}

function buildSession(
  user: { id: string; email: string; fullName: string; platformRole: PlatformRole | null },
  memberships: MembershipRow[],
  requestedOrganizationId: string | null,
): SessionResponse {
  const active =
    memberships.find(
      (membership) =>
        membership.organization.id === requestedOrganizationId &&
        membership.organization.status === 'ACTIVE',
    ) ?? pickActiveMembership(memberships);

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      platformRole: user.platformRole,
    },
    memberships: memberships.map((membership) => ({
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      organizationSlug: membership.organization.slug,
      organizationStatus: membership.organization
        .status as SessionResponse['memberships'][number]['organizationStatus'],
      role: membership.role,
      isDefault: membership.isDefault,
    })),
    activeOrganizationId: active?.organization.id ?? null,
    activeRole: active?.role ?? null,
  };
}

function toAccessPayload(session: SessionResponse): AccessTokenPayload {
  return {
    sub: session.user.id,
    email: session.user.email,
    org: session.activeOrganizationId,
    role: session.activeRole,
    platformRole: session.user.platformRole,
  };
}

/**
 * Argon2id hash of a random string, used to keep the work done for an unknown
 * email comparable to a real verification (timing-attack mitigation).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$I1GPKBEEvRB8ALeDbxpuKw$nArNFqzwBro2mzzQXJYJgvrl7GrsQhavoCEWxz2Ghl4';
