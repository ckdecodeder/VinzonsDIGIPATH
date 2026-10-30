# DigiPath sender SMS with httpSMS

Local replacement prepared on 30 October 2026. The user's standalone httpSMS/Android/GOMO test succeeded after correcting SIM registration. That test is separate from DigiPath integration acceptance.

Public connection checkpoint (30 October 2026): the public API connection is repaired and the matching production frontend at [Vinzons DigiPath](https://vinzons-digipath.vercel.app) is redeployed from `main` revision `40963ca`. A dedicated public tunnel was created with the user's explicit access approval; backend/network endpoint settings and Vercel's production API destination now match. Public health, API authentication, production-origin CORS, authenticated WebSocket and the published bundle destination passed verification. The production sign-in page renders without console warnings/errors. Earlier 404/pending-frontend notes below are historical. Keep the laptop backend and tunnel host running; this operation did not install service supervision or test signed-in business/physical workflows.

Activation checkpoint (30 October 2026): **SMS is enabled and running on the laptop backend.** The current local dashboard is available at [localhost:5173](http://localhost:5173). Authenticated SMS readiness is true; history is empty and no activation SMS or old queue flush occurred. A fresh native dump restored successfully with all 12 original table fingerprints matching; 70 scan files and configuration/source copies passed checksum checks. Normal startup created the new outbox and filled five pre-existing missing intake-office fields, exactly as rehearsed. The user explicitly waived the separate-storage-copy gate for this activation because the available C/D volumes share a physical disk. Private recovery stays in the ignored activation directory. The configured public tunnel returns HTTP 404 and could not be found using the saved CLI login; its address/permissions remain unchanged. Vercel was not republished. Signed-in browser workflow and external rollout acceptance remain pending.

Controlled integration checkpoint (30 October 2026): one explicitly authorized `DigiPath integration test` message passed through the current wrapped document model, transactional outbox, SMS queue/history API and real provider adapter using an isolated schema in the disposable test database. Exactly one provider POST was made; read-only reconciliation reported **Delivered**, with sent/delivered timestamps reflected in history. Private configuration and normal business queues were untouched, normal sending remains disabled, and the isolated schema was removed after retaining private recovery evidence. This verifies isolated backend-to-provider delivery. The user confirmed handset receipt. A backed-up matching rollout with running-browser acceptance remains pending; the test did not activate the normal system.

## Private configuration

Keep these settings in `backend/.env` on the backend laptop. Never use `VITE_*` variables for the API key, commit the key, or paste it into chat/screenshots.

```dotenv
SMS_ENABLED=false
HTTPSMS_API_KEY=
HTTPSMS_FROM_NUMBER=
HTTPSMS_SIM=SIM2
HTTPSMS_TIMEOUT_MS=10000
```

Fill `HTTPSMS_API_KEY` from your own [httpSMS settings](https://httpsms.com/settings). Set `HTTPSMS_FROM_NUMBER` to the actual GOMO number in `+639…` format. `HTTPSMS_SIM` must match the phone registration in httpSMS; use `SIM2` only if that is the registered working slot.

Before enabling DigiPath, open [httpSMS Settings → Phones](https://httpsms.com/settings#phones), choose **Edit** beside the sender, set **Max Send Attempts** to **1**, and select **Update Phone**. DigiPath verifies that value and the sender/SIM registration before each POST. Incorrect registration or provider retry settings produce a safe failed attempt without posting an SMS. Keep the phone online with SMS permission, cellular service and background operation allowed. The carrier allowance and hosted httpSMS quota are separate limits.

The API URL is fixed to `https://api.httpsms.com/v1`; no custom gateway URL, phone port forwarding, Twilio setting, or inbound webhook is needed. API calls leave the backend over HTTPS. Messages use fixed, short ASCII templates with a tracking number; private subjects, names, remarks, rejection explanations and internal notes are not included.

## Start and activation

1. Save the private key, actual sender number and correct SIM while leaving `SMS_ENABLED=false`.
2. Use the normal reviewed matching frontend/backend rollout. Take the required current native database backup before the first live schema rollout; this batch did not take a new live backup or run a live migration. The backend's normal schema verification adds only the new `sender_sms_outbox` model/table for this feature and its indexes/FK. Existing legacy `sender_notifications` data is not imported, altered, or flushed by the feature. Normal pre-existing startup checks still run.
3. Restart the backend using the chosen configuration. `GET /api/sms/status`, available to authenticated application roles, reports whether the feature is enabled and configured without exposing private settings. The document outbox shows paused state until ready.
4. For an agreed controlled end-to-end test, set `SMS_ENABLED=true` and restart the backend. Use a new clearly labelled test registration and a consenting recipient you control, or intentionally queue one reviewed, unexpired `Paused` row through its Requeue button. Do not use a historical recipient as an assumed test phone.
5. Confirm the recipient receives the SMS, DigiPath advances from `Queued` to `Accepted` and then `Sent`/`Delivered` as reported, and retries do not cause a second text. The API queue action returns `202 Queued`; it does not claim the phone has sent it.

Source changes do not restart a running backend or publish Vercel. Development validation used synthetic data and mocked provider delivery. The later explicitly authorized one-message integration test used the real provider as described in the checkpoint above; it did not deploy or enable the normal backend.

Enabling later **does not flush paused notifications**. Only events created while configured/enabled are automatically queued. Paused rows require an intentional Admin/Receptionist requeue, current consent and matching recipient, fewer than five attempts, and age below 24 hours. The old SMS table is never dispatched by this worker.

## Workflow and delivery behavior

- New document/scanner registration records a sender update when SMS is selected, a valid Philippine contact is present, and both `notifySender` and `senderNotificationConsent` are true.
- Approval/rejection, resubmission, routing, office receipt, signing/acknowledgement, filing/return, and archiving use fixed event templates. One multi-office routing batch produces one routing SMS; each office receipt is a separate event. Internal action notes and archive restoration/cancellation bookkeeping do not create sender texts.
- Sequelize document hooks persist outbox events in the same transaction as the mutation. A failed outbox write rolls back that document mutation. New wrapped model inserts now use transactions too, including physical scanner-style creation.
- A background worker checks every five seconds, admits at most one new send per 20 seconds across worker instances using a database lock/admission check, and sends in insertion order. Provider/network delays may make it slower. No provider request is awaited by a document HTTP action.
- Consent/contact changes cancel pending, unsubmitted rows in the same document transaction. Dispatch checks current consent/recipient under the document lock before its claim. A send already claimed is in flight; withdrawing consent cannot recall an already submitted text. New unsent messages never move silently to a replacement contact.
- `Accepted` means provider acceptance. `Sent` and `Delivered` require corresponding httpSMS states. Status reads poll approximately once per minute while the worker is available, within a 24-hour tracking window. Delivery confirmation depends on the phone/carrier reporting it.
- Definitive pre-acceptance rejections can be manually requeued after one minute, up to five attempts. Provider-accepted failures, expired messages, `Sending`, `Accepted`, `Sent`, `Delivered`, and ambiguous `Unknown` outcomes cannot be blindly resent.
- A lost response or an interrupted send becomes `Unknown`. The worker tries read-only reconciliation using the stored provider ID or an exact `request_id` match among the latest 20 messages in the sender/recipient conversation. A missing/nonunique match stays unknown and blocked. This deliberately favors avoiding duplicates over guessing that a send failed. After the tracking window, review the provider dashboard; no automatic retransmission is performed.

httpSMS's `request_id` is a correlation field, **not an idempotency guarantee**. Its service creates a new message ID for a new send call. The implementation therefore never automatically repeats an uncertain POST. A safe confirmed rejection may be intentionally retried with a new attempt reference.

## Application endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /api/sms/status` | Enabled/ready status, no key/phone contents |
| `GET /api/sender-notifications?page=1&limit=100` | Scoped paginated new outbox |
| `GET /api/documents/:id/sender-notifications?page=1&limit=100` | Authorized document-specific history |
| `POST /api/sender-notifications/:id/resend` | Admin/Receptionist only; atomically queues a safe eligible retry, no inline sending |

All require an authenticated current application role. Admin/Mayor read globally; Office/Receptionist history follows existing document visibility, with Receptionists restricted to visible incoming documents. Retry additionally checks current document visibility under its lock. Response data excludes API keys, provider bodies, request references and FCM tokens. The UI retrieves complete paginated history, shows loading/errors/paused state, and hides unsafe retries.

## If a message takes too long

First check the document's SMS history. Queued means DigiPath has not submitted it; Accepted means the provider accepted it, while the phone/network has not yet supplied a confirmed Sent/Delivered result. Do not requeue or create another message to work around an Accepted/Unknown outcome.

In the first observed normal-workflow delay on 30 October, DigiPath dispatched in 2.187 seconds, while the correlated httpSMS message remained scheduled for several minutes. The user later reported it sent after being asked to open the app/send a heartbeat; the final provider lookup was still Accepted without sent/delivered timestamps. The exact cause and recipient receipt were not independently confirmed, and no duplicate was submitted.

For the Honor phone, search Settings for **App launch**, select httpSMS, turn off **Manage automatically**, and enable **Auto-launch**, **Secondary launch** and **Run in background**. Honor also recommends locking the app card on the Recents screen so clearing background apps does not close it. These are [Honor's official background-launch recommendations](https://www.honor.com/mea/support/content/en-us00406923/); they are a troubleshooting step, not proof that background restrictions caused a particular delay. Keep the phone online and check its existing SMS/battery permissions. Opening httpSMS and keeping it visible helps distinguish a background wake-up problem from continued provider/network waiting.

## Recovery and limits

Set `SMS_ENABLED=false` and restart the backend to stop new dispatches; in-flight or provider-accepted messages may still complete. Preserve source/configuration and the new outbox during rollback. An older source revision can ignore the new table; do not drop tables or restore an old business database just to revert this feature. Native backups preserve both the new table and historical tables; the updated private JSON export includes the active new outbox but is not a substitute for native recovery.

The worker needs the laptop backend running. This batch does not add an operating-system service, incoming SMS processing, a delivery webhook, or a per-account quota dashboard. Unknown outcomes without a unique provider match need operator review; there is no exactly-once guarantee across the external SMS network. Arbitrary/manual bulk-message composition is not exposed.

## Validation evidence and API sources

[Local aggregate verification](httpsms-evidence-2026-10-30.json) records 145 distinct passing tests, the dashboard build, the separate one-message provider delivery check and the later verified local activation. Private configuration, provider-reported delivery, user-confirmed handset receipt and current authenticated local readiness are verified. External rollout and signed-in browser/physical acceptance remain pending. Prisma mirrors the Sequelize schema; its CLI is not installed and no Prisma migration/db push was run; the actual runtime schema was created by the normal Sequelize startup path.

Primary references checked during implementation:

- [Authentication and sending guide](https://docs.httpsms.com/)
- [Send request and correlation field](https://github.com/NdoleStudio/httpsms/blob/main/api/pkg/requests/message_send_request.go)
- [Provider send service](https://github.com/NdoleStudio/httpsms/blob/main/api/pkg/services/message_service.go)
- [Message states](https://github.com/NdoleStudio/httpsms/blob/main/api/pkg/entities/message.go)
- [Phone registration and maximum attempts](https://github.com/NdoleStudio/httpsms/blob/main/api/pkg/entities/phone.go)
- [Bounded conversation listing behavior](https://github.com/NdoleStudio/httpsms/blob/main/api/pkg/repositories/gorm_message_repository.go)
