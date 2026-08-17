import {
  DECISION_PRIORITIES,
  DECISION_REVIEW_RESULTS,
  DECISION_STATUSES,
} from '@sip/shared-types';
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form YYYY-MM-DD');

const uuidList = (label: string) =>
  z.array(z.string().uuid(`A valid ${label} is required`)).max(25).optional();

export const listDecisionsSchema = z.object({
  status: z.enum(DECISION_STATUSES).optional(),
  priority: z.enum(DECISION_PRIORITIES).optional(),
  ownerId: z.string().uuid('A valid person is required').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListDecisionsDto = z.infer<typeof listDecisionsSchema>;

const decisionFields = {
  title: z.string().trim().min(3, 'Give the decision a title').max(200),
  problemStatement: z
    .string()
    .trim()
    .min(10, 'Describe the problem this decision addresses')
    .max(2000),
  context: z.string().trim().max(4000).nullish(),
  ownerId: z.string().uuid('A valid person is required').nullish(),
  status: z.enum(DECISION_STATUSES).optional(),
  priority: z.enum(DECISION_PRIORITIES).optional(),
  decisionDate: isoDate.nullish(),
  expectedOutcome: z.string().trim().max(2000).nullish(),
  reviewDate: isoDate.nullish(),
  notes: z.string().trim().max(4000).nullish(),
  metricIds: uuidList('metric'),
  alertIds: uuidList('alert'),
  insightIds: uuidList('insight'),
  goalIds: uuidList('goal'),
};

/**
 * A decision must rest on something (plan §31). Requiring evidence at creation is
 * what makes the record worth keeping: a decision with no figures behind it cannot
 * be reviewed later, because there is nothing to review it against.
 */
export const createDecisionSchema = z
  .object(decisionFields)
  .strict()
  .refine(
    (value) =>
      (value.metricIds?.length ?? 0) +
        (value.alertIds?.length ?? 0) +
        (value.insightIds?.length ?? 0) +
        (value.goalIds?.length ?? 0) >
      0,
    {
      message: 'Link at least one metric, alert, insight or goal as evidence',
      path: ['metricIds'] as string[],
    },
  );

export type CreateDecisionDto = z.infer<typeof createDecisionSchema>;

export const updateDecisionSchema = z
  .object({
    title: decisionFields.title.optional(),
    problemStatement: decisionFields.problemStatement.optional(),
    context: decisionFields.context,
    ownerId: decisionFields.ownerId,
    status: decisionFields.status,
    priority: decisionFields.priority,
    decisionDate: decisionFields.decisionDate,
    expectedOutcome: decisionFields.expectedOutcome,
    reviewDate: decisionFields.reviewDate,
    notes: decisionFields.notes,
    metricIds: decisionFields.metricIds,
    alertIds: decisionFields.alertIds,
    insightIds: decisionFields.insightIds,
    goalIds: decisionFields.goalIds,
  })
  .strict();

export type UpdateDecisionDto = z.infer<typeof updateDecisionSchema>;

export const createDecisionActionSchema = z
  .object({
    title: z.string().trim().min(3, 'Describe the action').max(200),
    description: z.string().trim().max(2000).nullish(),
    ownerId: z.string().uuid('A valid person is required').nullish(),
    dueDate: isoDate.nullish(),
  })
  .strict();

export type CreateDecisionActionDto = z.infer<typeof createDecisionActionSchema>;

export const updateDecisionActionSchema = z
  .object({
    isCompleted: z.boolean(),
  })
  .strict();

export type UpdateDecisionActionDto = z.infer<typeof updateDecisionActionSchema>;

/** The review that closes the loop (plan §32). */
export const reviewDecisionSchema = z
  .object({
    actualOutcome: z.string().trim().min(3, 'Say what actually happened').max(2000),
    result: z.enum(DECISION_REVIEW_RESULTS),
    notes: z.string().trim().max(2000).nullish(),
  })
  .strict();

export type ReviewDecisionDto = z.infer<typeof reviewDecisionSchema>;
