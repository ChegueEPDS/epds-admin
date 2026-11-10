# EPDS Admin PostgreSQL cutover

The migration is deliberately two-phase. `DATABASE_ENGINE` must remain
`mongodb` until the PostgreSQL copy has passed count, relationship and checksum
validation. MongoDB is retained read-only for rollback after cutover.

## Infrastructure

- Database: `epds_admin`
- Application role: `epds_admin` (database owner)
- Coolify runtime secret: `DATABASE_URL`
- Host from the EPDS Compose network: `host.docker.internal:5432`

## Order of operations

1. Run `npm run postgres:schema` against an empty PostgreSQL database.
2. Take a timestamped MongoDB dump before the copy.
3. Run the idempotent MongoDB-to-PostgreSQL importer while the application is
   still using MongoDB. The archive keeps canonical Extended JSON and verifies
   every collection with both record counts and SHA-256 content digests.
4. Verify every relational table count and all checked foreign-key relations.
5. Run backend tests and the user acceptance suite against PostgreSQL.
6. Stop writes briefly, perform the final incremental copy and validate again.
7. Set `DATABASE_ENGINE=postgresql` and redeploy.
8. Keep the MongoDB dump and original database unchanged for rollback.

Never set `DATABASE_ENGINE=postgresql` merely because the schema exists.

## Commands inside the backend container

The container must receive both `MONGODB_URI` and `DATABASE_URL`.

```sh
npm run postgres:migrate
```

`postgres:migrate` is safe to rerun before cutover. Each run reconciles source
deletions, replaces the relational projection in a transaction, and fails if a
count, document digest, or checked relationship differs.

## Final cutover window

1. Take a timestamped `mongodump` and record its path and checksum.
2. Put the application into a short write freeze or stop the application
   container. Do not run the final copy while users can still write MongoDB.
3. Run `npm run postgres:migrate` and retain its complete output.
4. Confirm that every archive and projection row is marked `ok: true`.
5. Set `DATABASE_ENGINE=postgresql` in Coolify and redeploy without removing
   `MONGODB_URI`.
6. Confirm `/health/ready`, login, tenant selection, work board, effort
   tracking, domain monitoring, licences, documents and integration endpoints.
7. Keep MongoDB unchanged for the agreed rollback period.

## Rollback

If verification after cutover fails, stop writes immediately, set
`DATABASE_ENGINE=mongodb`, and redeploy the previously known-good application
revision. PostgreSQL must not be copied back automatically. Preserve its state
for diagnosis and reconcile any PostgreSQL-only writes explicitly before a
later retry. The pre-cutover MongoDB dump is the recovery baseline.
