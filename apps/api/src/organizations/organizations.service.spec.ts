import { OrganizationsService } from './organizations.service';
import type { AuditService } from '../audit/audit.service';

const organizationRow = {
  id: 'org-1',
  name: 'Alpha Medical Group',
  slug: 'alpha-medical',
  industryId: null as string | null,
  countryCode: 'OM',
  currencyCode: 'OMR',
  timezone: 'Asia/Muscat',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  industry: null as { name: string } | null,
};

function buildHarness(
  overrides: {
    organization?: Partial<typeof organizationRow>;
    industry?: unknown;
    metricValues?: number;
    imports?: number;
  } = {},
) {
  const organization = { ...organizationRow, ...overrides.organization };

  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue(organization),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...organization, ...data }),
        ),
    },
    industry: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.industry === undefined ? { id: 'industry-1' } : overrides.industry,
        ),
    },
    metricValue: { count: jest.fn().mockResolvedValue(overrides.metricValues ?? 0) },
    dataImport: { count: jest.fn().mockResolvedValue(overrides.imports ?? 0) },
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { service: new OrganizationsService(prisma as never, audit), prisma, audit };
}

describe('OrganizationsService.setIndustry', () => {
  it('sets the industry when none has been chosen', async () => {
    const { service, prisma } = buildHarness();

    const result = await service.setIndustry('org-1', 'actor-1', 'industry-1');

    expect(result.industryId).toBe('industry-1');
    expect(prisma.organization.update).toHaveBeenCalled();
  });

  it('rejects an unknown or inactive industry', async () => {
    const { service } = buildHarness({ industry: null });

    await expect(service.setIndustry('org-1', 'actor-1', 'industry-x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('is a no-op when the industry is unchanged', async () => {
    const { service, prisma } = buildHarness({
      organization: { industryId: 'industry-1' },
      metricValues: 500,
    });

    await expect(service.setIndustry('org-1', 'actor-1', 'industry-1')).resolves.toMatchObject({
      industryId: 'industry-1',
    });
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('refuses to change the industry once metric values exist (plan §37)', async () => {
    const { service, prisma } = buildHarness({
      organization: { industryId: 'industry-old' },
      metricValues: 12,
    });

    await expect(service.setIndustry('org-1', 'actor-1', 'industry-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('refuses to change the industry once imports exist', async () => {
    const { service } = buildHarness({
      organization: { industryId: 'industry-old' },
      imports: 1,
    });

    await expect(service.setIndustry('org-1', 'actor-1', 'industry-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('allows a change while the organization has no data yet', async () => {
    const { service, audit } = buildHarness({ organization: { industryId: 'industry-old' } });

    await expect(service.setIndustry('org-1', 'actor-1', 'industry-1')).resolves.toMatchObject({
      industryId: 'industry-1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.industry_changed' }),
    );
  });
});
