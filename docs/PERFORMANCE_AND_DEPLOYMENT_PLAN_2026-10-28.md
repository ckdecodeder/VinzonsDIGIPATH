# Loading reliability, performance, and deployment plan

Prepared: 28 October 2026, Asia/Manila.

Status: **Plan only. Implementation, backups, migrations, and deployment have not started.**

Baseline: `main`, commit `73cf88f` — the updated Raspberry Pi files are already on this branch.

Reference: [full performance audit](MULTI_USER_PERFORMANCE_AUDIT_2026-10-28.md). This plan also incorporates the friend's eight loading findings, including startup readiness and the Vite environment override.

Change record: follow the instructions in [CHANGELOG.md](../CHANGELOG.md) before each implementation batch, then record actual changes, test results, deployment status, recovery information, and remaining work there. A planned checkpoint is not a completed change.

## Intended outcome

Make four users on separate devices able to log in, browse, update documents, and use the scanner without one stalled request freezing the whole application. Preserve documents, attachments, role permissions, workflows, and the updated Pi mechanism. Establish a working local baseline before changing hosting.

Current architecture: Vercel frontend → public tunnel → laptop backend → laptop PostgreSQL and scan files.

The first implementation batch addresses request deadlines, independent loading, and verified endpoint selection. Payload reduction and event-driven refresh fixes follow immediately because they have the largest measured transfer cost. Deployment is a later stage with its own verification and rollback.

## Current user decisions and local checkpoint

On 2026-10-28 the user selected keeping the backend and PostgreSQL on this laptop and preparing physical four-device acceptance for later. The user published the first batch through `main` at `4c8649e`; the updated Vercel frontend and public API/WS reads were verified. The original first batch passed 55 tests and a production build. The user subsequently reported smooth ordinary online actions and a stuck roughly 490-page activity print/export. The separate report fix is LOCAL on `main`: background PDF generation, single-page preview, cancellation/deadlines, PDF print handoff and complete image ZIPs; 39 frontend tests and the production build passed. See [the handoff](PERFORMANCE_IMPROVEMENTS_2026-10-28.md), [first-batch evidence](performance-evidence-2026-10-28/verification-summary.json) and [report evidence](performance-evidence-2026-10-28/report-verification.json). No cloud/database migration or new report-fix publication was performed. Remaining phases and physical acceptance stay pending.

## Working rules

- Recheck the checkout and any new user changes before implementation. Use `main` as requested; do not create another branch as part of this plan.
- Make small commits with explicit file lists after each batch passes its checks. Leave unrelated files alone.
- Treat real records, uploaded scans, and local credentials separately from source code. Keep backups and private environment files out of Git.
- Use a restored test database and separate scan-storage location for write tests and migrations.
- Preserve the current Pi motor/sensor behavior. Camera transport work must not change lift directions, layer mapping, or sorting mechanics.
- A deployment checkpoint is complete only after the running frontend, backend, Pi, database, and stored scans have been verified together. A successful build alone is insufficient.

## Phase 0 — Protect data and establish the baseline

### Tasks

1. Record the current revision, branch, working changes, environment locations, database identity, and upload directory. Record public endpoint relationships without exposing credentials.
2. Prepare an ignored backup directory, such as `database-export/performance-operation-2026-10-28/`. Verify Git ignores it before storing real data there.
3. Briefly coordinate a pause in document/scan writes while taking a consistent database-and-file backup. Use the installed PostgreSQL 18 `pg_dump` in custom format; preserve schema, data, indexes, and constraints. Keep credentials out of command output and process arguments where practical.
4. Back up `backend/uploads/scans` with a file manifest and checksums. Securely preserve the relevant backend, frontend, network, and Pi environment configuration.
5. Restore the dump into a separately named test database, for example `vinzons_digipath_perf_test_20261028`, and clone the scan directory for testing. Check counts and representative attachment access against the originals. Preserve an additional verified backup on separate storage before live migration/cutover.
6. Make scan storage configurable if necessary for isolation, keeping the existing path as the default. The upload writer and `/uploads` serving path must use the same selected directory. Test and staging processes must use the cloned storage.
7. Bring up an isolated backend/frontend using test configuration. Its startup migrations must not target the real database.
8. Capture a four-device baseline where possible: request count, response bytes, time to usable page, errors, database waits, and camera throughput. Record unavailable measurements instead of inventing them.

