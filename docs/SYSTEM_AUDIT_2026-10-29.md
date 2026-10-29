# DigiPath system audit — 29 October 2026

The system is reachable and its existing tests pass, but it still has urgent security and data-preservation defects. Passing tests do not cover all the failures below. This audit made no application fixes, live record changes, configuration changes, service restarts, hardware commands, commits, pushes, or deployments.

**Repair follow-up (2026-10-30):** Source repairs are now committed locally at `d0291ff` on `main`; see [repair results and remaining requirements](SYSTEM_REPAIR_RESULTS_2026-10-29.md). This report preserves the original audit snapshot. Deployment, coordinated credential rollout, historical recovery and physical acceptance remain separate; SMS was explicitly deferred.

## Scope and evidence

- Audited `main` at `7d0631dc534fbac9a58e9c85ade12ea731055727`. The starting checkout was clean. A read-only remote check confirmed GitHub `main` at the same revision.
- Reviewed dashboard/API contracts, authentication and authorization, document registration/routing/receipt/signing/archiving, attachments, notifications, WebSockets, scanner commands, models, startup scripts, deployment instructions, and the current performance plan.
- Queried the live PostgreSQL database inside `BEGIN READ ONLY` transactions. Saved only aggregate results, configuration booleans, and public asset identifiers. Private records, file contents, credentials, and tokens are absent from these artifacts.
- Used explicitly approved 60-second, in-memory role tokens for bounded read-only API checks. Confirmed key live findings through the public tunnel. Destructive/fault/concurrency reproductions used actual handlers with synthetic in-memory dependencies or disposable schemas in the restored test database.
- Inspected the published sign-in page and its public tracking error path in a browser. A nonexistent synthetic tracking number completed with “Tracking number not found”; no warning/error console messages were captured for that check.
- Evidence: [runtime aggregates](system-audit-evidence-2026-10-29/runtime.json), [follow-up aggregates](system-audit-evidence-2026-10-29/followup.json), [finding reproductions](system-audit-evidence-2026-10-29/synthetic-probes.json), [dependency scan](system-audit-evidence-2026-10-29/dependency-summary.json), [validation](system-audit-evidence-2026-10-29/validation-summary.json).

`P1` means an urgent repair; `P2` means a correctness, security-hardening, or operational gap to address next. These project priorities are separate from npm advisory severity. “Synthetic” establishes the checked-out implementation's behavior; it does not establish that a harmful action happened to real records.

## Findings

| ID | Priority | Finding | Evidence level |
| --- | --- | --- | --- |
| A01 | P1 | Creating a document can overwrite an existing document, including another office's record | Actual handler + actual compatibility-layer save, synthetic reproduction |
| A02 | P1 | Backend configuration retains the known default scanner key and disables production startup checks | Configuration/source confirmed; live credential probe deliberately not run |
| A03 | P1 | Stored scans can be downloaded without login or document authorization | Public HTTP range request returned 206 without credentials |
| A04 | P1 | WebSocket command updates disclose complete scan result documents to unrelated users | Real hub, synthetic unrelated Office socket |
| A05 | P1 | Office users can read the entire activity-log collection | Public Office token returned the same 9,524 total as Admin |
| A06 | P1 | Stored attachment names enter print-popup HTML unescaped | Real persistence helper + print function, synthetic script markup preserved |
| A07 | P1 | Replacing attachments deletes old files before the database update succeeds | Actual update handler with synthetic database failure |
| A08 | P1 | Archive edits can rebind a record and alter an unrelated document when removed | Actual archive handlers, synthetic reproduction |
| A09 | P1 | Fifteen documents reference stored attachments absent from the selected scan directory | Read-only database references + filesystem existence checks |
| A10 | P2 | Simultaneous scanner submissions can queue conflicting active commands | Two real handlers both returned 201 in a controlled interleaving |
| A11 | P2 | Simultaneous archiving can create duplicate archive records | Two real handlers both returned 200 in a controlled interleaving |
| A12 | P2 | Backend signing does not enforce the current-custody rule used by the dashboard | Synthetic Mayor at another office successfully signed through the API |
| A13 | P2 | WebSocket authentication does not recheck account existence or expire an established session | Real hub accepted a signed token for a nonexistent synthetic account |
| A14 | P2 | Bridge status accepts an arbitrary caller-supplied destination | Actual route selected an external synthetic URL; network call intercepted |
| A15 | P2 | Existing records contain incomplete receipt/custody/legacy routing state | Read-only aggregates: 4 incomplete receipt timestamps, 8 missing custody references, 8 legacy queues |
| A16 | P2 | Dependency advisories remain in both lockfiles | Current npm registry audit: 9 backend and 11 dashboard package entries |
| A17 | P2 | Sender SMS delivery is configured as an outbox only | Configuration/source + all 40 sender notifications still Queued |
| A18 | P1 | Git tracks database exports, including account password hashes | 11 tracked JSON exports, 8,283 rows, 15 bcrypt password hashes |

