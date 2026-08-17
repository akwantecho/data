import type { GoalStatus } from '@sip/shared-types';

/** How a goal's status should read on screen, and which colour carries it. */
export function toneFor(status: GoalStatus): 'positive' | 'warning' | 'negative' | 'neutral' {
  switch (status) {
    case 'ACHIEVED':
    case 'ON_TRACK':
      return 'positive';
    case 'AT_RISK':
      return 'warning';
    case 'OFF_TRACK':
      return 'negative';
    default:
      return 'neutral';
  }
}

export function statusLabel(status: GoalStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

/** Time left, phrased the way someone would say it out loud. */
export function describeRemaining(days: number): string {
  if (days < 0) {
    return `${Math.abs(days)} days overdue`;
  }

  return days === 0 ? 'due today' : `${days} days left`;
}
