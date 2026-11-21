# Loading reliability, performance, and deployment plan

**Whole-system audit repair checkpoint (2026-11-21, LOCAL):** The seven reviewed defects are repaired on `main`: maintenance reset retains scan files; network sync no longer exports credentials into tracked scripts; package cleanup resolves and validates its root; registration visits its first planned office before onward routing; Reception keeps its stable intake identity; generic signing updates return success despite notification failures; dashboard previews refresh safely with loading/retry states. All 171 backend, dashboard and startup/maintenance checks passed, including the formerly opt-in PostgreSQL/HTTP suite against a new disposable cluster with separate synthetic storage. The production build passed, and preview loading/error layouts were inspected at desktop/mobile sizes. Test services are stopped. No historical-record repair, real SMS, physical hardware operation, commit, push or deployment occurred. Staff/live-system acceptance and publication remain pending; see the latest [changelog](../CHANGELOG.md).

**My Documents layout checkpoint (2026-11-09).** The date and action buttons now fit in separate columns. Narrow layouts scroll within the table. Synthetic Chrome checks covered Office and Admin at four desktop and mobile widths. The dashboard suite and build passed. The change is local for review. See [changelog](../CHANGELOG.md).

**Office handoff monitoring checkpoint (2026-11-08).** Office senders retain read-only monitoring after sending, receipt, and forwarding. The sidebar identifies the assigned office. The disposable PostgreSQL and HTTP suite, dashboard build, and synthetic desktop/mobile browser flow passed. The fix uses existing data and requires no migration. The local commit is ready for review before rollout. See [changelog](../CHANGELOG.md).

**User-reported SMS recovery (2026-11-04):** User manually resent an expired registration and later reports everything is working. Read-only provider history confirms the resend was a separate message delivered in about five seconds; the original remains expired with no recorded phone pickup. USB diagnostic tools were prepared with verified official archive integrity, but no phone inspection or repair occurred before the user ended troubleshooting. The temporary diagnostic port/processes are verified closed. No application/private configuration/provider-policy change, SMS by the agent, backend/tunnel control, or deployment. Exact cause and future automatic-registration reliability remain unproven; resume phone worker evidence only if the issue recurs. See the latest changelog.

**Registration/acknowledgement comparison (2026-11-04):** User confirms only acknowledgement arrives and the phone/httpSMS remained open and untouched. Read-only same-document comparison shows identical sender/recipient/SIM2, short single-segment ASCII templates and backend admission under one second for both. Acknowledgement delivered 3.685 seconds after provider creation, while registration had expired; another registration admitted in 60 ms remains provider-scheduled with no recorded pickup. There is no event-type priority or acknowledgement queue-release branch in DigiPath. The installed app uses separate message-ID jobs; a failed message fetch ends that job without WorkManager retry, and a new acknowledgement does not recover it. Exact push/job/fetch failure needs phone logs. Do not infer expired means cancelled: public provider source permits late pickup/results. No agent SMS, retry, source/configuration/data/service change or deployment. Latest source/evidence details and limitations are in the changelog/setup.

**SMS queue follow-up (2026-11-04):** The same registration event that was still `scheduled` at the first check is now `Expired` both in the backend outbox and httpSMS. It had one provider attempt and no sent/delivered timestamps; the user reports it is absent from the regular Messages app. This confirms it expired before httpSMS recorded a handset pickup, so signal strength/carrier transmission cannot explain the wait at that earlier stage. Recent heartbeat and a push token do not prove queue pickup. Root cause remains unconfirmed; the httpSMS queue-to-phone handoff is the next boundary to inspect. The separate user-reported native GOMO SMS failure remains unresolved. Read-only follow-up only, no resend/requeue, source/configuration/data/service change or deployment. See the latest changelog and evidence.

