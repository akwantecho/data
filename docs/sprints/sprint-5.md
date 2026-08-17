# Sprint 5 Completion Report

```text
SPRINT: 5 — Industry Packs
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

**Packs as data** (plan §17, ADR-0009)

A pack is a versioned bundle of default metrics, a health model, insight rules and
alert rules for one industry. The shipped definitions live in
`src/industry-packs/catalogue/` as data literals; a **sync** writes them into the
pack tables; the **installer** reads only from those tables.

That indirection is the whole point. A pack inserted by an administrator installs
through exactly the same path as a shipped one, and nothing anywhere branches on an
industry code. The integration suite depends on it: it publishes two throwaway
packs and installs them without touching the catalogue.

Definitions are validated by a Zod schema that also checks coherence — unique
metric codes, category weights summing to 100, metric weights summing to 100 inside
each category, and every formula, rule condition, evidence entry and alert target
naming a metric the same pack installs. A unit test runs it over all three shipped
packs, because a pack that is wrong is otherwise found inside a customer's
organization.

**The installer**

```text
industry selected (or install requested)
  → template metrics cloned into the tenant (is_system = true)
  → formulas and dependency rows re-resolved to the tenant's own metric ids
  → health model materialised (categories + metric weights)
  → insight rules and alert rules materialised
  → installation recorded with the pack version, and audited
