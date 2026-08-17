import { GOAL_STATUSES } from '@sip/shared-types';
import { z } from 'zod';

/** A date the API accepts on a goal: calendar days, never timestamps. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form YYYY-MM-DD');

/** Money and rates arrive as strings so no figure loses precision in transit. */
const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Enter a number');

export const listGoalsSchema = z.object({
  status: z.enum(GOAL_STATUSES).optional(),
  ownerId: z.string().uuid('A valid person is required').optional(),
});

export type ListGoalsDto = z.infer<typeof listGoalsSchema>;

const goalFields = {
  title: z.string().trim().min(3, 'Give the goal a title').max(200),
  description: z.string().trim().max(2000).nullish(),
  ownerId: z.string().uuid('A valid person is required').nullish(),
  /** The metric that drives progress. Without one, progress is entered by hand. */
  metricId: z.string().uuid('A valid metric is required').nullish(),
  supportingMetricIds: z.array(z.string().uuid('A valid metric is required')).max(10).optional(),
  baselineValue: decimalString.nullish(),
  targetValue: decimalString,
  startDate: isoDate,
  dueDate: isoDate,
  status: z.enum(GOAL_STATUSES).optional(),
};

export const createGoalSchema = z
  .object(goalFields)
  .strict()
  .refine((value) => value.startDate <= value.dueDate, {
    message: 'The due date must be on or after the start date',
    path: ['dueDate'] as string[],
  });

export type CreateGoalDto = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = z
  .object({
    title: goalFields.title.optional(),
    description: goalFields.description,
    ownerId: goalFields.ownerId,
    metricId: goalFields.metricId,
    supportingMetricIds: goalFields.supportingMetricIds,
    baselineValue: goalFields.baselineValue,
    targetValue: goalFields.targetValue.optional(),
    startDate: goalFields.startDate.optional(),
    dueDate: goalFields.dueDate.optional(),
    status: goalFields.status,
  })
  .strict()
  .refine(
    (value) => !value.startDate || !value.dueDate || value.startDate <= value.dueDate,
    { message: 'The due date must be on or after the start date', path: ['dueDate'] as string[] },
  );

export type UpdateGoalDto = z.infer<typeof updateGoalSchema>;

/** A note a person records against a goal, alongside the automatic history. */
export const goalNoteSchema = z
  .object({
    note: z.string().trim().min(1, 'Write the note').max(1000),
  })
  .strict();

export type GoalNoteDto = z.infer<typeof goalNoteSchema>;