**Queued SMS follow-up (2026-11-04):** The newest registration event reached the backend outbox at 11:36:04 and httpSMS accepted it at 11:36:05 with one attempt on SIM2. About eight minutes later, direct provider lookup still returned `scheduled`; no sent/delivered result or handset pickup was observed. The GOMO SIM2 registration matches backend configuration and has a push token; the phone sent two heartbeats after queueing (reported build `64cc1b71`). This places the observed delay before Android/carrier submission. A heartbeat does not prove the queued message reached the app worker, and the precise provider/push/phone cause is unconfirmed. The earlier user-reported native GOMO SMS failure remains relevant to the post-pickup path. Read-only check only: no message sent/retried, services/config/data changed, or deployment performed. Do not resend the accepted event; inspect the same message in the phone app and reconcile first. See the latest changelog and evidence.

**Corrected-SIM delivery follow-up (2026-10-31):** Fresh user-operated test remains pending. Registration/backend still match SIM2 and heartbeat is recent. Provider last-attempted occurs about 1.045 seconds after request receipt, but status remains sending without sent/delivered/failure results. This confirms phone pickup, not successful SMS transmission. User reports the provider test is not visible in native Messages, and a separate native plain SMS explicitly from GOMO to own DITO also remains pending/fails. Native phone/SIM SMS operation must recover first; exact cause and daily-use reliability remain unresolved. Read-only diagnostics only, no agent SMS/retry, configuration/service change or deployment.

**Two-SIM clarification (2026-10-31; supersedes single-active instructions below):** User confirms DITO is the other installed SIM, and login requires two fields. A manual SIM1 test reached the phone but failed with no service. Use both subscriptions active in Android, DITO app SIM1/GOMO app SIM2 with only GOMO outgoing enabled, then verify registration. Backend file already reads SIM2 after a concurrent edit; agent's guarded edit stopped without writing. User completed the phone correction; provider GOMO SIM2/backend SIM2 match, recent heartbeat and a user-restarted Node listener newer than the environment change are verified. Fresh user-operated delivery acceptance is pending. No agent SMS retry, service restart, source change or deployment by this batch; earlier blanket SIM2-empty advice was corrected. See setup/changelog.

**Renewed SMS failure (2026-10-31; local configuration alignment):** Following user publication of the earlier source at `0ee41d7`, latest failures were pre-POST SIM mismatches: backend SIM2 versus registered SIM1. User confirms GOMO is the only active subscription despite occupying physical slot 2. The installed app labels active subscriptions by list order. Backed up the private backend environment and changed only `HTTPSMS_SIM` to SIM1; parsed unrelated settings are unchanged. User must confirm the app's SIM1 number/outgoing toggle and reload their own backend; no agent service restart, retry, SMS or deployment. Provider/phone acceptance after this alignment is pending. See the latest changelog.

**SMS duplicate/latency follow-up (2026-10-31, LOCAL only):** Read-only correlation found two distinct registrations 1,202 ms apart, one provider attempt each. Added synchronous in-flight guards to all three registration paths, six-second configurable dispatch admission with phone-rate preflight, and independent status polling. All 152 tests (102 backend/startup, 50 frontend), production build and a synthetic actual-form double-click check passed. No live SMS, business-data/schema/private-environment change, user-service manual restart, commit/push or deployment. Existing records are not merged. A separate roughly 41–59-second provider-to-phone wait remains unexplained despite the app being foreground; no acknowledgement-release mechanism was found. The user subsequently reports localhost sending without delay; this is user-reported local acceptance, not an independently timed provider test. Matching publication and online-flow verification remain pending. Preserve the user-selected manual VS Code forwarding workflow. See the latest changelog and [evidence](httpsms-evidence-2026-10-30.json).

Prepared: 28 October 2026, Asia/Manila.

Status (updated 30 October 2026): **Implementation has progressed through the local checkpoints below. Audit repairs are committed on `main`; their rollout, historical recovery and remaining measured performance/physical acceptance work are pending.** The original baseline and phase tasks are retained for traceability.

Baseline: `main`, commit `73cf88f` — the updated Raspberry Pi files are already on this branch.

Reference: [full performance audit](MULTI_USER_PERFORMANCE_AUDIT_2026-10-28.md). This plan also incorporates the friend's eight loading findings, including startup readiness and the Vite environment override.

Change record: follow the instructions in [CHANGELOG.md](../CHANGELOG.md) before each implementation batch, then record actual changes, test results, deployment status, recovery information, and remaining work there. A planned checkpoint is not a completed change.

## Intended outcome

