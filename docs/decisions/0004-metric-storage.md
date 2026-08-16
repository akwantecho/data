# ADR-0004: Metric values in a typed table with explicit periods

- **Status**: Accepted (Sprint 0)

## Context

Metric values are the numeric truth of the platform. They arrive from manual entry
and CSV imports, are derived by formulas, feed the dashboard, health score, alerts,
insights, goals and the AI context, and must be recomputable and auditable.

## Decision

A single `metric_values` table:

```text
organization_id, metric_id, branch_id?, department_id?,
period_type, period_start, period_end, value Decimal(20,6),
source_type, source_ref, is_calculated, calculated_at
```

- **`Decimal(20,6)`, never `Float`.** Binary floating point cannot represent
  currency exactly, and these numbers are reported to management.
- **Explicit periods.** `period_type` + `period_start`/`period_end` instead of a
  timestamp, because every KPI in this product is a statement about a period.
- **Unique on `(organization_id, metric_id, branch_id, department_id, period_type,
period_start)`.** Re-importing a month upserts rather than duplicates, which is
  what makes imports idempotent and recalculation safe.
- **Branch and department nullable.** A null slice means the organization total, so
  roll-ups and drill-downs share one table and one code path.
- **Provenance on the row.** `source_type`/`source_ref` point back to the import or
  manual entry; `is_calculated` distinguishes derived values, which lets the metric
  detail page state where a number came from.

Formula metrics store their expression in `metric_formulas` with the referenced
metric codes denormalised, and `metric_dependencies` gives the calculation service
a graph to topologically order and cycle-check before evaluating.

## Consequences

- One indexable table serves trend queries, comparisons and aggregation.
- Decimal arithmetic must be done with a decimal-aware library or in SQL — never by
  converting to JavaScript numbers first.
- Very high-cardinality daily data across many branches will eventually want
  partitioning by `period_start`. The schema does not preclude it.
