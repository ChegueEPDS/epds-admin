# Project Tracker exchange rates

The work editor and Finance editor include an **Exchange rates & financial entries** section. Company tenants can record the order acceptance date. Invoice and receipt totals can be itemized into dated entries, each with its own reference. Once itemized, the total is calculated from the entries. All entries use the work's original currency.

## Valuation

- Pipeline: latest available daily MNB rates.
- Accepted work: the acceptance-date snapshot. Entering an accepted status (`to_start` or later, including `on_hold`) or signing the contract records today's date unless an acceptance date is supplied. Zero-value work also retains its acceptance date for a later amount entry.
- Receipts: each payment's dated snapshot. A work's manually entered/itemized received amount takes precedence over sub-work receipt totals, as before. Sub-work receipts also retain their payment-date snapshots.
- Receivables: outstanding invoice amounts at their respective invoice-date snapshots. Payments settle invoices oldest first, in the original currency. Full settlement leaves zero receivable regardless of exchange movements. Payments do not currently designate individual invoice allocations.
- Unbilled: the remaining amount in the original currency at the acceptance-date snapshot. Lead, Cancelled and Lost works are excluded, matching the existing scope.

Snapshots retain HUF quotes and quotation units so changing the tenant's reporting currency does not replace historical rates. AED uses the dated MNB USD quote and the existing 3.6725 AED/USD peg. Weekends and holidays use the last MNB publication on or before the event date, searched over the preceding 14 days. Missing rates reject the save that needs a new snapshot; a current rate is never substituted for an unavailable historical rate. Routine edits reuse fixed snapshots. Correcting an event date deliberately fixes the quote for the corrected date; correcting an amount on the same date keeps its existing quote.

Different parts of the dashboard use different valuation dates. Their converted amounts need not form a single accounting reconciliation. No realized exchange gain/loss accounting or invoice-specific settlement allocation is implemented.

## Existing records and deployment

No historical acceptance date is inferred from creation, import or modification timestamps. Existing unconverted records continue to use current rates and the dashboard flags them. On the first subsequent save, an existing accepted work without a known acceptance date receives an explicitly marked baseline snapshot. Legacy aggregate invoice/payment amounts use their known invoice/payment date, or a marked baseline if no date was recorded. Enter the actual date to replace a baseline. Existing totals are preserved; no automatic production backfill is run.

Rates and dates are displayed on work details. Financial entries submitted by clients cannot supply trusted snapshots: the backend restores existing quotes or obtains them from MNB. Changing the source currency after an invoice/payment is rejected. Existing records, ordinary edits, Finance edits, workbook imports and sub-work receipts use the same server-side rules.

PostgreSQL startup applies `013_work_exchange_rates` automatically, adding `sub_work_items.exchange_rates`. Work snapshots and dated entries use the existing `work_items.reporting` JSON. MongoDB uses the existing work reporting object and the new sub-work `exchangeRates` field. Dashboard snapshot version 4 invalidates old cached calculations on deploy. Historical lookups are stored separately from the current daily quote, including a refresh rule for requests made before today's MNB publication.

The official MNB WSDL advertises an HTTP SOAP endpoint. Historical requests try HTTPS first and use that official HTTP endpoint if HTTPS fails; they send only public currency codes and dates. Retrieved values are validated before persistence.

## Verification

Run backend `npm test`, backend `npm run check`, and frontend `npm run build`. The optional PostgreSQL test requires a disposable database: `WORK_FX_TEST_DATABASE_URL=postgresql://.../fx_qa node --test test/workExchangeRatesPostgres.test.js`. It seeds/restores quote fixtures, creates isolated tenant records, and checks persistence, dashboard valuation, sub-work receipts, cache invalidation and same-day historical-cache refresh. Never target a production database with integration tests.
