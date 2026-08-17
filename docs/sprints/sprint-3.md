# Sprint 3 Completion Report

```text
SPRINT: 3 — Data Import Engine
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

**Data sources**

- CRUD for `MANUAL` and `CSV` sources, with status and last-sync tracking. A source
  with import history is deactivated rather than deleted, so the trail survives.
- Analysts can manage sources as well as admins, because analysts are the people who
  import.

**The import pipeline** (plan §14)

`upload → preview → map → validate → commit`, with `cancel` available until commit.
Each step is persisted, so an import is an auditable operation rather than a
transient upload.

- **Upload** — `.csv` only, 10 MB and 50,000 rows maximum, held in memory and never
  written to disk. Delimiter is auto-detected between comma, semicolon and tab; a
  BOM is stripped; duplicate headers are refused because `csv-parse` would otherwise
  collapse them and silently drop a column.
- **Preview** — the parsed columns, the first 20 rows, a suggested mapping guessed
  from column names (`KPI`/`Month`/`Amount`/`Site` all resolve), and the metric codes
  this organization actually accepts.
- **Map** — which column fills `metricCode`, `period`, `value` and optionally
  `branchCode`, `departmentCode`, `currency`. A column the file does not have is a
  field-level validation error.
- **Validate** — every row checked and the outcome stored. Re-runnable: fixing the
  mapping and validating again replaces the previous result rather than accumulating.
- **Commit** — accepted rows written into `metric_values`, keyed by
  `(metric, period, branch, department)` so a re-import replaces instead of
  double-counting.

**Validation** (plan §15) — every rule the plan lists, plus a few the data demanded:

| Rejected                                                                                                                                                                                                                                                                                                        | Warned                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| missing metric / period / value; unknown metric code; unparseable period; non-numeric value; unknown branch or department; period type not matching the metric's frequency; duplicate of an earlier row; currency other than the organization's; negative counts; an impossible percentage; a calculated metric | out-of-range percentage or score; fractional count; currency column on a non-currency metric |

Three outcomes — `VALID`, `WARNING` (imported with a note), `REJECTED` (kept,
explained, not imported). The raw row is stored exactly as received alongside the
parsed one, and every issue names the row, the column and the reason.

**Numeric and period parsing**

Spreadsheet reality: thousands separators in either locale (`1,234.56` and
`1.234,56`), currency symbols and codes, accounting parentheses for negatives,
percent signs. Anything ambiguous is rejected rather than guessed. Values are
carried as decimal **strings** end to end — a value that passed through a JavaScript
number would already have lost precision (ADR-0004).

Periods: `2026-01`, `2026-Q1`, `2026-W05` (ISO weeks, Monday-start), `2026`,
`2026-01-31`. The label's shape decides the period type, which must match the
metric's frequency. All UTC.

**Duplicate protection**

Unique on `(organization, file checksum)`: re-uploading a committed file is refused;
re-uploading a cancelled or abandoned one replaces it, so "cancel and try again"
works. Committing twice is refused. The same content remains importable by a
different tenant.

**Data quality** (plan §16)

Rule-based and explainable: completeness (rows usable ÷ rows received), validity
(rows with no complaint ÷ received), freshness from the last commit date, rejected
row count, an overall 0–100 score weighted 40/40/20, and a confidence level that
also accounts for volume — a perfect score over ten rows is not evidence of much.
Broken down per source.

**Frontend**

`/data/sources`, `/data/imports`, `/data/imports/new`, `/data/imports/:id`,
`/data/quality`, with a shared tabbed layout. The wizard shows the file before
anything is imported, the validation summary and every issue before the commit, and
the written-value count after it. The import detail page lists rows as received,
filterable by outcome.

## DATABASE CHANGES

**None.** The Sprint 0 model already covered data sources, imports, import rows and
validation errors. `prisma migrate diff --exit-code` confirms no drift.

The seed now also creates four universal metrics per organization (revenue,
expenses, customers, satisfaction score) and a CSV data source, so the wizard is
demonstrable before the metrics engine exists.

## API CHANGES

| Method | Route                      | Access                          |
| ------ | -------------------------- | ------------------------------- |
| GET    | `/data-sources`            | Any member role                 |
| POST   | `/data-sources`            | `ORGANIZATION_ADMIN`, `ANALYST` |
| PATCH  | `/data-sources/:id`        | `ORGANIZATION_ADMIN`, `ANALYST` |
| DELETE | `/data-sources/:id`        | `ORGANIZATION_ADMIN`            |
| POST   | `/imports/upload`          | `ORGANIZATION_ADMIN`, `ANALYST` |
| POST   | `/imports/:id/map`         | `ORGANIZATION_ADMIN`, `ANALYST` |
| POST   | `/imports/:id/validate`    | `ORGANIZATION_ADMIN`, `ANALYST` |
| POST   | `/imports/:id/commit`      | `ORGANIZATION_ADMIN`, `ANALYST` |
| POST   | `/imports/:id/cancel`      | `ORGANIZATION_ADMIN`, `ANALYST` |
| GET    | `/imports`, `/imports/:id` | Any member role                 |
| GET    | `/imports/:id/rows`        | Any member role                 |
| GET    | `/data-quality`            | Any member role                 |

## FRONTEND CHANGES

- `features/data/`: `DataLayout`, `DataSourcesPage`, `ImportWizardPage`,
  `ImportsPage`, `ImportDetailPage`, `DataQualityPage`, `data-api`.
- Sidebar Data section now links to the three data routes.
- Design-system additions: step indicator, scrollable table wrapper, metric cards.

## TESTS

| Suite                              | Result                                  |
| ---------------------------------- | --------------------------------------- |
| API unit (Jest)                    | 142 passed, 15 suites (+57 this sprint) |
| API integration (Jest + Supertest) | 92 passed, 7 suites (+31 this sprint)   |
| Web (Vitest + Testing Library)     | 56 passed, 10 files (+11 this sprint)   |

Unit tests cover the logic that decides what a number means: period parsing
(including leap Februaries, ISO week 1, impossible dates like 2026-02-30, and UTC
stability), numeric parsing across locales and notations, CSV parsing (delimiters,
BOM, quoted fields, duplicate headers), mapping suggestion, and every validation
rule with its exact outcome.

The Sprint 3 gate is covered by `test/imports.e2e-spec.ts`:

- **A valid CSV imports** — values land in `metric_values` with the right period
  type, period end, decimal value, source type and source reference.
- **Invalid rows are surfaced, not dropped** — a deliberately messy file produces one
  valid row, one warning and six rejections, each with its own code and message, and
  the rejected rows are retrievable afterwards.
- **Cancel before commit works** — and leaves no metric values behind; the same file
  can then be uploaded again.
- **Duplicate commit is prevented** — committing twice is refused, and re-uploading
  a committed file is refused by checksum.
- **Isolation holds** — another organization's imports are invisible in the list and
  404 on every step (read, rows, map, validate, commit, cancel), metric and branch
  codes resolve only inside the caller's organization, and both organizations can
  import identical content independently.
- Also: re-import replaces rather than double-counts; organization-level and
  branch-level values coexist; a viewer cannot upload; the audit trail records
  upload, map and commit.

Verified by hand in Chromium against the running stack, with a deliberately messy
10-row CSV: suggested mapping filled in correctly, validation reported 6 valid and
4 rejected with per-row reasons, the commit wrote 6 metric values, the import detail
page listed the rejected rows, re-uploading the same file was blocked with the
server's message, and data quality moved to 68/100. The stored values were checked
directly in PostgreSQL.

## SECURITY CHECKS

- Uploads are restricted by extension **and** MIME type, capped at 10 MB by multer
  before the handler runs, and capped again at 50,000 rows after parsing.
- Files are never written to disk; the buffer is parsed and discarded.
- Every import query is scoped by `organizationId`; an import id alone resolves
  nothing (asserted for all six routes).
- Metric, branch and department codes resolve only within the caller's organization,
  so a file cannot reach another tenant's structure.
- A `dataSourceId` from another organization is rejected as a validation error.
- Uploads and commits are `ORGANIZATION_ADMIN`/`ANALYST` only; viewers are refused.
- Upload, mapping and commit are audited, with the written-value count recorded.
- CSV content is stored as JSON data and rendered as text, never evaluated — and the
  API is the only writer of metric values.

## KNOWN LIMITATIONS

1. **Parsing and committing are synchronous.** A 50,000-row file holds a request and
   a transaction open. The plan asks for "CSV validation asynchronous-ready" (§45);
   the step boundaries are shaped for it — each step is a separate request against
   persisted state — but no queue exists yet.
2. **No manual data entry UI.** Plan §2 lists it in MVP scope; it belongs with the
   metrics engine, since it is a single metric value written by hand, and is queued
   for Sprint 4 reusing the same validation rules.
3. **Imports cannot be undone.** A committed import can be corrected by importing a
   corrected file (which replaces the values), but there is no "revert this import"
   action. `sourceRef` on every value makes it feasible later.
4. **Formula metrics are not recalculated after a commit** — there is no formula
   engine yet. Sprint 4 adds it, and the commit is the natural trigger point.
5. **Wide-format files are not supported** (a column per month, or per metric).
   Long format only, by decision — see ADR-0007.
6. **Data quality is organization-wide and per source**, not per metric or per
   dataset; per-metric freshness arrives with the metric detail page in Sprint 4.
7. **Docker images still unverified locally** (no Docker daemon here); CI builds them.

One bug worth recording: `multer` was reachable in tests through the pnpm store but
missing from `apps/api`'s own dependencies, so the built application failed to boot
while every test passed. Running the real build caught it; it is now declared.

## FILES CHANGED

```text
API      src/imports/{imports.controller,imports.service,imports.module,imports.dto,
                      csv-parser,period,numbers,validation}.ts
                      (+ specs for csv-parser, period, numbers, validation)
         src/data-sources/{controller,service,module,dto}.ts
         src/data-quality/{controller,service,module}.ts
         src/app.module.ts, prisma/seed.ts, package.json (csv-parse, multer)
         test/imports.e2e-spec.ts
