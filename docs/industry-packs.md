# Industry Packs

An industry pack is **data**, not code: a named, versioned bundle of default
metrics, a health model and deterministic rules for one industry. Adding an
industry must never require touching core code.

> Status: built in Sprint 5. Three packs ship; installation, re-installation and
> the tenant/platform screens are live. Health scores and rule evaluation arrive
> with the engines in Sprint 7.

## Anatomy

| Part         | Table                         | Purpose                                              |
| ------------ | ----------------------------- | ---------------------------------------------------- |
| Pack         | `industry_packs`              | Identity and version, bound to one industry          |
| Metrics      | `industry_pack_metrics`       | Template metrics (`metrics` rows with `industry_id`) |
| Health model | `industry_pack_health_models` | Categories, weights, metric weights                  |
| Rules        | `industry_pack_insight_rules` | Insight and alert definitions (see below)            |
| Installation | `organization_industry_packs` | What a tenant received, and at which version         |

Both kinds of rule live in the pack's one rule table. Each row records the kind it
holds (`{ kind: 'INSIGHT' | 'ALERT', rule: … }`), and alert rows carry an `alert:`
code prefix so an insight and an alert describing the same condition cannot
collide on one code.

## Where a pack comes from

```text
apps/api/src/industry-packs/catalogue/*.ts     the shipped definitions (data literals)
        │  syncPackCatalogue()  — seed, or POST /platform/industry-packs/sync
        ▼
industry_packs + template metrics + model + rules      the database
        │  installPack()  — choosing an industry, or POST /industry-packs/:id/install
        ▼
ordinary tenant rows: metrics, health model, insight_rules, alert_rules
```

The installer reads **only** from the database. That is what keeps "a pack is
data" true rather than aspirational: a pack inserted by an administrator installs
through exactly the same path as a shipped one, and no engine anywhere branches on
an industry code.

The definitions are validated by a Zod schema (`catalogue/pack-definition.ts`) that
a unit test runs over every shipped pack: codes unique, category weights summing to
100, metric weights summing to 100 inside each category, and every formula, rule
condition, evidence code and alert target naming a metric the same pack installs.
A pack that is wrong is otherwise only discovered inside a customer's organization.

## Installation

```text
Industry selected (or POST /industry-packs/:id/install)
   ↓
Template metrics cloned into the organization (is_system = true)
   ↓
Formulas and dependency rows resolved to the organization's own metric ids
   ↓
Health model materialised (categories + metric weights)
   ↓
Insight rules and alert rules materialised
   ↓
Installation recorded with the pack version, and audited
```

All of it in one transaction: a tenant is never left holding half a pack.

Two rules govern it:

- **Clone, never reference.** An organization must be able to rename, recategorise
  or deactivate its copy of a metric without mutating the template every other
  tenant installs from.
- **Never overwrite.** Anything already present under the same code is left exactly
  as the tenant has it — a metric they renamed, a weight they tuned, a rule they
  disabled. So installing is repeatable: a pack that gains a metric can be
  re-installed to pick it up, and no customization is ever silently undone. The
  result reports how many items were created and how many were kept.

Isolation: installation only writes rows carrying the target `organization_id`, and
a pack resolves only through the caller's own industry. Template metrics
(`organization_id IS NULL`) are never returned by a tenant-facing endpoint.

## Rule definitions

Deterministic, validated with Zod, evaluated by the engines in Sprints 7 and 8 —
never by a model.

```jsonc
// Insight rule
{
  "conditions": [
    { "metric": "appointments", "measure": "CHANGE_PCT", "operator": "GT", "value": 0 },
    { "metric": "revenue_per_patient", "measure": "CHANGE_PCT", "operator": "LT", "value": 0 },
  ],
  "narrative": "Patient volume is increasing but monetization per patient is declining…",
  "evidence": ["appointments", "revenue_per_patient", "revenue"],
}
```

`measure` is one of `CHANGE_PCT`, `VALUE`, `VARIANCE_TO_TARGET_PCT` — each already
computed by the metrics engine, so a rule never needs arithmetic of its own. Every
rule names its own evidence; an insight without evidence is a bug, not an insight.

```jsonc
// Alert rule — parameters are validated per type
{ "type": "METRIC_ABOVE_THRESHOLD", "definition": { "usesConfiguredThreshold": true } }
{ "type": "LARGE_PERIOD_CHANGE",    "definition": { "changePct": -15 } }
{ "type": "TARGET_MISSED",          "definition": { "tolerancePct": 5 } }
```

`usesConfiguredThreshold` means the rule reads the metric's own warning/critical
values, so a tenant that retunes a threshold retunes the alert with it.

## MVP packs

### Healthcare — `healthcare_core`

Revenue, Patients, Appointments, Completed Appointments, Cancelled Appointments,
No-Show Rate, Doctor Utilization, **Revenue per Patient** (`revenue / patients`),
Average Waiting Time, Patient Retention, Treatment Completion Rate.

Health model: Financial 30, Patient Growth 20, Operations 20, Utilization 15,
Patient Experience 15.

Rules: volume up / monetization down, waiting time hurting retention, revenue
decline; alerts on no-show rate, doctor utilization and a missed revenue target.

### Hospitality / Tourism — `hospitality_core`

Revenue, Bookings, Guests, Available Rooms, Occupied Rooms, **Occupancy Rate**
(`occupied_rooms / available_rooms * 100`), **ADR** (`revenue / occupied_rooms`),
**RevPAR** (`revenue / available_rooms`), Cancellation Rate, Average Length of
Stay, Repeat Guest Rate, Booking Lead Time.

Health model: Financial 30, Occupancy 25, Demand 20, Guest Behavior 15,
Operations 10.

Rules: occupancy bought with rate, cancellations rising, RevPAR decline; alerts on
occupancy, cancellation rate and a sharp RevPAR drop.

### Real Estate — `real_estate_core`

Revenue, Properties, Units, Occupied Units, Vacant Units, **Occupancy Rate**,
**Vacancy Rate**, Rental Yield, Collection Rate, Maintenance Cost, **Revenue per
Unit** (`revenue / units`), Renewal Rate.

Health model: Financial 30, Occupancy 25, Collections 20, Asset Performance 15,
Maintenance 10.

Rules: vacancy eroding revenue, collections weakening, maintenance outpacing
revenue; alerts on collection rate, vacancy rate and a missed revenue target.

Stock metrics (properties, units, occupied/vacant units) aggregate as `LAST`: a
portfolio of 400 units is 400 units, not 4,800 a year.

## Adding an industry later

1. Insert an `industries` row.
2. Add a definition satisfying `packDefinitionSchema` and sync it — or insert the
   pack rows directly.
3. Nothing else. Retail, Restaurants, Education, Logistics, Manufacturing,
   Government, Professional Services, Technology and custom industries all follow
   this same path.
