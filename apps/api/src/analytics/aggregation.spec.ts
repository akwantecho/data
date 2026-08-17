import { Prisma } from '@prisma/client';
import {
  aggregateMetric,
  combinePeriods,
  combineSlices,
  periodsFor,
  type MetricShape,
  type StoredValue,
} from './aggregation';

const decimal = (value: string) => new Prisma.Decimal(value);

const ORGANIZATION = { branchId: null, departmentId: null };

function shapes(...entries: Array<[string, MetricShape['aggregationType'], string?]>) {
  return new Map<string, MetricShape>(
    entries.map(([code, aggregationType, formula]) => [
      code,
      { code, aggregationType, formula: formula ?? null },
    ]),
  );
}

function value(
  metricCode: string,
  periodStart: string,
  amount: string,
  slice: { branchId?: string | null; departmentId?: string | null } = {},
): StoredValue {
  return {
    metricCode,
    periodStart,
    branchId: slice.branchId ?? null,
    departmentId: slice.departmentId ?? null,
    value: decimal(amount),
  };
}

describe('combineSlices', () => {
  it('prefers a value reported at the requested level over a roll-up beneath it', () => {
    const values = [
      value('revenue', '2026-01-01', '300'),
      value('revenue', '2026-01-01', '180', { branchId: 'b1' }),
      value('revenue', '2026-01-01', '140', { branchId: 'b2' }),
    ];

    // 300 is what the organization reported; 320 would double count.
    expect(combineSlices(values, 'SUM', ORGANIZATION)?.toString()).toBe('300');
  });

  it('rolls branches up when no organization-level value exists', () => {
    const values = [
      value('revenue', '2026-01-01', '180', { branchId: 'b1' }),
      value('revenue', '2026-01-01', '140', { branchId: 'b2' }),
    ];

    expect(combineSlices(values, 'SUM', ORGANIZATION)?.toString()).toBe('320');
  });

  it('averages a rate across branches rather than summing it', () => {
    const values = [
      value('occupancy_rate', '2026-01-01', '80', { branchId: 'b1' }),
      value('occupancy_rate', '2026-01-01', '60', { branchId: 'b2' }),
    ];

    expect(combineSlices(values, 'AVERAGE', ORGANIZATION)?.toString()).toBe('70');
  });

  it('sums a stock metric across branches even though it aggregates as LAST in time', () => {
    const values = [
      value('units', '2026-01-01', '250', { branchId: 'b1' }),
      value('units', '2026-01-01', '150', { branchId: 'b2' }),
    ];

    expect(combineSlices(values, 'LAST', ORGANIZATION)?.toString()).toBe('400');
  });

  it('returns only the requested branch when one is asked for', () => {
    const values = [
      value('revenue', '2026-01-01', '180', { branchId: 'b1' }),
      value('revenue', '2026-01-01', '140', { branchId: 'b2' }),
    ];

    expect(combineSlices(values, 'SUM', { branchId: 'b1', departmentId: null })?.toString()).toBe(
      '180',
    );
  });

  it('rolls a branch’s departments up when the branch itself reported nothing', () => {
    const values = [
      value('revenue', '2026-01-01', '90', { branchId: 'b1', departmentId: 'd1' }),
      value('revenue', '2026-01-01', '60', { branchId: 'b1', departmentId: 'd2' }),
      value('revenue', '2026-01-01', '500', { branchId: 'b2' }),
    ];

    expect(combineSlices(values, 'SUM', { branchId: 'b1', departmentId: null })?.toString()).toBe(
      '150',
    );
  });

  it('rolls up one level at a time, so a department is not added to its own branch', () => {
    const values = [
      value('revenue', '2026-01-01', '300', { branchId: 'b1' }),
      value('revenue', '2026-01-01', '150', { branchId: 'b2' }),
      // Already part of b1's 300 — counting it again would report 570.
      value('revenue', '2026-01-01', '120', { branchId: 'b1', departmentId: 'd1' }),
    ];

    expect(combineSlices(values, 'SUM', ORGANIZATION)?.toString()).toBe('450');
  });

  it('falls through to departments only when no branch reported', () => {
    const values = [
      value('revenue', '2026-01-01', '120', { branchId: 'b1', departmentId: 'd1' }),
      value('revenue', '2026-01-01', '80', { branchId: 'b2', departmentId: 'd2' }),
    ];

    expect(combineSlices(values, 'SUM', ORGANIZATION)?.toString()).toBe('200');
  });

  it('does not invent a department figure from its siblings', () => {
    const values = [value('revenue', '2026-01-01', '90', { branchId: 'b1', departmentId: 'd1' })];

    expect(combineSlices(values, 'SUM', { branchId: 'b1', departmentId: 'd2' })).toBeNull();
  });

  it('has nothing to say about an empty period', () => {
    expect(combineSlices([], 'SUM', ORGANIZATION)).toBeNull();
  });
});

