import type { HealthBand, HealthScoreBasis, MetricDirection } from '@sip/shared-types';
import { DEFAULT_HEALTH_BANDS } from '@sip/shared-types';

/**
 * Turning a metric into a 0–100 score (plan §26).
 *
 * The engine scores a metric against what the organization itself said good looks
 * like: its target, its warning and critical thresholds, and its direction. Nothing
 * is scored against an industry average or a model's opinion — a health score has to
 * be arguable with, and that means every point traces to a number the tenant set.
 */

/** Where a metric sits relative to its own benchmarks. */
export interface ScoreInput {
  value: number | null;
  target: number | null;
  minValue: number | null;
  maxValue: number | null;
  warningValue: number | null;
  criticalValue: number | null;
  isRelativeToTarget: boolean;
  direction: MetricDirection;
}

export interface ScoreResult {
  score: number | null;
  basis: HealthScoreBasis;
}

/** Score at the warning line: on the edge of "needs attention". */
const WARNING_SCORE = 60;
/** Score at the critical line: bad, but not yet the floor. */
const CRITICAL_SCORE = 25;
/** Hitting target scores full marks; beating it does not score more than full. */
const TARGET_SCORE = 100;

export function scoreMetric(input: ScoreInput): ScoreResult {
  if (input.direction === 'INFORMATIONAL') {
    // Informational metrics are reported, not judged.
    return { score: null, basis: 'INFORMATIONAL' };
  }

  if (input.value === null) {
    return { score: null, basis: 'NO_VALUE' };
  }

  if (input.direction === 'TARGET_RANGE') {
    return scoreRange(input);
  }

  const warning = resolveLimit(input.warningValue, input);
  const critical = resolveLimit(input.criticalValue, input);
  const anchors = buildAnchors(input.target, warning, critical, input.direction);

  if (anchors.length < 2) {
    // Nothing to score against: no target, and no threshold that survives the
    // metric's direction. Reported as unscored rather than guessed at.
    return { score: null, basis: 'NO_BENCHMARK' };
  }

  const basis: HealthScoreBasis =
    input.target !== null && (warning !== null || critical !== null)
      ? 'TARGET_AND_THRESHOLDS'
      : input.target !== null
        ? 'TARGET'
        : 'THRESHOLDS';

  return { score: interpolate(input.value, anchors, input.direction), basis };
}

/**
 * A relative threshold is a percentage of the target, so it only means anything
 * once a target exists.
 */
function resolveLimit(limit: number | null, input: ScoreInput): number | null {
  if (limit === null) {
    return null;
  }

  if (!input.isRelativeToTarget) {
    return limit;
  }

  return input.target === null ? null : (input.target * limit) / 100;
}

interface Anchor {
  at: number;
  score: number;
}

/**
 * The points the scale is pinned to, ordered from worst to best.
 *
 * A metric with a target and both thresholds gets three; one with only a target
 * gets a floor derived from it. Anchors that contradict the metric's direction —
 * a warning line on the good side of the target — are dropped rather than
 * silently inverting the scale.
 */
function buildAnchors(
  target: number | null,
  warning: number | null,
  critical: number | null,
  direction: MetricDirection,
): Anchor[] {
  const better = (a: number, b: number) => (direction === 'LOWER_IS_BETTER' ? a < b : a > b);

  // Built from the best anchor down, so the target is the authority: a threshold
  // that sits on the good side of it is the contradiction, and it is the one that
  // gets dropped.
  const candidates: Anchor[] = [];

  if (target !== null) {
    candidates.push({ at: target, score: TARGET_SCORE });
  }

  if (warning !== null) {
    candidates.push({ at: warning, score: WARNING_SCORE });
  }

  if (critical !== null) {
    candidates.push({ at: critical, score: CRITICAL_SCORE });
  }

  const descending: Anchor[] = [];

  for (const candidate of candidates) {
    const previous = descending.at(-1);

    if (!previous || better(previous.at, candidate.at)) {
      descending.push(candidate);
    }
  }

  if (descending.length === 0) {
    return [];
  }

  const anchors = [...descending].reverse();

  // A floor scoring zero beneath the worst anchor: the distance to the next one,
  // or the anchor's own magnitude when it stands alone — zero for a metric that
  // should be high, twice the limit for one that should be low.
  const worst = anchors[0];
  const gap = anchors.length > 1 ? Math.abs(anchors[1].at - worst.at) : Math.abs(worst.at) || 1;
  const floorAt = direction === 'LOWER_IS_BETTER' ? worst.at + gap : worst.at - gap;

  if (floorAt !== worst.at) {
    anchors.unshift({ at: floorAt, score: 0 });
  }

  return anchors;
}

