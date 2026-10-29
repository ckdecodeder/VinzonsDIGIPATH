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

Planning recorded; implementation in progress. Per-finding results, tests, commits, recovery evidence and rollout prerequisites will be recorded here and in `CHANGELOG.md` before completion.
