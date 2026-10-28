# Vinzons DigiPath — System Changelog

This is the project record of system changes, investigations, and implementation plans. Add new entries below the instructions and template, newest first. Dates and times use **Asia/Manila (UTC+08:00)**.

## Instructions for every change

1. **Read before working.** Read the latest entries and the current [operation plan](docs/PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md). Check the actual branch, revision, and working tree; the log does not replace those checks.
2. **Record each meaningful batch.** Before application, configuration, database, service, branch, or deployment work, create an `IN_PROGRESS` entry describing the intended scope. Update it with the result before ending the task. For a read-only investigation or documentation-only task, a completed entry at the end is sufficient.
3. **Explain what changed and why.** Identify affected files/components and the user-visible behavior. Record data/configuration impact separately from source changes. Mention ignored local environment changes without copying their contents.
4. **Keep lifecycle states precise.** `PLANNED` is a proposal; `IN_PROGRESS` is unfinished work; `LOCAL` exists in the checkout; `COMMITTED` is in Git; `PUSHED` is on the named remote branch; `DEPLOYED` is running on the named target; `REVERTED` was rolled back. Record validation separately. A local test or Git push does not establish deployment.
5. **Record evidence.** List actual tests/checks and their outcomes, including failures, skipped checks, and limits. Link relevant reports and evidence. Do not describe a planned test, simulated motor movement, or source probe as a successful live-system test.
6. **Record recovery information.** For data/configuration changes, identify the backup location and whether restoration was tested. Include a specific rollback approach and any remaining risks. Never claim backups or rollback were verified unless they were.
7. **Track branches and publication.** Record the actual branch and known commit/revision. This operation is intended for `main`; respect the user's current branch instructions. Record pushes, deployments, and branch deletion independently. Do not create a branch, push, deploy, or change data merely because it appears in a log entry.
8. **Protect sensitive information.** Never log passwords, tokens, API keys, private environment contents, document bodies, or personal record details. Use aggregate counts, redacted references, and paths. Keep database/file backups and private configuration out of Git.
9. **Preserve history honestly.** Keep older entries. Add a correction or follow-up rather than silently changing an earlier outcome. Explicitly label backfilled entries and identify their evidence. Redact an exposed credential while preserving the historical action.
10. **Leave a clear handoff.** End each entry with outstanding work and the next concrete action. Update the operation plan's checkpoints when implementation actually progresses.

Historical command descriptions are **not execution instructions or current authorization**. Older planned items and previous deployment claims must be checked against current source, data, and user instructions. Do not rerun a destructive migration simply because it appears below.

## Entry template

Copy this template into the dated entries section. Fill in only verified information; use `Pending`, `Not run`, or `Not applicable` where appropriate. Record a commit hash when known; do not invent a hash or create repeated commits just to record the changelog's own commit.

```markdown
## [YYYY-MM-DD] — Short change title

- **Type / state:** FIX | FEATURE | CONFIG | MIGRATION | AUDIT | DOCS | GIT / PLANNED | IN_PROGRESS | LOCAL | COMMITTED | PUSHED | DEPLOYED | REVERTED
- **Author / time:** Codex or contributor; Asia/Manila time if known
- **Request / reason:** What requested behavior or problem this addresses
- **Branch / revision:** Actual branch; source/result commit if known
- **Changes / files:** Concrete behavior changes and affected paths
- **Data / configuration impact:** Actual changes, or none
- **Backup / recovery evidence:** Location and restore check; never include secrets
- **Validation:** Commands or checks run, outcomes, and limitations
- **Publication / deployment:** Commit/push status and exact target; distinguish repository from running services/Pi
- **Rollback:** How to reverse this batch without losing subsequent work/data
- **Outstanding / next action:** What remains and the next step
```

## [2026-10-28] — Initial manual browser feedback