### Backup caveat

The existing `npm run export-db` is not the sole recovery method: its JSON export omits `commands`, does not preserve the complete schema/index/constraint definition, and writes into `dbcollections`. Its instruction to commit exported data is unsuitable for these private backups. Use the verified PostgreSQL dump and scan-file backup for recovery.

### Completion criteria

- The backup restores successfully into the test database.
- Counts match for all relevant tables, including commands, logs, and device events.
- Sample original PDFs/images open from the cloned files.
- No backup or credential file is staged for Git.
- The running test processes are confirmed to use test data and storage.

## Phase 1 — Fix stalled loading and endpoint selection

Suggested files: `dashboard/src/api/documentService.js`, `dashboard/src/api/apiBase.js`, `dashboard/src/main.jsx`, `dashboard/src/ws/realtimeClient.js`, `dashboard/vite.config.js`, `scripts/start-all.js`, `backend/middleware/auth.js`, and the relevant page/loading components.

### 1A. Shared request deadlines and controlled retries

- Add configurable deadlines for ordinary reads, uploads, and exports. The deadline must cover connection, headers, and reading/parsing the response body; clear the timer only after body consumption finishes.
- Respect caller cancellation and distinguish cancellation, deadline expiry, transport failure, HTTP failure, and malformed responses.
- Automatically retry only eligible safe reads, with a small bounded attempt count and backoff/jitter. Respect `Retry-After` when applicable. Do not retry saves, uploads, routing actions, or other mutations blindly.
- Show a useful error and a retry action. Keep valid sessions when a request fails for network/database reasons.

### 1B. Independent, page-first loading

- Replace the all-or-nothing initial dataset load with independently committed section/query results.
- Render the application shell and the successfully loaded sections while another section is pending or failed.
- Fetch the visible page's essential data first. Defer collections used only by other pages.
- Give each section its own loading/error/retry state. Show unavailable counts explicitly rather than interpreting missing data as zero.
- Do not merely switch to `Promise.allSettled` and wait for every result before rendering; successful results must become visible immediately.

### 1C. Verified API and WebSocket destinations

- Separate ICE configuration loading from API/WS endpoint selection.
- Preserve a verified local `/api` proxy. Validate a proposed replacement before switching, and derive the matching WebSocket route deliberately.
- Review `VITE_WS_URL` priority so it cannot silently keep WS on a different outdated backend. An explicitly separate WS endpoint must be intentional and tested.
- Cache verified successes, deduplicate probe candidates, and expire/recheck failed discovery attempts. Allow bounded rediscovery on manual retry, relevant transport failure, and network recovery.
- Render the shell while discovery runs; show connection progress and a bounded error state.
- Validate expected health JSON, HTTP status, and content type. Reject frontend HTML as API health.
- Make startup readiness reject HTTP 503 and other failed responses. Report API liveness, database readiness, and public reachability separately.
- Load Vite environment files through `loadEnv` inside the configuration factory before constructing `/api`, `/ws`, and `/uploads` proxy targets. Preserve the intended priority of explicit process environment settings.
- Align canonical URL configuration without overwriting the new Pi stream/mechanism settings. Add coverage for the startup/network-sync path that currently reapplies settings.

### 1D. Correct authentication error classification

- Handle invalid/expired tokens separately from database or pool failures.
- Return an appropriate temporary service error for database unavailability; reserve 401 for authentication failure.
- Confirm frontend retries and error handling do not clear a valid login after a temporary infrastructure problem.