Web      src/features/data/{DataLayout,DataSourcesPage,ImportWizardPage,ImportsPage,
                            ImportDetailPage,DataQualityPage,data-api}.ts(x)
                            (+ tests for the wizard and data quality)
         src/app/App.tsx, src/components/AppShell.tsx, src/styles/global.css
Shared   packages/shared-types/src/imports.ts, src/index.ts
Docs     docs/decisions/0007-import-model.md, docs/{api,architecture,database,
         current-state,implementation-checklist}.md, docs/sprints/sprint-3.md, README.md
```

## ACCEPTANCE CRITERIA

| Criterion                             | Status                                                               |
| ------------------------------------- | -------------------------------------------------------------------- |
| Valid CSV imports                     | ✅ End to end, verified in tests, in the browser and in the database |
| Invalid rows are surfaced             | ✅ Kept with per-row, per-column reasons and retrievable afterwards  |
| Import can be cancelled before commit | ✅ And the same file can then be re-uploaded                         |
| Duplicate commit is prevented         | ✅ By status and by file checksum                                    |
| Organization isolation passes         | ✅ Every route and every code lookup                                 |

## NEXT SPRINT

**Sprint 4 — Metrics Engine.**

- Metrics CRUD (unit, aggregation, frequency, direction, category), targets and
  thresholds.
- Formulas with a dependency graph: topological ordering, cycle detection, division
  by zero and missing inputs handled explicitly.
- Recalculation of derived metrics after an import commit.
- Manual data entry, reusing the import validation rules.
- Frontend: metrics list, create/edit, metric detail, target and threshold
  configuration.
- Gate before Sprint 5: metrics calculate server-side, dependency order is safe,
  division by zero and missing dependencies are handled, historical values are stored
  correctly, and the formula tests cover them.