- **Type / state:** DOCS / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Record the user's report that the isolated local test feels smooth.
- **Branch / revision:** `main`, `73cf88f`; existing local application changes preserved.
- **Changes / files:** Recorded manual feedback in `CHANGELOG.md` and updated the operation plan's validation checkpoint. This records the user's observation, not a measured speedup or complete acceptance of every workflow.
- **Data / configuration impact:** Documentation only. No account, database, environment, service, Pi, or deployment change in this batch.
- **Backup / recovery evidence:** No new backup needed for documentation; previously verified native backup and restored test copy retained.
- **Validation:** User reported “i think its all smooth now” after receiving the local browser checklist. Specific roles, pages, operations, timing measurements, and concurrent-device coverage were not confirmed. Earlier 55-test/build results remain separate evidence; no application tests rerun for this documentation-only update.
- **Publication / deployment:** Local documentation only; no commit/push/deployment. No claim that the running Vercel site has these fixes.
- **Rollback:** Add a correction if later testing contradicts this feedback; preserve the original observation and test evidence.
- **Outstanding / next action:** Continue remaining workflow/preview/SQL optimization batches, then complete detailed role checks and the deferred physical Pi/four-device/public-route acceptance before rollout.

## [2026-10-28] — Start the isolated dashboard for manual browser testing

- **Type / state:** CONFIG / LOCAL; isolated test services RUNNING
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** User asked how to test the improvements; make the isolated setup accessible with a direct address and a short checklist.
- **Branch / revision:** `main`, `73cf88f`; existing local changes preserved.
- **Changes / files:** Started the guarded test backend on loopback port 5501 and dashboard on loopback port 5174. Left both available for the user's browser checks at `http://127.0.0.1:5174/`. No application source edits in this batch.
- **Data / configuration impact:** Test services use the restored database and cloned scan directory, separate device key, and outbox notifications. No live database/environment-file/public-route/Pi/hosting changes; no account passwords reset. Proxy validation used synthetic frames in the isolated relay only.
- **Backup / recovery evidence:** Existing verified native backup and restored copy retained under ignored `database-export/performance-operation-2026-10-28/`.
- **Validation:** Both ports were unused before startup; backend connected to the test database. API/config proxy, authenticated WebSocket, uploaded PDF checksum, and preview-frame rate-limit checks passed through the isolated setup. Manual authenticated screens and physical devices remain unverified.
- **Publication / deployment:** Local test services only; no commit/push/deployment.
- **Rollback:** Stop only the test backend/frontend processes. Retain test data and backups; do not overwrite or restore the live database.
- **Outstanding / next action:** User to open the test address on this laptop, sign in, check the dashboard/documents/scans/logs/reports and a clearly labeled test edit. Physical Pi remains separate and may appear offline. Services intentionally left running for the manual check; stop only these test processes when finished.

## [2026-10-28] — Defer optional page bundles and prepare later local acceptance

- **Type / state:** FIX | DOCS / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Keep the backend/database on this laptop and prepare the physical four-device test for later; reduce initial browser download cost before that test.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Lazy-loaded document, archive, scanner, report and device-control pages; added Vite environment/proxy regression coverage and actual HTTP/WS/upload proxy verification. Startup now preserves existing configuration unless synchronization is explicitly requested, and reports the backend-configured public URL. Added the implementation/acceptance handoff, aggregate verification evidence, and clarified current PostgreSQL setup guidance.
- **Data / configuration impact:** Source/documentation only; no hosting migration, live environment rewrite, or Pi package deployment.
- **Backup / recovery evidence:** Verified native dump/test restore retained in the ignored operation directory. Separate-storage copy still pending before live data migration/cutover.
- **Validation:** All 55 regression tests passed; production build passed. Initial JavaScript entry is about 312 KB (approximately 91 KB gzip), down from the audited approximately 1.49 MB entry. Actual isolated Vite API/config, authenticated WS and PDF checksum checks passed. Initial proxy check could not reach the sandbox-bound Vite listener; restarting the isolated frontend with localhost access enabled resolved it. Browser automation stopped because its policy check could not verify the Windows browser URL; authenticated screen checks remain pending. Final read-only comparison verified all five live configuration files, 64 original scan hashes and 12 live table counts against backup. Disposable test fixtures were removed and isolated test services stopped.
- **Publication / deployment:** Local only; no commit/push/deployment.
- **Rollback:** Reverse this batch's source edits; keep the verified backups and completed records.
- **Outstanding / next action:** User selected laptop backend/database hosting and deferred physical acceptance. Follow docs/PERFORMANCE_IMPROVEMENTS_2026-10-28.md for later browser/device/public-route acceptance. Remaining SQL summaries/indexes/metrics, cross-record workflow guards, idle-preview work and rollout are explicitly pending; no live incident resolution claimed.