### Completion criteria

- Deliberately stalled logs do not prevent documents and navigation from becoming usable.
- A stalled response body is aborted within its configured deadline.
- A failed mutation is attempted once unless the operation has an explicit idempotent recovery mechanism.
- A 200 HTML page is rejected as API health; a 503 is rejected as readiness.
- Loading ICE configuration does not change the verified API route.
- A configured Vite proxy target is honored for both HTTP and WS.
- Database failure produces a temporary service error and preserves the authenticated session.

## Phase 2 — Reduce payloads and eliminate repeated full reloads

Suggested files: `backend/routes/documents.js`, `backend/routes/logs.js`, `backend/routes/reports.js`, `backend/models/ModelWrapper.js`, dashboard data services/pages, `dashboard/src/App.jsx`, and realtime/presence code.

### 2A. Small list responses and correct pagination

- Introduce paginated, searchable, filterable document-list responses containing only the fields needed by that view.
- Fetch attachments, OCR text, and full history through the authorized document-detail route when a record is opened.
- Paginate activity logs and other growing lists on the server. Define and test a maximum page size, stable ordering, and total-count semantics.
- Implement positive field projection correctly in `ModelWrapper`, preserving password exclusion and existing negative-selection behavior. Avoid loading entire documents merely to collect IDs.
- Update callers together with any API contract change. Do not make `getAll()` silently return only a first page while existing reports or dashboard totals assume the complete dataset.
- Add scoped server summaries/aggregates for dashboard counts and reports. Preserve complete exports and correct totals without downloading all documents to every browser.

### 2B. Stop creating embedded cover scans; normalize existing records carefully

- For new registrations, prefer the persisted attachment URL over client-provided inline `scannedImageUrl` media.
- Prepare a separate migration with dry-run and apply modes for the existing inline covers. The audit found 37, but recount before applying.
- Validate that the proposed stored attachment exists and corresponds to the cover being replaced. Preserve unmatched records for review; do not discard their only usable scan.
- Run and inspect the dry run on the test copy, verify previews/downloads, then schedule the validated migration against backed-up real data.
- Preserve originals and a per-record change manifest so cover changes can be reversed.

### 2C. Targeted realtime updates and request deduplication

- A device-only event updates device state; it must not download documents, logs, or reference lists.
- For document/workflow events, update the affected record or invalidate only the relevant query/collection.
- Cache stable offices and document types. Refresh users only when relevant changes occur and permissions allow it.
- Coalesce related refresh triggers, deduplicate in-flight queries, and abort or ignore obsolete responses.
- Prevent local mutation refresh, global invalidation, and WS reconnect from launching duplicate full loads.
- Maintain existing backend permission checks; event-driven updates must not expose another office's records.

### Completion criteria

- List responses contain no embedded scan media.
- Target a typical first document page below 100 KB for the current dataset; record actual before/after HTTP bytes.
- Device-only events generate zero document/log reload requests.
- Only one equivalent collection/query fetch is in flight at a time.
- A late response cannot overwrite a more recent result.
- Pagination, search, totals, reports, previews, and exports remain correct for all four roles.

## Phase 3 — Repair multi-user correctness and scanner transport

### Tasks

1. Make history/counter updates atomic. Use appropriate transactions, row locking, or version conflicts for workflow operations that check and modify the same record.
2. Check existing pending handoff/command data before adding any relevant uniqueness guard. Resolve unexpected records through an explicit reviewed process rather than deleting them automatically.
3. Register WS presence handlers after hub initialization, or retain registrations until initialization. Test heartbeat behavior through WS and HTTP independently.
4. Stop idle preview transmission when no viewers need it; pause hidden browser previews and resume promptly when needed. Keep scan-capture resolution independent of preview tuning.
5. Correct HTTPS frame-ingest limits and backoff for the selected preview rate, using validated device identity. Preserve control-command limits.
6. Test one and multiple viewers while other users browse/save. Verify the newest Pi motor/sensor behavior remains unchanged.