### A01 — Creation uses upsert and accepts the caller's ID

`backend/routes/documents.js:371,515,572` accepts a supplied ID and constructs a new document. `backend/models/ModelWrapper.js:177–187` implements `.save()` as an unconditional upsert. Registration does not first authorize access to an existing record with that ID.

The synthetic Office request replaced an existing out-of-office document's subject, tracking identity, custody, attachments, and history. Its later handoff failed with HTTP 500, but the original record had already been overwritten. This also exposes partial-success behavior in registration.

**Repair:** Separate insert from update, generate immutable IDs on the server, return 409 for an existing identity, and commit registration plus initial handoffs atomically. Keep replays explicit and idempotent rather than treating every create as upsert.

### A02 — Default device credential remains configured

The backend's saved configuration matches the known development device key; the Pi configuration matches that backend key. Production mode is disabled. `backend/server.js:14–22` rejects default credentials only in production mode, while `backend/utils/bridge.js:6–13` also supplies a default key when none is configured.

The API is publicly reachable. The device credential protects hardware event ingestion, scan writes, command polling/status, and the device WebSocket. This is an urgent configuration risk. Acceptance of that credential by the currently running process was not probed: automatic review declined transmission of the device key, and the approved role-token checks were kept separate. No hardware identity or command was impersonated.

**Repair:** Coordinate a new high-entropy device key across the backend, Pi, and network source configuration; remove public-runtime fallback credentials; enable validated production startup after alignment. A configuration restart/rollout is required and was not performed by this audit.

### A03 — Upload serving bypasses document permissions

`backend/server.js:45` exposes the uploads directory through unauthenticated static serving. The document metadata API correctly returned 401 without a token, but a known stored PDF returned 200 locally and 206 for a 16-byte unauthenticated public range request.

Knowing a scan URL is sufficient to retrieve it, even when the corresponding document is outside the caller's office. Filename obscurity does not enforce authorization.

**Repair:** Authorize each attachment against its owning document, then serve it through an authenticated download/preview path or a short-lived signed URL. Update PDF/image previews and downloads together so protecting files does not break normal viewing.

### A04 — Full result documents are broadcast to every WebSocket user

`backend/ws/realtimeHub.js:620–626` broadcasts `{command,resultDocument}` to every authenticated user before its subscription-specific broadcast. The result document can include OCR, attachments, sender contact, and internal history. An unrelated synthetic Office socket received the complete synthetic result without subscribing. Subscribers can also receive duplicate updates.

**Repair:** Apply the same document scope as HTTP, send command status only to authorized recipients, and fetch full documents through the protected detail route. Test unrelated offices and expired/deleted accounts as well as valid scanner users.

### A05 — Office activity-log access is global

`backend/routes/logs.js:9–15` allows Office access but scopes only Receptionists; Office receives `{}` as its visibility filter. Public Admin and Office requests both reported 9,524 records and returned the same sampled page; the Office page included other users' activity. The dashboard's intended `visibleLogs` filtering (`dashboard/src/App.jsx:791`) does not protect the endpoint, and Activity Logs fetches server pages directly.

**Repair:** Define the permitted own-user/visible-document log scope on the server and apply it to listing, counts, search, and complete report collection.

### A06 — Print HTML injection

