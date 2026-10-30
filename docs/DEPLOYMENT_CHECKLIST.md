# Deployment and local backend rollout

The user-selected architecture remains Vercel frontend → public tunnel → laptop backend/PostgreSQL/scans. A source commit does not restart those services or deploy the Pi.

## Before restarting the repaired backend

- Use Node.js 22.12 or newer, the committed lockfiles, and `npm ci` in backend/dashboard.
- Review [repair results](SYSTEM_REPAIR_RESULTS_2026-10-29.md), including unresolved historical files/records and the explicit SMS exception.
- Prepare coordinated strong backend/Pi credentials. `node scripts/prepare-secure-config.cjs` writes a private candidate bundle with previous settings; apply matching keys and canonical endpoint configuration during a maintenance window. The repaired backend fails closed with default or short credentials.
- Keep the intended `DATABASE_URL` and persistent `UPLOADS_ROOT`. Never run seed, import, password-reset or workflow-wipe utilities on live records.
- Before a live schema/data repair, take a coordinated native PostgreSQL/scan/configuration backup, verify restoration and hashes, and retain a verified separate-storage copy. No historical data repair is authorized solely by an audit or this checklist.
- SMS delivery defaults to the outbox. To enable it, set the provider to `twilio_sendgrid` and supply `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` through protected runtime configuration. Start with one explicitly approved test phone; do not automatically flush old queued notifications. The backend validates E.164 (or Philippine `09` mobile) recipients, caps retries at five per outbox entry, and times out provider calls.

## Source and frontend checks

Run the regular suite and separately opt into PostgreSQL/HTTP integration against disposable test schemas. Build the dashboard and exercise protected images/PDFs/downloads, role scopes, session expiry/recovery, registration rollback, concurrent workflows and reports. Confirm scanner/Pi syntax and package parity without moving physical motors.

Publish the matching frontend before enforcing backend file authorization: the new frontend can read the previous static endpoint with a bearer header, while cached old clients cannot read the protected endpoint. Refresh signed-in clients after cutover. Keep both source revisions/configurations available for coordinated recovery.

## Running-system acceptance

Verify health readiness and `revision`/`startedAt`, expected API and WebSocket destinations, CORS, protected scan range/download behavior for legitimate and unrelated roles, document counts, existing scans, and new captures. Check fresh Pi heartbeat, preview, commands and reconnects after coordinated configuration/restart. Perform actual four-device, multiple-viewer and native-print acceptance separately from synthetic testing.

A Windows login shortcut requires a logged-in, powered-on laptop and is not a supervised system service. Keep the backend/tunnel available under the chosen operating arrangement; service management, off-machine recovery and later performance phases remain explicit operational work.

## Recovery

Revert the specific source commit if needed; keep frontend/backend contracts aligned. Restore prior configuration as a coordinated backend/Pi pair. Preserve newer business writes and reconcile them before changing data/storage destinations. Do not restore an older database merely to undo code. Retained superseded scans require a separate ownership-aware cleanup review; saving/removing an attachment no longer deletes its original file automatically.
