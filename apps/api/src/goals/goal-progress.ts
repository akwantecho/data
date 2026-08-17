import type { GoalStatus } from '@sip/shared-types';

/**
 * Goal progress and status (plan §29).
 *
 * A metric-linked goal is not something anyone should have to update by hand: the
 * metric already says where the organization is, and the goal says where it meant
 * to be. Everything here derives the second from the first.
 */

export interface ProgressInput {
  baseline: number | null;
  target: number;
  current: number | null;
}

/**
 * How far along the goal is, as a percentage of the distance it set out to cover.
 *
 * Measured from the baseline, not from zero: a goal to lift revenue from 400 to
 * 500 is half done at 450, not 90% done. Direction falls out of the arithmetic —
 * a goal to bring a no-show rate from 12 down to 8 has a negative span, and a
 * current value of 10 is still half way.
 */
export function progressFor(input: ProgressInput): number | null {
  if (input.current === null) {
    return null;
  }

  const baseline = input.baseline ?? 0;
  const span = input.target - baseline;

  if (span === 0) {
    // Nothing to cover: either it is already met, or the goal is malformed.
    return input.current === input.target ? 100 : 0;
  }

  const covered = ((input.current - baseline) / span) * 100;

  // Below the baseline is no progress; past the target is 100. A goal is met or
  // not — "140% of a goal" is a number for a sales board, not a management one.
  return round(Math.min(100, Math.max(0, covered)));
}

/** Where the goal should be by now, purely from the calendar. */
export function expectedProgressFor(start: Date, due: Date, now: Date): number | null {
  const total = due.getTime() - start.getTime();

  if (total <= 0) {
    return null;
  }

  const elapsed = now.getTime() - start.getTime();

  return round(Math.min(100, Math.max(0, (elapsed / total) * 100)));
}

/** How much a goal may lag its schedule before it stops being on track. */
const AT_RISK_LAG = 10;
const OFF_TRACK_LAG = 25;

/**
 * The status the system derives.
 *
 * `DRAFT` and `CANCELLED` are statements of intent, so they are left exactly as a
 * person set them. Everything else is a claim about how the goal is going, which
 * is the system's to make and to keep current.
 */
export function statusFor(
  current: GoalStatus,
  progress: number | null,
  expected: number | null,
): GoalStatus {
  if (current === 'DRAFT' || current === 'CANCELLED') {
    return current;
  }

  if (progress !== null && progress >= 100) {
    return 'ACHIEVED';
  }

  if (current === 'ACHIEVED') {
    // It was achieved and has since slipped back; the honest status is the one the
    // figures support now.
    return progress === null ? 'ACTIVE' : lagStatus(progress, expected);
  }

  if (progress === null || expected === null) {
    return 'ACTIVE';
  }

  return lagStatus(progress, expected);
}

function lagStatus(progress: number, expected: number | null): GoalStatus {
  if (expected === null) {
    return 'ACTIVE';
  }

  const lag = expected - progress;

  if (lag <= AT_RISK_LAG) {
    return 'ON_TRACK';
  }

  return lag <= OFF_TRACK_LAG ? 'AT_RISK' : 'OFF_TRACK';
}

/** Whole days left, negative once the due date has passed. */
export function daysRemaining(due: Date, now: Date): number {
  return Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
