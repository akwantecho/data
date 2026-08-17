# ADR-0011: Scoring against the tenant's own benchmarks, and never firing without evidence

- **Status**: Accepted (Sprint 7)

## Context

Three engines land together: a health score, alert generation and insight
detection. All three make a claim about an organization's performance, and the
plan's acceptance criterion for the sprint is a single sentence — every generated
alert and insight must be able to explain why it was created, and none of it may
come from a model.

## Decision

### A metric is scored only against what the organization itself set

The scale is pinned to the metric's own target and thresholds: the target scores
100, the warning line 60, the critical line 25, with a floor of 0 beneath the worst
of them and linear interpolation between. Direction decides which side is good.

Nothing is scored against an industry average or a model's opinion. A health score
has to be arguable with — "why is Operations at 25?" must be answerable by pointing
at a number the tenant chose — and a benchmark the tenant did not set cannot carry
that argument.

Beating a target scores 100 and no more. Health is "are we where we said we would
be", not a leaderboard.

### A metric with nothing to be measured against is excluded, and its weight redistributed

A metric with no target and no threshold cannot be scored. Scoring it zero would
punish an organization for not having set a target yet; keeping its weight while
ignoring it would silently cap the score below 100. So it is dropped and the
remaining weights are renormalised — and the response reports how many metrics that
happened to, so the number is never quietly incomplete.

### A target stands until it is replaced

A target set for March is the standard September is judged against until someone
sets a new one. Requiring a fresh row every period would mean every newly imported
month arrived with nothing to be judged against: no variance, no health score, no
missed-target alert — which is exactly the demonstration plan §49 asks for.

It applies forward only: a target set in March says nothing about January. This is
additive to Sprint 6's rule that a target is only compared over the periods it
covers (ADR-0010) — those periods are now the ones a target is _in force_ for.

### The engines read through the analytics layer

Health, alerts and insights all take their figures from the same aggregation the
dashboard uses (ADR-0010): branch roll-ups included, formulas recomputed from their
inputs. The first implementation read `metric_values` directly and scored nothing,
because every value in the seeded organizations lives at branch level — a useful
failure, because a rule that reached a different number from the screen it points
at would be far worse than one that reads nothing at all.

### Nothing fires without evidence

Every alert carries a statement and the figures behind it; every insight is written
in the same transaction as one evidence row per figure it quotes. An insight whose
rule reads a figure that does not exist does not fire at all — an assertion built
on a missing number is an assertion about nothing.

Insight rules are the deterministic definitions the industry packs installed
(ADR-0009). No model is consulted anywhere in this sprint; the AI layer in Sprint 9
explains what these engines found, and never detects on its own (ADR-0005).

### Alerts are live; insights are a record

Re-running the engines is idempotent, but the two behave differently on a second
pass:

- An **alert** is a live signal. If its condition still holds, the existing alert
  keeps its identity and everything a person has done with it, but its figures are
  refreshed — an alert showing last week's numbers for a corrected month is a lie
  with a timestamp. If the condition has passed, the engine resolves it itself, with
  an event saying so, and a dashboard stops showing a problem that has gone away.
- An **insight** is an observation about a period, written once. A corrected month
  does not rewrite what was noticed at the time.

An alert a person resolved or dismissed is never reopened or rewritten by the
engine. That was a decision, and decisions are the thing this product exists to
keep.

### Organizational health shares the `/health` prefix with the liveness probe

`GET /health` remains the public, unauthenticated service check that Docker and
monitoring call; `GET /health/current` and `/health/history` are tenant-scoped and
authenticated. Two controllers, no overlapping paths, and a test asserts the probe
still answers without a session and still carries no tenant data.

## Consequences

- A score can always be walked down: overall → category → metric → the target it
  was compared against. The UI does exactly that, and the stored breakdown makes it
  reproducible after the fact.
- An organization that has set few targets gets a partial score and is told so,
  rather than a confident number built on two metrics out of ten.
- Rules and dashboard cannot disagree, because they are the same arithmetic.
- Auto-resolution means the alert list is a list of live problems, not a log. The
  log is `alert_events`, which keeps every transition with its actor and note.
- Scoring per branch is possible (the engine takes a branch) but only the
  organization-level score is stored today; per-branch history is a schema-supported
  extension, not a redesign.