## [2026-10-28] — Existing-row update safety and scanner connection repairs

- **Type / state:** FIX / LOCAL; broader Phase 3 remains incomplete
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Continue the approved operation; user confirmed laptop hosting remains in place and physical four-device acceptance will occur later.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Added transactional row locks for existing-record findOneAndUpdate and relevant updateOne history/counter operations; corrected $each append and previous-value return semantics. Retained presence registration across hub initialization. Added a separate authenticated 30 FPS preview-frame budget, validated device identifiers, and preserved control-request limits. Full cross-record workflow transactions, schema guards and idle-preview transport changes remain pending.
- **Data / configuration impact:** Created and removed disposable synthetic records in the restored test database; live database/configuration and all Pi Python/mechanism package files unchanged.
- **Backup / recovery evidence:** Verified ignored native dump, scan/configuration copies, and restored test copy.
- **Validation:** All 55 final tests passed. Real PostgreSQL rehearsal preserved 20 concurrent writes, 22 individual history events after a two-event append, and counter 21 after another increment. Previous-value semantics verified. Presence-before-initialization regression passed. Simulated 25 FPS over one minute left the command quota available; actual authenticated burst accepted 30 and limited the 31st. Restored table/file counts matched after fixture cleanup. No physical Pi test performed.
- **Publication / deployment:** Local only; no commit/push/deployment.
- **Rollback:** Reverse only this batch's source edits. Preserve live originals and verified backups; disposable test records use an exact generated identifier and are cleaned by the test harness.
- **Outstanding / next action:** Review and implement the remaining multi-record workflow/pending-command guards, idle/hidden preview demand and physical acceptance before marking Phase 3 complete.

## [2026-10-28] — Document payload reduction and paginated listing foundation

- **Type / state:** FIX / LOCAL; broader Phase 2 remains incomplete
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Reduce the audited 34 MB document download and growing log requests after the loading reliability fixes.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Implemented SQL field projection with password exclusion, bounded/filterable document/log listing envelopes, metadata-only document pages, detail-on-open for scans/history and complete metadata collection for existing totals/report callers. Activity Logs uses server paging/search/filtering. New covers prefer persisted URLs; report generation excludes unused scan bodies/history. Existing inline covers remain intact.
- **Data / configuration impact:** No live cover migration or environment change. Synthetic image registration/persistence was tested against the isolated API; its exact fixture, notifications/logs and cloned-storage file were removed.
- **Backup / recovery evidence:** Verified ignored native dump, scan/configuration copies, and restored test copy from Phase 0.
- **Validation:** All 55 final tests and production build passed. Four concurrent local role clients matched scoped database IDs/totals and authorized detail access. Admin/Mayor first 50-document page: 56,244 response-body bytes; both pages covering all 80 records: 90,897 bytes. First 20-log page: 3,911 bytes with correct total 9,462. This is distinct from the original 34,170,244-byte full-record serialization measurement. Synthetic saved cover used its stored URL and downloaded bytes matched. Source-data/configuration checks and fixture cleanup passed.
- **Publication / deployment:** Local only; no commit/push/deployment.
- **Rollback:** Reverse this source batch; originals remain in the untouched live database and verified backup.
- **Outstanding / next action:** Complete SQL dashboard/report summaries, filtered report queries, server-driven document-page UI, and reviewed dry-run/rollback for legacy inline covers. Existing callers intentionally collect all metadata/log pages where complete totals are required; this preserves correctness but is not the final large-dataset design.