```

One transaction, so a tenant never holds half a pack. Two rules govern it:

- **Clone, never reference** — an organization can rename, recategorise or
  deactivate its copy without touching the template other tenants install from.
- **Never overwrite** — anything already present under the same code is left exactly
  as the tenant has it. Installing is therefore repeatable: a pack that gains a
  metric can be installed again to pick it up, and no customization is ever undone.
  The result reports what was created and what was kept.

Choosing an industry installs its pack automatically, and the seed installs through
the same function, so the demonstration data and a real installation cannot drift
apart.

**The three MVP packs** (plan §18–§20)

| Pack               | Metrics | Calculated                                     | Health categories                                                                     |
| ------------------ | ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `healthcare_core`  | 11      | Revenue per Patient                            | Financial 30, Patient Growth 20, Operations 20, Utilization 15, Patient Experience 15 |
| `hospitality_core` | 12      | Occupancy Rate, ADR, RevPAR                    | Financial 30, Occupancy 25, Demand 20, Guest Behavior 15, Operations 10               |
| `real_estate_core` | 12      | Occupancy Rate, Vacancy Rate, Revenue per Unit | Financial 30, Occupancy 25, Collections 20, Asset Performance 15, Maintenance 10      |

Every metric the plan lists, under the plan's own names, with three insight rules
and three alert rules each. Only genuinely derivable figures are formulas: inventing
one for "No-Show Rate" would produce a number no clinic could reconcile with its own
system.

**Rule definitions**

Deterministic and inspectable, ready for the engines in Sprint 7:

```jsonc
{
  "conditions": [
    { "metric": "occupancy_rate", "measure": "CHANGE_PCT", "operator": "GT", "value": 0 },
    { "metric": "adr", "measure": "CHANGE_PCT", "operator": "LT", "value": -5 },
  ],
  "narrative": "Occupancy improved while the average daily rate fell — rooms are filling because they are cheaper…",
  "evidence": ["occupancy_rate", "adr", "revpar"],
}
```

`measure` is always something the metrics engine already computes (`CHANGE_PCT`,
`VALUE`, `VARIANCE_TO_TARGET_PCT`), so a rule never needs arithmetic of its own.
Alert parameters are validated per rule type; `usesConfiguredThreshold` means the
rule reads the metric's own warning and critical values, so retuning a threshold
retunes the alert with it.

**Metric code immutability**

A metric's code can no longer be changed after creation. Formulas reference metrics
by code, CSV mappings target codes and packs match on codes; renaming one left all
three pointing at nothing. This was a real hole in Sprint 4 that packs made urgent —
the Sprint 4 report claimed the rule existed when only the intent did, and that
report has been corrected.

**Frontend**

- `/platform/industry-packs` — every published pack with its version and contents, a
  **Sync catalogue** action reporting what changed, and an inspector showing a pack's
  metrics (with formulas), health model weights and both kinds of rule.
- Organization settings gains an **Industry pack** card: which pack applies, whether
  it is installed and at what version, what it contains, the organization's own
  health model as installed, and an install/reinstall button whose result says how
  many metrics were added and how many were left untouched.

## DATABASE CHANGES

One migration, `20260817090000_alert_rule_codes`:

- `alert_rules.code` — `TEXT NOT NULL`, unique per organization. A rule with no
  stable identifier cannot be installed idempotently.
- `alert_rules.description` — nullable text, so an installed rule can explain itself.

The table is empty in every environment (alerts are built in Sprint 7), so the
non-null column is safe. `prisma migrate diff --exit-code` reports no drift.

The seed now syncs the catalogue and installs each organization's pack. Because it
creates four universal metrics first, `revenue` already exists when the pack
installs — so every seeded tenant reports one metric "kept", which is the
non-destructive rule visible in the demonstration data.

## API CHANGES

| Method | Route                           | Access               |
| ------ | ------------------------------- | -------------------- |
| GET    | `/industry-packs`               | Any member role      |
| GET    | `/industry-packs/:id`           | Any member role      |
| POST   | `/industry-packs/:id/install`   | `ORGANIZATION_ADMIN` |
| GET    | `/platform/industry-packs`      | `PLATFORM_ADMIN`     |
| GET    | `/platform/industry-packs/:id`  | `PLATFORM_ADMIN`     |
| POST   | `/platform/industry-packs/sync` | `PLATFORM_ADMIN`     |

`PUT /organizations/current/industry` now installs the industry's pack as part of
the change.

## FRONTEND CHANGES

- `features/industry-packs/`: `PlatformPacksPage`, `IndustryPackCard`, `packs-api`.
- `OrganizationSettingsPage` renders the pack card under the industry selector.
- Platform navigation and routes gain `/platform/industry-packs`.

## TESTS

| Suite                              | Result                                  |
| ---------------------------------- | --------------------------------------- |
| API unit (Jest)                    | 204 passed, 19 suites (+24 this sprint) |
| API integration (Jest + Supertest) | 142 passed, 9 suites (+18 this sprint)  |
| Web (Vitest + Testing Library)     | 76 passed, 13 files (+9 this sprint)    |

Unit tests cover the two things that are pure: the catalogue (every shipped pack
parses; weights sum correctly at both levels; nothing references a metric outside
its own pack; a broken health model, an out-of-pack formula and mismatched alert
parameters are each rejected with a message naming the problem) and the stored rule
format (both kinds survive a round trip through JSON, and a row that cannot be read
is reported rather than dropped).

The Sprint 5 gate is covered by `test/industry-packs.e2e-spec.ts`:

- **Creating an organization with an industry installs the correct templates** —
  selecting an industry installs its pack; the installation writes metrics with
  `is_system`, formulas and dependency rows resolved to the organization's own metric
  ids, the health model with its category and metric weights, both kinds of rule with
  the alert pointing at the tenant's own metric, and the versioned installation
  record. Audited.
- **No organization receives another industry's private configuration** — a pack from
  another industry is 404 on read and on install, the overview lists only the
  caller's own, installing into one organization writes nothing into another, and the
  same metric code in two tenants is two separate rows.
- **Installed metrics behave exactly like tenant-owned ones** — a target, a threshold
  and two manual values on pack metrics produce a calculated value, a threshold status
  and a variance to target through the ordinary metrics routes.
- **Customization survives** — a renamed, recategorised and deactivated pack metric
  and a hand-tuned health weight are all intact after a re-install; a metric the
  organization defined itself under a pack code is kept as-is and not marked system.
- **Re-installation is idempotent** — nothing duplicated, nothing created twice.
- Also: platform routes are 403 for tenants, install is admin-only while reading is
  open to every member, the shipped catalogue syncs and re-syncs cleanly, a pack
  metric's code cannot be changed, and a pack metric cannot be deleted.

Verified by hand in Chromium against the running stack: the platform catalogue
listed all three packs and synced them (`+0 new, 11/12/12 updated`), the Healthcare
pack inspector showed its 11 metrics with `revenue / patients` as a formula, its
five weighted categories and its six rules; the tenant settings card showed the
installed hospitality pack, its health model and its counts; a re-install reported
"0 metrics added, 12 already present and left unchanged"; and hand-entered revenue,
available rooms and occupied rooms produced —

```text
adr             |     57.533864 | CALCULATED
available_rooms |   9300.000000 | MANUAL
occupancy_rate  |     77.000000 | CALCULATED
occupied_rooms  |   7161.000000 | MANUAL
revenue         | 412000.000000 | MANUAL
revpar          |     44.301075 | CALCULATED
```

checked directly in PostgreSQL and consistent with each other: RevPAR 44.301 =
ADR 57.534 × occupancy 0.77.

## SECURITY CHECKS

- A pack resolves only through the caller's own organization's industry. Another
  industry's pack is `NOT_FOUND`, not `FORBIDDEN` — a tenant has no business knowing
  it exists.
- Installation writes only rows carrying the target `organization_id`, taken from the
  session; template metrics (`organization_id IS NULL`) are never returned by a
  tenant-facing route.
- Platform pack administration is `@PlatformAdminOnly()`; both routes were asserted
  403 for a tenant admin in tests and in the browser.
- Installing is `ORGANIZATION_ADMIN` only; analysts and viewers are refused.
- Pack formulas are parsed by the same engine as user formulas (ADR-0008) — never
  evaluated — and their dependencies are resolved against the installing
  organization's metrics only.
- Rule definitions are re-validated when read back, so a hand-edited JSON column
  cannot smuggle a shape the engines do not expect; unreadable rows are reported and
  refuse the install rather than being skipped silently.
- Installation and catalogue sync are both audited with their result counts.
- The install transaction means a failure leaves no partial pack behind.

## KNOWN LIMITATIONS

1. **Re-installing is the only upgrade path.** It adds what is missing; it cannot
   change or remove what a tenant already has. A genuinely breaking pack revision (a
   renamed metric code, a reweighted model) still needs a migration story.
   `organization_industry_packs.version` records what was installed so that story can
   exist.
2. **Syncing does not reach installed organizations.** That is the right default — a
   platform edit must not silently rewrite tenant configuration — but a corrected
   pack reaches existing tenants only when they install again.
3. **No uninstall.** Pack metrics can be deactivated, and rules deleted directly, but
   there is no "remove this pack" action; removing metrics would cascade away values.
4. **Health weights and rules have no editing UI.** They are installed, stored and
   displayed; editing them belongs with the engines that consume them in Sprint 7.
   The API exposes them read-only for now.
5. **Health scores and rule evaluation do not exist yet.** The model and the rules
   are inert data until Sprint 7. The rule schema is validated now so those engines
   can rely on it.
6. **Organizations are still created only by the seed** — there is no signup or
   create-organization API in the MVP, so "creating an organization with an industry"
   is exercised through industry selection and through the seed, both of which call
   the same installer.
7. **One pack per industry in practice.** The schema allows several, and the tenant
   overview lists all of them, but automatic installation takes the oldest active
   pack for the industry.
8. **Docker images still unverified locally** (no Docker daemon in this container);
   CI builds them.

## FILES CHANGED

```text
API      src/industry-packs/catalogue/{pack-definition,healthcare,hospitality,
                                       real-estate,index,catalogue.spec}.ts
         src/industry-packs/{pack-sync,pack-install,pack-installer.service,
                             industry-packs.service,industry-packs.controller,
                             platform-packs.controller,industry-packs.module,
                             stored-rule,stored-rule.spec}.ts
         src/organizations/{organizations.service,organizations.module,
                            organizations.service.spec}.ts
         src/metrics/metrics.service.ts (metric code immutability)
         src/app.module.ts, prisma/seed.ts, prisma/schema.prisma
         prisma/migrations/20260817090000_alert_rule_codes/migration.sql
         test/industry-packs.e2e-spec.ts, test/helpers/fixtures.ts
