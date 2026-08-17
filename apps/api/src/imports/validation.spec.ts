import { validateRows, type MetricDefinition, type ValidationContext } from './validation';

function metric(overrides: Partial<MetricDefinition> = {}): MetricDefinition {
  return {
    id: 'metric-revenue',
    code: 'revenue',
    name: 'Revenue',
    unit: 'CURRENCY',
    frequency: 'MONTHLY',
    isCalculated: false,
    ...overrides,
  };
}

function buildContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    mapping: {
      metricCode: 'Metric',
      period: 'Period',
      value: 'Value',
      branchCode: 'Branch',
      departmentCode: 'Department',
      currency: null,
    },
    metrics: new Map([
      ['revenue', metric()],
      [
        'patients',
        metric({ id: 'metric-patients', code: 'patients', name: 'Patients', unit: 'COUNT' }),
      ],
      [
        'no_show_rate',
        metric({
          id: 'metric-no-show',
          code: 'no_show_rate',
          name: 'No-Show Rate',
          unit: 'PERCENTAGE',
        }),
      ],
    ]),
    branches: new Map([['muscat', 'branch-muscat']]),
    departments: new Map([['finance', 'department-finance']]),
    currencyCode: 'OMR',
    ...overrides,
  };
}

const row = (values: Record<string, string>) => ({
  Metric: 'revenue',
  Period: '2026-01',
  Value: '1000',
  Branch: '',
  Department: '',
  ...values,
});

