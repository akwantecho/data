import type { PackDefinition } from './pack-definition';

/**
 * Real Estate pack (plan §20).
 *
 * Occupancy, vacancy and revenue per unit are calculated from the unit counts a
 * portfolio already reports. Stock metrics (properties, units) aggregate as LAST
 * rather than SUM: a portfolio of 400 units is 400 units, not 4,800 a year.
 */
export const realEstatePack: PackDefinition = {
  code: 'real_estate_core',
  name: 'Real Estate Core',
  industryCode: 'real_estate',
  version: '1.0.0',
  description: 'Default metrics, health model and rules for property management and leasing.',
  metrics: [
    {
      code: 'revenue',
      name: 'Revenue',
      description: 'Rental and related income for the period.',
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'properties',
      name: 'Properties',
      description: 'Properties under management at the end of the period.',
      category: 'Asset Performance',
      unit: 'COUNT',
      aggregationType: 'LAST',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'units',
      name: 'Units',
      description: 'Lettable units at the end of the period.',
      category: 'Asset Performance',
      unit: 'COUNT',
      aggregationType: 'LAST',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'occupied_units',
      name: 'Occupied Units',
      category: 'Occupancy',
      unit: 'COUNT',
      aggregationType: 'LAST',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'vacant_units',
      name: 'Vacant Units',
      category: 'Occupancy',
      unit: 'COUNT',
      aggregationType: 'LAST',
      frequency: 'MONTHLY',
      direction: 'LOWER_IS_BETTER',
    },
    {
      code: 'occupancy_rate',
      name: 'Occupancy Rate',
      category: 'Occupancy',
      unit: 'PERCENTAGE',
      aggregationType: 'FORMULA',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      formula: 'occupied_units / units * 100',
    },
    {
      code: 'vacancy_rate',
      name: 'Vacancy Rate',
      category: 'Occupancy',
      unit: 'PERCENTAGE',
      aggregationType: 'FORMULA',
      frequency: 'MONTHLY',
      direction: 'LOWER_IS_BETTER',
      formula: 'vacant_units / units * 100',
    },
    {
      code: 'rental_yield',
      name: 'Rental Yield',
      description: 'Annualised rental income against asset value.',
      category: 'Financial',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'collection_rate',
      name: 'Collection Rate',
      description: 'Rent collected against rent billed.',
      category: 'Collections',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'maintenance_cost',
      name: 'Maintenance Cost',
      category: 'Maintenance',
      unit: 'CURRENCY',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'LOWER_IS_BETTER',
    },
    {
      code: 'revenue_per_unit',
      name: 'Revenue per Unit',
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'FORMULA',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      formula: 'revenue / units',
    },
    {
      code: 'renewal_rate',
      name: 'Renewal Rate',
      description: 'Share of expiring leases renewed.',
      category: 'Occupancy',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
  ],
  healthModel: {
    name: 'Real Estate Health Model',
    categories: [
      {
        code: 'financial',
        name: 'Financial',
        weight: 30,
        metrics: [
          { code: 'revenue', weight: 40 },
          { code: 'revenue_per_unit', weight: 30 },
          { code: 'rental_yield', weight: 30 },
        ],
      },
      {
        code: 'occupancy',
        name: 'Occupancy',
        weight: 25,
        metrics: [
          { code: 'occupancy_rate', weight: 60 },
          { code: 'vacancy_rate', weight: 20 },
          { code: 'renewal_rate', weight: 20 },
        ],
      },
      {
        code: 'collections',
        name: 'Collections',
        weight: 20,
        metrics: [{ code: 'collection_rate', weight: 100 }],
      },
      {
        code: 'asset_performance',
        name: 'Asset Performance',
        weight: 15,
        metrics: [
          { code: 'units', weight: 50 },
          { code: 'properties', weight: 50 },
        ],
      },
      {
        code: 'maintenance',
        name: 'Maintenance',
        weight: 10,
        metrics: [{ code: 'maintenance_cost', weight: 100 }],
      },
    ],
  },
  insightRules: [
    {
      code: 'vacancy_eroding_revenue',
      name: 'Vacancy is eroding revenue',
      severity: 'HIGH',
      category: 'Occupancy',
      definition: {
        conditions: [
          { metric: 'vacancy_rate', measure: 'CHANGE_PCT', operator: 'GT', value: 5 },
          { metric: 'revenue', measure: 'CHANGE_PCT', operator: 'LT', value: 0 },
        ],
        narrative:
          'Vacancy rose and revenue fell with it. Letting velocity and asking rents are the two levers to check first.',
        evidence: ['vacancy_rate', 'occupancy_rate', 'revenue'],
      },
    },
    {
      code: 'collections_weakening',
      name: 'Collections weakening',
      severity: 'HIGH',
      category: 'Collections',
      definition: {
        conditions: [
          { metric: 'collection_rate', measure: 'CHANGE_PCT', operator: 'LT', value: -5 },
        ],
        narrative:
          'A smaller share of billed rent was collected than in the previous period. Arrears build quietly and compound.',
        evidence: ['collection_rate', 'revenue', 'occupied_units'],
      },
    },
    {
      code: 'maintenance_outpacing_revenue',
      name: 'Maintenance outpacing revenue',
      severity: 'WARNING',
      category: 'Maintenance',
      definition: {
        conditions: [
          { metric: 'maintenance_cost', measure: 'CHANGE_PCT', operator: 'GT', value: 10 },
          { metric: 'revenue', measure: 'CHANGE_PCT', operator: 'LT', value: 0 },
        ],
        narrative:
          'Maintenance spend grew more than 10% while revenue fell. Recurring repairs on ageing units usually explain both.',
        evidence: ['maintenance_cost', 'revenue', 'revenue_per_unit'],
      },
    },
    {
      code: 'full_portfolio_supports_a_rent_review',
      name: 'A full portfolio supports a rent review',
      description:
        'An opportunity rather than a problem: the decision centre reads INFO insights as its opportunities.',
      severity: 'INFO',
      category: 'Asset Performance',
      definition: {
        conditions: [
          { metric: 'occupancy_rate', measure: 'VALUE', operator: 'GT', value: 95 },
          { metric: 'renewal_rate', measure: 'VALUE', operator: 'GT', value: 80 },
          { metric: 'revenue_per_unit', measure: 'CHANGE_PCT', operator: 'LT', value: 2 },
        ],
        narrative:
          'Units are close to full and tenants are renewing, but revenue per unit is flat. A rent review is worth modelling before the next renewal cycle.',
        evidence: ['occupancy_rate', 'renewal_rate', 'revenue_per_unit'],
      },
    },
  ],
  alertRules: [
    {
      code: 'collection_rate_below_threshold',
      name: 'Collection rate below threshold',
      metric: 'collection_rate',
      type: 'METRIC_BELOW_THRESHOLD',
      severity: 'HIGH',
      definition: { usesConfiguredThreshold: true },
    },
    {
      code: 'vacancy_rate_above_threshold',
      name: 'Vacancy rate above threshold',
      metric: 'vacancy_rate',
      type: 'METRIC_ABOVE_THRESHOLD',
      severity: 'WARNING',
      definition: { usesConfiguredThreshold: true },
    },
    {
      code: 'revenue_target_missed',
      name: 'Revenue target missed',
      metric: 'revenue',
      type: 'TARGET_MISSED',
      severity: 'WARNING',
      definition: { tolerancePct: 5 },
    },
  ],
};