Make four users on separate devices able to log in, browse, update documents, and use the scanner without one stalled request freezing the whole application. Preserve documents, attachments, role permissions, workflows, and the updated Pi mechanism. Establish a working local baseline before changing hosting.

Current architecture: Vercel frontend → public tunnel → laptop backend → laptop PostgreSQL and scan files.

The first implementation batch addresses request deadlines, independent loading, and verified endpoint selection. Payload reduction and event-driven refresh fixes follow immediately because they have the largest measured transfer cost. Deployment is a later stage with its own verification and rollback.

## Current user decisions and local checkpoint

**Restore the preferred VS Code workflow (2026-10-30):** User explicitly requested returning to their original process: `npm run dev:backend`, manually forward port 5000 in VS Code, set visibility Public. Backend/network endpoint settings were restored to the original VS Code address, the replacement CLI tunnel binding removed, and automatic CLI hosting disabled; SMS/scanner credentials, database, local dashboard proxy and Pi tuning are preserved. No backend or forward was started/restarted by the agent. Vercel's production API variable was restored after user-completed authenticator verification; production redeployment verification is recorded in the current changelog entry. Earlier CLI-tunnel instructions are historical and do not change this selected workflow. Backend/forward availability remains user-controlled; restart the backend to reload changed environment settings.

**Tunnel startup handoff (2026-10-30):** User requested control of tunnel hosting as well. The recorded agent-started tunnel process was already absent when checked; no process was killed and no tunnel resource or endpoint setting was deleted/changed. User can resume the saved tunnel with `devtunnel host` and its configured tunnel ID. Earlier public-ready checks do not establish current forwarding while the host is stopped. A new problem report awaits the user's exact error/behavior before diagnosis.

**Backend startup handoff (2026-10-30):** At the user's request, the identified agent-started backend was stopped and port 5000 verified free. Dashboard, PostgreSQL and public tunnel remain running. User will start only the backend with `npm run dev:backend` from the project root. Earlier healthy public/runtime checks describe the state before this intentional stop; API/SMS dispatch resume when the user starts the backend. Configuration and stored data were not changed.

**Public connection repair (2026-10-30):** After the user's push/sync, `main` is `40963ca4fbaa42147492ece0ce7f3bd8cae4b0c3`. The user explicitly approved a new internet-accessible port-5000 tunnel after automatic review required specific audience authorization. Five private configuration recovery copies were checksum-verified; only backend/network endpoint fields were aligned, preserving scanner/SMS settings and local dashboard/Pi configuration. The current backend and dedicated tunnel are running. After the user completed Vercel authenticator verification, the production API variable was updated and matching main was redeployed as `dpl_6jNxWXymtBKnUmKRA3RKrWXZwWUr`, Ready/current. Public health 200/current revision, protected unauthenticated SMS 401, authenticated SMS readiness 200, production-origin CORS 204, authenticated WebSocket and published bundle endpoint checks passed. The live sign-in page has zero console warnings/errors. No diagnostic SMS, business mutation or device command. This resolves the earlier public-404/unpublished-frontend checkpoints; signed-in/physical/background-delivery acceptance and separate-storage recovery remain separate. Keep the laptop backend/tunnel running; no supervised autostart was added. See the changelog for private recovery and rollout details.

**Deployment-readiness review (2026-10-30):** Local SMS is operational, but public go-live remains pending. Current read-only checks confirm local HTTP 200/database ready and the latest SMS Delivered; aggregate outbox has two Delivered and one Accepted row. The configured public API still returns HTTP 404, implementation changes remain local/uncommitted, matching Vercel release/external signed-in acceptance and reliable phone-background delivery remain unverified. No publication or runtime change was authorized/performed by this review. Existing local restore/hash evidence is retained; separate-storage recovery is still outstanding beyond the prior one-activation waiver.

