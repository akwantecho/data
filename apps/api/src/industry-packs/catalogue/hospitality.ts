import type { PackDefinition } from './pack-definition';

/**
 * Hospitality / Tourism pack (plan §19).
 *
 * Occupancy rate, ADR and RevPAR are calculated, because they are ratios of
 * figures a property already reports and every hotelier expects them to agree
 * with those figures exactly. The plan writes RevPAR as
 * `Room Revenue / Available Rooms`; the pack's revenue metric is the room
 * revenue a property reports, so the formula uses it directly.
 */
export const hospitalityPack: PackDefinition = {
  code: 'hospitality_core',
  name: 'Hospitality & Tourism Core',
  industryCode: 'hospitality',
  version: '1.0.0',
  description: 'Default metrics, health model and rules for hotels, resorts and travel operators.',
  metrics: [
    {
      code: 'revenue',
      name: 'Revenue',
      description: 'Room revenue for the period.',
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'bookings',
      name: 'Bookings',
      category: 'Demand',
      unit: 'COUNT',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'guests',
      name: 'Guests',
      category: 'Demand',
      unit: 'COUNT',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'available_rooms',
      name: 'Available Rooms',
      description: 'Room nights available in the period.',
      category: 'Occupancy',
      unit: 'COUNT',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'INFORMATIONAL',
    },
    {
      code: 'occupied_rooms',
      name: 'Occupied Rooms',
      description: 'Room nights sold in the period.',
      category: 'Occupancy',
      unit: 'COUNT',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'occupancy_rate',
      name: 'Occupancy Rate',
      category: 'Occupancy',
      unit: 'PERCENTAGE',
      aggregationType: 'FORMULA',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      formula: 'occupied_rooms / available_rooms * 100',
    },
    {
      code: 'adr',
      name: 'ADR',
      description: 'Average daily rate: room revenue per occupied room night.',
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'FORMULA',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      formula: 'revenue / occupied_rooms',
    },
    {
      code: 'revpar',
      name: 'RevPAR',
      description: 'Revenue per available room: room revenue per available room night.',
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'FORMULA',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      formula: 'revenue / available_rooms',
    },
    {
      code: 'cancellation_rate',
      name: 'Cancellation Rate',
      category: 'Demand',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'LOWER_IS_BETTER',
    },
    {
      code: 'average_length_of_stay',
      name: 'Average Length of Stay',
      category: 'Guest Behavior',
      unit: 'DAYS',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'repeat_guest_rate',
      name: 'Repeat Guest Rate',
      category: 'Guest Behavior',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'booking_lead_time',
      name: 'Booking Lead Time',
      description: 'Average days between booking and arrival.',
      category: 'Operations',
      unit: 'DAYS',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
  ],
  healthModel: {
    name: 'Hospitality Health Model',
    categories: [
      {
        code: 'financial',
        name: 'Financial',
        weight: 30,
        metrics: [
          { code: 'revenue', weight: 40 },
          { code: 'revpar', weight: 35 },
          { code: 'adr', weight: 25 },
        ],
      },
      {
        code: 'demand',
        name: 'Demand',
        weight: 20,
        metrics: [
          { code: 'bookings', weight: 60 },
          { code: 'guests', weight: 40 },
        ],
      },
      {
        code: 'occupancy',
        name: 'Occupancy',
        weight: 25,
        metrics: [
          { code: 'occupancy_rate', weight: 70 },
          { code: 'occupied_rooms', weight: 30 },
        ],
      },
      {
        code: 'guest_behavior',
        name: 'Guest Behavior',
        weight: 15,
        metrics: [
          { code: 'repeat_guest_rate', weight: 60 },
          { code: 'average_length_of_stay', weight: 40 },
        ],
      },
      {
        code: 'operations',
        name: 'Operations',
        weight: 10,
        metrics: [
          { code: 'cancellation_rate', weight: 60 },
          { code: 'booking_lead_time', weight: 40 },
        ],
      },
    ],
  },
  insightRules: [
    {
      code: 'occupancy_bought_with_rate',
      name: 'Occupancy bought with rate',
      severity: 'WARNING',
      category: 'Financial',
      definition: {
        conditions: [
          { metric: 'occupancy_rate', measure: 'CHANGE_PCT', operator: 'GT', value: 0 },
          { metric: 'adr', measure: 'CHANGE_PCT', operator: 'LT', value: -5 },
        ],
        narrative:
          'Occupancy improved while the average daily rate fell — rooms are filling because they are cheaper. Check whether RevPAR actually gained.',
        evidence: ['occupancy_rate', 'adr', 'revpar'],
      },
    },
    {
      code: 'cancellations_rising',
      name: 'Cancellations rising',
      severity: 'WARNING',
      category: 'Demand',
      definition: {
        conditions: [
          { metric: 'cancellation_rate', measure: 'CHANGE_PCT', operator: 'GT', value: 15 },
        ],
        narrative:
          'The cancellation rate rose sharply. Booked demand is overstating the rooms you will actually sell.',
        evidence: ['cancellation_rate', 'bookings', 'occupied_rooms'],
      },
    },
    {
      code: 'revpar_decline',
      name: 'RevPAR declined significantly',
      severity: 'HIGH',
      category: 'Financial',
      definition: {
        conditions: [{ metric: 'revpar', measure: 'CHANGE_PCT', operator: 'LT', value: -10 }],
        narrative:
          'RevPAR fell more than 10% against the previous period. Occupancy and rate together explain where it went.',
        evidence: ['revpar', 'occupancy_rate', 'adr'],
      },
    },
  ],
  alertRules: [
    {
      code: 'occupancy_below_threshold',
      name: 'Occupancy below threshold',
      metric: 'occupancy_rate',
      type: 'METRIC_BELOW_THRESHOLD',
      severity: 'WARNING',
      definition: { usesConfiguredThreshold: true },
    },
    {
      code: 'cancellation_rate_above_threshold',
      name: 'Cancellation rate above threshold',
      metric: 'cancellation_rate',
      type: 'METRIC_ABOVE_THRESHOLD',
      severity: 'WARNING',
      definition: { usesConfiguredThreshold: true },
    },
    {
      code: 'revpar_large_drop',
      name: 'RevPAR dropped sharply',
      metric: 'revpar',
      type: 'LARGE_PERIOD_CHANGE',
      severity: 'HIGH',
      definition: { changePct: -15 },
    },
  ],
};
