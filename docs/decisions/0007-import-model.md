# ADR-0007: Long-format CSV imports, validated per row, committed idempotently

- **Status**: Accepted (Sprint 3)

## Context

Imports are where a spreadsheet becomes the organization's numbers. Everything
downstream — KPIs, health scores, alerts, goals, AI answers — inherits whatever
this step accepts. The plan is explicit about three things: never silently discard
invalid data (§15, §51.19), treat imports as auditable operations (§51.17), and
prevent duplicate commits (§42).

Two questions had to be settled: what shape of file the platform accepts, and what
"importing" actually writes.

## Decision

### One row per measurement (long format)

A file carries `metric code, period, value` plus optional `branch`, `department`
and `currency` columns. Wide format — a column per month, or a column per metric —
was rejected: it needs a different mapping UI for every file shape, and it hides
the identity of a value inside a header the user must interpret. Long format has
one mapping regardless of the file, and the identity of every value is explicit on
its own row.

The **period label decides the period type**: `2026-01` is a month, `2026-Q1` a
quarter, `2026-W05` an ISO week, `2026` a year, `2026-01-31` a day. That type must
match the metric's configured frequency, so a monthly metric cannot be filled with
daily rows by accident. Everything is UTC: a metric belongs to a period, not to a
moment.

### Imports write metric values

The commit writes `metric_values` for metrics that exist in the organization; a
code the organization does not define is a rejection, not a new metric. The
alternative — letting a file create metrics — would put metric definitions outside
the platform's control and make the industry pack meaningless.

`datasets`/`dataset_columns` stay unused for now. They are for future source types
that carry their own schema.

### Three outcomes per row, all retained

`VALID`, `WARNING` (imported, with a note) and `REJECTED` (kept, explained, not
imported). The raw row is stored exactly as received alongside the parsed version,
and every issue becomes a `data_validation_errors` row naming the row, the column
and the reason. A user can therefore always answer "why is that number not in the
system?" — which is the entire point of §15.

Warnings exist because some data is odd but usable (a percentage of 140, a
fractional count). Refusing them would push users to edit their source data to
please the importer; ignoring them would hide a real signal. Flagging is the honest
middle.

### Commit replaces, it does not append

Values are keyed by `(metric, period, branch, department)`. Re-importing a
corrected file for the same period **replaces**, so a correction cannot
double-count.

PostgreSQL treats NULLs as distinct in a unique index, so the schema's unique
constraint cannot enforce this for organization-level rows (null branch and
department). The commit therefore deletes the matching identities explicitly and
inserts, in one transaction, chunked. This is why `metric_values` uniqueness is
described as an invariant the _service_ maintains, not one the database alone
guarantees.

### Duplicate files

An import is unique on `(organization, SHA-256 of the file)`. Re-uploading a file
that was already committed is refused; re-uploading one that was cancelled or
abandoned replaces it, so "cancel and try again" works. The same file content
remains importable by a different tenant.

## Consequences

- The mapping UI is the same for every file, and the suggested mapping usually gets
  it right, so the common case is three clicks.
- Every rejection is inspectable after the fact, which makes the import history a
  usable data-quality record rather than a log.
- Numeric parsing must accept the shapes spreadsheets actually emit — thousands
  separators in either locale, currency symbols, accounting parentheses, percent
  signs — and must reject anything ambiguous. Values are carried as decimal
  **strings** end to end; a value that passed through a JavaScript number would
  already have lost precision (ADR-0004).
- Files are parsed in memory with a 10 MB / 50,000-row ceiling. Beyond that the
  pipeline needs to become asynchronous; the step boundaries are already shaped for
  it, since each step is a separate request against persisted state.
- The commit is O(rows) in write volume but batched; a very large import holds a
  transaction open, which is the main reason for the row ceiling.