**httpSMS activation (2026-10-30):** User authorized activation after confirming receipt, then explicitly waived only the separate-storage-copy gate for this activation after a verified local recovery bundle was prepared. A fresh native restore matched all 12 original table counts/full-row fingerprints; all 70 scans, five configuration copies and 364 source copies passed hash checks. Restored startup rehearsal and live application created the new outbox and filled five missing intake-office values from their origin offices; other fields/tables were unchanged. Only the private SMS enable flag changed. The normal backend/worker and matching local dashboard are running; local health, authenticated enabled/ready SMS status, unauthenticated 401 and matching dashboard-proxy readiness passed. The outbox is empty, no old queue was flushed and no activation SMS was sent. Browser login renders without console warnings/errors; signed-in workflow acceptance remains separate. The configured public API returns HTTP 404 and CLI inspection could not locate that tunnel under the saved login; no endpoint/access change or new tunnel was made. No commit, push, Vercel publication or Pi deployment. Current external-access and recovery limits supersede earlier paused/deferred SMS checkpoints below. See [setup](HTTPSMS_SETUP.md), [evidence](httpsms-evidence-2026-10-30.json) and the latest changelog entry.

**Controlled httpSMS integration test (2026-10-30):** With an explicitly agreed recipient and one test message, the current wrapped document model created one atomic outbox event in a new schema in the guarded disposable test database. The actual SMS API returned HTTP 202 Queued, the real provider adapter submitted exactly one POST, and read-only reconciliation advanced Accepted to Delivered with matching history and timestamps. A persistent one-POST guard prevented retransmission. Private configuration stayed unchanged, normal sending stayed disabled and business records/queues were not accessed. The synthetic schema was removed after retaining private recovery evidence. The user subsequently confirmed handset receipt. Normal running-browser acceptance remains pending. This completes the isolated backend-to-provider delivery check; a current backup and matching rollout/activation are still pending. No commit, push, normal service restart or deployment. See [aggregate evidence](httpsms-evidence-2026-10-30.json).

**httpSMS private configuration verification (2026-10-30):** After the user privately entered the new settings and explicitly authorized a read-only provider check, one official phones GET confirmed authentication, the configured sender's unique registration, matching SIM and the required one-attempt policy. No private values were recorded; configuration was unchanged, sending remains disabled, and no SMS was sent. This completes provider credential/registration verification only. A current backup, reviewed matching rollout and controlled DigiPath-to-phone acceptance remain pending; the implementation checkpoint below records its earlier development boundary.

**httpSMS rebuild (2026-10-30, supersedes the reset checkpoint below):** User confirmed a standalone Android/GOMO httpSMS test after correcting SIM registration, then authorized the replacement backend. A fresh transactional outbox, paced worker, bounded provider/SIM checks, scoped/paginated history, guarded manual queueing and truthful delivery/unknown-state tracking are implemented locally on `main`; preserved frontend SMS controls are reconnected. All 145 distinct automated tests and the dashboard build passed. Private configuration, matching rollout and one controlled DigiPath-to-phone test remain pending; sending stays paused by default. Legacy SMS rows are not reused or flushed. No commit, push, service restart or real SMS in this batch. See [setup](HTTPSMS_SETUP.md), [aggregate evidence](httpsms-evidence-2026-10-30.json) and the latest changelog entry.

**SMS backend reset (2026-10-30, supersedes the SMS checkpoints below):** User requested starting the SMS backend again while retaining the frontend. Removed sender delivery/providers/templates, workflow SMS hooks, outbox/retry API routes and sender-notification model/schema maintenance. SMS UI components/forms/styles and passive document contact/preferences are retained; the frontend service no longer calls removed endpoints. Historical database tables/records and private environment files are untouched. This source batch is local and uncommitted; validation and final state are recorded in the latest changelog entry. No SMS, service restart, push or deployment. A replacement backend remains future work; the following SMS implementation notes are historical.

**Document detail UI follow-up (2026-10-30):** Fixed long multiple-office location text escaping the workflow banner and compressing its heading. Summarized pending destinations in the header/current location while retaining all delivery details; improved wrapping/receipt-date spacing and removed duplicate sender contact. Local synthetic checks at 390/768/1024/1280 pixels showed no modal/banner/card overflow; 46 frontend tests and production build passed. Source remains local pending publication; see the latest changelog entry. No backend/data/Pi change in this UI batch.