### Completion criteria

- Two concurrent history updates preserve both events, or one returns an explicit conflict; counters remain correct.
- Concurrent routing/command submissions do not create conflicting active operations.
- WS-only presence updates reach the application; HTTP fallback recovers after a broken WS connection.
- Preview fallback does not enter a repeated 429/retry loop at the supported rate.
- Normal API work stays responsive during the supported preview workload.

## Phase 4 — Optimize remaining queries and production execution

**Local report checkpoint (2026-10-28):** worker-based complete text PDFs, bounded single-page rendering, stable report snapshots and isolated clock, cancellation/deadline/retry controls, PDF print handoff and complete JPEG ZIPs implemented. Synthetic 10,000-record/589-page content and layout checks, actual worker cancellation/retry, browser preview/downloads, 39 frontend tests and production build passed. This report batch has not been committed, pushed or deployed. SQL report filtering/aggregation, native browser/physical print acceptance and the other tasks below remain pending.

### Tasks

- Review query plans and add targeted indexes for actual device-event, pending-command, log-ordering, and workflow lookups. Review duplicate unique-index/constraint dependencies before removing anything.
- Measure database pool wait time before changing pool capacity.
- Apply server-side report filters/aggregates; move expensive report generation into a worker/job when measurements justify it.
- Lazy-load scanner/PDF/report features and memoize expensive derived report data. Isolate the one-second clock from full report recomputation.
- Enable appropriate text-response compression and verify headers/transfer sizes through the real public route.
- Add lightweight request duration/size/error, pool wait, event-loop delay, preview subscriber, and bitrate measurements.
- Prepare supervised production startup and explicit environment validation.

### Completion criteria

- Query plans and timings document the effect of each index change.
- Production build and functional tests pass; optional feature bundles load on demand.
- Report export does not stall unrelated operations under the agreed test workload.
- Measurements distinguish network transfer, query work, browser rendering, and server queueing.

## Phase 5 — Four-device acceptance run

Use one Admin, Mayor, Receptionist, and Office account with the same test dataset for before/after comparisons. Run both same-network and different-internet-connection scenarios when available.

| Scenario | Required result |
| --- | --- |
| Four simultaneous logins/page loads | Useful content appears independently; no indefinite global spinner |
| Stalled logs endpoint and stalled response body | Documents remain usable; deadline and section retry work |
| Device heartbeat while four pages are idle | No document/log downloads |
| One document update observed by others | Correct targeted updates; no duplicate full reloads |
| Camera with zero, one, and multiple viewers | Idle traffic is controlled; ordinary API requests remain usable |
| Two users act on one document | Both valid updates persist or a clear conflict is returned |
| Large scan upload, PDF preview, download, and report | Files remain correct; progress/errors are bounded |
| Backend/WS outage and recovery | Valid login survives infrastructure failure; verified endpoint rediscovery recovers |

Record request counts, actual response bytes, time to usable content, p50/p95 read latency, failures, pool waits, and preview bitrate. Choose a realistic timing target from the baseline/network conditions; do not claim a capacity or speedup before measuring it.

Re-run the current checks plus new regression tests for the defects:

```powershell
node --test backend/test/*.test.js dashboard/src/utils/*.test.js scripts/start-all.test.js
npm.cmd --prefix dashboard run build
```

The existing isolated audit probes assert the old broken behavior. Preserve their baseline results and convert relevant probes into tests of the corrected behavior; they should not be treated as a post-fix passing suite unchanged.

## Phase 6 — Hosting preparation and staged cutover

Begin after the local acceptance criteria pass.

### Decisions to settle when implementation reaches this stage