/** Piecewise-linear between anchors, flat outside them. */
function interpolate(value: number, anchors: Anchor[], direction: MetricDirection): number {
  const better = (a: number, b: number) => (direction === 'LOWER_IS_BETTER' ? a < b : a > b);
  const best = anchors.at(-1) as Anchor;
  const worst = anchors[0];

  if (better(value, best.at) || value === best.at) {
    return best.score;
  }

  if (better(worst.at, value)) {
    return worst.score;
  }

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const low = anchors[index];
    const high = anchors[index + 1];
    const withinSegment = better(value, low.at) || value === low.at;
    const belowNext = better(high.at, value);

    if (withinSegment && belowNext) {
      const span = high.at - low.at;

      if (span === 0) {
        return high.score;
      }

      const position = (value - low.at) / span;

      return round(low.score + position * (high.score - low.score));
    }
  }

  return worst.score;
}

/**
 * A range metric scores full marks inside its band and falls away outside it, so
 * "too high" is penalised exactly as much as "too low".
 */
function scoreRange(input: ScoreInput): ScoreResult {
  const value = input.value as number;
  const min = input.minValue;
  const max = input.maxValue;

  if (min === null && max === null) {
    return { score: null, basis: 'NO_BENCHMARK' };
  }

  if ((min === null || value >= min) && (max === null || value <= max)) {
    return { score: TARGET_SCORE, basis: 'TARGET_RANGE' };
  }

  const band = (max ?? min ?? 0) - (min ?? max ?? 0);
  const distance = min !== null && value < min ? min - value : value - (max as number);
  const tolerance = band === 0 ? Math.abs(min ?? max ?? 1) : Math.abs(band);
  const score = Math.max(0, TARGET_SCORE - (distance / tolerance) * TARGET_SCORE);

  return { score: round(score), basis: 'TARGET_RANGE' };
}

export interface WeightedScore {
  score: number;
  weight: number;
}

/**
 * Combines weighted parts, redistributing the weight of anything that could not be
 * scored across what could.
 *
 * Dropping an unscored metric to zero would punish an organization for not having
 * set a target yet; keeping its weight but ignoring it would silently cap the
 * score below 100. Redistribution is the only option that leaves the score
 * meaning what it says, and the parts that were excluded are reported alongside.
 */
export function combineWeighted(parts: WeightedScore[]): {
  score: number | null;
  effectiveWeights: number[];
} {
  const total = parts.reduce((sum, part) => sum + part.weight, 0);

  if (parts.length === 0 || total === 0) {
    return { score: null, effectiveWeights: [] };
  }

  const effectiveWeights = parts.map((part) => round((part.weight / total) * 100));
  const score = parts.reduce((sum, part) => sum + (part.score * part.weight) / total, 0);

  return { score: round(score), effectiveWeights };
}

export interface BandDefinition {
  band: HealthBand;
  min: number;
  max: number;
}

/** The label for a score, from the organization's own bands (plan §26). */
export function bandFor(score: number | null, bands: BandDefinition[]): HealthBand | null {
  if (score === null) {
    return null;
  }

  const match = bands.find((band) => score >= band.min && score <= band.max);

  return match?.band ?? null;
}

export function parseBands(stored: unknown): BandDefinition[] {
  if (!Array.isArray(stored)) {
    return [...DEFAULT_HEALTH_BANDS];
  }

  const parsed = stored.filter(
    (entry): entry is BandDefinition =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as BandDefinition).band === 'string' &&
      typeof (entry as BandDefinition).min === 'number' &&
      typeof (entry as BandDefinition).max === 'number',
  );

  return parsed.length > 0 ? parsed : [...DEFAULT_HEALTH_BANDS];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
