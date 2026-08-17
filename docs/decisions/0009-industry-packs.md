# ADR-0009: Packs are data, installed by cloning, and never overwrite a tenant

- **Status**: Accepted (Sprint 5)

## Context

An industry pack has to give a new clinic, hotel or property manager a working set
of metrics, a health model and rules on day one — without any of those industries
appearing in the code that runs them, and without a later pack change trampling
what a tenant has since made their own.

## Decision

### The catalogue is a source; the database is the installer's only input

Shipped packs are definition literals under `src/industry-packs/catalogue/`. A sync
step writes them into `industry_packs` and its child tables. The installer then
reads **only** those tables.

The alternative — installing straight from the module — would have been shorter and
would have quietly made packs code. Every claim in plan §17 ("adding an industry is
a data change") would then have depended on nobody noticing. With the sync in
between, a pack inserted by SQL installs exactly like a shipped one, which is the
property the architecture actually promises. The integration suite relies on it:
it publishes throwaway packs and installs them without touching the catalogue.

Nothing anywhere branches on an industry code.

### Definitions are validated before they can be stored

A Zod schema checks structure, and a `superRefine` checks the things that make a
pack _coherent_: unique metric codes, category weights summing to 100, metric
weights summing to 100 within each category, and every formula, rule condition,
evidence entry and alert target naming a metric the same pack installs. A unit test
runs it over all three shipped packs.

A pack that is wrong is otherwise discovered at install time, inside a customer's
organization, which is the worst possible place to find it.

### Install clones, and never overwrites

Template metrics are copied into the tenant with `is_system = true`; formulas and
dependency rows are re-resolved to the tenant's own metric ids. Anything already
present under the same code is left exactly as it is, and the result reports how
many items were created and how many were kept.

Cloning rather than referencing is what allows customization at all: a tenant can
rename `occupied_rooms` to "Room Nights Sold", recategorise it, or deactivate it,
without mutating the template every other tenant installs from.

Not overwriting is what makes installation _repeatable_. A pack that gains a metric
in version 1.1 can simply be installed again; nobody's tuned weight or renamed
metric is undone. The alternative — refusing a second install — would have made the
first install the only chance to get anything, and an upgrade path impossible.

The whole install is one transaction. A tenant is never left holding half a pack.

### Choosing an industry installs the pack

Plan §42 asks that creating an organization with an industry install its templates.
Organizations are created by the seed rather than by an API (no signup in the MVP),
so the equivalent for a live tenant is selecting its industry — and both paths call
the same function. The seed installs through it too, so the demonstration data and
a real install cannot drift apart.

### Both kinds of rule share the pack's one rule table

Plan §8.5 gives a pack four tables, one of them for rules. Alert rules are rules a
pack installs just as much as insight rules are, so they live there too: each row
records its kind (`{ kind, rule }`) and alert rows carry an `alert:` code prefix so
an insight and an alert describing the same condition cannot collide on one code.
Adding a fifth table would have been the alternative; it buys nothing that the
discriminator does not, and departs from the plan's schema.

`alert_rules` did gain a `code` column (migration `…_alert_rule_codes`), because a
rule with no stable identifier cannot be installed idempotently.

### A metric code is immutable

Formulas reference metrics by code, CSV mappings target codes, and packs match on
codes. Renaming one leaves all three pointing at nothing, so the name is editable
and the code is not. This closes a real hole from Sprint 4 rather than only serving
packs.

## Consequences

- A fourth industry is a definition file and a sync — or an `INSERT` — with no
  change to any engine.
- Re-installing is the upgrade mechanism for now: it adds what is missing. Changing
  or removing what a tenant already has is deliberately out of reach, so a genuine
  breaking pack revision (a renamed metric code, a reweighted model) still needs a
  migration path. `organization_industry_packs.version` records what was installed
  so that path can exist.
- Syncing does not touch installed organizations. This is the right default — a
  platform edit must not silently rewrite tenant configuration — but it does mean a
  fixed pack reaches existing tenants only when they install again.
- Health scores and rule evaluation are not part of this sprint: the model and the
  rules are installed and inspectable, and the engines that read them arrive in
  Sprint 7. The rule schema is validated now so those engines can rely on it.
