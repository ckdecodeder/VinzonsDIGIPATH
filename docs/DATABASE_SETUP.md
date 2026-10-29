# PostgreSQL setup and maintenance

DigiPath uses PostgreSQL through Sequelize. MongoDB and Prisma files are legacy/reference material, not the active database setup.

Use Node.js 22.12 or newer. Create private `backend/.env` from the example, configure `DATABASE_URL`, and generate strong JWT/device credentials. The same device key must be installed on the physical Pi. Default/short secrets are rejected in every runtime mode. Do not publish environment files or database exports.

## Existing installations

Do not reseed an existing installation. `npm --prefix backend run migrate -- --apply` is now schema-only; it never imports `dbcollections` or resets accounts. A live target additionally requires `--allow-live --backup <absolute-private-dump-path>` after a coordinated write pause and verified PostgreSQL/scan recovery. A nonempty dump path is a guard, not evidence that restoration was tested. Follow the [repair handoff](SYSTEM_REPAIR_RESULTS_2026-10-29.md) and [operation plan](PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md).

## Disposable test setup

Use a separate database whose name contains the `_test` suffix pattern, separate `UPLOADS_ROOT`, loopback-only listeners, and an outbox-only sender provider. `seed`, legacy import, workflow wipe, and test password reset refuse a live target and require `--apply`. Seeding also requires an empty test database and a private `SEED_ADMIN_PASSWORD` of at least 12 characters. Never use predictable account-derived passwords.

The automated integration suites create/drop only uniquely named schemas in the existing restored test database. Their opt-in connection string is `WORKFLOW_TEST_DATABASE_URL`; do not print or commit its value.

## Backups and exports

Use native PostgreSQL custom-format `pg_dump`, backed-up scan files with checksums, and a successful restore/count/file check. Keep a verified separate-storage copy before any live repair or cutover. The existing guarded backup script refuses an active API/other database clients to enforce a coordinated checkpoint.

`npm --prefix backend run export-db` creates a consistent, private JSON snapshot of all 12 application tables under ignored `database-export/`. It includes commands. It does not export scan files or replace the native recovery backup. The old tracked `dbcollections/*.json` snapshots remain locally preserved and ignored; normal migration no longer imports them. Never commit private export contents.

## Historical anomalies

`node scripts/reconcile-system-data.cjs` performs read-only queries and file/backup checks, then writes a private manifest under ignored storage. It applies no repair and never guesses a missing receipt time, custody office, recipient queue, or scan. Review original records and verified backups before preparing any live change manifest.