## [2026-10-28] — Loading reliability, independent sections, and endpoint verification

- **Type / state:** FIX / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Begin the approved improvements after verifying the recovery/test checkpoint.
- **Branch / revision:** `main`, `73cf88f`; no branch created.
- **Changes / files:** Added request/body deadlines, cancellation and bounded safe-read retries; independent page-first collection commits and section retries; collection cache/deduplication/stale-response guards and targeted invalidation; verified API/WS selection independent of ICE; strict startup readiness; Vite `loadEnv`; 503 for authentication database failures; preservation of existing Pi camera tuning during network synchronization (explicit tuning opt-in required). Application shell renders before discovery completes.
- **Data / configuration impact:** Application source only. Validation uses the restored database and cloned storage. No live data normalization or endpoint/environment rewrite in this batch.
- **Backup / recovery evidence:** Verified dump, scan/configuration copies, and test restore at ignored `database-export/performance-operation-2026-10-28/`; separate-storage backup remains pending before live migration/cutover.
- **Validation:** 47 tests passed, including stalled JSON/blob bodies, cancellation, safe-read-only retries, discovery HTML rejection/recovery/deduplication, independent section loading, stale-response/session guards, ICE/WS consistency, authentication 503, and startup readiness. Production build passed. Initial test run found a test-loader syntax issue (corrected) and sandbox-denied localhost connections; the complete suite passed with localhost access enabled. Real four-device/Pi acceptance remains pending.
- **Publication / deployment:** Local only; no commit, push, or deployment performed.
- **Rollback:** Reverse this batch's source edits while preserving prior documentation and backups; no live data rollback is required.
- **Outstanding / next action:** Verify UI against the isolated running backend after payload changes. Public URL alignment awaits a reachable canonical endpoint; no existing environment files rewritten. Continue payload reduction and pagination; real devices/deployment remain pending.

## [2026-10-28] — Performance operation: backups and isolated test setup

- **Type / state:** CONFIG / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** User authorized beginning the performance improvement operation.
- **Branch / revision:** `main`, `73cf88f`; existing documentation changes preserved.
- **Changes / files:** Added guarded backup/restore and isolated-launch scripts, shared configurable upload storage, and storage isolation regression coverage. Created a native custom PostgreSQL dump, scan/configuration backups, and the separately named restored test database. Upload writers, file readers, and HTTP serving now share `UPLOADS_ROOT`, retaining the existing default.
- **Data / configuration impact:** Read-only production backup; created/restored `vinzons_digipath_perf_test_20261028` and cloned scan storage. Test backend uses loopback port 5501 and a separate device key. Live environment files and Pi mechanisms unchanged. No API listener or other PostgreSQL clients were connected before backup; source table counts and file hashes remained unchanged afterward.
- **Backup / recovery evidence:** Ignored `database-export/performance-operation-2026-10-28/`: `database.dump`, scan/configuration copies, scan manifest, verification and HTTP-storage verification. All 12 table counts match, including 80 documents and 9,462 logs; 64 files / 33,004,896 bytes match SHA-256 checksums. Restored test copy verified. Additional backup on separate storage remains pending before live migration/cutover.
- **Validation:** Backup/restore, all table counts, unchanged source/copy checksums, connected test health, and PDF/JPEG/PNG HTTP downloads verified. Initial backup command found the parent backup folder absent; corrected parent creation and reran successfully. Storage regression and existing test suite run before Phase 1. Four physical devices are unavailable for baseline testing.
- **Publication / deployment:** Local work only; no commit, push, or deployment authorized by this entry.
- **Rollback:** Retain backups; reverse only this batch's source edits. Stop test processes and retain the test database for inspection rather than dropping data automatically.
- **Outstanding / next action:** Test environment ready; proceed with loading fixes. Keep private files ignored and take a separate-storage copy before any live migration/cutover.

