# Panda to EPDS Admin work migration

## Source and destination

| Panda owner | EPDS Admin tenant | Work | Archived work | Sub-work | Archived sub-work | Project tasks |
|---|---|---:|---:|---:|---:|---:|
| Company 1, EPDS Szoftverfejlesztő Kft. | `epds` | 125 | 14 | 223 | 13 | 9 |
| Company 6, IndEx Middle East FZE | `ind-ex` | 99 | 23 | 126 | 19 | 0 |

Counts were read from the live Panda database on 2026-11-09 and include soft-deleted rows. Scope comes from `projects.company_id`. A subproject, task, note or contributor belongs to the tenant of its parent project. Confirm destination tenant IDs and the application release against the target environment before applying anything.

The source includes 44 project contributor links and 85 subproject contributor links in the two companies. Confirm attachments via their polymorphic type and parent ID. A `document` value is a reference. The actual content of an uploaded attachment must come from Panda's document storage.

## Export and preflight

Export source data with read-only queries and save it in a private local directory. Never export the entire `users` table or any authentication table. Use only referenced user IDs, names and email addresses when matching tenant users.

```sql
SELECT * FROM projects WHERE company_id IN (1,6) ORDER BY id;
SELECT s.* FROM subprojects s
JOIN projects p ON p.id=s.project_id
WHERE p.company_id IN (1,6) ORDER BY s.id;
SELECT id,name,prefix,company_id FROM types ORDER BY id;
```

Keep the source exports and this report separate. The preflight script accepts phpMyAdmin JSON exports and can validate scoped parents and source numbering without writing to either database.

```sh
node backend/scripts/panda-work-board-preflight.js \
  --projects /private/path/projects.json \
  --subprojects /private/path/subprojects.json \
  --types /private/path/types.json \
  --compare-live-snapshot
```

An optional `--target-numbers` file can supply the existing destination work numbers by tenant slug, including archived works. Inspect collisions by source ID. Names, financial amounts and notes stay out of the preflight report.

## Field ownership

| Panda source | EPDS Admin destination |
|---|---|
| Project, subproject, original dates, archive flag, description and commercial state | Work and sub-work. Retain source creation and update times separately from later EPDS edits. Preserve independently archived children on parent restoration. |
| Source project and subproject IDs | Stable import keys scoped to the destination tenant. A repeat run resolves the original target ID. |
| Year, numeric work number and type prefix | Preserve the original, prefixed Panda number as tenant metadata. Allocate destination work numbers through the existing sequences. |
| Customer company and billing partner | Link the customer by validated tax identity when available. Preserve the billing partner separately. An unresolved name remains visible for later matching. |
| Owner and contributors | Link by verified tenant user email. Preserve unresolved names as migration notes without creating user accounts. |
| Division and type | Use tenant business units for recorded divisions and a tenant project type field or service catalog entry where semantically equivalent. Map IndEx `AE` to UAE and `EU` to EU. Leave missing divisions unassigned. |
| Revenue, costs, two currency references and exchange rate | Preserve original currency amounts. Use the standard cost field only when amounts share a currency or a verified conversion is available. Keep original cost and cost currency as tenant fields where needed. |
| Invoice references, payment dates and paid status | Preserve source facts. Build confirmed financial balances only from authoritative amounts. Route partial or ambiguous cases to reconciliation. Deduplicate parent and milestone references to the same invoice. |
| Document reference, legacy working hours and subproject-specific fields | Preserve populated values in appropriate tenant fields, including a text field for references that are not valid HTTPS URLs. Keep references and actual files distinguishable. |
| Panda project tasks and notes | Preserve their original status and assignment. For a tracker-enabled tenant, link applicable open actions to the shared Work record. Retain source history for board-only tenants. |

The live source has 13 duplicate groups when comparing tenant, year and numeric work number before applying Panda type prefixes. In addition, two EPDS source work numbers overlap with unrelated destination records. Preserve the Panda identifier and allocate the EPDS Admin work number without overwriting either record.

## Apply gate

The live EPDS Admin interface inspected during preflight had Work Board but no Project Tracker or Work settings. Release the tenant features before the full migration. Take a target backup and run a rehearsal against a separate copy. Compare tenant totals, archived records, parent-child links, unmapped users, financial totals per currency and source file references. Keep unresolved matches visible and preserve original data. An apply utility and a completed destination import are separate from the read-only preflight in this directory.