`backend/utils/attachments.js:48` accepts existing-URL attachment metadata without validating the name/URL. `dashboard/src/utils/attachmentDownload.js:141,167` interpolates the stored name into a `document.write()` title without escaping. A synthetic attachment name containing a closing title and script element survived the actual persistence helper and appeared as active markup in the generated popup document.

This establishes HTML injection and a potential stored-XSS path when another user prints/converts the attachment. Actual script execution in a real browser was not attempted. The claim-slip printing path already escapes its fields; the attachment print path does not.

**Repair:** Build the popup with safe DOM properties or correctly escape text and attribute contexts; validate attachment URLs and metadata at ingestion. Add a focused malicious-name regression and browser execution check using a harmless synthetic marker.

### A07 — Attachment deletion is not coordinated with the database

`backend/routes/documents.js:660–674` persists replacement attachments and removes old files before the database update at line 741. A simulated database failure returned 500 after the removal helper had already run; the document still referenced its former attachment list.

**Repair:** Commit the new document references first, then perform retryable cleanup of genuinely unreferenced files. Preserve originals until successful commit and check ownership/shared references before deletion. Failed uploads also need cleanup of newly written orphan files.

### A08 and A11 — Archive integrity is insufficient

`backend/routes/archives.js:127–132` accepts unrestricted metadata updates, including `documentId` and `statusBeforeArchive`. Removal at lines 142–155 trusts those mutable values. In the synthetic reproduction, changing an archive's document link and removing it changed an unrelated Received document to Signed while leaving the original Archived document without its archive record.

Creation checks for an existing archive separately from saving it (`:76–91`), and the live database has no unique archive-per-document constraint. Two interleaved real handlers created two archive rows for one synthetic document. No duplicate archive rows were found in the live snapshot.

**Repair:** Make document linkage and prior workflow state immutable, validate any allowed metadata edits, and serialize archive/create/restore with document routing using a transaction and document lock. Add a reviewed uniqueness constraint after checking existing data. Coordinate the document and archive write in the same transaction.

### A09 and A15 — Existing data needs reconciliation

The snapshot contains 85 documents, 41 transmissions, 6 archives, 17 users, 11 offices, 9 document types, 123 commands, and 9,524 logs.

- **15 documents** have a top-level stored attachment whose file is absent. Each of those 15 has no existing top-level stored attachment in its list. Seven cover URLs also reference absent files. Some records may still have inline cover data or recoverable backup originals; permanent loss was not established.
- **8 documents** reference a custody office absent from the current office table: 3 Received, 2 For Signing, 2 In Transit, 1 Archived.
- **4 transmissions** have a receiver identity but no receipt timestamp. These were not classified as pending by the current `receivedBy` check. Missing timestamps still affect history and reporting.
- **8 documents** retain legacy send queues: 6 In Transit, 1 Received, 1 Archived. They need explicit workflow reconciliation; the archived queue is inconsistent with the current archive guard.
- **37 documents** still contain inline cover media. This is a known migration/performance item, not proof that the cover is unusable.
- No orphan transmission/document or archive/document links, duplicate archives, invalid user roles, missing user-office assignments, invalid stored workflow statuses, or currently conflicting active scanner commands were found in the checked snapshot. The database has **zero foreign-key constraints**, so application checks currently carry the entire reference-integrity burden.

**Repair:** Reconcile against trusted records and backups on the restored test copy first. Produce a private per-record review/rollback manifest before any approved live repair. Do not delete legacy queues or replace the only surviving scan automatically.

### A10 — Scanner command admission is a check-then-save race

`backend/routes/devices.js:890–914` checks for a pending command and creates the new command in separate operations. There is no device-level lock or database guard. The synthetic interleaving let SCAN and SORT both pass the empty-queue check and return 201. No physical movement was simulated or requested, and the live snapshot had no active conflicts.

**Repair:** Serialize admission per device and enforce the allowed active-command invariant in the database. Preserve the deliberate camera-light exception and stale-command rules; verify retries cannot execute a command twice.

### A12 — Signing custody rules differ between browser and API

The dashboard requires current office custody (`dashboard/src/utils/documentActionRules.js:11–29`). The API's `/documents/:id/process-note` (`backend/routes/documents.js:901–974`) checks role and document visibility but does not enforce matching current custody. A synthetic Mayor whose office did not hold the document received HTTP 200 and changed it to Signed.

