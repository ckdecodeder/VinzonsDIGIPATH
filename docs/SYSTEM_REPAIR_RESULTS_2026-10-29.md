# System repair results — 29–30 October 2026

The reproducible source repairs are committed on `main` at `d0291ff23133565d28283fcf1a430885fad657d9`. All 116 distinct automated tests passed, the production dashboard build passed, and both dependency audits report zero vulnerabilities. This is a local source result: the running backend, physical Pi and published frontend were not updated by this repair operation.

The user explicitly deferred SMS until after the other fixes. Historical missing scans and ambiguous record values remain open because no exact originals or unambiguous replacement values were verified.

## Scope and finding disposition

Work followed the [repair plan](SYSTEM_REPAIR_PLAN_2026-10-29.md), the existing [performance/deployment plan](PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md), and the requested planning → execution → testing → commit sequence. The [original audit](SYSTEM_AUDIT_2026-10-29.md) remains the baseline snapshot at `7d0631d`; its line references and dependency counts describe that earlier revision.

| Finding | Local result | Remaining requirement |
| --- | --- | --- |
| A01 — Create can overwrite an existing document | New instances insert; server generates IDs; identity cannot change. Registration and initial deliveries share a transaction. Existing saves update dirty fields under a lock and cannot recreate deleted records. | Deploy matching source and perform live role acceptance. |
| A02 — Weak scanner configuration | Backend startup and network synchronization reject weak credentials in every mode; bridge fallback removed. A private candidate bundle contains matching backend/network/Pi settings and preserves previous configurations. | Apply coordinated strong credentials and restart/verify the physical backend/Pi pair. The current running configuration was not rotated. |
| A03 — Public scan downloads | `/uploads` requires authentication and permission to the owning document, including page attachments and legacy covers. Frontend image/PDF/download paths authenticate to the verified backend; byte ranges remain supported. | Release matching frontend before enforcing the new backend file contract; refresh cached clients and verify actual scans. |
| A04 — WebSocket document disclosure | Command events omit full result documents and are limited to the requester/allowed approval roles. Camera access is role restricted. | Verify real clients after release. |
| A05 — Office-wide activity logs | Listing and totals use the same user/document/linked-record scope; reports use that scope too. | Live acceptance with intended Office accounts. |
| A06 — Print markup injection | Print metadata is escaped; image print sources are restricted to accepted local media. | Native browser/physical print acceptance. |
| A07 — Early scan deletion | Saving/removing attachments retains previous files; client references must belong to the same document. Database failures preserve old scans. | A separate ownership-aware storage cleanup policy; no automatic destructive cleanup added. |
| A08 — Mutable archive linkage | Only supported archive metadata is editable. Archive linkage and restore status cannot be rebound by the caller; restore is transactional. | Live workflow acceptance. |
| A09 — Missing stored scans | Read-only reconciliation and a private per-record recovery manifest prepared. | 15 absent stored attachments remain; 8 have inline cover fallbacks, which do not establish complete original recovery. No exact backup originals verified. |
| A10 — Conflicting scanner commands | PostgreSQL advisory lock serializes per-device command admission/cancellation; terminal acknowledgements cannot reactivate completed commands or rewrite their original execution time. Camera-light exception retained. | Actual Pi command/reconnect acceptance during rollout. |
| A11 — Concurrent archive duplicates | Archive creation locks the document and commits archive/document changes together; restore/deletion races are covered. | Live acceptance. |
| A12 — Signing outside custody | Status, signing and process-note actions enforce current custody under a document lock; stale workflow snapshots conflict. | Live role acceptance. |
| A13 — Stale WebSocket sessions | Account existence, current role/office and token expiry checked; account edits/deletion revoke sessions. | Live connection/session acceptance. |
| A14 — Arbitrary bridge destinations | Requests require the registered numeric private-LAN target; loopback requires explicit configuration. Redirects rejected and body reads share a deadline. | Verify the actual registered bridge address/configuration. |
| A15 — Historical workflow anomalies | Read-only reconciliation identifies 8 invalid custody references, 4 missing receipt timestamps and 8 legacy queues. Account deletion now preserves historical receipt identity/time. | Review originals and intended recipients. Zero unambiguous timestamp candidates were found; no guessed repairs, resends or backfills applied. |
| A16 — Dependency advisories | Backend/dashboard lockfiles updated; compatible fixes plus the Sequelize UUID override avoid an automatic major downgrade. Both full npm audits report zero vulnerabilities. | Use Node.js 22.12+ and committed lockfiles at release; future advisories require rechecking. |
| A17 — Outbox-only SMS | Explicit user exception: unchanged and deferred. | Separate provider/delivery work and approved test recipient later; do not flush the existing queue. |
| A18 — Tracked private exports | 11 exports removed from the new Git snapshot and ignored; original local files and private preserved copies checksum-match. Export now uses private consistent read-only PostgreSQL snapshots, including all 12 tables. | Earlier Git history remains. Assess exposure/rotate any reused credentials during rollout; no history rewrite performed. JSON export is not the sole recovery method. |