**SMS follow-up (2026-10-30):** Local Twilio delivery safeguards are implemented and tested: normalized recipient format, bounded provider calls, single in-flight retries and privacy-safe errors. Philippines delivery also requires a registered alphanumeric sender ID, and SMS content omits links. Provider remains outbox-only until sender registration, credentials and an approved test phone are ready. No SMS sent; old queued notifications will not flush automatically. See the latest changelog entry and deployment checklist.

**Android SIM gateway follow-up (2026-10-30):** User selected their always-on Android phone and existing SMS promo. A local-only Android gateway adapter is implemented with Philippine recipient validation, bounded authenticated requests, private-LAN endpoint restrictions and no automatic outbox flush. Focused SMS checks passed (7/7); full backend suite passed (44, 27 opt-in PostgreSQL/HTTP checks skipped). Automated tests used a mocked gateway. The phone/backend network relationship remains unknown; keep SMS in outbox until both are verified on a trusted LAN and the carrier promo terms are confirmed. No SMS/device request, commit, push or deployment occurred.

**Startup recovery follow-up (2026-10-30):** After syncing/stopping services, the user encountered the intended weak-device-key startup guard. Applied the prepared strong scanner credential to the ignored local backend/network/Pi configuration copies, preserving all other settings and private previous copies. Runtime and temporary loopback backend health passed (HTTP 200, ready, database connected, revision `73753da`); the verification process was stopped afterward. Physical Pi is not connected yet and was not updated; its matching credential/reconnect and restored port forwarding remain pending. See the latest changelog entry for private recovery location. This is a local configuration follow-up, not a new source push or hardware acceptance.

**Current checkpoint (2026-10-30):** Audit repair source is committed locally at `d0291ff` on `main`, following planning, implementation and validation. All 116 distinct tests, production dashboard build and 95 CommonJS syntax checks passed; both dependency audits report zero vulnerabilities. See [repair results](SYSTEM_REPAIR_RESULTS_2026-10-29.md) for access/workflow/storage safeguards, private recovery/configuration paths and per-finding limits. No push, deployment, user-service restart, Pi command or live data/configuration change occurred in this repair. Strong backend/network/Pi credential application, historical missing files/ambiguous records, actual devices/native printing, off-machine recovery and remaining measured phases are pending. SMS was explicitly deferred by the user. The audit confirmed the preceding report/multi-office source on remote `main` at `7d0631d`; that evidence does not establish a matching running backend.

**Historical checkpoint (2026-10-28):** On that date the user selected keeping the backend and PostgreSQL on this laptop and preparing physical four-device acceptance for later. The user published the first batch through `main` at `4c8649e`; the updated Vercel frontend and public API/WS reads were verified. The original first batch passed 55 tests and a production build. The user subsequently reported smooth ordinary online actions and a stuck roughly 490-page activity print/export. The separate report fix was then LOCAL on `main`: background PDF generation, single-page preview, cancellation/deadlines, PDF print handoff and complete image ZIPs; 39 frontend tests and the production build passed. See [the handoff](PERFORMANCE_IMPROVEMENTS_2026-10-28.md), [first-batch evidence](performance-evidence-2026-10-28/verification-summary.json) and [report evidence](performance-evidence-2026-10-28/report-verification.json). No cloud/database migration or new report-fix publication was performed in that checkpoint. Remaining phases and physical acceptance stay pending.

## Working rules