**Repair:** Enforce the agreed custody rule inside the locked workflow transaction, including generic status-changing updates. Recheck current state under the lock so concurrent routing/archiving cannot invalidate an earlier permission decision.

### A13 — WebSocket sessions outlive account validity

`backend/ws/realtimeHub.js:298–322` verifies the JWT once and trusts its identity/role without looking up the account. A token for a nonexistent synthetic user was accepted. Established connections have no token-expiry/revocation check; ping/pong only checks transport liveness.

**Repair:** Resolve the current account/role during authentication, close sessions at token expiry, and invalidate sockets for removed or restricted accounts. Coordinate reconnection with the dashboard's normal authentication recovery.

### A14 — Bridge target validation is inconsistent

`/device/bridge/probe` validates a private destination, but `/device/bridge/status` uses `getBridgeBaseUrl` directly (`backend/routes/devices.js:531–534`, `backend/utils/bridge.js:44–47`). A synthetic Mayor-selected external host reached the outbound-request boundary. The request was intercepted; no external/internal target was contacted.

This exposes a server-side request-forgery surface to otherwise authorized bridge users. **Repair:** Use a configured/registered bridge destination and one consistent destination policy, including redirect validation, across status/snapshot/connect/disconnect. Restrict the roles allowed to choose or change a bridge address.

### A16 — Dependency scan requires contextual remediation

| Audit | Critical | High | Moderate | Low | Total package entries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Backend, all dependencies | 1 | 3 | 5 | 0 | 9 |
| Backend, omit dev | 1 | 2 | 5 | 0 | 8 |
| Dashboard, all dependencies | 1 | 6 | 3 | 1 | 11 |
| Dashboard, omit dev | 1 | 2 | 1 | 1 | 5 |

The critical entries are `proxy-addr` in the backend audit and `dompurify` in the dashboard audit. Other notable entries include `body-parser`, `adm-zip`, and the Vite development toolchain. Registry advisories are package/version alerts, not proof that every vulnerable option is exercised by this application. “Omit dev” classifies the dependency graph; it does not establish which code is shipped or invoked.

**Repair:** Triage reachable runtime paths first, then upgrade compatible versions and rebuild/retest. Do not apply `npm audit fix --force` blindly: the suggested Sequelize remediation includes a major downgrade. Full advisory URLs and proposed package changes are preserved in [the scan evidence](system-audit-evidence-2026-10-29/dependency-summary.json). No dependency was changed.

### A17 — SMS delivery remains queued

The configured provider is outbox-only. `backend/utils/senderNotifications.js:195` returns without contacting a provider, and all 40 sender notification records are Queued. Creating a notification therefore does not currently establish delivery to an external sender. Email is intentionally filtered out in the current workflow and is not treated here as a regression.

**Repair:** If live SMS is required, select/configure a provider and a bounded, retryable delivery worker with status tracking. The existing provider HTTP calls also need response-body deadlines; they currently run inside workflow side effects without them. Any test message needs its own explicitly authorized recipient and was not sent by this audit.

### A18 — Database exports belong outside ordinary source publication

`git ls-files` confirms the 11 `dbcollections/*.json` files are tracked. They contain 8,283 aggregate rows, including 15 bcrypt password hashes; no plaintext password was found in those 15 password fields. `backend/scripts/export-pg-to-json.js` writes live tables into this tracked directory and advises committing it.

**Repair:** Separate synthetic seed fixtures from private exports/backups, remove credential-bearing data from future source publication, and assess repository visibility/history and whether affected credentials need rotation. Do not rewrite Git history or delete the only recovery copy without a coordinated plan. No data contents or hashes were reproduced in this report.

## Remaining operational and performance gaps

