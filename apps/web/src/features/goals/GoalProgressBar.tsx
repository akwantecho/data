import type { GoalStatus } from '@sip/shared-types';
import { toneFor } from './goal-display';

/**
 * A goal's progress, with the pace the calendar expects marked on it.
 *
 * Position alone does not say whether a goal is going well — 40% is excellent in
 * month one and alarming in month eleven — so the expected mark is drawn on the same
 * bar rather than reported separately.
 */
export function GoalProgressBar({
  progressPct,
  expectedProgressPct,
  status,
}: {
  progressPct: string | null;
  expectedProgressPct: string | null;
  status: GoalStatus;
}) {
  const progress = progressPct === null ? null : Number(progressPct);
  const expected = expectedProgressPct === null ? null : Number(expectedProgressPct);

  return (
    <div className="goal-progress">
      <div
        className="goal-progress__track"
        role="progressbar"
        aria-valuenow={progress ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Goal progress"
      >
        <div
          className={`goal-progress__fill goal-progress__fill--${toneFor(status)}`}
          style={{ inlineSize: `${clamp(progress ?? 0)}%` }}
        />
        {expected === null ? null : (
          <span
            className="goal-progress__pace"
            style={{ insetInlineStart: `${clamp(expected)}%` }}
            title={`Expected ${expected}% by now`}
          />
        )}
      </div>
      <p className="form-hint">
        {progress === null ? 'No progress recorded' : `${progress}% complete`}
        {expected === null ? '' : ` · ${expected}% expected by now`}
      </p>
    </div>
  );
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}
