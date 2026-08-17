/**
 * Date arithmetic for the filter bar.
 *
 * Kept out of the components so a range preset and a chart label agree, and so
 * the helpers can be exported without breaking fast refresh.
 */

/** The first day of the month `months` months before the given date. */
export function startOfMonthsBefore(date: string, months: number): string {
  const anchor = new Date(`${date}T00:00:00.000Z`);

  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - months, 1))
    .toISOString()
    .slice(0, 10);
}
