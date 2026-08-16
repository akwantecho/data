import { Injectable } from '@nestjs/common';
import type { OrganizationMemberSummary, OrganizationRole } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api-exception';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { AddMemberDto, UpdateMemberDto } from './organization-users.dto';

const MEMBER_SELECT = {
  role: true,
  isDefault: true,
  createdAt: true,
  user: {
    select: { id: true, email: true, fullName: true, status: true, lastLoginAt: true },
  },
} as const;

/**
 * Team management for one organization.
 *
 * Membership is the tenancy boundary, so this service is deliberately strict: it
 * never touches a user outside the caller's organization, and it refuses any change
 * that would leave the organization without an administrator.
 */
@Injectable()
export class OrganizationUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  async list(organizationId: string): Promise<OrganizationMemberSummary[]> {
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: MEMBER_SELECT,
    });

    return members.map(toSummary);
  }

  /**
   * Adds an existing platform user to the organization, or creates the user first.
   *
   * There is no email delivery yet, so a new user needs an initial password chosen
   * by the administrator; password reset and invitation links are Phase 2. An
   * existing account is never modified — only a membership row is added.
   */
  async add(
    organizationId: string,
    actorId: string,
    dto: AddMemberDto,
    ipAddress?: string,
  ): Promise<OrganizationMemberSummary> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, platformRole: true },
    });

    if (existing?.platformRole) {
      throw ApiException.conflict('Platform staff cannot be added to an organization.');
    }

    if (!existing && (!dto.fullName || !dto.temporaryPassword)) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'fullName', message: 'Required when the email is not an existing user' },
        { field: 'temporaryPassword', message: 'Required when the email is not an existing user' },
      ]);
    }

    const userId =
      existing?.id ??
      (
        await this.prisma.user.create({
          data: {
            email: dto.email,
            fullName: dto.fullName as string,
            passwordHash: await this.passwords.hash(dto.temporaryPassword as string),
          },
          select: { id: true },
        })
      ).id;

    const alreadyMember = await this.prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });

    if (alreadyMember) {
      throw ApiException.conflict('This person is already a member of the organization.');
    }

    const member = await this.prisma.organizationUser.create({
      data: {
        organizationId,
        userId,
        role: dto.role,
        // First organization a user joins becomes their default landing context.
        isDefault: (await this.prisma.organizationUser.count({ where: { userId } })) === 0,
      },
      select: MEMBER_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'organization_user.added',
      entityType: 'organization_user',
      entityId: userId,
      after: { email: dto.email, role: dto.role, createdUser: !existing },
      ipAddress,
    });

    return toSummary(member);
  }

  async updateRole(
    organizationId: string,
    userId: string,
    actorId: string,
    dto: UpdateMemberDto,
    ipAddress?: string,
  ): Promise<OrganizationMemberSummary> {
    const membership = await this.prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: MEMBER_SELECT,
    });

    if (!membership) {
      throw ApiException.notFound('Member');
    }

    if (membership.role === 'ORGANIZATION_ADMIN' && dto.role !== 'ORGANIZATION_ADMIN') {
      await this.assertNotLastAdmin(organizationId, userId);
    }

    const updated = await this.prisma.organizationUser.update({
      where: { organizationId_userId: { organizationId, userId } },
      data: { role: dto.role },
      select: MEMBER_SELECT,
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'organization_user.role_changed',
      entityType: 'organization_user',
      entityId: userId,
      before: { role: membership.role },
      after: { role: updated.role },
      ipAddress,
    });

    return toSummary(updated);
  }

  /**
   * Removes a membership. The user account itself survives — they may belong to
   * other organizations, and their history here must remain attributable.
   *
   * No token surgery is needed: `AuthorizationGuard` re-reads membership on every
   * request, so access ends immediately (verified in the isolation tests).
   */
  async remove(
    organizationId: string,
    userId: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<void> {
    const membership = await this.prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true, user: { select: { email: true } } },
    });

    if (!membership) {
      throw ApiException.notFound('Member');
    }

    if (membership.role === 'ORGANIZATION_ADMIN') {
      await this.assertNotLastAdmin(organizationId, userId);
    }

    await this.prisma.organizationUser.delete({
      where: { organizationId_userId: { organizationId, userId } },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: 'organization_user.removed',
      entityType: 'organization_user',
      entityId: userId,
      before: { email: membership.user.email, role: membership.role },
      ipAddress,
    });
  }

  /** An organization without an administrator can never be administered again. */
  private async assertNotLastAdmin(organizationId: string, userId: string): Promise<void> {
    const otherAdmins = await this.prisma.organizationUser.count({
      where: { organizationId, role: 'ORGANIZATION_ADMIN', userId: { not: userId } },
    });

    if (otherAdmins === 0) {
      throw ApiException.conflict(
        'This is the only administrator. Promote another member before changing this one.',
      );
    }
  }
}

type MemberRow = {
  role: OrganizationRole;
  isDefault: boolean;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    fullName: string;
    status: string;
    lastLoginAt: Date | null;
  };
};

function toSummary(row: MemberRow): OrganizationMemberSummary {
  return {
    userId: row.user.id,
    email: row.user.email,
    fullName: row.user.fullName,
    role: row.role,
    status: row.user.status as OrganizationMemberSummary['status'],
    isDefault: row.isDefault,
    lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
    joinedAt: row.createdAt.toISOString(),
  };
}
