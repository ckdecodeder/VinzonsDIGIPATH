# Vinzons DigiPath — setup, database and network guide

Ang active system ay React/Vite dashboard, Express API, PostgreSQL, at Raspberry Pi scanner. Node.js 22.12 o mas bago ang kailangan. Ang MongoDB/Prisma references at dating password recipes ay hindi na current setup instructions.

1. Install dependencies with `npm.cmd run install:all` from the project root.
2. Create private configuration from the `.env.example` files. Use the intended PostgreSQL database and matching strong backend/Pi device keys. See [database setup](DATABASE_SETUP.md).
3. For an existing installation, preserve its records and scan storage. Do not run seed/import/reset commands. Review the [repair and rollout handoff](SYSTEM_REPAIR_RESULTS_2026-10-29.md) before restarting the repaired backend.
4. `npm.cmd run dev` runs local development; `npm.cmd start` uses the existing combined launcher. Starting does not synchronize network files unless explicitly opted in.
5. For a published frontend, configure its build-time public API destination; local `/api` only works where the API proxy exists. Verify API health and matching WebSocket/scan access through the actual public route.

## Network changes

`network.env` is a private source for `network:sync`. Review its public backend/device settings before synchronization: that command rewrites backend, frontend and Pi settings. Never use synchronization to accidentally reapply an old tunnel or device key. Camera/motor tuning remains separately preserved.

`node scripts/prepare-secure-config.cjs` prepares matching private backend/network/Pi configuration and preserves previous settings. It does not apply them or contact hardware. Coordinate the physical Pi and backend during one maintenance window; do not restart only one side with a new key.

## Testing and recovery

Use the restored `_test` database, cloned uploads and an isolated loopback API for write tests. New integration tests create disposable schemas and synthetic files. Native database and scan backups belong in ignored private storage; export data is never intended for Git. Physical scanner, native-print and four-device acceptance remain release checks.

See [the operation plan](PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md), [PostgreSQL maintenance](DATABASE_SETUP.md), and [deployment checklist](DEPLOYMENT_CHECKLIST.md) for the current commands and limits.