## [2026-10-28] — Change recording instructions and current-work history

- **Type / state:** DOCS / LOCAL
- **Author / time:** Codex; date recorded in Asia/Manila
- **Request / reason:** Create a log that records system changes and includes instructions for maintaining it.
- **Branch / revision:** `main`; starting revision `73cf88f`.
- **Changes / files:** Extended the existing `CHANGELOG.md` with maintenance instructions, lifecycle states, an entry template, and backfilled records for this chat's completed work. Added discoverability links in `README.md` and the operation plan. Added a narrow root `AGENTS.md` instruction requiring future coding work to maintain this log.
- **Data / configuration impact:** Documentation only. Removed plaintext database/demo-account credential values from historical entries; retained the descriptions of those past actions. This redaction does not rotate credentials or remove them from Git history.
- **Backup / recovery evidence:** Existing tracked documentation can be recovered through Git. No database backup was performed for this documentation task.
- **Validation:** Initial documentation QA identified missing recovery-information fields in two entries; corrected them before final checks. Documentation links, required logging fields, preservation of historical sections, credential redaction, and file-change scope checked. No application tests required for this documentation-only change.
- **Publication / deployment:** Local changes only; no commit, push, or deployment performed for this entry. `AGENTS.md` is a local instruction file ignored by the existing `.gitignore`; tracked documentation also contains the logging instructions.
- **Rollback:** Remove the new instruction/link sections and local `AGENTS.md` if needed; retain credential redactions and completed historical records.
- **Outstanding / next action:** Begin the operation plan with verified database/scan backups and an isolated test copy when implementation resumes.

## [2026-10-28] — Performance and deployment operation plan

- **Type / state:** DOCS / LOCAL; application work remains PLANNED
- **Author / time:** Codex; backfilled from the plan created during this chat.
- **Request / reason:** Prepare the operation while the user is away.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Created [the operation plan](docs/PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md), covering backups/restoration, request deadlines, independent loading, verified endpoints, payload reduction, targeted refreshes, concurrent-update handling, scanner transport, four-device tests, staging, cutover, and rollback. Incorporated the friend's additional loading findings.
- **Data / configuration impact:** None. Full database/scan backups, test restoration, migrations, fixes, and deployment have not started. The earlier Pi environment backup is separate from this planned full backup.
- **Backup / recovery evidence:** No data backup was performed for the planning task. Verified database/scan backups and restoration are the first pending operation checkpoint.
- **Validation:** Plan links, phase coverage, rollback section, and Markdown structure checked.
- **Publication / deployment:** Plan saved locally; not committed, pushed, or deployed.
- **Rollback:** Remove or revise the plan; no application/data rollback is needed.
- **Outstanding / next action:** Phase 0: recheck the checkout, make coordinated backups, and verify a restored test environment.

## [2026-10-28] — Four-user performance and loading audit

- **Type / state:** AUDIT / LOCAL
- **Author / time:** Codex; backfilled from the audit and saved evidence. Runtime samples were approximately 11:34–11:42 AM, Asia/Manila.
- **Request / reason:** Investigate slowness across four users/devices, sometimes on different internet connections.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Created [the full audit](docs/MULTI_USER_PERFORMANCE_AUDIT_2026-10-28.md) and [evidence/probe files](docs/audit-evidence-2026-10-28/). Confirmed oversized document payloads, global reload amplification, endpoint-discovery defects, missing request deadlines, and additional concurrency/scanner/query issues.
- **Data / configuration impact:** Read-only database queries and bounded public GET checks; no business records, application configuration, services, or Pi hardware changed. The production build produced ignored `dashboard/dist` output.
- **Backup / recovery evidence:** No full database/scan backup created during the audit; measurements were read-only.
- **Validation:** All 33 existing backend/frontend-utility/startup tests passed; production build passed. Isolated probes reproduced the reported defects. Actual Document-model JSON measured 34,170,244 bytes across 80 records; this is a serialization measurement, not captured live HTTP transfer size. A real four-device authenticated load run was unavailable because the local API was not listening and tunnel health checks failed.
- **Publication / deployment:** Report/evidence remain local and uncommitted; no application fixes deployed.
- **Rollback:** Remove the audit artifacts if no longer required; application/data state was not modified.
- **Outstanding / next action:** Implement and measure the fixes according to the operation plan; do not treat identified defects as resolved.

