# Vinzons DigiPath

Municipal document tracking dashboard with a React frontend, Express backend, and PostgreSQL database.

> **Full setup guide (database, ports, dev tunnel):** see [docs/SETUP_AT_DATABASE_GUIDE.md](docs/SETUP_AT_DATABASE_GUIDE.md)

> **Change recording:** read and update [CHANGELOG.md](CHANGELOG.md) for each meaningful work batch. It contains instructions, an entry template, validation/deployment status, and recovery notes. The current loading work follows the [performance and deployment plan](docs/PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md).

> **Local performance fixes and later acceptance:** see [the implementation handoff](docs/PERFORMANCE_IMPROVEMENTS_2026-10-28.md). Backend and PostgreSQL remain on the laptop. `npm start` preserves existing configuration; network synchronization now requires an explicit command or opt-in.

## Project Structure

```text
backend/    Express API and PostgreSQL (Sequelize)
dashboard/  React + Vite dashboard
database-export/  Ignored private backups/exports (never publish)
docs/       ERD, DFD, and setup guides
pi_scanner_bridge.py  Raspberry Pi physical scanner bridge
```

## Setup

Install all dependencies from the project root:

```powershell
npm.cmd run install:all
```

Or install each app separately:

```powershell
cd backend
npm install
```

Install dashboard dependencies:

```powershell
cd ../dashboard
npm install
```

Use Node.js 22.12 or newer. Create `backend/.env` from `backend/.env.example` and use privately generated credentials. The backend rejects default/short credentials in every mode. For an existing installation, see the [repair and rollout handoff](docs/SYSTEM_REPAIR_RESULTS_2026-10-29.md):

```env
DATABASE_URL=postgres://YOUR_DB_USER:YOUR_DB_PASSWORD@127.0.0.1:5432/vinzons_digipath
PORT=5000
NODE_ENV=development
JWT_SECRET=<generate-a-private-random-value-of-at-least-32-characters>
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:5173
API_BASE_URL=http://localhost:5000/api
PUBLIC_TRACKING_BASE_URL=http://localhost:5173
SENDER_NOTIFICATION_PROVIDER=outbox
DEVICE_API_KEY=<same-private-strong-key-on-backend-and-Pi>
DEVICE_HEARTBEAT_TIMEOUT_MS=30000
MAX_ATTACHMENTS_PER_DOCUMENT=8
MAX_ATTACHMENT_BYTES=10485760
```

Seed only a new, empty development/test PostgreSQL database:

```powershell
cd ../backend
npm.cmd run seed -- --apply
```

Existing installations do not need reseeding or data migration to try the loading fixes. Use the isolated test instructions in the implementation handoff before testing writes.

Run both backend and dashboard from the project root:

```powershell
npm.cmd run dev
```

Or run them separately.

Run backend:

```powershell
npm.cmd run dev
```

Run frontend in another terminal:

```powershell
cd ../dashboard
npm.cmd run dev
```

Open the dashboard URL shown by Vite, usually:

```text
http://localhost:5173/
```

## Accounts and private data

Use the account assigned by the administrator. Live credentials and predictable password recipes do not belong in this repository. Review and rotate any credentials reused from older published examples during the coordinated rollout.

Synthetic seeding is restricted to an empty, separately named `_test` PostgreSQL database with `--apply` and a private `SEED_ADMIN_PASSWORD` of at least 12 characters. It never uses the old default-password recipe. Database exports remain local under ignored `database-export/`; `dbcollections/` is no longer published or imported by the normal migration command.

## Role Model

- Admin manages offices, users, document types, device configuration, and can perform approval workflow actions.
- Mayor reviews/approves/rejects documents, routes approved documents, receives transmissions, signs/completes, archives, and views reports/logs.
- Receptionist scans or registers incoming documents, routes approved documents only from their current office, and receives transmissions sent to their office.

## Database Check

With the backend running, open:

```text
http://localhost:5000/api/status
```

The database is connected when the response says:

```json
"database": "connected"
```

## Workflow Check

Against an isolated test backend/database/storage only, test the full process from the terminal:

```powershell
cd backend
npm.cmd run smoke -- --apply
```

Expected output:

```text
Workflow smoke test passed.
```

The smoke test creates a test document, checks public tracking, routes it, receives it, processes it, archives it, checks notifications, and then cleans up its own records.

## Scanner And File Storage

- Dashboard uploads and scanner captures are saved by the backend under `backend/uploads/scans`.
- The database stores the file URL in `scannedFiles[].url`.
- Uploads are validated by the backend and limited to JPG, PNG, WebP, and PDF files.
- The dashboard now depends on the backend database only; it no longer uses mock/local fallback data for system records.
- The backend creates IDs, tracking numbers, audit logs, and document timeline entries.
- Claim slips can be printed from document details, and the tracking number can be checked on the login page without signing in.
- Sidebar notifications are stored in PostgreSQL and stay dismissed after refresh once marked read.
- Sender SMS updates are queued in PostgreSQL as an outbox; delivery remains deferred by the user for tracking numbers and document status changes.
- Office users register outgoing documents, send from current custody, confirm receipts, and track visible records. Signing/acknowledgement requires an approval role holding current custody.
- Scanner intake creates documents as `Pending Review`; Admin or Mayor users approve them before workflow routing.
- Device Management shows the scanner as connected only while API-key protected hardware heartbeats are being received through `/api/devices/*`.
- IoT/RFID hardware events are recorded through the same API-key protected device endpoints.
- The Raspberry Pi scanner bridge from branch `s` is included as `pi_scanner_bridge.py` and uses API-key protected command/upload endpoints.
- Physical scanner/device integration notes are in `docs/SCANNER_INTEGRATION.md`.
- Manual verification steps are in `docs/WORKFLOW_TEST_PLAN.md`.
- Deployment reminders are in `docs/DEPLOYMENT_CHECKLIST.md`.

## Backend Security

- Passwords are hashed before being stored in MongoDB.
- Login returns a JWT token.
- Protected API routes require the token in the `Authorization: Bearer <token>` header.
- Role checks are enforced for administrative actions such as managing users, offices, document types, and devices.
- Basic security headers, CORS restrictions, and rate limits are applied by the backend.
- Production mode refuses to start if `JWT_SECRET` or `DEVICE_API_KEY` are still using dev defaults.
- Deletes are guarded: offices, users, and document types cannot be removed while live records depend on them, and document deletes clean up related workflow records.
- Expired sessions are cleared in the dashboard and return the user to the login screen.
- Do not commit `backend/.env`, `node_modules/`, `dashboard/dist/`, or `backend/uploads/`.
