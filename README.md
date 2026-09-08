# EPDS Admin

Standalone admin app split into two projects:

- `backend`: Express API using the existing EPDS-style cookie/session auth model.
- `frontend`: Angular Material UI with login, function cards, mail and domain-health pages.

## Development

Backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Frontend:

```bash
cd frontend
cp .env.example .env
npm install
npm start
```

The frontend runs on `http://localhost:4300` and expects the API on `http://localhost:4301` by default.

## Docker deployment

The repository contains a production Docker Compose stack with Angular, the Express API and MongoDB. It intentionally does not include a public reverse proxy; expose the configured frontend and backend host ports through the proxy already installed on the VPS.

```bash
cp .env.docker.example .env
# Fill every required secret and set FILE_STORAGE_HOST_PATH to the VPS HDD mount.
docker compose config
docker compose up -d --build
```

The frontend is published on port `4300` and the API on `4301` by default. MongoDB is only available on the private Compose network. Uploaded license and APK files are private and stored below `FILE_STORAGE_HOST_PATH`; downloads continue to use authenticated API endpoints.

Before starting the stack, create the host storage directory and make it writable by UID/GID `1000`, which is the unprivileged Node user inside the backend container. In Coolify, define the values from `.env.docker.example` as application environment variables and point `FILE_STORAGE_HOST_PATH` at the HDD mount.

## Domain Status read model

The public Domain Status JSON and PDF endpoints read a materialized MongoDB snapshot instead of rebuilding 30 days of raw checks during the request. Snapshots are rebuilt after monitoring and PageSpeed runs and use a database lease so only one backend replica performs a given build. Stale snapshots remain available while a refresh runs.

Daily health rollups are backfilled at startup, refreshed hourly for the current two-day window, and retained for 400 days by default. The public JSON response supports ETag revalidation and sends browser/proxy stale-while-revalidate cache directives. The first request after a completely new deployment may wait for the initial snapshot; readiness is indicated by a temporary HTTP 503 rather than returning a partial report.

Production background jobs use MongoDB leases, so multiple API replicas do not duplicate domain checks, PageSpeed runs, license expiry work, or the daily report. Webhook reconciliation is marker-based and only revisits events whose deliveries were not durably created. Domain, PageSpeed, and webhook work use bounded concurrency configured through the corresponding environment variables.

Large license/APK downloads are streamed with HTTP byte-range support. Work, license, user, client, and effort list queries are bounded, and effort tasks compact old embedded timer sessions into durable counters to prevent unbounded MongoDB document growth.

One Domain Status PDF is pre-generated per owner per UTC day and stored in MongoDB. PDFs expire after 30 days through both a TTL index and a daily leased cleanup job. If no saved PDF is available, the download endpoint generates and persists one on demand.

After deploying these changes, run `npm run migrate:performance -- --dry-run` in the backend container, inspect the counts, and then run `npm run migrate:performance`. The migration is idempotent: it creates the required indexes, compacts legacy effort sessions in bounded batches, backfills daily rollups, and builds the initial status snapshots.
