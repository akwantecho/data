import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createOrganization, createUser } from './helpers/fixtures';
import { cleanupFixtures, createTestApp, TEST_PASSWORD, unique } from './helpers/test-app';

/**
 * Sprint 3 gate (plan §42): a valid CSV imports, invalid rows are surfaced rather
 * than dropped, an import can be cancelled before commit, a duplicate commit is
 * prevented, and organization isolation holds throughout.
 */
describe('Data import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let alpha: { id: string };
  let beta: { id: string };
  let alphaAdmin: { email: string };
  let alphaViewer: { email: string };
  let betaAdmin: { email: string };

  const HEADER = 'Metric,Period,Value,Branch';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());

    alpha = await createOrganization(prisma, { name: 'Alpha Imports' });
    beta = await createOrganization(prisma, { name: 'Beta Imports' });
    organizationIds.push(alpha.id, beta.id);

    alphaAdmin = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });
    alphaViewer = await createUser(prisma, {
      memberships: [{ organizationId: alpha.id, role: 'VIEWER', isDefault: true }],
    });
    betaAdmin = await createUser(prisma, {
      memberships: [{ organizationId: beta.id, role: 'ORGANIZATION_ADMIN', isDefault: true }],
    });

    const users = await prisma.user.findMany({
      where: { email: { in: [alphaAdmin.email, alphaViewer.email, betaAdmin.email] } },
      select: { id: true },
    });
    userIds.push(...users.map((user) => user.id));

    // Both organizations get the same metric and branch codes, so a leak between
    // them would be invisible without the isolation assertions below.
    for (const organizationId of [alpha.id, beta.id]) {
      await prisma.metric.createMany({
        data: [
          {
            organizationId,
            code: 'revenue',
            name: 'Revenue',
            unit: 'CURRENCY',
            aggregationType: 'SUM',
            frequency: 'MONTHLY',
          },
          {
            organizationId,
            code: 'patients',
            name: 'Patients',
            unit: 'COUNT',
            aggregationType: 'SUM',
            frequency: 'MONTHLY',
          },
          {
            organizationId,
            code: 'margin',
            name: 'Margin',
            unit: 'PERCENTAGE',
            aggregationType: 'FORMULA',
            frequency: 'MONTHLY',
          },
        ],
      });
      await prisma.branch.create({
        data: { organizationId, code: 'muscat', name: 'Muscat' },
      });
    }
  });

  afterAll(async () => {
    await prisma.metricValue.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.metric.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.dataImport.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.dataSource.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.branch.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await cleanupFixtures(prisma, { organizationIds, userIds });
    await app?.close();
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    return agent;
  }

  /** Uploads a CSV body, returning the preview response. */
  async function upload(
    agent: ReturnType<typeof request.agent>,
    csv: string,
    fileName = 'data.csv',
  ) {
    return agent
      .post('/api/imports/upload')
      .attach('file', Buffer.from(csv), { filename: fileName, contentType: 'text/csv' });
  }

  const MAPPING = {
    metricCode: 'Metric',
    period: 'Period',
    value: 'Value',
    branchCode: 'Branch',
  };

  /** Runs upload → map → validate for a CSV body. */
  async function validated(agent: ReturnType<typeof request.agent>, csv: string) {
    const preview = await upload(agent, csv);
    expect(preview.status).toBe(201);

    const id = preview.body.import.id as string;
    await agent.post(`/api/imports/${id}/map`).send(MAPPING).expect(200);
    const report = await agent.post(`/api/imports/${id}/validate`).expect(200);

    return { id, preview: preview.body, report: report.body };
  }

  describe('upload and preview', () => {
    it('parses the file, suggests a mapping and lists usable metric codes', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await upload(
        agent,
        `${HEADER}\nrevenue,2026-01,125000,muscat\nrevenue,2026-02,131000,muscat\n`,
      );

      expect(response.status).toBe(201);
      expect(response.body.columns).toEqual(['Metric', 'Period', 'Value', 'Branch']);
      expect(response.body.suggestedMapping).toMatchObject({
        metricCode: 'Metric',
        period: 'Period',
        value: 'Value',
        branchCode: 'Branch',
      });
      expect(response.body.sampleRows).toHaveLength(2);
      expect(response.body.availableMetricCodes).toEqual(
        expect.arrayContaining(['revenue', 'patients']),
      );
      expect(response.body.import).toMatchObject({ status: 'UPLOADED', rowsReceived: 2 });
    });

    it('stores every raw row exactly as received', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await upload(agent, `${HEADER}\nrevenue,2026-03,  99 ,muscat\n`);
      const rows = await prisma.dataImportRow.findMany({
        where: { dataImportId: response.body.import.id },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].rawData).toMatchObject({ Metric: 'revenue', Value: '99' });
    });

    it('reads semicolon-delimited exports', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await upload(agent, 'Metric;Period;Value\nrevenue;2026-04;1000\n');

      expect(response.status).toBe(201);
      expect(response.body.columns).toEqual(['Metric', 'Period', 'Value']);
    });

    it('rejects a non-CSV file', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await agent
        .post('/api/imports/upload')
        .attach('file', Buffer.from('%PDF-1.4'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        });

      expect(response.status).toBe(400);
    });

    it('rejects a file with no data rows', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await upload(agent, `${HEADER}\n`);

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/no data rows/i);
    });

    it('rejects duplicate column headers', async () => {
      const agent = await signIn(alphaAdmin.email);

      const response = await upload(agent, 'Metric,Period,Value,Value\nrevenue,2026-01,1,2\n');

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/duplicate column/i);
    });

    it('refuses a viewer', async () => {
      const agent = await signIn(alphaViewer.email);

      const response = await upload(agent, `${HEADER}\nrevenue,2026-01,1000,muscat\n`);

      expect(response.status).toBe(403);
    });
  });

  describe('mapping', () => {
    it('rejects a mapping that names a column the file does not have', async () => {
      const agent = await signIn(alphaAdmin.email);
      const preview = await upload(agent, `${HEADER}\nrevenue,2026-01,1000,muscat\n`);

      const response = await agent
        .post(`/api/imports/${preview.body.import.id}/map`)
        .send({ metricCode: 'Metric', period: 'Period', value: 'Nonexistent' })
        .expect(400);

      expect(response.body.details[0]).toMatchObject({ field: 'value' });
    });

    it('requires a mapping before validation', async () => {
      const agent = await signIn(alphaAdmin.email);
      const preview = await upload(agent, `${HEADER}\nrevenue,2026-01,1000,muscat\n`);

      const response = await agent
        .post(`/api/imports/${preview.body.import.id}/validate`)
        .expect(409);

      expect(response.body.message).toMatch(/map the columns/i);
    });
  });

  describe('validation', () => {
    it('separates valid, warned and rejected rows and explains every problem', async () => {
      const agent = await signIn(alphaAdmin.email);

      const { report } = await validated(
        agent,
        [
          HEADER,
          'revenue,2026-01,125000,muscat', // valid
          'patients,2026-01,12.5,muscat', // warning: fractional count
          'revenue,2026-01,999,muscat', // rejected: duplicate
          'made_up,2026-01,10,muscat', // rejected: unknown metric
          'revenue,January,10,muscat', // rejected: unparseable period
          'revenue,2026-02,,muscat', // rejected: missing value
          'revenue,2026-03,1000,nowhere', // rejected: unknown branch
          'margin,2026-04,10,muscat', // rejected: calculated metric
          '',
        ].join('\n'),
      );

      expect(report.import).toMatchObject({
        status: 'VALIDATED',
        rowsReceived: 8,
        rowsValid: 1,
        rowsWarning: 1,
        rowsRejected: 6,
      });

      const codes = report.issues.map((issue: { code: string }) => issue.code);
      expect(codes).toEqual(
        expect.arrayContaining([
          'DUPLICATE_ROW',
          'UNKNOWN_METRIC',
          'INVALID_PERIOD',
          'MISSING_VALUE',
          'UNKNOWN_BRANCH',
          'CALCULATED_METRIC',
          'FRACTIONAL_COUNT',
        ]),
      );
      expect(report.issues.every((issue: { message: string }) => issue.message.length > 0)).toBe(
        true,
      );
    });

    it('keeps rejected rows for inspection instead of discarding them', async () => {
      const agent = await signIn(alphaAdmin.email);
      const { id } = await validated(
        agent,
        `${HEADER}\nrevenue,2026-06,1000,muscat\nmade_up,2026-06,5,muscat\n`,
      );

      const rejected = await agent
        .get(`/api/imports/${id}/rows`)
        .query({ status: 'REJECTED' })
        .expect(200);

      expect(rejected.body.total).toBe(1);
      expect(rejected.body.items[0]).toMatchObject({
        rowNumber: 2,
        status: 'REJECTED',
        data: { Metric: 'made_up' },
      });
      expect(rejected.body.items[0].issues[0].code).toBe('UNKNOWN_METRIC');
    });

    it('can be re-run after the mapping is corrected', async () => {
      const agent = await signIn(alphaAdmin.email);
      const preview = await upload(
        agent,
        'KPI,When,Amount\nrevenue,2026-07,1000\nrevenue,2026-08,2000\n',
      );
      const id = preview.body.import.id;

      // A wrong mapping points the value column at the period.
      await agent
        .post(`/api/imports/${id}/map`)
        .send({ metricCode: 'KPI', period: 'Amount', value: 'When' })
        .expect(200);
      const first = await agent.post(`/api/imports/${id}/validate`).expect(200);
      expect(first.body.import.rowsRejected).toBe(2);

      await agent
        .post(`/api/imports/${id}/map`)
        .send({ metricCode: 'KPI', period: 'When', value: 'Amount' })
        .expect(200);
      const second = await agent.post(`/api/imports/${id}/validate`).expect(200);

      expect(second.body.import.rowsValid).toBe(2);
      expect(second.body.import.rowsRejected).toBe(0);
      // The previous run's issues are replaced, not accumulated.
      expect(second.body.issues).toHaveLength(0);
    });
  });

  describe('commit', () => {
    it('writes metric values for accepted rows only', async () => {
      const agent = await signIn(alphaAdmin.email);
      const { id } = await validated(
        agent,
        [
          HEADER,
          'revenue,2026-09,125000.50,muscat',
          'patients,2026-09,430,muscat',
          'made_up,2026-09,1,muscat',
          '',
        ].join('\n'),
      );

      const result = await agent.post(`/api/imports/${id}/commit`).expect(200);

      expect(result.body.valuesWritten).toBe(2);
      expect(result.body.import).toMatchObject({ status: 'COMMITTED' });
      expect(result.body.import.committedAt).not.toBeNull();

      const stored = await prisma.metricValue.findMany({
        where: { organizationId: alpha.id, periodStart: new Date('2026-09-01T00:00:00.000Z') },
        include: { metric: { select: { code: true } } },
      });

      expect(stored).toHaveLength(2);
      const revenue = stored.find((value) => value.metric.code === 'revenue');
      expect(revenue?.value.toString()).toBe('125000.5');
      expect(revenue?.periodType).toBe('MONTH');
      expect(revenue?.periodEnd.toISOString().slice(0, 10)).toBe('2026-09-30');
      expect(revenue?.sourceType).toBe('CSV');
      expect(revenue?.sourceRef).toBe(id);
    });

    it('replaces values on re-import instead of double counting', async () => {
      const agent = await signIn(alphaAdmin.email);

      const first = await validated(agent, `${HEADER}\nrevenue,2026-10,100,muscat\n`);
      await agent.post(`/api/imports/${first.id}/commit`).expect(200);

      // A corrected file for the same period.
      const second = await validated(agent, `${HEADER}\nrevenue,2026-10,175,muscat\n`);
      await agent.post(`/api/imports/${second.id}/commit`).expect(200);

      const stored = await prisma.metricValue.findMany({
        where: {
          organizationId: alpha.id,
          periodStart: new Date('2026-10-01T00:00:00.000Z'),
          metric: { code: 'revenue' },
        },
      });

      expect(stored).toHaveLength(1);
      expect(stored[0].value.toString()).toBe('175');
    });

    it('keeps organization-level and branch-level values apart', async () => {
      const agent = await signIn(alphaAdmin.email);
      const { id } = await validated(
        agent,
        `${HEADER}\nrevenue,2026-11,500,muscat\nrevenue,2026-11,900,\n`,
      );

      await agent.post(`/api/imports/${id}/commit`).expect(200);

      const stored = await prisma.metricValue.findMany({
        where: {
          organizationId: alpha.id,
          periodStart: new Date('2026-11-01T00:00:00.000Z'),
          metric: { code: 'revenue' },
        },
      });

      expect(stored).toHaveLength(2);
      expect(stored.filter((value) => value.branchId === null)).toHaveLength(1);
    });

    it('refuses to commit twice', async () => {
      const agent = await signIn(alphaAdmin.email);
      const { id } = await validated(agent, `${HEADER}\nrevenue,2026-12,1000,muscat\n`);

      await agent.post(`/api/imports/${id}/commit`).expect(200);
      const second = await agent.post(`/api/imports/${id}/commit`).expect(409);

      expect(second.body.message).toMatch(/already been committed/i);
    });

    it('refuses to commit before validation', async () => {
      const agent = await signIn(alphaAdmin.email);
      const preview = await upload(agent, `${HEADER}\nrevenue,2027-01,1000,muscat\n`);

      const response = await agent
        .post(`/api/imports/${preview.body.import.id}/commit`)
        .expect(409);

      expect(response.body.message).toMatch(/validate the import/i);
    });

    it('refuses to commit a file where every row was rejected', async () => {
      const agent = await signIn(alphaAdmin.email);
      const { id } = await validated(agent, `${HEADER}\nmade_up,2027-02,1,muscat\n`);

      await agent.post(`/api/imports/${id}/commit`).expect(409);
    });

    it('blocks re-uploading a file that was already committed', async () => {
      const agent = await signIn(alphaAdmin.email);
      const csv = `${HEADER}\nrevenue,2027-03,4242,muscat\n`;

      const { id } = await validated(agent, csv);
      await agent.post(`/api/imports/${id}/commit`).expect(200);

      const again = await upload(agent, csv, 'same-content-different-name.csv');

      expect(again.status).toBe(409);
      expect(again.body.message).toMatch(/already imported/i);
    });
  });

  describe('cancel', () => {
    it('cancels before commit and leaves no metric values', async () => {
      const agent = await signIn(alphaAdmin.email);
      const { id } = await validated(agent, `${HEADER}\nrevenue,2027-04,7777,muscat\n`);

      const cancelled = await agent.post(`/api/imports/${id}/cancel`).expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');

      await agent.post(`/api/imports/${id}/commit`).expect(409);

      const values = await prisma.metricValue.count({
        where: { organizationId: alpha.id, sourceRef: id },
      });
      expect(values).toBe(0);
    });

    it('lets the same file be uploaded again after a cancellation', async () => {
      const agent = await signIn(alphaAdmin.email);
      const csv = `${HEADER}\nrevenue,2027-05,321,muscat\n`;

      const first = await upload(agent, csv);
      await agent.post(`/api/imports/${first.body.import.id}/cancel`).expect(200);

      const second = await upload(agent, csv);
      expect(second.status).toBe(201);
    });

    it('refuses to cancel a committed import', async () => {
      const agent = await signIn(alphaAdmin.email);
      const { id } = await validated(agent, `${HEADER}\nrevenue,2027-06,111,muscat\n`);
      await agent.post(`/api/imports/${id}/commit`).expect(200);

      await agent.post(`/api/imports/${id}/cancel`).expect(409);
    });
  });

  describe('tenant isolation', () => {
    it('does not list another organization’s imports', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const betaUpload = await upload(betaAgent, `${HEADER}\nrevenue,2028-01,50,muscat\n`);
      const alphaList = await alphaAgent.get('/api/imports').query({ pageSize: 100 }).expect(200);

      expect(alphaList.body.items.map((entry: { id: string }) => entry.id)).not.toContain(
        betaUpload.body.import.id,
      );
    });

    it('cannot read or drive another organization’s import', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const betaUpload = await upload(betaAgent, `${HEADER}\nrevenue,2028-02,60,muscat\n`);
      const betaImportId = betaUpload.body.import.id;

      await alphaAgent.get(`/api/imports/${betaImportId}`).expect(404);
      await alphaAgent.get(`/api/imports/${betaImportId}/rows`).expect(404);
      await alphaAgent.post(`/api/imports/${betaImportId}/map`).send(MAPPING).expect(404);
      await alphaAgent.post(`/api/imports/${betaImportId}/validate`).expect(404);
      await alphaAgent.post(`/api/imports/${betaImportId}/commit`).expect(404);
      await alphaAgent.post(`/api/imports/${betaImportId}/cancel`).expect(404);

      const untouched = await prisma.dataImport.findUniqueOrThrow({ where: { id: betaImportId } });
      expect(untouched.status).toBe('UPLOADED');
    });

    it('resolves metric and branch codes inside the caller’s organization only', async () => {
      const betaAgent = await signIn(betaAdmin.email);
      const { id } = await validated(betaAgent, `${HEADER}\nrevenue,2028-03,4321,muscat\n`);

      await betaAgent.post(`/api/imports/${id}/commit`).expect(200);

      const stored = await prisma.metricValue.findMany({
        where: { sourceRef: id },
        include: { metric: { select: { organizationId: true } }, branch: true },
      });

      expect(stored).toHaveLength(1);
      expect(stored[0].organizationId).toBe(beta.id);
      expect(stored[0].metric.organizationId).toBe(beta.id);
      expect(stored[0].branch?.organizationId).toBe(beta.id);
    });

    it('lets both organizations import the same file content independently', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);
      const csv = `${HEADER}\nrevenue,2028-04,999,muscat\n`;

      const alphaImport = await validated(alphaAgent, csv);
      await alphaAgent.post(`/api/imports/${alphaImport.id}/commit`).expect(200);

      // The checksum is unique per organization, not globally.
      const betaImport = await validated(betaAgent, csv);
      await betaAgent.post(`/api/imports/${betaImport.id}/commit`).expect(200);

      const values = await prisma.metricValue.findMany({
        where: {
          periodStart: new Date('2028-04-01T00:00:00.000Z'),
          organizationId: { in: [alpha.id, beta.id] },
        },
        select: { organizationId: true },
      });

      expect(values.map((value) => value.organizationId).sort()).toEqual(
        [alpha.id, beta.id].sort(),
      );
    });
  });

  describe('audit trail', () => {
    it('records the upload and the commit', async () => {
      const agent = await signIn(alphaAdmin.email);
      const { id } = await validated(agent, `${HEADER}\nrevenue,2028-05,808,muscat\n`);
      await agent.post(`/api/imports/${id}/commit`).expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { organizationId: alpha.id, entityId: id },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.map((entry) => entry.action)).toEqual([
        'import.uploaded',
        'import.mapped',
        'import.committed',
      ]);
      expect(entries[2].after).toMatchObject({ valuesWritten: 1 });
    });
  });

  describe('data sources and quality', () => {
    it('attaches an import to a source and stamps its last sync', async () => {
      const agent = await signIn(alphaAdmin.email);

      const source = await agent
        .post('/api/data-sources')
        .send({ name: `Monthly upload ${unique('s')}`, type: 'CSV' })
        .expect(201);

      const preview = await agent
        .post('/api/imports/upload')
        .field('dataSourceId', source.body.id)
        .attach('file', Buffer.from(`${HEADER}\nrevenue,2028-06,150,muscat\n`), {
          filename: 'monthly.csv',
          contentType: 'text/csv',
        })
        .expect(201);

      const id = preview.body.import.id;
      await agent.post(`/api/imports/${id}/map`).send(MAPPING).expect(200);
      await agent.post(`/api/imports/${id}/validate`).expect(200);
      await agent.post(`/api/imports/${id}/commit`).expect(200);

      const sources = await agent.get('/api/data-sources').expect(200);
      const updated = sources.body.find((entry: { id: string }) => entry.id === source.body.id);

      expect(updated.lastSyncAt).not.toBeNull();
      expect(updated.importCount).toBe(1);
    });

    it('rejects a data source belonging to another organization', async () => {
      const alphaAgent = await signIn(alphaAdmin.email);
      const betaAgent = await signIn(betaAdmin.email);

      const betaSource = await betaAgent
        .post('/api/data-sources')
        .send({ name: `Beta source ${unique('s')}`, type: 'CSV' })
        .expect(201);

      const response = await alphaAgent
        .post('/api/imports/upload')
        .field('dataSourceId', betaSource.body.id)
        .attach('file', Buffer.from(`${HEADER}\nrevenue,2028-07,1,muscat\n`), {
          filename: 'x.csv',
          contentType: 'text/csv',
        })
        .expect(400);

      expect(response.body.details[0].field).toBe('dataSourceId');
    });

    it('reports data quality from what was actually imported', async () => {
      const agent = await signIn(alphaAdmin.email);

      const report = await agent.get('/api/data-quality').expect(200);

      expect(report.body.overallScore).toBeGreaterThan(0);
      expect(report.body.completenessPct).toBeGreaterThan(0);
      expect(report.body.freshness).toBe('GOOD');
      expect(report.body.errorCount).toBeGreaterThan(0);
      expect(report.body.lastUpdatedAt).not.toBeNull();
    });

    it('reports unknown quality for an organization with no imports', async () => {
      const organization = await createOrganization(prisma);
      const admin = await createUser(prisma, {
        memberships: [
          { organizationId: organization.id, role: 'ORGANIZATION_ADMIN', isDefault: true },
        ],
      });
      organizationIds.push(organization.id);
      userIds.push(admin.id);

      const agent = await signIn(admin.email);
      const report = await agent.get('/api/data-quality').expect(200);

      expect(report.body).toMatchObject({
        overallScore: 0,
        freshness: 'UNKNOWN',
        confidence: 'UNKNOWN',
        lastUpdatedAt: null,
      });
    });
  });
});