- Backend host, region, and budget.
- Whether PostgreSQL and scan storage move online. Prefer locating the database near the backend; leaving it on the laptop retains the laptop availability/network dependency.
- Persistent scan storage, backup location, public API/WS address, and a suitable cutover window.
- How the chosen host handles WS connections and shared relay/presence state. Do not assume in-memory connection maps work unchanged across multiple instances.

### Tasks

1. Create a separate staging deployment connected to restored test data and storage.
2. Configure server-only credentials, production secrets, CORS, public API/WS URLs, and persistent storage. Frontend configuration must contain only public values.
3. Verify health/readiness, all four roles, uploads/downloads, reports, Pi heartbeats, preview, commands, and reconnects in staging.
4. Take fresh coordinated backups and transfer the final database/files during the agreed write pause.
5. Verify row counts and file checksums on the hosted system before changing the live frontend or Pi endpoint.
6. Update the Vercel frontend and Pi to the same verified hosted backend. Rebuild the frontend where build-time configuration changes are involved. Clear obsolete endpoint configuration caches deliberately.
7. Repeat the four-device checks and monitor errors, timings, and scanner behavior. Retain the local recovery copy until the hosted setup is accepted.

### Completion criteria

- Hosted users can operate without the laptop if database and storage were migrated too.
- All existing scans remain accessible and new scans persist through a backend restart/redeploy.
- API and WS destinations are verified together.
- The actual hosted four-user workload meets the agreed measured targets.

## Rollback procedure

- **Source changes:** record the revision for each verified batch. Revert the specific failed change with a normal revert commit; preserve unrelated work and avoid force pushes.
- **Data normalization/schema changes:** retain the original dump, scan manifest, and per-record migration manifest. Test reversal on the restored test copy before live application.
- **Hosting cutover:** retain the prior frontend/Pi endpoint configuration and working local services. If hosted writes have occurred, pause writes and reconcile those records/files before switching back; do not overwrite new data with an older backup blindly.
- Check login, document counts, sample scans, permissions, and scanner connectivity after rollback.

## Checkpoint tracker

| Checkpoint | Status |
| --- | --- |
| Audit and source evidence available | Complete |
| Operation plan saved | Complete |
| Verified backup and restored test copy | Local verification complete: 12 tables, 64 scan files, isolated API/storage; separate-storage copy pending before cutover |
| Loading reliability and endpoint fixes | First batch published; local tests and public API/asset checks passed; initial local browser feedback positive; detailed online browser/workflow acceptance pending |
| Payload, pagination, and refresh fixes | Partial: small metadata pages, activity pagination, detail loading and targeted refresh complete locally; SQL summaries/document-page UI/legacy migration pending |
| Concurrent-update and scanner transport fixes | Partial: row-safe existing-record updates, presence registration and frame limits tested; cross-record guards and idle preview pending |
| Remaining query/rendering/production optimization | Partial: page bundles deferred; complete report worker/single-page preview/cancellation tested locally; SQL report queries, indexes/metrics/pool/production work pending |
| Four-device local acceptance | Deferred by user; automated four-role local HTTP checks passed; initial manual browser feedback positive, detailed role checks and physical devices pending |
| Hosting choices and staging validation | User selected laptop backend/database; no online database migration; public API/CORS/WS connectivity verified |
| Live cutover and hosted acceptance | User pushed main 4c8649e including source c1ac509; updated Vercel bundle/feature assets and four-role public API reads verified; detailed online browser and physical-device acceptance pending |

**Immediate next action:** review the local report fix and test preview, Cancel, retry, PDF download and the PDF-tab print flow. Include this substantive fix and existing verification documentation in the next authorized `main` commit/push; verify the Vercel build and the actual all-time report in the user's browser afterward. Keep the current laptop backend/tunnel running; this frontend-only report fix does not change its API contract or data. Native PDF printing, detailed workflow/four-device/Pi acceptance and the explicitly pending phases remain outstanding. Do not treat synthetic report success as completed live-system acceptance.
