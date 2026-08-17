import { daysRemaining, expectedProgressFor, progressFor, statusFor } from './goal-progress';

describe('progressFor', () => {
  it('measures from the baseline, not from zero', () => {
    // Lifting revenue from 400 to 500 is half done at 450 — not 90%.
    expect(progressFor({ baseline: 400, target: 500, current: 450 })).toBe(50);
  });

  it('is complete at the target', () => {
    expect(progressFor({ baseline: 400, target: 500, current: 500 })).toBe(100);
  });

  it('does not go past complete', () => {
    // "140% of a goal" is a number for a sales board, not a management one.
    expect(progressFor({ baseline: 400, target: 500, current: 640 })).toBe(100);
  });

  it('does not go below nothing', () => {
    expect(progressFor({ baseline: 400, target: 500, current: 350 })).toBe(0);
  });

  it('reads a downward goal from the same arithmetic', () => {
    // Bringing a no-show rate from 12 to 8: at 10 it is half way.
    expect(progressFor({ baseline: 12, target: 8, current: 10 })).toBe(50);
    expect(progressFor({ baseline: 12, target: 8, current: 8 })).toBe(100);
    expect(progressFor({ baseline: 12, target: 8, current: 13 })).toBe(0);
  });

  it('treats a missing baseline as zero', () => {
    expect(progressFor({ baseline: null, target: 200, current: 50 })).toBe(25);
  });

  it('has no progress to report without a current value', () => {
    expect(progressFor({ baseline: 0, target: 100, current: null })).toBeNull();
  });

  it('handles a goal with nowhere to travel', () => {
    expect(progressFor({ baseline: 100, target: 100, current: 100 })).toBe(100);
    expect(progressFor({ baseline: 100, target: 100, current: 90 })).toBe(0);
  });
});

describe('expectedProgressFor', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const due = new Date('2026-03-01T00:00:00.000Z');

  it('is nothing on the first day and everything on the last', () => {
    expect(expectedProgressFor(start, due, start)).toBe(0);
    expect(expectedProgressFor(start, due, due)).toBe(100);
  });

  it('tracks the calendar in between', () => {
    // 1 January to 1 March is 59 days; 31 January is 30 of them.
    expect(expectedProgressFor(start, due, new Date('2026-01-31T00:00:00.000Z'))).toBe(50.85);
  });

  it('does not exceed complete once the date has passed', () => {
    expect(expectedProgressFor(start, due, new Date('2026-06-01T00:00:00.000Z'))).toBe(100);
  });

  it('has nothing to say about a window with no length', () => {
    expect(expectedProgressFor(start, start, start)).toBeNull();
  });
});

describe('statusFor', () => {
  it('leaves a draft and a cancelled goal exactly as a person set them', () => {
    expect(statusFor('DRAFT', 90, 10)).toBe('DRAFT');
    expect(statusFor('CANCELLED', 90, 10)).toBe('CANCELLED');
  });

  it('is achieved at the target regardless of the calendar', () => {
    expect(statusFor('ACTIVE', 100, 20)).toBe('ACHIEVED');
  });

  it('is on track while it keeps up with the schedule', () => {
    expect(statusFor('ACTIVE', 50, 50)).toBe('ON_TRACK');
    expect(statusFor('ACTIVE', 60, 50)).toBe('ON_TRACK');
    // A small lag is still on track: goals do not move in a straight line.
    expect(statusFor('ACTIVE', 42, 50)).toBe('ON_TRACK');
  });

  it('is at risk once it falls meaningfully behind', () => {
    expect(statusFor('ACTIVE', 35, 50)).toBe('AT_RISK');
    expect(statusFor('ON_TRACK', 25, 50)).toBe('AT_RISK');
  });

  it('is off track once it falls a long way behind', () => {
    expect(statusFor('ACTIVE', 10, 50)).toBe('OFF_TRACK');
  });

  it('reports a goal that has slipped back out of achievement', () => {
    // A metric-linked goal can un-achieve itself when the metric moves.
    expect(statusFor('ACHIEVED', 40, 80)).toBe('OFF_TRACK');
  });

  it('says only that it is active when there is nothing to judge', () => {
    expect(statusFor('ACTIVE', null, 50)).toBe('ACTIVE');
    expect(statusFor('ACTIVE', 40, null)).toBe('ACTIVE');
  });
});

describe('daysRemaining', () => {
  it('counts whole days to the due date', () => {
    expect(
      daysRemaining(new Date('2026-03-01T00:00:00.000Z'), new Date('2026-02-25T00:00:00.000Z')),
    ).toBe(4);
  });

  it('goes negative once the date has passed', () => {
    expect(
      daysRemaining(new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-06T00:00:00.000Z')),
    ).toBe(-5);
  });
});