**Workflow correction checkpoint (2026-10-29):** Group assessment found that multiple-office selection sent only to the first office. A new LOCAL batch on `main` (starting revision `f5bfa86`, which already contains the report fix) now delivers to every selected office with independent receipt confirmation. The first selected office retains custody; other selections receive copies. Document locks/transactions protect concurrent sends and receipts; latest-recipient visibility and cancellation are covered. Final validation: 77 regular tests passed, 11 opt-in PostgreSQL/HTTP cases separately passed, browser send/Cancel/failure/retry/three receipts verified, and production build passed. See [evidence](workflow-evidence-2026-10-29.json) and [change log](../CHANGELOG.md). No live writes, backend restart, commit, push, or deployment for this correction. Existing queued deliveries were not backfilled; actual role/four-device acceptance remains pending.

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
| httpSMS activation (30 October follow-up) | Enabled/running on laptop with matching local dashboard; fresh 12-table restore, 70 scan hashes and exact startup rehearsal passed. User waived separate-storage gate for this activation only. Authenticated readiness passed; outbox empty. Configured public tunnel 404, Vercel publication and signed-in/physical acceptance pending |
| Loading reliability and endpoint fixes | First batch published; local tests and public API/asset checks passed; initial local browser feedback positive; detailed online browser/workflow acceptance pending |
| Payload, pagination, and refresh fixes | Partial: small metadata pages, activity pagination, detail loading and targeted refresh complete locally; SQL summaries/document-page UI/legacy migration pending |
| Concurrent-update and scanner transport fixes | Partial: row-safe updates, transactional registration/routing/archive guards, scanner admission/cancellation locks, presence and frame limits tested; rollout, idle-preview optimization and physical acceptance pending |
| Multiple-office delivery and receipt confirmation | Source was present on remote main at audited 7d0631d; repair regressions remain green at local d0291ff. Per-office deliveries/notifications, explicit receipt confirmation, transactional send/receive/cancel and scoped copy access tested; matching running-backend/live acceptance pending |
| Audit access/workflow/storage/dependency remediation | Local source committed at d0291ff; 116 distinct tests, production build, syntax95, npm audits0/0 and synthetic browser checks passed. Credential rollout, historical recovery, physical acceptance and deferred SMS remain open; see repair results |
| Remaining query/rendering/production optimization | Partial: page bundles deferred; complete report worker/single-page preview/cancellation tested locally; SQL report queries, indexes/metrics/pool/production work pending |
| UI accessibility and readability (21 November follow-up) | Batch 1 implemented locally on main at source 367bb1c: shared dialog focus/nesting, keyboard navigation/activation, form associations/error focus and readable theme/type rules. All 65 dashboard tests, production build, 26 modal browser assertions and synthetic desktop/mobile checks passed. Manual assistive-technology/zoom/forced-colors/live acceptance, later UI batches and publication remain pending; see CHANGELOG.md |
| UI work queues and handoffs (21 November follow-up) | Batch 2 implemented locally on main at source 367bb1c: matching role queues/drill-downs, explicit custody/copies, retained failed/uncertain sends with read reconciliation, record/claim-slip continuation and session-safe scanner saves. All 100 dashboard tests, production build and synthetic browser checks passed. Reload-durable send recovery, signed-in/physical/native-print acceptance, later UI batches and publication remain pending; see CHANGELOG.md |
| Desktop registration and header clarity (22 November follow-up) | Batch 3 implemented locally on main at source 367bb1c: one source-organization field, clear edit lock, desktop registration grid and reserved/bounded notification placement. All 103 dashboard tests, production build, role/form and desktop browser checks passed at 1366x768/1920x1080. Mobile development/testing excluded by user instruction, including remaining UI work. Desktop PDF performance/conventions/polish and signed-in/manual acceptance/publication remain pending; see CHANGELOG.md |
| Four-device local acceptance | Deferred by user; automated four-role local HTTP checks passed; initial manual browser feedback positive, detailed role checks and physical devices pending |
| Hosting choices and staging validation | User selected laptop backend/database; no online database migration; public API/CORS/WS connectivity verified |
| Live cutover and hosted acceptance | User pushed main 4c8649e including source c1ac509; updated Vercel bundle/feature assets and four-role public API reads verified; detailed online browser and physical-device acceptance pending |

**Immediate next action:** local httpSMS activation is complete; use the matching running local dashboard for new consented workflow events. Restore the existing public tunnel under its owning account, then review matching Vercel frontend publication and external acceptance using the [deployment checklist](DEPLOYMENT_CHECKLIST.md). Keep the new outbox and newer business writes during rollback; disable the SMS flag and restart only the identified backend to pause dispatch. A separate-storage recovery copy remains outstanding beyond the user's one-activation waiver. The broader [repair handoff](SYSTEM_REPAIR_RESULTS_2026-10-29.md), signed-in role/scan/WebSocket checks, new captures, three-office receipts, native printing and physical four-device/Pi acceptance remain separate. Historical missing scans and ambiguous records still require original evidence and a reviewed recovery manifest before repair/resend. Local readiness does not establish public deployment or physical acceptance.
