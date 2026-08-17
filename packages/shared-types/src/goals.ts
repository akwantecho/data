import type {
  DecisionPriority,
  DecisionReviewResult,
  DecisionStatus,
  GoalStatus,
  MetricUnit,
} from './enums.js';

/** A goal, with the progress the system calculated for it (plan §29). */
export interface GoalSummary {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: GoalStatus;
  baselineValue: string | null;
  targetValue: string;
  currentValue: string | null;
  progressPct: string | null;
  /** Where the goal should be by now, given the time elapsed. */
  expectedProgressPct: string | null;
  startDate: string;
  dueDate: string;
  daysRemaining: number;
  /** The metric that drives progress, when the goal has one. */
  primaryMetric: GoalMetricLink | null;
  supportingMetrics: GoalMetricLink[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalMetricLink {
  metricId: string;
  code: string;
  name: string;
  unit: MetricUnit;
  isPrimary: boolean;
}

export interface GoalUpdateEntry {
  id: string;
  currentValue: string | null;
  progressPct: string | null;
  status: GoalStatus | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface GoalDetail extends GoalSummary {
  updates: GoalUpdateEntry[];
  /** Decisions that cite this goal as evidence. */
  decisions: Array<{ id: string; title: string; status: DecisionStatus }>;
}

export interface CreateGoalRequest {
  title: string;
  description?: string | null;
  ownerId?: string | null;
  metricId?: string | null;
  supportingMetricIds?: string[];
  baselineValue?: string | null;
  targetValue: string;
  startDate: string;
  dueDate: string;
  status?: GoalStatus;
}

export type UpdateGoalRequest = Partial<CreateGoalRequest>;

export interface GoalProgressResult {
  evaluated: number;
  changed: number;
  achieved: number;
}

/** A decision, and the evidence that prompted it (plan §30, §31). */
export interface DecisionSummary {
  id: string;
  title: string;
  problemStatement: string;
  context: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: DecisionStatus;
  priority: DecisionPriority;
  decisionDate: string | null;
  expectedOutcome: string | null;
  reviewDate: string | null;
  notes: string | null;
  evidenceCount: number;
  openActions: number;
  totalActions: number;
  lastReviewResult: DecisionReviewResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionEvidence {
  metrics: Array<{ metricId: string; code: string; name: string; unit: MetricUnit }>;
  alerts: Array<{ alertId: string; title: string; severity: string; periodStart: string | null }>;
  insights: Array<{ insightId: string; title: string; periodStart: string | null }>;
  goals: Array<{ goalId: string; title: string; status: GoalStatus; progressPct: string | null }>;
}

export interface DecisionAction {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  isCompleted: boolean;
  completedAt: string | null;
}

export interface DecisionReviewEntry {
  id: string;
  expectedOutcome: string | null;
  actualOutcome: string | null;
  result: DecisionReviewResult | null;
  notes: string | null;
  reviewerName: string | null;
  reviewedAt: string;
}

export interface DecisionDetail extends DecisionSummary {
  evidence: DecisionEvidence;
  actions: DecisionAction[];
  reviews: DecisionReviewEntry[];
}

export interface CreateDecisionRequest {
  title: string;
  problemStatement: string;
  context?: string | null;
  ownerId?: string | null;
  status?: DecisionStatus;
  priority?: DecisionPriority;
  decisionDate?: string | null;
  expectedOutcome?: string | null;
  reviewDate?: string | null;
  notes?: string | null;
  /** The evidence this decision rests on — at least one item is required. */
  metricIds?: string[];
  alertIds?: string[];
  insightIds?: string[];
  goalIds?: string[];
}

export type UpdateDecisionRequest = Partial<CreateDecisionRequest>;

export interface CreateDecisionActionRequest {
  title: string;
  description?: string | null;
  ownerId?: string | null;
  dueDate?: string | null;
}

export interface ReviewDecisionRequest {
  actualOutcome: string;
  result: DecisionReviewResult;
  notes?: string | null;
}

/** The decision centre's sections (plan §30). */
export interface DecisionCentre {
  criticalIssues: Array<{
    id: string;
    title: string;
    severity: string;
    metricName: string | null;
    periodStart: string | null;
  }>;
  warnings: Array<{
    id: string;
    title: string;
    severity: string;
    metricName: string | null;
    periodStart: string | null;
  }>;
  opportunities: Array<{ id: string; title: string; narrative: string; periodStart: string | null }>;
  openDecisions: DecisionSummary[];
  recentlyReviewed: DecisionSummary[];
  goalsAtRisk: GoalSummary[];
}