- `docs/DEPLOYMENT_CHECKLIST.md` and `docs/DATABASE_SETUP.md` still describe MongoDB and advise migration/seeding in ways that do not match the active PostgreSQL system. `migrate-pg.js` currently uses `sync({alter:true})` and imports/upserts historical exports; it is not a schema-only production migration. `seed.js` still connects to MongoDB while using PostgreSQL model wrappers and can delete/reseed users. None of these commands was run.
- `network.env`'s configured backend differs from the current backend/Pi configuration. `network:sync` would reapply that source to several environment files. Local dashboard `/api` configuration is valid for its development proxy; its mismatch with a public URL is not itself a defect. The published frontend embeds the currently advertised backend.
- The API samples had no text compression, while Vercel assets used Brotli. Reports still collect complete datasets and filter in application memory; document compatibility callers still collect all metadata pages. These preserve completeness but leave the SQL aggregate/filter and server-driven UI work in the performance plan unfinished.
- The live database has only 20 indexes, including four tracking-number unique indexes and four username unique indexes. Targeted log/device-event/command indexes, measured pool waits, and request/event-loop/preview metrics remain unimplemented. Do not remove duplicate unique indexes without checking constraint dependencies.
- Automatic startup is a Windows login shortcut, not supervised production service management. Laptop/tunnel availability remains a dependency by the user's chosen architecture. No backend source-revision endpoint establishes which checked-out revision the running process loaded.
- Existing local recovery artifacts from 28 October remain separate from a current backup and a verified separate-storage copy. This audit did not create a backup, rerun a restore, or verify an off-machine recovery copy. Fresh coordinated recovery verification remains required before live data repairs or migration.
- Actual four-device acceptance, physical Pi deployment, motor/sensor/camera behavior, multiple simultaneous camera viewers, real scanner uploads during other users' work, native report printing, and outage/recovery capacity measurements remain pending. Source syntax and synthetic tests cannot establish those outcomes.

## Checks that passed

- Regular suite: **77 passed, 0 failed**; 11 opt-in integration cases skipped in that command and then **all 11 passed separately** against disposable schemas in the restored test database. This is **88 distinct passing tests**.
- Production dashboard build passed; root/backend/dashboard dependency installations resolved at the checked top level.
- **80** backend/startup CommonJS files parsed; **23** Python files parsed; **6** PowerShell scripts parsed; **55** shell scripts passed `bash -n`. Matching root/`raspberry_pi` Python and shell copies were equal after line-ending normalization. No Pi module was imported or motor command run.
- Ten isolated audit probes reproduced the listed defects; their success means the defective behavior was demonstrated, not that it was fixed.
- Local and public API health returned 200 with a ready database. Unauthorized document metadata returned 401. Admin/Mayor document totals were 85; sampled Office total was 20; sampled Receptionist total was 59. These are sampled role/API checks from one machine, not all 17 accounts or four physical devices.
- Public build serves the report-worker feature and receipt-confirmation code. The published entry is `/assets/index-58ac8ad7.js`; a local build has different environment-dependent asset hashes. That difference alone is not evidence of a stale release. A search limited to the DocumentList chunk missed receipt code located in the main chunk; [the follow-up publication check](system-audit-evidence-2026-10-29/publication.json) confirmed it there. Backend runtime revision and live multi-office mutation behavior remain unverified.

The first readiness test and Git Bash checks failed under sandbox connection/process restrictions, and npm initially could not resolve its registry there. Authorized reruns with the necessary access passed/completed; those initial environment failures are not reported as application defects. The device-key public probe remained unexecuted after automatic review declined it.

## Proposed repair order

1. Protect data and access: coordinate scanner credentials/production checks; fix create/upsert overwrite, scan-file authorization, WebSocket disclosure, Office log scoping, and print HTML injection. Restrict credential-bearing exports from further publication.
2. Make file/document/archive operations recoverable and atomic; add immutable archive linkage and locked signing/archiving/command admission. Convert the isolated reproductions into regressions for corrected behavior.
3. Reconcile missing files, office references, receipt timestamps, and old queues on the restored copy, with a reviewed private manifest and verified backups before live application.
4. Triage dependencies, repair deployment/runbook drift and supervision, and implement SMS delivery if required. Continue the existing measured performance plan.
5. Coordinate any authorized frontend/backend release, then verify real roles and physical devices. Keep local/committed/pushed/deployed/live-verified states separate.

All repairs above remain proposed. This audit added documentation and reusable evidence probes only.
