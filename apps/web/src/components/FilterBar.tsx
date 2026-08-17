import type { AnalyticsOptions } from '@sip/shared-types';
import { startOfMonthsBefore } from '../lib/dates';

export interface AnalyticsFilterState {
  from: string;
  to: string;
  branchId: string;
  departmentId: string;
}

/** Ranges an executive actually asks for, expressed against the data's own end. */
export const RANGE_PRESETS = [
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last 12 months', months: 12 },
] as const;

interface FilterBarProps {
  options: AnalyticsOptions | undefined;
  value: AnalyticsFilterState;
  onChange: (next: AnalyticsFilterState) => void;
  /** Rendered at the end of the bar — a metric picker, an export, whatever fits. */
  children?: React.ReactNode;
}

/**
 * The global filter bar (plan §21).
 *
 * It owns no figures: it produces a filter, and every panel on the page re-reads
 * the API with it, so a range change moves the whole screen at once rather than
 * half of it.
 */
export function FilterBar({ options, value, onChange, children }: FilterBarProps) {
  const departments = (options?.departments ?? []).filter(
    (department) => !value.branchId || department.branchId === value.branchId,
  );

  // Until the options load there is no anchor to count back from, so the presets
  // stay inert rather than producing an invalid date.
  const anchor = options?.latestPeriod ?? (value.to || null);

  const applyPreset = (months: number) => {
    if (!anchor) {
      return;
    }

    onChange({ ...value, from: startOfMonthsBefore(anchor, months - 1), to: anchor });
  };

  return (
    <div className="filter-bar">
      <div className="filter-bar__group" role="group" aria-label="Date range presets">
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`chip ${isPreset(value, anchor, preset.months) ? 'chip--active' : ''}`}
            disabled={!anchor}
            onClick={() => applyPreset(preset.months)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <label className="filter-bar__field">
        <span className="filter-bar__label">From</span>
        <input
          type="date"
          className="form-field__input"
          value={value.from}
          max={value.to}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
        />
      </label>

      <label className="filter-bar__field">
        <span className="filter-bar__label">To</span>
        <input
          type="date"
          className="form-field__input"
          value={value.to}
          min={value.from}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
        />
      </label>

      <label className="filter-bar__field">
        <span className="filter-bar__label">Branch</span>
        <select
          className="form-field__input"
          value={value.branchId}
          onChange={(event) =>
            // A department belongs to a branch, so changing the branch clears it
            // rather than leaving an impossible pair in the filter.
            onChange({ ...value, branchId: event.target.value, departmentId: '' })
          }
        >
          <option value="">All branches</option>
          {(options?.branches ?? []).map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-bar__field">
        <span className="filter-bar__label">Department</span>
        <select
          className="form-field__input"
          value={value.departmentId}
          disabled={departments.length === 0}
          onChange={(event) => onChange({ ...value, departmentId: event.target.value })}
        >
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>

      {children}
    </div>
  );
}

function isPreset(value: AnalyticsFilterState, anchor: string | null, months: number): boolean {
  if (!anchor || !value.from || !value.to) {
    return false;
  }

  return value.to === anchor && value.from === startOfMonthsBefore(anchor, months - 1);
}