## [2026-10-28] — Remove the superseded experiment branch

- **Type / state:** GIT / completed locally and on GitHub
- **Author / time:** Codex; backfilled from verified Git command results in this chat.
- **Request / reason:** User requested deletion of `codex/render-local-db-experiment` after the Pi changes reached `main`.
- **Branch / revision:** Active checkout remained `main`, `73cf88f`; deleted branch tip was `e786bb4`.
- **Changes / files:** Deleted that exact local and remote branch. Before deletion, verified the nine Pi updates matched `main`. Its only file differences were two audit reports and an audit screenshot.
- **Data / configuration impact:** Git references only; no database, application configuration, Pi deployment, or `main` file changes.
- **Backup / recovery evidence:** Pi file parity with `main` was verified before deletion, and the former tip `e786bb4` is recorded here. No database/file backup was needed for this reference-only change; branch restoration was not tested.
- **Validation:** GitHub reported the branch deleted; local branch listing confirmed removal and `main` was unchanged.
- **Publication / deployment:** Remote branch deletion completed. No application deployment performed.
- **Rollback:** The former tip was `e786bb4`; restoration requires that commit to remain recoverable from repository history/reflog or another retained copy.
- **Outstanding / next action:** No further branch cleanup requested.

## [2026-10-28] — Update root Raspberry Pi package and publish on main

