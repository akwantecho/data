# ADR-0012: A goal reads its own progress, and a decision must carry its evidence

- **Status**: Accepted (Sprint 8)

## Context

Sprint 8 adds two records that outlive the numbers they were created from: a goal,
which states where the organization meant to get to, and a decision, which states
what management chose to do about where it actually got to. The plan's acceptance
criteria are two sentences — metric-linked goals update automatically, and decision
history remains auditable — and both are about the record staying true after the
moment that produced it has passed.

## Decision

### Progress is measured from the baseline, and read from the metric

A goal to lift revenue from 400 to 500 is half done at 450, not 90% done. Progress
is the fraction of the distance the goal set out to cover, so direction falls out of
the arithmetic: a goal to bring a no-show rate from 12 down to 8 has a negative span,
and 10 is still half way. It is clamped to 0–100 — a goal is met or it is not, and
"140% of a goal" is a number for a sales board, not a management one.

For a metric-linked goal the current value is never typed in. It is read through the
analytics engine over the goal's own window (ADR-0010), so a goal's progress is the
same figure the dashboard would show for that range. If the two could disagree, one
of them would be wrong, and nobody could say which.

### The system owns the status; a person owns the intent

`DRAFT` and `CANCELLED` are statements of intent, so they are left exactly as a
person set them. `ON_TRACK`, `AT_RISK`, `OFF_TRACK` and `ACHIEVED` are claims about
how the goal is going, which is the system's to make and to keep current: progress is
compared with where the calendar says the goal should be, and a lag of ten points or
less is on track, twenty-five or less is at risk, and more than that is off track.

A goal can un-achieve itself. A metric-linked goal that reached its target and then
slipped back is reported on the figures that hold now, not the ones that held on the
day it was first met.

### A recalculation that changes nothing writes nothing

Progress is refreshed after every import and on demand. Appending a history row each
time would fill the record with identical entries and bury the moments that mattered,
so a row is written only when the value, the progress or the status actually moved —
and the row says which.

### A decision cannot exist without evidence

Creating a decision requires at least one metric, alert, insight or goal, and an edit
cannot remove the last one. This is not paperwork: a decision recorded without the
figures that prompted it cannot be reviewed later, because there is nothing to review
it against. Every referenced record is checked to belong to the caller's organization
before it is linked, so a decision can never cite — or leak the title of — another
tenant's alert.

### A review is judged against the expectation as it stood

When a review is recorded, the decision's expected outcome is copied onto the review.
Later edits to the decision therefore cannot rewrite what the review was judged
against. Reviews accumulate; none is ever replaced, and every create, edit, action and
review is written to the audit log with actor and before/after.

### Opportunities are insights the engines did not call problems

The decision centre's "Opportunities" section reads insights of `INFO` severity. The
packs use that severity for observations that are favourable rather than alarming, so
the section needs no separate detector and no second definition of what an opportunity
is — it is whatever the deterministic insight rules said was going well.

## Consequences

- A goal's figures are only as current as the last analysis run. That run happens on
  every import commit and can be triggered by hand, but a goal is not recalculated on
  read.
- Deleting a goal cited by a decision is refused rather than cascaded. Cancelling is
  the supported way to close a goal, and the history survives either way.
- Goals are recalculated once per analysis run rather than once per period, because a
  goal spans its own window rather than a reporting period.
