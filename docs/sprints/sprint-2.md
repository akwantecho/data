# Sprint 2 Completion Report

```text
SPRINT: 2 — Organization Structure
STATUS: COMPLETE — all acceptance criteria met, all blocking tests pass
```

## IMPLEMENTED

**Industries and industry selection**

- `GET /industries` returning the active list, and
  `PUT /organizations/current/industry` to choose one.
- The choice is **locked once the organization has metric values or imports**
  (plan §37). The industry decides which pack supplies metrics, health model and
  insight rules, so switching later would leave reported history describing a model
  that no longer applies.

**Branches and departments**

- Full CRUD for both, scoped to the caller's organization on every query.
- `code` is unique per organization — the identifier CSV imports will map onto —
  with a clear `CONFLICT` message on collision, and the same code remains available
  to other tenants.
- A department may belong to a branch or to the organization as a whole. A
  `branchId` from **another** organization is rejected as a field-level validation
  error rather than silently accepted.
- Deleting is allowed only for structure with no history: a branch with departments
  or metric values, or a department with metric values, returns `CONFLICT` telling
  the administrator to deactivate instead. Deletion would have cascaded away
  reported numbers, which is the "never silently discard data" rule applied to
  structure.
- Inactive rows are hidden by default and returned with `?includeInactive=true`.

**Team management**

- `GET /organization-users` (any member), plus add, change role and remove for
  administrators.
- Adding by email attaches an existing platform user, or creates the account when
  the email is unknown — which requires a name and an initial password of at least
  12 characters with mixed case and a digit. Platform staff cannot be added to a
  tenant.
- **An organization can never be left without an administrator**: the last admin
  cannot be demoted or removed.
- Removing a member deletes the membership, not the user — they may belong to other
  organizations, and their history here must stay attributable. Access ends on their
  very next request, because the guard re-reads membership rather than trusting the
  token.

**Frontend**

- `/settings/organization`, `/settings/branches`, `/settings/departments`,
  `/settings/team`, with a shared tabbed layout, wired into the sidebar.
- Organization profile form (name, country, currency, timezone) and an industry
  selector that explains the lock.
- Branch and department tables with create/edit dialogs, activate/deactivate and
  delete; team table with inline role changes and member removal.
- Every write control is hidden from non-admins, and server messages for conflicts
  (duplicate code, last administrator, industry locked) are shown verbatim because
  they are written to be read by users.
- New shared components: `Modal`, `FormField`, and `describeApiError`, which maps
  the platform error envelope to user-facing copy without leaking internals.

## DATABASE CHANGES

**None.** The Sprint 0 model already covered industries, branches, departments and
memberships, including the per-organization unique codes and `is_active` flags this
sprint relies on. `prisma migrate diff --exit-code` confirms no drift.

## API CHANGES

| Method | Route                              | Access               |
| ------ | ---------------------------------- | -------------------- |
| GET    | `/industries`                      | Any member role      |
| PUT    | `/organizations/current/industry`  | `ORGANIZATION_ADMIN` |
| GET    | `/branches`, `/branches/:id`       | Any member role      |
| POST   | `/branches`                        | `ORGANIZATION_ADMIN` |
| PATCH  | `/branches/:id`                    | `ORGANIZATION_ADMIN` |
| DELETE | `/branches/:id`                    | `ORGANIZATION_ADMIN` |
| GET    | `/departments`, `/departments/:id` | Any member role      |
| POST   | `/departments`                     | `ORGANIZATION_ADMIN` |
| PATCH  | `/departments/:id`                 | `ORGANIZATION_ADMIN` |
| DELETE | `/departments/:id`                 | `ORGANIZATION_ADMIN` |
| GET    | `/organization-users`              | Any member role      |
| POST   | `/organization-users`              | `ORGANIZATION_ADMIN` |
| PATCH  | `/organization-users/:userId`      | `ORGANIZATION_ADMIN` |
| DELETE | `/organization-users/:userId`      | `ORGANIZATION_ADMIN` |

## FRONTEND CHANGES

- `features/settings/`: `SettingsLayout`, `OrganizationSettingsPage`,
  `BranchesPage`, `DepartmentsPage`, `TeamPage`, `settings-api`.
- `components/Modal`, `components/FormField`.
- `lib/errors.ts` — one place deciding which server messages are safe to show.
- Sidebar organization section now links to the four settings routes.

## TESTS

| Suite                              | Result                                 |
| ---------------------------------- | -------------------------------------- |
| API unit (Jest)                    | 85 passed, 11 suites (+26 this sprint) |
| API integration (Jest + Supertest) | 61 passed, 6 suites (+28 this sprint)  |
| Web (Vitest + Testing Library)     | 45 passed, 8 files (+19 this sprint)   |

The Sprint 2 gate is covered by `test/organization-structure.e2e-spec.ts` and
`test/team.e2e-spec.ts`:

- **CRUD** — full create/read/update/delete lifecycle for branches and departments.
- **Tenant isolation** — another organization's branch or department is invisible in
  lists and returns 404 on read, update and delete by id; the row is asserted
  untouched afterwards.
- **Invalid organization references** — creating or moving a department onto another
  organization's branch is rejected as a `branchId` validation error.
- **Codes** — duplicates rejected inside an organization, accepted across tenants.
- **Delete policy** — a branch with departments cannot be deleted.
- **Roles** — a viewer reads but cannot write; an analyst reads the team but cannot
  change it.
- **Team rules** — an existing user of another organization keeps their original
  membership when added here; duplicates rejected; a role change applies to the
  target's _existing_ session on the next request; the last administrator can be
  neither demoted nor removed; a removed member loses access immediately while their
  account survives; a member of another organization cannot be modified.
- **Industry** — set, rejected when unknown, refused once an import exists, refused
  to an analyst.
- **Audit** — structural changes recorded with before/after values.

Verified by hand in Chromium against the running stack: creating a branch through
the UI, the duplicate-code conflict surfacing the server's message, a department
attached to that branch, an inline role change persisting, the organization profile
saving, and a viewer seeing no write controls at all.

## SECURITY CHECKS

- Every new query is filtered by `organizationId` from the verified token; an id
  alone never resolves a row (asserted by the isolation tests).
- Foreign-key inputs (`branchId`) are validated against the caller's organization
  before use.
- Write routes are `ORGANIZATION_ADMIN`-only, read routes any member; the UI hides
  controls but the server is the boundary.
- Initial passwords are validated for length and character classes, hashed with
  Argon2id, and never echoed back.
- Platform staff cannot be added to a tenant, keeping the platform/tenant separation
  intact from both directions.
- The last-administrator rule prevents an organization from becoming unadministrable.
- Zod `.strict()` on the add-member DTO and unknown-key stripping elsewhere keep
  clients from injecting fields.
- All structural changes are audited with before/after values.

## KNOWN LIMITATIONS

1. **No invitation email or password reset.** An administrator sets a new member's
   first password and communicates it out of band. Phase 2 per plan §54.
2. **No forced password change on first sign-in**, which would pair naturally with
   the above; it needs a schema flag and is deferred with it.
3. **Removing a member does not revoke their refresh tokens.** It does not need to —
   membership is re-read per request, so tenant access ends immediately — but the
   user's session for _other_ organizations deliberately survives.
4. **Deactivating a branch does not cascade to its departments.** They remain active
   and simply belong to an inactive branch; the dashboard filters will need to
   account for that in Sprint 6.
5. **No bulk import of branches or departments** — Sprint 3 brings CSV import, which
   is the natural home for it.
6. **Docker images still unverified locally** (no Docker daemon here); CI builds both
   on every push.

## FILES CHANGED

```text
API      src/branches/{branches.controller,branches.service,branches.module,
                       branches.dto}.ts (+ dto spec)
         src/departments/{departments.controller,departments.service,
                          departments.module,departments.dto}.ts
         src/organization-users/{controller,service,module,dto}.ts (+ service spec)
         src/industries/{industries.controller,industries.service,industries.module}.ts
         src/organizations/{organizations.service,organizations.controller,
                            organizations.dto}.ts (+ service spec)
         src/app.module.ts
         test/{organization-structure,team}.e2e-spec.ts
Web      src/features/settings/{SettingsLayout,OrganizationSettingsPage,BranchesPage,
                                DepartmentsPage,TeamPage,settings-api}.ts(x) (+ 3 test files)
         src/components/{Modal,FormField}.tsx, src/components/AppShell.tsx
         src/lib/errors.ts, src/app/App.tsx, src/styles/global.css
Shared   packages/shared-types/src/organization.ts, src/enums.ts, src/index.ts
Docs     docs/{api,architecture,database,current-state,implementation-checklist}.md,
         docs/sprints/sprint-2.md, README.md
```

## ACCEPTANCE CRITERIA

| Criterion                                | Status                                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| CRUD works                               | ✅ Branches and departments, end to end, API and UI            |
| Tenant isolation verified                | ✅ Lists, reads, updates and deletes all scoped and tested     |
| Invalid organization references rejected | ✅ Cross-organization `branchId` rejected on create and update |

## NEXT SPRINT

**Sprint 3 — Data Import Engine.**

- Data sources (`MANUAL`, `CSV`), CSV upload with type and size limits.
- Parse → preview → column mapping → validate → commit, with per-row errors retained
  and duplicate commits blocked by the file checksum.
- Data quality module: completeness, freshness, validity, error count, confidence.
- Frontend: data sources, upload wizard, mapping UI, validation report, import
  summary and history.
- Gate before Sprint 4: a valid CSV imports, invalid rows are surfaced rather than
  dropped, an import can be cancelled before commit, a duplicate commit is prevented,
  and organization isolation holds throughout.