Web      src/features/industry-packs/{PlatformPacksPage,IndustryPackCard,packs-api}.ts(x)
                                     (+ tests for both screens)
         src/features/settings/OrganizationSettingsPage.tsx (+ test)
         src/app/App.tsx, src/components/AppShell.tsx
Shared   packages/shared-types/src/industry-packs.ts, src/index.ts
Docs     docs/decisions/0009-industry-packs.md, docs/{industry-packs,api,architecture,
         database,current-state,implementation-checklist}.md, docs/sprints/sprint-5.md,
         docs/sprints/sprint-4.md (two corrections), README.md
```

## ACCEPTANCE CRITERIA

| Criterion                                                                | Status                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Creating an organization with an industry installs the correct templates | ✅ Industry selection and the seed both install through the same function |
| No organization receives another industry's private configuration        | ✅ 404 on read and install; overview scoped to the caller's industry      |
| The three MVP packs exist with their metrics, model and rules            | ✅ 11/12/12 metrics, five weighted categories and six rules each          |
| Pack metrics behave like tenant-owned ones                               | ✅ Targets, thresholds, manual entry and calculation, verified end to end |
| Customization survives                                                   | ✅ Renames, recategorisation, deactivation and tuned weights all kept     |

## NEXT SPRINT

**Sprint 6 — Executive Dashboard and Analytics.**

- `GET /dashboard/overview`: KPI cards, health placeholder, trends, attention items,
  all calculated server-side.
- Analytics: period comparison, breakdown by branch and department, metric
  correlation over time.
- Global filters — date range, branch, department — applied consistently across
  every panel.
- Read-time aggregation across periods and slices, which is the piece Sprint 4's
  formulas deliberately left out.
- Gate before Sprint 7: every number on the dashboard matches what the metrics API
  returns for the same filter, filters apply to every panel at once, and an empty
  organization renders an honest empty state rather than zeros.
