// Legacy entry point now delegates to the guarded, schema-only PostgreSQL migration.
require('./migrate-pg').main().catch(() => { console.error('Use the documented PostgreSQL migration target, flags and backup.'); process.exitCode = 1; });
