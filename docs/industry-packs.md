# Industry Packs

An industry pack is **data**, not code: a named, versioned bundle of default
metrics, a health model and insight rules for one industry. Adding an industry
must never require touching core code.

> Status: the schema and this contract exist as of Sprint 0. Pack content and the
> installer are built in Sprint 5.

## Anatomy

| Part          | Table                         | Purpose                                              |
| ------------- | ----------------------------- | ---------------------------------------------------- |
| Pack          | `industry_packs`              | Identity and version, bound to one industry          |
| Metrics       | `industry_pack_metrics`       | Template metrics (`metrics` rows with `industry_id`) |
| Health model  | `industry_pack_health_models` | Categories, weights, metric weights                  |
| Insight rules | `industry_pack_insight_rules` | Deterministic conditions + message + evidence        |
| Installation  | `organization_industry_packs` | What a tenant received, and at which version         |

## Installation flow

```text
Organization created → industry selected → pack resolved
→ template metrics cloned into the organization (is_system = true)
→ health model materialised (categories + metric weights)
→ insight rules materialised
→ default dashboard prepared
```

Cloning rather than referencing is deliberate: an organization must be able to
customise a metric without mutating the template every other tenant depends on.
`is_system` marks pack-provided metrics so they can be deactivated but not deleted.

Isolation rule: installation only ever writes rows carrying the target
`organization_id`. No organization can read another industry's private
configuration, and template metrics (`organization_id IS NULL`) are never returned
by tenant-facing endpoints.

## Rule definition shape

Insight and alert rules are JSON validated with Zod, evaluated by the deterministic
engine — never by a model:

```jsonc
{
  "conditions": [
    { "metric": "appointments", "change": "increase" },
    { "metric": "revenue_per_patient", "change": "decrease", "thresholdPct": -10 },
  ],
  "message": "Patient volume is increasing but monetization per patient is declining.",
  "evidence": ["appointments", "revenue_per_patient", "revenue"],
  "severity": "WARNING",
}
```

## MVP packs

### Healthcare

Metrics: Revenue, Patients, Appointments, Completed Appointments, Cancelled
Appointments, No-Show Rate, Doctor Utilization, Revenue per Patient, Average
Waiting Time, Patient Retention, Treatment Completion Rate.

Health categories: Financial, Patient Growth, Operations, Utilization, Patient
Experience.

### Hospitality / Tourism

Metrics: Revenue, Bookings, Guests, Available Rooms, Occupied Rooms, Occupancy
Rate, ADR, RevPAR (`room_revenue / available_rooms`), Cancellation Rate, Average
Length of Stay, Repeat Guest Rate, Booking Lead Time.

Health categories: Financial, Demand, Occupancy, Guest Behavior, Operations.

### Real Estate

Metrics: Revenue, Properties, Units, Occupied Units, Vacant Units, Occupancy Rate,
Vacancy Rate, Rental Yield, Collection Rate, Maintenance Cost, Revenue per Unit,
Renewal Rate.

Health categories: Financial, Occupancy, Collections, Asset Performance, Maintenance.

## Adding an industry later

1. Insert an `industries` row.
2. Insert an `industry_packs` row plus its template metrics, health model and rules.
3. Nothing else. Retail, Restaurants, Education, Logistics, Manufacturing,
   Government, Professional Services, Technology and custom industries all follow
   this same path.
