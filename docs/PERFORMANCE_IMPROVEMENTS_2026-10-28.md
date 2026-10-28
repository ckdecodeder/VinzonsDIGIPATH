# Local performance improvements and later acceptance

Date: 2026-10-28, Asia/Manila. Starting revision: `main`, `73cf88f`.

The backend and PostgreSQL will remain on this laptop, as requested. This is an implementation checkpoint, not proof that the live four-device incident is resolved. The user deferred physical acceptance to a later session. Source commit `c1ac509` is committed locally on `main`; its frontend publication remains pending. After the user started the main backend and forwarded port 5000, public API/config, Vercel-origin CORS and authenticated WS checks passed. Follow-up documentation updates remain local; no push or Vercel deployment was performed by Codex.

See [CHANGELOG.md](../CHANGELOG.md) for batch records, [the operation plan](PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md) for remaining work, and [the original audit](MULTI_USER_PERFORMANCE_AUDIT_2026-10-28.md) for baseline evidence.

## Implemented locally

- Requests have deadlines through response-body consumption, caller cancellation, typed errors, and bounded retries for eligible safe reads. Mutations are attempted once. Report downloads use a separate deadline and no automatic retry.
- The application shell renders immediately. Collections load independently and according to the visible page; activity logs no longer block the dashboard. Each unavailable section has its own message and retry action, and dashboard cards show unknown counts until their collection loads.
- Collection loads share in-flight work, cache reference data, reject obsolete/session results, coalesce invalidations, and refresh affected visible collections. Device-only events do not reload documents or logs. Continuous invalidation ends with a retryable section error instead of an endless loader.
- API discovery validates JSON identity, deduplicates candidates, caches verified success, and supports bounded recovery/manual retry/network recovery. ICE configuration cannot change the verified API/WS destination. A separate WS backend requires an intentional opt-in.
- Startup readiness rejects failed statuses, HTML, stalled bodies, and an unready database. Authentication database failures return 503 while invalid tokens return 401. Temporary infrastructure failure therefore does not clear a valid login.
- Vite loads environment files before building API, WS, and upload proxies. Starting services preserves existing configuration unless synchronization is explicitly enabled. Network synchronization preserves existing Pi camera tuning by default.
- Document lists return bounded metadata pages with counts and filters. Scan media, OCR and timeline are fetched through the authorized detail route when opened. The compatibility `documentService.getAll()` explicitly collects all metadata pages so existing dashboard/report totals are not silently truncated. New cover saves prefer the persisted file URL. Full report generation no longer selects unused scan bodies/history.
- Activity Logs uses server pagination/search/filtering. Full-data report callers explicitly collect all log pages; they still need later SQL filtering/aggregation work.
- Positive/negative field projection reaches SQL and preserves password exclusion. Existing-row history/counter updates in `findOneAndUpdate`, and relevant `updateOne` calls, use a transaction and row lock. `$push: { $each: ... }` appends individual history events correctly.
- Presence registration survives hub initialization. Authenticated HTTP preview uploads have a separate 30-per-second budget and validated device identifier; normal command limits remain separate.
- Document, archive, scanner, report and device-control code loads on demand, reducing the initial JavaScript bundle.

## Validation and measured limits

The native PostgreSQL dump restored into `vinzons_digipath_perf_test_20261028`. Counts matched all 12 tables, including 80 documents, 9,462 logs and 123 commands. All 64 scan files, totaling 33,004,896 bytes, matched SHA-256 checksums. Sample PDF/JPEG/PNG HTTP downloads matched the cloned files.

The private backup, configuration copies, manifests and detailed aggregate test evidence are in ignored `database-export/performance-operation-2026-10-28/`. Do not add this directory to Git. An additional backup on separate storage remains required before any future live data migration/cutover.

| Measurement | Result and interpretation |
| --- | --- |
| Original full document serialization | 34,170,244 bytes in the audit; not captured HTTP transfer timing |
| New first Admin/Mayor document page, 50 records | 56,244 HTTP response-body bytes |
| All 80 metadata records over two 50-record pages | 90,897 response-body bytes including both envelopes |
| First Admin/Mayor log page, 20 entries | 3,911 response-body bytes; total remains 9,462 |
| Four simultaneous role clients | Admin/Mayor/Receptionist/Office scope and detail checks passed against isolated local HTTP |
| Concurrent existing-row writes | All 20 writes retained; 22 events after a two-event append; counter 21 after an additional increment |
| Synthetic image registration | Inline cover replaced by stored URL; downloaded image bytes matched; exact test fixture and file removed |
| Actual Vite proxies | HTTP health/config, authenticated WS upgrade, and PDF checksum passed through port 5174 to test backend 5501 |
| Preview limiter | Actual authenticated burst accepted 30 and limited the 31st; simulated 25 FPS for one minute did not consume command quota |