describe('combinePeriods', () => {
  const points = [
    { periodStart: '2026-01-01', value: decimal('100') },
    { periodStart: '2026-02-01', value: decimal('140') },
    { periodStart: '2026-03-01', value: decimal('120') },
  ];

  it.each([
    ['SUM', '360'],
    ['AVERAGE', '120'],
    ['MIN', '100'],
    ['MAX', '140'],
    ['LAST', '120'],
  ] as const)('%s over a window', (type, expected) => {
    expect(combinePeriods(points, type)?.toString()).toBe(expected);
  });

  it('takes the latest period for LAST regardless of the order it was given in', () => {
    const shuffled = [points[2], points[0], points[1]];

    expect(combinePeriods(shuffled, 'LAST')?.toString()).toBe('120');
  });

  it('returns nothing for an empty window rather than zero', () => {
    // Zero is a figure someone reported; nothing is the absence of one.
    expect(combinePeriods([], 'SUM')).toBeNull();
  });
});

describe('aggregateMetric', () => {
  const periods = ['2026-01-01', '2026-02-01', '2026-03-01'];

  it('sums a stored metric across the window and keeps its series', () => {
    const result = aggregateMetric(
      'revenue',
      shapes(['revenue', 'SUM']),
      [
        value('revenue', '2026-01-01', '100'),
        value('revenue', '2026-02-01', '140'),
        value('revenue', '2026-03-01', '120'),
      ],
      periods,
      ORGANIZATION,
    );

    expect(result.value?.toString()).toBe('360');
    expect(result.method).toBe('SUM');
    expect(result.series).toHaveLength(3);
    expect(result.missingPeriods).toBe(0);
  });

  it('counts the periods that reported nothing', () => {
    const result = aggregateMetric(
      'revenue',
      shapes(['revenue', 'SUM']),
      [value('revenue', '2026-01-01', '100')],
      periods,
      ORGANIZATION,
    );

    expect(result.value?.toString()).toBe('100');
    expect(result.missingPeriods).toBe(2);
  });

  it('recomputes a formula from aggregated inputs instead of averaging its own values', () => {
    const metrics = shapes(
      ['revenue', 'SUM'],
      ['available_rooms', 'SUM'],
      ['revpar', 'FORMULA', 'revenue / available_rooms'],
    );

    const values = [
      value('revenue', '2026-01-01', '300'),
      value('revenue', '2026-02-01', '600'),
      value('available_rooms', '2026-01-01', '30'),
      value('available_rooms', '2026-02-01', '30'),
    ];

    const result = aggregateMetric('revpar', metrics, values, periods.slice(0, 2), ORGANIZATION);

    // 900 / 60 = 15. The mean of the monthly RevPARs (10 and 20) is 15 here only
    // because the room count is flat; the next test is the one that separates them.
    expect(result.value?.toString()).toBe('15');
    expect(result.method).toBe('RECOMPUTED_FROM_INPUTS');
    expect(result.series.map((point) => point.value.toString())).toEqual(['10', '20']);
  });

  it('differs from the average of the monthly ratios, which is the point', () => {
    const metrics = shapes(
      ['revenue', 'SUM'],
      ['available_rooms', 'SUM'],
      ['revpar', 'FORMULA', 'revenue / available_rooms'],
    );

    const values = [
      value('revenue', '2026-01-01', '300'),
      value('revenue', '2026-02-01', '600'),
      value('available_rooms', '2026-01-01', '10'),
      value('available_rooms', '2026-02-01', '100'),
    ];

    const result = aggregateMetric('revpar', metrics, values, periods.slice(0, 2), ORGANIZATION);

    // Correct: 900 / 110. The mean of 30 and 6 would be 18 — a number nobody earned.
    expect(result.value?.toDecimalPlaces(4).toString()).toBe('8.1818');
  });

  it('recomputes a formula whose input is itself a formula', () => {
    const metrics = shapes(
      ['revenue', 'SUM'],
      ['expenses', 'SUM'],
      ['net_profit', 'FORMULA', 'revenue - expenses'],
      ['net_margin', 'FORMULA', 'net_profit / revenue * 100'],
    );

    const values = [
      value('revenue', '2026-01-01', '100'),
      value('revenue', '2026-02-01', '300'),
      value('expenses', '2026-01-01', '60'),
      value('expenses', '2026-02-01', '140'),
    ];

    const result = aggregateMetric(
      'net_margin',
      metrics,
      values,
      periods.slice(0, 2),
      ORGANIZATION,
    );

    // (400 - 200) / 400 * 100 = 50.
    expect(result.value?.toString()).toBe('50');
  });

  it('produces nothing when an input is missing for the window', () => {
    const metrics = shapes(
      ['revenue', 'SUM'],
      ['available_rooms', 'SUM'],
      ['revpar', 'FORMULA', 'revenue / available_rooms'],
    );

    const result = aggregateMetric(
      'revpar',
      metrics,
      [value('revenue', '2026-01-01', '300')],
      periods,
      ORGANIZATION,
    );

    expect(result.value).toBeNull();
    expect(result.method).toBe('RECOMPUTED_FROM_INPUTS');
  });

  it('produces nothing rather than Infinity when the aggregated divisor is zero', () => {
    const metrics = shapes(
      ['revenue', 'SUM'],
      ['available_rooms', 'SUM'],
      ['revpar', 'FORMULA', 'revenue / available_rooms'],
    );

    const values = [
      value('revenue', '2026-01-01', '300'),
      value('available_rooms', '2026-01-01', '0'),
    ];

    const result = aggregateMetric('revpar', metrics, values, ['2026-01-01'], ORGANIZATION);

    expect(result.value).toBeNull();
    expect(result.series).toHaveLength(0);
  });

  it('aggregates a formula from the requested branch’s own inputs', () => {
    const metrics = shapes(
      ['revenue', 'SUM'],
      ['units', 'LAST'],
      ['revenue_per_unit', 'FORMULA', 'revenue / units'],
    );

    const values = [
      value('revenue', '2026-01-01', '1000', { branchId: 'b1' }),
      value('revenue', '2026-01-01', '400', { branchId: 'b2' }),
      value('units', '2026-01-01', '10', { branchId: 'b1' }),
      value('units', '2026-01-01', '40', { branchId: 'b2' }),
    ];

    const forBranch = aggregateMetric('revenue_per_unit', metrics, values, ['2026-01-01'], {
      branchId: 'b1',
      departmentId: null,
    });
    const forOrganization = aggregateMetric(
      'revenue_per_unit',
      metrics,
      values,
      ['2026-01-01'],
      ORGANIZATION,
    );

    expect(forBranch.value?.toString()).toBe('100');
    // Organization-wide: 1400 / 50, not the mean of 100 and 10.
    expect(forOrganization.value?.toString()).toBe('28');
  });

  it('refuses to loop on a cycle read straight from the database', () => {
    const metrics = shapes(['a', 'FORMULA', 'b + 1'], ['b', 'FORMULA', 'a + 1']);

    const result = aggregateMetric('a', metrics, [], ['2026-01-01'], ORGANIZATION);

    expect(result.value).toBeNull();
  });

  it('says nothing about a metric it does not know', () => {
    expect(aggregateMetric('ghost', shapes(), [], periods, ORGANIZATION).value).toBeNull();
  });
});

describe('periodsFor', () => {
  it('uses the metric’s own periods', () => {
    const values = [value('revenue', '2026-02-01', '1'), value('revenue', '2026-01-01', '1')];

    expect(periodsFor('revenue', shapes(['revenue', 'SUM']), values)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
  });

  it('widens a formula’s window to every period its inputs reported', () => {
    const metrics = shapes(
      ['revenue', 'SUM'],
      ['units', 'LAST'],
      ['revenue_per_unit', 'FORMULA', 'revenue / units'],
    );

    const values = [
      value('revenue', '2026-01-01', '1'),
      value('units', '2026-02-01', '1'),
      value('revenue_per_unit', '2026-01-01', '1'),
    ];

    expect(periodsFor('revenue_per_unit', metrics, values)).toEqual(['2026-01-01', '2026-02-01']);
  });
});
