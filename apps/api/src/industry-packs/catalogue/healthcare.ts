import type { PackDefinition } from './pack-definition';

/**
 * Healthcare pack (plan §18).
 *
 * The metric list is the plan's, unchanged. Only `revenue_per_patient` is
 * calculated: the others are figures a clinic reports rather than derives, and
 * inventing formulas for them would produce numbers nobody could reconcile with
 * their own systems.
 */
export const healthcarePack: PackDefinition = {
  code: 'healthcare_core',
  name: 'Healthcare Core',
  industryCode: 'healthcare',
  version: '1.0.0',
  description: 'Default metrics, health model and rules for clinics, hospitals and medical groups.',
  metrics: [
    {
      code: 'revenue',
      name: 'Revenue',
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'patients',
      name: 'Patients',
      description: 'Distinct patients seen in the period.',
      category: 'Patient Growth',
      unit: 'COUNT',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'appointments',
      name: 'Appointments',
      description: 'Appointments booked for the period.',
      category: 'Patient Growth',
      unit: 'COUNT',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'completed_appointments',
      name: 'Completed Appointments',
      category: 'Operations',
      unit: 'COUNT',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'cancelled_appointments',
      name: 'Cancelled Appointments',
      category: 'Operations',
      unit: 'COUNT',
      aggregationType: 'SUM',
      frequency: 'MONTHLY',
      direction: 'LOWER_IS_BETTER',
    },
    {
      code: 'no_show_rate',
      name: 'No-Show Rate',
      description: 'Booked appointments where the patient did not attend.',
      category: 'Operations',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'LOWER_IS_BETTER',
    },
    {
      code: 'doctor_utilization',
      name: 'Doctor Utilization',
      description: 'Share of available clinical hours actually used.',
      category: 'Utilization',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'revenue_per_patient',
      name: 'Revenue per Patient',
      category: 'Financial',
      unit: 'CURRENCY',
      aggregationType: 'FORMULA',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
      formula: 'revenue / patients',
    },
    {
      code: 'average_waiting_time',
      name: 'Average Waiting Time',
      description: 'Minutes between appointment time and being seen.',
      category: 'Patient Experience',
      unit: 'MINUTES',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'LOWER_IS_BETTER',
    },
    {
      code: 'patient_retention',
      name: 'Patient Retention',
      description: 'Share of patients who returned within the retention window.',
      category: 'Patient Experience',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
    {
      code: 'treatment_completion_rate',
      name: 'Treatment Completion Rate',
      description: 'Share of started treatment plans carried through to completion.',
      category: 'Operations',
      unit: 'PERCENTAGE',
      aggregationType: 'AVERAGE',
      frequency: 'MONTHLY',
      direction: 'HIGHER_IS_BETTER',
    },
  ],
  healthModel: {
    name: 'Healthcare Health Model',
    categories: [
      {
        code: 'financial',
        name: 'Financial',
        weight: 30,
        metrics: [
          { code: 'revenue', weight: 50 },
          { code: 'revenue_per_patient', weight: 50 },
        ],
      },
      {
        code: 'patient_growth',
        name: 'Patient Growth',
        weight: 20,
        metrics: [
          { code: 'patients', weight: 60 },
          { code: 'appointments', weight: 40 },
        ],
      },
      {
        code: 'operations',
        name: 'Operations',
        weight: 20,
        metrics: [
          { code: 'treatment_completion_rate', weight: 40 },
          { code: 'no_show_rate', weight: 35 },
          { code: 'cancelled_appointments', weight: 25 },
        ],
      },
      {
        code: 'utilization',
        name: 'Utilization',
        weight: 15,
        metrics: [{ code: 'doctor_utilization', weight: 100 }],
      },
      {
        code: 'patient_experience',
        name: 'Patient Experience',
        weight: 15,
        metrics: [
          { code: 'patient_retention', weight: 60 },
          { code: 'average_waiting_time', weight: 40 },
        ],
      },
    ],
  },
  insightRules: [
    {
      code: 'volume_up_monetization_down',
      name: 'Volume up, monetization down',
      description: 'The plan §18 example: more appointments earning less per patient.',
      severity: 'WARNING',
      category: 'Financial',
      definition: {
        conditions: [
          { metric: 'appointments', measure: 'CHANGE_PCT', operator: 'GT', value: 0 },
          { metric: 'revenue_per_patient', measure: 'CHANGE_PCT', operator: 'LT', value: 0 },
        ],
        narrative:
          'Patient volume is increasing but monetization per patient is declining. Check pricing, case mix and the services being delivered per visit.',
        evidence: ['appointments', 'revenue_per_patient', 'revenue'],
      },
    },
    {
      code: 'waiting_time_hurting_retention',
      name: 'Waiting time is hurting retention',
      severity: 'WARNING',
      category: 'Patient Experience',
      definition: {
        conditions: [
          { metric: 'average_waiting_time', measure: 'CHANGE_PCT', operator: 'GT', value: 10 },
          { metric: 'patient_retention', measure: 'CHANGE_PCT', operator: 'LT', value: 0 },
        ],
        narrative:
          'Patients are waiting noticeably longer and fewer of them are coming back. Scheduling capacity is the first place to look.',
        evidence: ['average_waiting_time', 'patient_retention', 'appointments'],
      },
    },
    {
      code: 'revenue_decline',
      name: 'Revenue declined significantly',
      severity: 'HIGH',
      category: 'Financial',
      definition: {
        conditions: [{ metric: 'revenue', measure: 'CHANGE_PCT', operator: 'LT', value: -10 }],
        narrative:
          'Revenue fell more than 10% against the previous period. Compare patient volume and revenue per patient to see which side moved.',
        evidence: ['revenue', 'patients', 'revenue_per_patient'],
      },
    },
    {
      code: 'capacity_available_for_growth',
      name: 'Demand is growing while capacity is spare',
      description:
        'An opportunity rather than a problem: the decision centre reads INFO insights as its opportunities.',
      severity: 'INFO',
      category: 'Utilization',
      definition: {
        conditions: [
          { metric: 'appointments', measure: 'CHANGE_PCT', operator: 'GT', value: 5 },
          { metric: 'doctor_utilization', measure: 'VALUE', operator: 'LT', value: 75 },
        ],
        narrative:
          'Appointment demand is rising while doctors are under three quarters utilized. There is room to take on more patients before capacity has to be added.',
        evidence: ['appointments', 'doctor_utilization', 'revenue_per_patient'],
      },
    },
  ],
  alertRules: [
    {
      code: 'no_show_rate_above_threshold',
      name: 'No-show rate above acceptable threshold',
      description: 'The plan §18 example, expressed against the tenant’s own threshold.',
      metric: 'no_show_rate',
      type: 'METRIC_ABOVE_THRESHOLD',
      severity: 'WARNING',
      definition: { usesConfiguredThreshold: true },
    },
    {
      code: 'doctor_utilization_below_threshold',
      name: 'Doctor utilization below threshold',
      metric: 'doctor_utilization',
      type: 'METRIC_BELOW_THRESHOLD',
      severity: 'WARNING',
      definition: { usesConfiguredThreshold: true },
    },
    {
      code: 'revenue_target_missed',
      name: 'Revenue target missed',
      metric: 'revenue',
      type: 'TARGET_MISSED',
      severity: 'HIGH',
      definition: { tolerancePct: 5 },
    },
  ],
};