These are local API/model/transport checks, not four physical devices, real internet timing, physical motor/camera tests, or public-tunnel validation. Browser automation stopped because it could not reliably verify the current Windows browser URL; authenticated screen checks remain pending. All **55 regression tests passed**, and the production build passed. The initial JavaScript entry is approximately **312 KB / 91 KB gzip**; optional feature chunks load on demand. See [aggregate verification](performance-evidence-2026-10-28/verification-summary.json) for exact artifact measurements and the change log for batch outcomes.

## Re-run isolated tests later

The restored test database and cloned uploads already exist. Do not rerun the preparation script to overwrite them; it deliberately refuses an existing test database or backup folder. It is a one-time guarded backup/restore operation.

From the project root, start the isolated backend in one terminal:

```powershell
node scripts/start-performance-test.cjs
```

It validates the exact test database/storage/port, binds only to `127.0.0.1:5501`, uses a separate device key, and forces notifications to the outbox. It does not run network synchronization or connect the physical Pi. The normal production scan directory remains the default when `UPLOADS_ROOT` is unset; the test launcher explicitly selects the cloned directory for both serving and writing.

Start the isolated frontend in a second terminal:

```powershell
$env:VITE_BACKEND_PROXY_TARGET='http://127.0.0.1:5501'
$env:VITE_API_BASE_URL='/api'
$env:VITE_WS_URL=''
npm.cmd --prefix dashboard run dev -- --host 127.0.0.1 --port 5174
```

These variables affect that terminal and its child processes; they do not edit `.env` files. Open `http://127.0.0.1:5174` on this laptop. Existing account credentials in the restored copy were not reset. Do not paste credentials or records into the log.

Run the automated checks with localhost/PostgreSQL access available:

```powershell
node --test backend/test/*.test.js dashboard/src/utils/*.test.js dashboard/src/api/*.test.mjs scripts/start-all.test.js
npm.cmd --prefix dashboard run build
node scripts/verify-performance-test.cjs
node scripts/verify-performance-proxy.cjs
```

The HTTP verification uses all four existing roles without resetting passwords. It creates disposable synthetic records only in the exact test database, validates updates/persistence, then removes only its own generated fixture IDs and cloned-storage file. The proxy test sends synthetic JPEG bytes to the isolated relay and does not command the Pi. Stop the two test processes with Ctrl+C afterward. Test processes started during implementation are stopped before handoff.

## Later physical and public-route acceptance

1. Review the local diff and complete the pending workflow/scanner batches before treating the whole operation as finished. Verify login, dashboard, document/archive detail, editing, attachment preview/download/rotation, search, pagination, totals, reports and session recovery in the actual browser.
2. Keep the laptop powered and available for the chosen operating schedule. Select and verify one public backend route from a different network. The earlier audit found unreachable/stale tunnel settings; no canonical URL or environment file has been rewritten by this implementation.
3. Prepare a controlled acceptance dataset and route for the physical Pi and four devices. The loopback test launcher is deliberately inaccessible from other devices and uses a different device key; do not simply point a real Pi at its address. Confirm the selected database/storage and avoid physical motor tests until the setup is intentionally connected.
4. Use Admin, Mayor, Receptionist and Office sessions. Repeat the operation plan's stalled-endpoint/body, device-heartbeat, simultaneous update, preview, upload/download/report, outage and reconnect scenarios on same and different internet connections. Capture actual bytes/request counts/time-to-content and p50/p95 latency. Do not log private records or tokens.
5. Prepare the matching backend/frontend release as a unit: list responses now use `{ items, total, page, limit }`, and detail carries full media/history. An old frontend and new backend are not a compatible release pair. Vercel must be built with a verified public `VITE_API_BASE_URL`; laptop-only `/api` does not provide a Vercel backend proxy.
6. After acceptance, review and authorize publication/rollout separately. Verify the running Vercel frontend, laptop backend/database, stored files, HTTP/WS endpoints, and physical Pi together. A Git push or build is not live verification.

## Still pending

- Complete cross-record workflow transactions and conflict/uniqueness guards for concurrent sends, receives and commands. Row-safe individual updates do not make a multi-record workflow atomic; `save()`/bulk-update behavior also needs the planned review.
- Idle/hidden preview demand, Pi pause/resume, and supported multi-viewer camera workload. No Pi Python/mechanism package files were changed in this batch.
- SQL dashboard/report summaries, filtered report queries, fully server-driven document-page browsing, and a reviewed dry-run/rollback procedure for legacy inline-cover normalization. Complete metadata collection is retained for compatibility and is not the final large-dataset design.
- Measured indexes/pool waits, compression, request/event-loop/bitrate metrics, report workers if justified, and supervised production startup.
- Authenticated browser screens, physical four-device acceptance, separate-storage backup before live data migration, a verified public route, and coordinated frontend/backend rollout.

## Recovery

No live business records, live environment files, deployed Vercel configuration or Pi mechanism settings were modified. Keep the backup and test environment for investigation. Revert only the relevant source batch, preserving unrelated documentation/user work. Because document/log listing contracts changed, frontend and backend rollback must also use a matching pair. Do not restore the older database dump over newer live records simply to undo a source change.
