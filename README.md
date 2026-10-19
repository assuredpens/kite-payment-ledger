# Payment Ledger

Payment and delivery evidence reconciliation with append-only case review.

Version 0.1.0 is an AI-assisted engineering evaluation release, developed under one operator and assigned to this GitHub account. It is not evidence of independent human adoption, official Kite approval, Electric Capital inclusion or successful live payment.

## Run and verify

Node.js 20.11+ is required.

```sh
npm ci
npm test
# Set DATA_KEY and ACCOUNTS_JSON, then:
npm start
```

Run a single operator workspace or configure multiple isolated tenants through ACCOUNTS_JSON, a JSON map of tenant IDs to distinct bearer tokens. Imports accept {"events":[...]} at POST /imports/executions, /imports/merchant-events and /imports/activity. GET /operations and /operations/{id} return matched evidence. POST /cases/{id}/resolve records an append-only review action and reason.

Import normalized events using docs/EVENTS.md. Raw Passport output field mapping must be reviewed before import; no undocumented response shape is guessed. Strong references form connected evidence groups; time or amount similarity only creates a candidate. Payment, fulfillment, send/access observations remain distinct in retained events. Import statements are evidence claims, not independent chain verification.

Event IDs deduplicate within and across batches; conflicting IDs roll back the whole batch. Late evidence appends a new decision snapshot. Contradictory confirmed/failed settlement evidence remains UNKNOWN. Resolution records never send money. Actual artifact recovery is performed at the original merchant with its own authorization.

## Configuration and recovery

Use .env.example as a list of required environment variables; the service does not automatically load it. Generate a fresh 32-byte hex DATA_KEY locally, keep it outside the repository and retain it across restarts. Supply strong operator/application bearer tokens and a real receiver and asset before enabling a service. Values are intentionally blank so example configuration cannot silently charge a wrong wallet. The stored payment state UNKNOWN never means unpaid. Inspect the original receipt/activity and restricted journal; do not change an operation key to buy again. Where a writer lock survives a crash, stop all writer processes and review the journal before removing only the stale lock directory.

## Integration evidence

Read [compatibility.json](compatibility.json) and [the protocol boundary](docs/PROTOCOL.md). Local tests are E1; read-only public capability/RPC observations prove only the facts observed. Real Passport approval, funded purchase, SIWX interoperability, public deployment and catalog/EC review are not completed by this release. 

## Scope and evidence

[Original PRD](docs/PRD.md) describes the full target, not a claim that every external acceptance gate has passed. [Event contract](docs/EVENTS.md) defines the application records. The standalone repositories share protocol/storage support code, with distinct business implementations and tests. The license is MIT; third-party dependencies keep their upstream licenses. Reproduce failures without publishing payment signatures, account credentials or private files.
