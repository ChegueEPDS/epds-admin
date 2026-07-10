# EPDS License Integration API v1

Base path: `/api/integrations/v1`

Send the API key in `Authorization: Bearer <api-key>` or `X-API-Key: <api-key>`. API keys and webhook secrets are shown only once in **Settings > License integrations**. All responses are JSON except multipart uploads.

## Poll licenses

```http
GET /api/integrations/v1/licenses?limit=50&updatedAfter=2026-07-10T00:00:00.000Z
Authorization: Bearer epds_live_...
```

Follow `nextCursor` while `hasMore` is `true`. Pass the cursor unchanged on the next request. A client can see every license, but VPN credentials, notes, infrastructure credentials and blob paths are not exposed.

## Poll ordered events

```http
GET /api/integrations/v1/events?limit=50&occurredAfter=2026-07-10T00:00:00.000Z
Authorization: Bearer epds_live_...
```

The event type is `license.ordered`. The event is emitted whenever a license changes from a different status to `ordered`, including the requested `active -> ordered` and `expired -> ordered` transitions. Event IDs are globally unique and consumers should deduplicate by `id`.

## Upload a license file

```bash
curl -X POST "https://admin.example.com/api/integrations/v1/licenses/<license-id>/license-file" \
  -H "Authorization: Bearer $EPDS_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -F "file=@license.zip"
```

Supported file extensions are `.zip`, `.txt` and `.docx`; maximum size is 3 MB. ZIP/DOCX signatures and UTF-8 TXT content are checked. Upload replaces the current file. If the license was `ordered`, a successful upload changes it to `pending`.

`Idempotency-Key` is required, must be 16-200 characters, and is retained for 24 hours. Repeating the exact request returns the original response. Reusing the key for different content returns `409`.

## Webhooks

Webhooks send the same event envelope returned by the events endpoint:

```json
{
  "id": "061f6b3e-7c95-43de-9c83-72ac2e4cd936",
  "type": "license.ordered",
  "occurredAt": "2026-07-10T10:00:00.000Z",
  "data": {
    "previousStatus": "active",
    "status": "ordered",
    "license": {
      "id": "...",
      "customerName": "Example Customer",
      "description": "Production",
      "status": "ordered",
      "objectLimit": 6000,
      "expiresAt": "2027-12-31T00:00:00.000Z",
      "mobileApp": true
    }
  }
}
```

`objectLimit` is a number for fixed and custom limits, or `"unlimited"` when the license has no object limit. `mobileApp` is `true` when the customer has mobile enabled, otherwise `false`.

Headers:

- `X-EPDS-Event-Id`: globally unique event ID.
- `X-EPDS-Timestamp`: Unix timestamp in seconds.
- `X-EPDS-Signature`: `v1=<hex HMAC-SHA256>`.

To verify, reject timestamps older than five minutes, calculate HMAC-SHA256 over `<timestamp>.<raw-request-body>` using the webhook secret, and compare signatures with a constant-time function. Return any `2xx` response within 10 seconds. Failed requests are retried up to 10 times with exponential backoff; SuperAdmin can requeue dead deliveries.

## Webhook tester

Open `/webhook` in EPDS Admin or use **Settings > License integrations > Webhook tester**. The page creates a random receiver URL, displays the latest 100 requests with their headers and raw/parsed body, and can send an editable JSON sample. Paste the integration's one-time webhook signing secret into the inspector to verify `X-EPDS-Signature`; the secret stays in browser memory and is not sent to or stored by the backend.

Test inboxes expire after 24 hours. Request bodies are limited to 256 KB, sensitive HTTP headers are redacted, and receiver traffic is rate-limited. A local receiver URL is useful for manual tests only because production webhook configuration rejects localhost and private addresses. After deployment, paste the tester's public `https://.../api/webhook-test/inboxes/...` URL into the integration settings.

## Operational responses

- `400`: invalid input or idempotency key.
- `401`: missing, malformed, revoked or invalid API key.
- `403`: required API scope is absent.
- `404`: license not found.
- `409`: idempotency conflict or request still processing; honor `Retry-After` when present.
- `413`: file is larger than 3 MB.
- `415`: unsupported extension or invalid file content.
- `429`: rate limit exceeded. The current limit is 120 requests per API key per minute.

## Deployment checklist

Set `INTEGRATION_SECRET_ENCRYPTION_KEY` to a stable base64-encoded 32-byte secret in the deployment secret store. Changing or losing it makes existing webhook signing secrets unreadable. Keep `WEBHOOK_WORKER_ENABLED=true` on at least one running backend instance. MongoDB TTL cleanup, unique indexes and the delivery lock make multiple worker instances safe. Configure Azure Blob Storage before enabling uploads, then run a staging smoke test covering API authentication, a repeated idempotent upload, HMAC verification and a forced webhook retry.