describe('validateRows', () => {
  it('accepts a well-formed row and resolves its references', () => {
    const summary = validateRows(
      [row({ Branch: 'muscat', Department: 'finance' })],
      buildContext(),
    );

    expect(summary).toMatchObject({ rowsReceived: 1, rowsValid: 1, rowsRejected: 0 });
    expect(summary.rows[0].parsed).toMatchObject({
      metricId: 'metric-revenue',
      branchId: 'branch-muscat',
      departmentId: 'department-finance',
      periodType: 'MONTH',
      value: '1000',
    });
  });

  it('matches metric and reference codes case-insensitively', () => {
    const summary = validateRows([row({ Metric: 'REVENUE', Branch: 'Muscat' })], buildContext());

    expect(summary.rowsValid).toBe(1);
    expect(summary.rows[0].parsed?.branchId).toBe('branch-muscat');
  });

  it('treats an organization-level row as valid with no branch', () => {
    const summary = validateRows([row({})], buildContext());

    expect(summary.rows[0].parsed).toMatchObject({ branchId: null, departmentId: null });
  });

  describe('rejections', () => {
    it.each([
      ['a missing metric code', { Metric: '' }, 'MISSING_METRIC'],
      ['an unknown metric code', { Metric: 'made_up' }, 'UNKNOWN_METRIC'],
      ['a missing period', { Period: '' }, 'MISSING_PERIOD'],
      ['an unparseable period', { Period: 'January 2026' }, 'INVALID_PERIOD'],
      ['a missing value', { Value: '' }, 'MISSING_VALUE'],
      ['a non-numeric value', { Value: 'n/a' }, 'INVALID_NUMBER'],
      ['an unknown branch', { Branch: 'nowhere' }, 'UNKNOWN_BRANCH'],
      ['an unknown department', { Department: 'nowhere' }, 'UNKNOWN_DEPARTMENT'],
    ])('rejects %s', (_label, override, expectedCode) => {
      const summary = validateRows([row(override)], buildContext());

      expect(summary.rowsRejected).toBe(1);
      expect(summary.rows[0].status).toBe('REJECTED');
      expect(summary.rows[0].issues.map((issue) => issue.code)).toContain(expectedCode);
      expect(summary.rows[0].parsed).toBeUndefined();
    });

    it('rejects a period that does not match the metric frequency', () => {
      const summary = validateRows([row({ Period: '2026-01-15' })], buildContext());

      expect(summary.rows[0].issues[0]).toMatchObject({ code: 'FREQUENCY_MISMATCH' });
      expect(summary.rows[0].issues[0].message).toContain('monthly');
    });

    it('rejects a calculated metric, which the platform derives itself', () => {
      const context = buildContext();
      context.metrics.set(
        'margin',
        metric({ id: 'metric-margin', code: 'margin', name: 'Margin', isCalculated: true }),
      );

      const summary = validateRows([row({ Metric: 'margin' })], context);

      expect(summary.rows[0].issues[0].code).toBe('CALCULATED_METRIC');
    });

    it('rejects a negative count', () => {
      const summary = validateRows([row({ Metric: 'patients', Value: '-4' })], buildContext());

      expect(summary.rows[0].issues[0].code).toBe('NEGATIVE_NOT_ALLOWED');
    });

    it('rejects a currency that is not the organization currency', () => {
      const context = buildContext();
      context.mapping.currency = 'Currency';

      const summary = validateRows([{ ...row({}), Currency: 'USD' }], context);

      expect(summary.rows[0].issues[0]).toMatchObject({ code: 'UNSUPPORTED_CURRENCY' });
      expect(summary.rows[0].issues[0].message).toContain('OMR');
    });

    it('rejects a duplicate of an earlier row and names it', () => {
      const summary = validateRows(
        [row({ Branch: 'muscat' }), row({ Branch: 'muscat', Value: '2000' })],
        buildContext(),
      );

      expect(summary.rowsValid).toBe(1);
      expect(summary.rowsRejected).toBe(1);
      expect(summary.rows[1].issues[0]).toMatchObject({ code: 'DUPLICATE_ROW' });
      expect(summary.rows[1].issues[0].message).toContain('row 1');
    });

    it('does not treat the same metric in different branches as a duplicate', () => {
      const context = buildContext();
      context.branches.set('salalah', 'branch-salalah');

      const summary = validateRows(
        [row({ Branch: 'muscat' }), row({ Branch: 'salalah' })],
        context,
      );

      expect(summary.rowsValid).toBe(2);
    });

    it('keeps every rejected row, so nothing is silently discarded', () => {
      const summary = validateRows(
        [row({}), row({ Metric: 'made_up' }), row({ Value: 'oops' })],
        buildContext(),
      );

      expect(summary.rows).toHaveLength(3);
      expect(
        summary.rows.every((entry) => entry.issues.length > 0 || entry.status === 'VALID'),
      ).toBe(true);
    });
  });

  describe('warnings', () => {
    it('imports an out-of-range percentage but flags it', () => {
      const summary = validateRows([row({ Metric: 'no_show_rate', Value: '140' })], buildContext());

      expect(summary.rows[0].status).toBe('WARNING');
      expect(summary.rows[0].issues[0].code).toBe('PERCENTAGE_OUT_OF_RANGE');
      expect(summary.rows[0].parsed).toBeDefined();
      expect(summary.rowsWarning).toBe(1);
    });

    it('rejects a percentage that cannot be a rounding artefact', () => {
      const summary = validateRows(
        [row({ Metric: 'no_show_rate', Value: '5000' })],
        buildContext(),
      );

      expect(summary.rows[0].status).toBe('REJECTED');
    });

    it('warns about a fractional count', () => {
      const summary = validateRows([row({ Metric: 'patients', Value: '12.5' })], buildContext());

      expect(summary.rows[0].status).toBe('WARNING');
      expect(summary.rows[0].issues[0].code).toBe('FRACTIONAL_COUNT');
    });

    it('warns when a currency column is used on a non-currency metric', () => {
      const context = buildContext();
      context.mapping.currency = 'Currency';

      const summary = validateRows(
        [{ ...row({ Metric: 'patients', Value: '10' }), Currency: 'OMR' }],
        context,
      );

      expect(summary.rows[0].status).toBe('WARNING');
      expect(summary.rows[0].issues[0].code).toBe('CURRENCY_ON_NON_CURRENCY_METRIC');
    });
  });

  it('summarises the whole file', () => {
    const summary = validateRows(
      [
        row({}),
        row({ Period: '2026-02' }),
        row({ Metric: 'no_show_rate', Period: '2026-03', Value: '150' }),
        row({ Value: 'oops', Period: '2026-04' }),
      ],
      buildContext(),
    );

    expect(summary).toMatchObject({
      rowsReceived: 4,
      rowsValid: 2,
      rowsWarning: 1,
      rowsRejected: 1,
    });
  });
});
