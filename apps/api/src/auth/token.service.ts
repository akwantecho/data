import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { RefreshToken } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import type { AccessTokenPayload, RefreshTokenPayload } from './auth.types';

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
  familyId: string;
}

/**
 * Issues and verifies JWTs, and owns the refresh-token rotation records.
 *
 * Only a SHA-256 hash of a refresh token is stored: a database dump must not be
 * enough to impersonate a user. SHA-256 (not Argon2) is correct here because the
 * token is 256 bits of entropy from a CSPRNG, not a guessable secret, and the
 * lookup happens on every refresh.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL', { infer: true });
  }

  get refreshTtlSeconds(): number {
    return this.config.get('JWT_REFRESH_TTL', { infer: true });
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.accessTtlSeconds,
    });
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
    });
  }

  /**
   * Creates a refresh token row and signs the matching JWT.
   * Pass an existing `familyId` when rotating so the chain stays linked.
   */
  async issueRefreshToken(userId: string, familyId?: string): Promise<IssuedRefreshToken> {
    const id = randomUUID();
    const family = familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);

    const token = await this.jwt.signAsync(
      { sub: userId, jti: id, fam: family } satisfies RefreshTokenPayload,
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.refreshTtlSeconds,
      },
    );

    await this.prisma.refreshToken.create({
      data: { id, userId, familyId: family, tokenHash: hashToken(token), expiresAt },
    });

    return { token, expiresAt, familyId: family };
  }

  findStoredToken(id: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { id } });
  }

  async revokeToken(id: string, reason: 'ROTATED' | 'LOGOUT'): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Revokes every live token in a family — used on logout and on reuse detection. */
  async revokeFamily(
    familyId: string,
    reason: 'LOGOUT' | 'REUSE_DETECTED' | 'MEMBERSHIP_CHANGED',
  ): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}

/** Stable lookup hash for a refresh token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