Fourteen findings have their source repair implemented. A02 also has source guards and prepared configuration, but its physical credential rollout is pending. A09/A15 remain recovery/reconciliation work; A17 is the agreed exception. None of these local results establishes production acceptance.

## Validation completed

| Check | Result and boundary |
| --- | --- |
| Regular regression command | `node --test backend/test/*.test.js dashboard/src/utils/*.test.js dashboard/src/api/*.test.mjs scripts/start-all.test.js`: 89 passed, 0 failed; 27 opt-in database cases skipped in this invocation. |
| PostgreSQL/HTTP regressions | All 27 opt-in tests separately passed in disposable schemas of the existing restored test database, with temporary scan storage and teardown. These are the 27 skipped above: 116 distinct passing tests in total. |
| Concurrency/fault boundaries | Actual model/HTTP tests cover insert conflicts, partial registration rollback, unauthorized files/ranges/pages, attachment ownership/retention, archive/restore rollback and races, custody, command admission/replay, log scope, stale edits, dirty saves, deletion races and receipt preservation. Existing multi-office delivery/receipt tests remain green. |
| WebSocket/bridge/maintenance | Synthetic real-hub checks cover disclosure, account/expiry/revocation and camera permissions. Bridge credentials, destination/body deadlines and guarded maintenance are covered. Weak network-source keys are refused before any configuration writes. |
| Dashboard production build | Passed with Vite 8.3.5. Dependency installation used the lockfiles with installation lifecycle scripts disabled. |
| Dependency audit | Backend: 0; dashboard: 0 vulnerabilities, including development dependencies, at validation time. |
| Syntax | All 95 backend/startup CommonJS files parsed without errors. Pi source was not changed; the earlier audit's Python/PowerShell/shell checks remain historical evidence, not fresh hardware acceptance. |
| Browser acceptance | Synthetic local API/Vite harness rendered protected PNG and PDF, denied expired sessions with bounded errors, and restored previews after authentication recovery. A downloaded 68-byte synthetic PNG checksum matched the fixture. Screenshots were visually inspected; no saved screenshot artifact is claimed. |
| Privacy and Git review | Explicit source paths staged; no private configuration, records, backups or upload files added. All 11 untracked exports remain locally intact with matching preserved copies. Git whitespace checks passed. |

The browser harness used generated in-memory tokens and synthetic files, with no live database or hardware. Temporary harness processes and its browser tab were closed. User-owned backend/tunnel services were left running. Existing local backend health remained HTTP 200/ready, without the new revision field, consistent with no source rollout. Initial sandbox readiness and VM-fixture errors were corrected and rerun successfully; they are not outstanding failures.

Machine-readable aggregate evidence: [verification summary](system-repair-evidence-2026-10-29/summary.json). Raw local outputs and synthetic fixtures are retained under ignored `database-export/system-repair-2026-10-29/`; this directory is not a database recovery backup.

## Private recovery and configuration handoff

These paths identify ignored local artifacts, not published files. Do not commit or share their contents.

- Preserved exports: `database-export/system-repair-2026-10-29/preserved-exports/`. All 11 match their original local `dbcollections` files. Keeping these copies does not erase older Git history.
- Read-only reconciliation: `database-export/reconciliation-2026-10-29T15-32-32-188Z/private-manifest.json`. Checked 85 documents; no production writes or applied historical repairs. The aggregate summary is also retained in the private operation directory.
- Latest complete candidate configuration bundle: `database-export/secure-rollout-2026-10-29T16-09-22-034Z-bd8859/`. Includes previous backend/network/Pi settings and matching candidate credentials. Nothing was applied; the script did not contact the Pi. Revalidate endpoints and device tuning before a later rollout.

No new native live database/scan backup, restore exercise or separate-storage verification was completed during this source repair. Preserve the earlier recovery artifacts; before any live data/schema repair, take a fresh coordinated PostgreSQL/scan/configuration backup, restore it on the test copy, verify file hashes and retain a verified separate-storage copy. A file's existence alone does not establish a valid recoverable backup.

## Release and remaining acceptance

Follow the [deployment checklist](DEPLOYMENT_CHECKLIST.md) for a separately authorized release. Review/apply the coordinated credential bundle before starting the repaired backend, which will reject the old weak settings. Publish the matching frontend before enabling protected backend downloads; refresh existing clients. Preserve the intended database and persistent upload locations. Verify health `revision`/`startedAt`, API/WS pairing, role scopes, existing scans, new captures, Pi heartbeat/preview/commands/reconnects, receipt workflows and reports together.

Historical record repair needs original evidence and a reviewed per-record manifest. Physical four-device acceptance, native printing, off-machine recovery, service supervision, remaining measured performance/query/index phases and hosting decisions remain in the operation plan. Retained superseded files need a later storage-cleanup review. SMS remains deferred.

No push, deployment, service restart, Pi command, live credential replacement or business-data mutation occurred in this repair operation. Source rollback should use focused revert commits and align frontend/backend contracts; preserve newer records and files. Restore prior backend/Pi configuration together if a later release needs recovery. Do not restore an old database solely to undo source changes.
