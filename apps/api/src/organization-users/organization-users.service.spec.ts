import { OrganizationUsersService } from './organization-users.service';
import type { AuditService } from '../audit/audit.service';
import type { PasswordService } from '../auth/password.service';

function buildHarness(
  overrides: {
    membership?: unknown;
    otherAdmins?: number;
    existingUser?: unknown;
  } = {},
) {
  const prisma = {
    organizationUser: {
      findMany: jest.fn().mockResolvedValue([]),
      // Used both to find the target membership and to detect a duplicate.
      findUnique: jest.fn().mockResolvedValue(overrides.membership ?? null),
      count: jest.fn().mockResolvedValue(overrides.otherAdmins ?? 1),
      create: jest.fn().mockResolvedValue(memberRow('ANALYST')),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: { role: string } }) =>
          Promise.resolve(memberRow(data.role)),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(overrides.existingUser ?? null),
      create: jest.fn().mockResolvedValue({ id: 'user-new' }),
    },
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const passwords = { hash: jest.fn().mockResolvedValue('hashed') } as unknown as PasswordService;

  return {
    service: new OrganizationUsersService(prisma as never, audit, passwords),
    prisma,
    audit,
    passwords,
  };
}

function memberRow(role: string) {
  return {
    role,
    isDefault: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    user: {
      id: 'user-1',
      email: 'member@alpha.local',
      fullName: 'Member',
      status: 'ACTIVE',
      lastLoginAt: null,
    },
  };
}

describe('OrganizationUsersService.add', () => {
  it('attaches an existing user without touching their account', async () => {
    const { service, prisma } = buildHarness({
      existingUser: { id: 'user-1', platformRole: null },
    });

    await service.add('org-1', 'actor-1', { email: 'member@alpha.local', role: 'ANALYST' });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.organizationUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          role: 'ANALYST',
        }),
      }),
    );
  });

  it('creates the user when the email is new, hashing the initial password', async () => {
    const { service, prisma, passwords } = buildHarness();

    await service.add('org-1', 'actor-1', {
      email: 'new@alpha.local',
      role: 'VIEWER',
      fullName: 'New Person',
      temporaryPassword: 'InitialPassword1',
    });

    expect(passwords.hash).toHaveBeenCalledWith('InitialPassword1');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'new@alpha.local', passwordHash: 'hashed' }),
      }),
    );
  });

  it('requires a name and password for an unknown email', async () => {
    const { service } = buildHarness();

    await expect(
      service.add('org-1', 'actor-1', { email: 'new@alpha.local', role: 'ANALYST' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses to add platform staff to a tenant', async () => {
    const { service } = buildHarness({
      existingUser: { id: 'user-9', platformRole: 'PLATFORM_ADMIN' },
    });

    await expect(
      service.add('org-1', 'actor-1', { email: 'platform@sip.local', role: 'ANALYST' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a duplicate membership', async () => {
    const { service } = buildHarness({
      existingUser: { id: 'user-1', platformRole: null },
      membership: { id: 'membership-1' },
    });

    await expect(
      service.add('org-1', 'actor-1', { email: 'member@alpha.local', role: 'ANALYST' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('OrganizationUsersService.updateRole', () => {
  it('changes a role and audits the change', async () => {
    const { service, audit } = buildHarness({ membership: memberRow('ANALYST') });

    const result = await service.updateRole('org-1', 'user-1', 'actor-1', {
      role: 'ORGANIZATION_ADMIN',
    });

    expect(result.role).toBe('ORGANIZATION_ADMIN');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization_user.role_changed',
        before: { role: 'ANALYST' },
        after: { role: 'ORGANIZATION_ADMIN' },
      }),
    );
  });

  it('refuses to demote the only administrator', async () => {
    const { service } = buildHarness({
      membership: memberRow('ORGANIZATION_ADMIN'),
      otherAdmins: 0,
    });

    await expect(
      service.updateRole('org-1', 'user-1', 'actor-1', { role: 'VIEWER' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('allows demoting an administrator when another one remains', async () => {
    const { service } = buildHarness({
      membership: memberRow('ORGANIZATION_ADMIN'),
      otherAdmins: 1,
    });

    await expect(
      service.updateRole('org-1', 'user-1', 'actor-1', { role: 'VIEWER' }),
    ).resolves.toMatchObject({ role: 'VIEWER' });
  });

  it('reports an unknown member as not found', async () => {
    const { service } = buildHarness({ membership: null });

    await expect(
      service.updateRole('org-1', 'user-x', 'actor-1', { role: 'VIEWER' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('OrganizationUsersService.remove', () => {
  it('removes a membership but keeps the user account', async () => {
    const { service, prisma } = buildHarness({
      membership: { role: 'ANALYST', user: { email: 'member@alpha.local' } },
    });

    await service.remove('org-1', 'user-1', 'actor-1');

    expect(prisma.organizationUser.delete).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: 'org-1', userId: 'user-1' } },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses to remove the only administrator', async () => {
    const { service, prisma } = buildHarness({
      membership: { role: 'ORGANIZATION_ADMIN', user: { email: 'admin@alpha.local' } },
      otherAdmins: 0,
    });

    await expect(service.remove('org-1', 'user-1', 'actor-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(prisma.organizationUser.delete).not.toHaveBeenCalled();
  });
});
