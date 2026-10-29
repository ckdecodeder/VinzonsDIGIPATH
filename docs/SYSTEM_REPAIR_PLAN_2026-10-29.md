# System repair plan — 29 October 2026

Baseline: `main`, `7d0631d`. User authorized comprehensive planning, implementation, testing, and local commits. The prior audit documents are part of this work. Push, deployment, service restart, physical device commands, real SMS, and speculative changes to historical records are separate rollout/acceptance steps.

**Explicit user exception:** Defer the SMS function (A17) until after the other fixes. Do not implement/enable SMS delivery or send messages in this operation.

## Intended result

Close the reproducible source defects from the 18-finding audit, preserve scan previews and multi-office delivery, add regressions at the HTTP/database boundaries, and leave a committed, reviewable implementation with an honest record of any recovery or operational dependencies.

## Implementation batches

1. **Identity and access (A01–A06, A13–A14).** Make new model instances insert-only and identities immutable; authorize scan files without breaking browser/PDF downloads; scope Office logs and WebSocket command payloads; validate/recheck WebSocket accounts and expiry; escape print markup; constrain bridge destinations. Reject weak device configuration and provide coordinated credential preparation without restarting the running Pi/backend.
2. **Atomic workflow and storage (A01, A07–A08, A10–A12).** Commit registration and initial deliveries together; check edits/signing under document locks; create/restore archives atomically with immutable linkage; serialize scanner command admission per device; retain old scan files until successful database commit and verify global references before cleanup. Preserve camera-light and existing delivery semantics.
3. **Recovery and operations (A09, A15, A18; A17 deferred).** Produce private, read-only reconciliation evidence for absent files, timestamps, offices and queues; recover only exact, verified originals if available and safely attributable. Preserve ambiguity for review. Stop writing private exports into tracked source, preserve existing exports locally, guard seeding/imports, and correct PostgreSQL runbooks. Leave SMS unchanged under the explicit user exception. Add explicit release readiness/configuration checks and safe runtime identity.
4. **Dependencies and validation (A16).** Upgrade compatible affected packages and remove unused legacy dependencies. Inspect advisory conditions and avoid automatic major downgrades. Re-run the normal suite, new regressions, isolated PostgreSQL/HTTP tests, dashboard production build, relevant syntax checks and browser acceptance using synthetic data. Record residual advisories and external acceptance separately.
5. **Commit.** Review the complete diff and privacy boundary; stage explicit source/documentation/lockfile paths and intended export removals, verify staged content, then commit on `main`. Keep runtime, commit, remote and deployment states distinct.

## Safeguards and acceptance

- No test writes to the live database. Use disposable schemas in the restored test database and isolated scan storage.
- Never infer historical custody, receipt time, or delivery from an empty field alone. Never replace a record's only scan with an unverified alternative.
- Keep the running backend/tunnel and Pi mechanism unchanged during local implementation. Credential rotation needs backend/Pi/network-source alignment before restarting.
- Authorized roles must retain their legitimate downloads, page counts, reports, and independently confirmed multi-office receipts. Unauthorized roles must receive no file, OCR, contact or log data.
- Concurrent operations must commit one valid result or return a clear conflict. A failed database update must preserve old scans and workflow state.
- Retain private exports/recovery artifacts in ignored local storage; remove them from the next source snapshot without rewriting Git history.
- Real SMS requires a provider and explicitly approved recipient. Physical devices, native printing, production credentials and release verification cannot be established by synthetic tests.

## Status

Local planning, implementation, testing and source commit completed on 2026-10-30, Asia/Manila. Source revision: `d0291ff23133565d28283fcf1a430885fad657d9` on `main`. The final [results and handoff](SYSTEM_REPAIR_RESULTS_2026-10-29.md) map every finding to its local result and remaining requirements; [aggregate evidence](system-repair-evidence-2026-10-29/summary.json) records validation.

All 116 distinct tests passed (89 regular plus 27 separately opted-in PostgreSQL/HTTP cases), the production dashboard build passed, 95 CommonJS files parsed, and backend/dashboard dependency audits both report zero vulnerabilities. Synthetic browser checks passed for authenticated images/PDFs, expired-session denial, recovery and download integrity. No live business data or configuration changed.

Fourteen findings have source repairs implemented. A02 has startup/network guards and a private coordinated credential bundle, pending physical application. A09/A15 remain historical recovery/reconciliation: no exact originals or unambiguous replacement values verified, so none were guessed. A17 remains explicitly deferred. Private exports were preserved locally and removed from the new Git snapshot without rewriting history.

No push, deployment, user-service restart or Pi command was performed. Next: separately authorize/review the coordinated frontend/backend/Pi release, preserve/verify recovery, then perform live role, physical-device and native-print acceptance. Remaining performance phases stay pending in the operation plan.
