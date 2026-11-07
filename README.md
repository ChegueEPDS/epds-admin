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

## Customer service monitoring

Status JSON and PDF endpoints require the normal authenticated session and `domainHealth` feature access. Customer report queries are constrained by tenant ID, including a selected SuperAdmin tenant context. The legacy `/public/domain-status/:owner` URL is retained for compatibility, but is no longer public. Customer payloads omit service URLs, tenant IDs, health policies, raw errors and PageSpeed diagnostic text. Responses are private and must not be cached by shared proxies. Existing anonymous status links now lead to login.

Availability and response performance are independent: a successful response exceeding the slow/very-slow thresholds is a warning, never an outage. A failed check is repeated until three consecutive failures confirm it. Recovery requires two consecutive successful checks. Confirmed rounds are stored once, together with per-location evidence. With remote locations enabled, each location receives one vote and a strict majority must agree. Missing probes and disagreements are inconclusive; the last confirmed status is retained, and becomes unknown after 35 minutes without a confirmed observation.

The monitor still runs every 15 minutes. Confirmation retries occur within a round (1.5-second intervals), not after another 15-minute wait. Distributed per-domain leases prevent competing manual and scheduled checks. Internal snapshots remain available for background processing, but customer responses are scoped and sanitized independently.

Before starting the updated backend, run `npm run migrate:domain-customers` in its environment. This idempotent migration adds PostgreSQL measurement/state/outbox storage, increases MongoDB raw-check retention to 400 days, and reclassifies historical `slow_response` failures as warnings. PostgreSQL cleanup likewise retains 400 days. Existing data already expired under the old 30-day retention cannot be restored; monthly PDFs explicitly report missing coverage. Previously stored daily snapshots/PDFs are not served by the customer endpoint.

### Independent measurement locations

Run `npm run start:domain-probe` on a separate host or network with:

- `DOMAIN_PROBE_TOKEN`: a unique random token of at least 32 characters.
- `DOMAIN_PROBE_ALLOWED_HOSTS`: comma-separated exact target hostnames.
- `DOMAIN_PROBE_PORT`: loopback port, default 4310.

Publish the loopback service through an HTTPS reverse proxy with request timeouts at least as long as the configured target timeout. Configure the main backend's `DOMAIN_HEALTH_REMOTE_PROBES` as a JSON array, for example `[{"name":"region-2","url":"https://probe.example/probe","token":"replace-with-long-random-token"}]`. Keep tokens in deployment secrets. At most four remote locations are supported. The runner does not need the application database. Target and redirect addresses are validated against private networks; the actual connection also validates DNS results. A remote runner on the same host is not an independent measurement location.

### Notifications and monthly archive

Set `DOMAIN_HEALTH_CUSTOMER_RECIPIENTS` to a JSON object keyed by tenant ID, for example `{"012345678901234567890123":["operations@example.com"]}`. There is deliberately no fallback to another customer's recipients. The existing Graph mail configuration (`MAIL_SENDER_UPN` and Azure credentials) is used. This setting enables confirmed outage/recovery notifications and monthly report delivery for those tenants. No real messages are sent by the test suite.

Notifications use a durable outbox, per-message leases and exponential retries capped at six hours. Successful deliveries are marked and skipped. As with an external mail service without an idempotency key, a crash between sending and recording success can cause a duplicate. Failed transition enqueueing is recoverable from the monitor's saved pending transition.

Monthly reports cover closed calendar months in `Europe/Budapest`, including daylight saving changes. They contain time-weighted observed availability, coverage, unknown time, downtime, complete observed interruption intervals, average month-clipped recovery time, average/P95 response time and a plain-language assessment. A check covers at most 30 minutes; longer gaps are unknown. Months with no data are never reported as 100% available. Creation/archive timestamps limit a service's reporting period. Archived PDFs remain immutable in `domain_operations`/`DomainOperation`; they do not inherit the old daily PDF's 30-day expiration.

The previous month is archived automatically after startup and checked hourly. The domain detail panel also lists closed months and downloads an existing archive or generates one on demand. Reports include all services of the selected tenant, not just the selected domain or owner badge. Customer access is enforced on both list and download endpoints. Domain deletion now archives the monitor and preserves its measurements. Monitors with measurement history cannot be reassigned to another tenant; archive and recreate them to preserve customer isolation. Take database backups of the monthly archive; no automatic archive deletion policy is applied.

### Verification

Run `npm test` and `npm run check` in `backend`, and `npm run build` in `frontend`. Optional integration tests use disposable local databases only:

- PostgreSQL: `DATABASE_ENGINE=postgresql DATABASE_URL=postgresql://.../epds_customer_qa DOMAIN_CUSTOMER_QA=true node --test test/domainCustomerPostgres.test.js`.
- MongoDB: `DOMAIN_CUSTOMER_MONGO_QA=true DOMAIN_CUSTOMER_MONGO_URL=mongodb://.../epds_customer_qa node --test test/domainCustomerMongo.test.js`.

These fixtures reset their dedicated test data. Never point them at an application database.

Production background jobs use MongoDB leases, so multiple API replicas do not duplicate domain checks, PageSpeed runs, license expiry work, or the daily report. Webhook reconciliation is marker-based and only revisits events whose deliveries were not durably created. Domain, PageSpeed, and webhook work use bounded concurrency configured through the corresponding environment variables.

Large license/APK downloads are streamed with HTTP byte-range support. Work, license, user, client, and effort list queries are bounded, and effort tasks compact old embedded timer sessions into durable counters to prevent unbounded MongoDB document growth.

Legacy internal daily PDF caching remains separate from authenticated customer downloads and the permanent monthly archive.

After deploying these changes, run `npm run migrate:performance -- --dry-run` in the backend container, inspect the counts, and then run `npm run migrate:performance`. The migration is idempotent: it creates the required indexes, compacts legacy effort sessions in bounded batches, backfills daily rollups, and builds the initial status snapshots.