- **Type / state:** FIX / PUSHED
- **Author / time:** Codex; backfilled from source comparison, test results, Git history, and push verification. Commit time: **11:01:30 AM, Asia/Manila**.
- **Request / reason:** Replace outdated root Pi files with the package from `D:\VinzonsDIGIPATH-Pi` and ensure the changes are on `main`.
- **Branch / revision:** Result `main`, commit [`73cf88f`](https://github.com/ckdecodeder/VinzonsDIGIPATH/commit/73cf88fd14a7ddc85771a3431c6dd9a5e50a0328). Pi changes were initially committed/pushed by the user on the already-active experiment branch; the Pi-only changes were then applied and pushed to `main` as requested.
- **Changes / files:** Updated `digipath_hall_ys27.py`, `digipath_mechanism.py`, `digipath_tb6600.py`, both relevant Pi environment examples, and four Pi bootstrap/install/restart/USB-update scripts. This brought the newer motor/sensor handling, startup self-test, and installation fixes into the root package.
- **Data / configuration impact:** Copied the standalone `.env` into ignored root `pi_ws_scanner.env`. The runtime configuration remains local and is not included in the Git push. Website/backend application code and database records were unchanged.
- **Backup / recovery evidence:** Previous Pi runtime configuration preserved as ignored `pi_ws_scanner.before-replacement-2026-10-28.env`. This was a configuration copy, not a full database/scan backup or tested restore.
- **Validation:** All 30 mapped package files matched the standalone source after normalizing line endings; seven Python modules and 18 shell scripts passed syntax checks. Required mechanism imports and document-layer mapping passed. Lift/sort tests ran in simulation only. GitHub `main` was verified at `73cf88f` after push.
- **Publication / deployment:** Nine tracked Pi files were committed and pushed to `origin/main`. Physical Pi deployment and motor/camera operation were not performed or verified by this task.
- **Rollback:** Prior tracked baseline is `db1ba42`; restore a consistent package as a unit and validate its scanner imports before using it. Restore local Pi configuration from the preserved copy if needed. Do not overwrite subsequent user work.
- **Outstanding / next action:** Future physical deployment needs a package copy/restart and hardware validation. The audit also found that network synchronization can overwrite local Pi settings; resolve configuration alignment during the planned loading work.

---

## Historical entries

The entries below predate the current audit and are retained as historical records. Their completion/planned labels describe what was recorded at that time, not a fresh verification of today's system.


## [2026-09-30] — Phase 4: Frontend UI ✅

### FEATURE — Document Types Management Page (Admin Only)
- **New File:** `dashboard/src/pages/DocumentTypeList.jsx`
- New admin page accessible via the **Administration → Document Types** sidebar link
- Displays a table of all document types with their routing track and Mayor Approval status
- Admin can create, edit, and delete document types
- Edit/Create form includes a **toggle switch** for `requiresMayorApproval` and a **dropdown** for `routingTrack`

### FEATURE — Route Progress Stepper in Document Detail
- **File:** `dashboard/src/pages/DocumentList.jsx`
- Added a visual route progress bar inside the expanded document detail row
- Shows each office in `routePlan` as a pill-shaped badge
- **Current stop** is highlighted in primary color with a 📍 pin icon
- **Completed stops** show a ✓ green checkmark
- **Future stops** are shown in muted color
- Only displays if the document has a `routePlan` with more than one stop

### WIRED — App.jsx Plumbing
- **File:** `dashboard/src/App.jsx`
- Imported `DocumentTypeList` page and `documentTypeService` API
- Added `document-types` to the admin `ROLE_PAGES` access list
- Added three handler functions: `handleAddDocumentType`, `handleUpdateDocumentType`, `handleDeleteDocumentType`
- Added `case 'document-types'` to the admin page `renderPage` switch

---

## [2026-09-30] — Phase 3: API Updates ✅

### FEATURE — Document Types API
- **File:** `backend/routes/documentTypes.js`
- Updated the `POST /api/document-types` and `PUT /api/document-types/:id` routes.
- Safely extracts and casts `requiresMayorApproval` and `routingTrack` from the request body to ensure data integrity when admins update routing rules.

---

## [2026-09-30] — Phase 2: Mayor Gate & Route Logic ✅

### FEATURE — Mayor Gate on Document Creation
- **File:** `backend/routes/documents.js`
- Added logic in `normalizeDocumentPayload` to automatically lookup the `requiresMayorApproval` flag for the selected document type.
- If true, automatically generates a `routePlan` targeting the Mayor's office and forces the document into the Mayor's inbox with a `For Signing` status.

### FEATURE — Route Auto-Advancement
- **File:** `backend/routes/transmissions.js`
- Added logic to automatically increment `routeStep` whenever a transmission is received, moving the document to the next logical stop in the `routePlan`.

---

## [2026-09-30] — Phase 1: Database Schema Changes ✅

### FEATURE — Added Routing Fields to `DocumentType`
- **File:** `backend/models/index.js` (`DocumentTypeModel`)
- Added `requiresMayorApproval` (BOOLEAN, default: `false`) — flags a document type as needing Mayor sign-off before routing
- Added `routingTrack` (TEXT, default: `'direct'`) — defines the routing track: `direct`, `mayor`, or `sequential`
- Migration function `migrateDocumentTypeRoutingFields()` added; runs `ALTER TABLE IF NOT EXISTS` on every server start (safe to re-run)

### FEATURE — Added Routing Fields to `Document`
- **File:** `backend/models/index.js` (`DocumentModel`)
- Added `routePlan` (JSONB, default: `[]`) — ordered array of office IDs the document must visit
- Added `routeStep` (INTEGER, default: `0`) — pointer to the current position in `routePlan`
- Added `mayorApprovalCleared` (BOOLEAN, default: `false`) — flag set to `true` once the Mayor has signed/approved a document that required it
- Migration function `migrateDocumentRoutingFields()` added; runs `ALTER TABLE IF NOT EXISTS` on every server start (safe to re-run)

### Verification
- Ran `node -e "syncModels()"` — all 5 new columns applied to live PostgreSQL database successfully ✅

---


## [2026-09-30]

### CONFIG — Environment Setup
- Created `backend/.env` from `backend/.env.example`
- Set `DATABASE_URL` credentials to match the local PostgreSQL installation (credential value redacted)
- Generated secure random values for `JWT_SECRET` and `DEVICE_API_KEY`
- Set `MONGODB_URI` to `mongodb://127.0.0.1:27017/vinzons_digipath`
- Set `PORT=5000`, `NODE_ENV=development`, `HOST=0.0.0.0`

### FIX — Database Migration Script
- **File:** `backend/scripts/migrate-pg.js`
- Changed `sequelize.sync({ alter: true })` to `sequelize.sync({ force: true })`
- **Reason:** Running `npm run seed` (old MongoDB script) before `npm run migrate` created
  corrupted/partial PostgreSQL tables. The `force: true` flag drops and recreates all tables
  cleanly, resolving the "Validation error / id must be unique" crash during migration.

### MIGRATION — PostgreSQL Data Import
- Ran `npm run migrate` successfully
- Imported all collections from `dbcollections/` into PostgreSQL (`vinzons_digipath` database)
  - offices: 11 records
  - document_types: 9 records
  - users: 15 records
  - documents: 9 records
  - transmissions: 3 records
  - devices: 1 record
  - device_events: 8 records
  - notifications: 35 records
  - sender_notifications: 10 records
  - logs: 8,182 records

### CONFIG — Demo Passwords Reset
- Ran `node scripts/set-demo-passwords.js`
- Reset demo passwords for 15 accounts (credential values redacted)
- Affected demo accounts included Admin, Mayor, and Office roles; credential values are intentionally omitted

---

## [PLANNED] — Professor's Workflow Requirements

The following changes are planned and approved. They have not been implemented yet.
See `workflow_modification_plan.md` for the full technical breakdown.

### PLANNED FEATURE — Dynamic Routing Tracks (Track A / B / C)
- **Files:** `backend/models/DocumentType.js`, `backend/models/Document.js`
- Add `requiresMayorApproval` (boolean) and `routingTrack` (enum) to DocumentType
- Add `routePlan[]` (array of office IDs), `routeStep` (number), and
  `mayorApprovalCleared` (boolean) to Document
- **Purpose:** Support Direct, Mayor-Mediated, and Sequential multi-office routing

### PLANNED FEATURE — Mayor Gate on Document Creation
- **File:** `backend/routes/documents.js`
- When an Office user creates an Outgoing document, automatically check the document type
- If `requiresMayorApproval === true`, force document to Mayor's Office and lock it
  until Mayor signs it before it proceeds to the destination office

### PLANNED FEATURE — Route Advancement on Transmission Receive
- **File:** `backend/routes/transmissions.js`
- When a transmission is marked as received, auto-advance `routeStep` and update
  `currentOfficeId` to the next office in `routePlan`

### PLANNED FEATURE — Routing Preview UI on Document Form
- **File:** `dashboard/src/pages/ReceptionistDashboard.jsx`
- Show a visual preview of the routing path when a document type is selected

### PLANNED FEATURE — Route Progress Stepper UI on Document Detail
- **File:** `dashboard/src/pages/DocumentList.jsx`
- Show a horizontal stepper showing all stops in `routePlan` with the current
  `routeStep` highlighted so staff can see exactly where a document is in its journey

---

*This file is updated manually whenever a change is made to the system.*
*Add new dated entries after the instructions/template and before older dated entries. Follow the maintenance instructions at the top of this file.*
