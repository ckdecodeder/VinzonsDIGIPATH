# Vinzons DigiPath — System Changelog

This is the project record of system changes, investigations, and implementation plans. Add new entries below the instructions and template, newest first. Dates and times use **Asia/Manila (UTC+08:00)**.

## Instructions for every change

1. **Read before working.** Read the latest entries and the current [operation plan](docs/PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md). Check the actual branch, revision, and working tree; the log does not replace those checks.
2. **Record each meaningful batch.** Before application, configuration, database, service, branch, or deployment work, create an `IN_PROGRESS` entry describing the intended scope. Update it with the result before ending the task. For a read-only investigation or documentation-only task, a completed entry at the end is sufficient.
3. **Explain what changed and why.** Identify affected files/components and the user-visible behavior. Record data/configuration impact separately from source changes. Mention ignored local environment changes without copying their contents.
4. **Keep lifecycle states precise.** `PLANNED` is a proposal; `IN_PROGRESS` is unfinished work; `LOCAL` exists in the checkout; `COMMITTED` is in Git; `PUSHED` is on the named remote branch; `DEPLOYED` is running on the named target; `REVERTED` was rolled back. Record validation separately. A local test or Git push does not establish deployment.
5. **Record evidence.** List actual tests/checks and their outcomes, including failures, skipped checks, and limits. Link relevant reports and evidence. Do not describe a planned test, simulated motor movement, or source probe as a successful live-system test.
6. **Record recovery information.** For data/configuration changes, identify the backup location and whether restoration was tested. Include a specific rollback approach and any remaining risks. Never claim backups or rollback were verified unless they were.
7. **Track branches and publication.** Record the actual branch and known commit/revision. This operation is intended for `main`; respect the user's current branch instructions. Record pushes, deployments, and branch deletion independently. Do not create a branch, push, deploy, or change data merely because it appears in a log entry.
8. **Protect sensitive information.** Never log passwords, tokens, API keys, private environment contents, document bodies, or personal record details. Use aggregate counts, redacted references, and paths. Keep database/file backups and private configuration out of Git.
9. **Preserve history honestly.** Keep older entries. Add a correction or follow-up rather than silently changing an earlier outcome. Explicitly label backfilled entries and identify their evidence. Redact an exposed credential while preserving the historical action.
10. **Leave a clear handoff.** End each entry with outstanding work and the next concrete action. Update the operation plan's checkpoints when implementation actually progresses.

Historical command descriptions are **not execution instructions or current authorization**. Older planned items and previous deployment claims must be checked against current source, data, and user instructions. Do not rerun a destructive migration simply because it appears below.

## Entry template

Copy this template into the dated entries section. Fill in only verified information; use `Pending`, `Not run`, or `Not applicable` where appropriate. Record a commit hash when known; do not invent a hash or create repeated commits just to record the changelog's own commit.

```markdown
## [YYYY-MM-DD] — Short change title

- **Type / state:** FIX | FEATURE | CONFIG | MIGRATION | AUDIT | DOCS | GIT / PLANNED | IN_PROGRESS | LOCAL | COMMITTED | PUSHED | DEPLOYED | REVERTED
- **Author / time:** Codex or contributor; Asia/Manila time if known
- **Request / reason:** What requested behavior or problem this addresses
- **Branch / revision:** Actual branch; source/result commit if known
- **Changes / files:** Concrete behavior changes and affected paths
- **Data / configuration impact:** Actual changes, or none
- **Backup / recovery evidence:** Location and restore check; never include secrets
- **Validation:** Commands or checks run, outcomes, and limitations
- **Publication / deployment:** Commit/push status and exact target; distinguish repository from running services/Pi
- **Rollback:** How to reverse this batch without losing subsequent work/data
- **Outstanding / next action:** What remains and the next step
```

## [2026-10-31] — Verify phone connectivity after mobile-data comparison

- **Type / state:** AUDIT | DOCS / LOCAL; user subsequently reports localhost sending without delay; provider-message disappearance not explained.
- **Request / reason:** User switched from Wi-Fi to mobile data, reopened httpSMS and tapped heartbeat; reported the three existing texts still pending.
- **Branch / revision:** `main`, `a3902abbaf4bb04db1e15cfa0620a7cbcee6cc9e`; existing source and documentation changes remain local/uncommitted.
- **Read-only findings:** Official heartbeat GET reports a phone heartbeat at 07:30:12 Asia/Manila, with reported app version `64cc1b71`; this proves phone-to-provider HTTP connectivity, not incoming push delivery. Phones GET returns HTTP 200, matching registered sender/SIM and a nonempty push token (contents never recorded); one provider send attempt remains configured. Around 07:30-07:31, all three previously available message IDs return HTTP 404. One bounded conversation GET returns HTTP 200 with four entries and zero matches for the three exact stored request references. Existing database rows remain Accepted. Initial aggregate lookup stopped at the first 404; subsequent bounded checks captured all three without provider mutations.
- **Interpretation / limits:** Wi-Fi alone does not explain the continued result. Neither a heartbeat nor a stored token proves incoming Firebase/Android work processing. Current 404/absent references prevent confirming the messages' final outcome; do not infer deletion, delivery, expiry or an outage from 404 alone. Asked user whether they removed the conversation/messages or changed account/API credentials; answer pending. Exact root cause remains unconfirmed.
- **Data / recovery / validation:** Read-only database transactions plus official provider message/phone/heartbeat/conversation GETs; no SMS POST, retry, deletion, business/schema/configuration change, service restart, tunnel change or deployment. Redacted evidence under ignored `database-export/sms-duplicate-investigation-2026-10-30/mobile-data-*.redacted.json`. No backup required for read-only checks; existing recovery retained. No application edits or redundant test rerun.
- **User outcome / limits:** User subsequently reports that localhost is now working with no SMS delay. This is user-reported local acceptance, not a new agent-generated SMS or independently timed delivery check. The response does not establish why the earlier provider IDs disappeared; no deletion/account change or specific recovery cause is inferred. Stop additional probes while local sending is satisfactory.
- **Publication / outstanding:** Documentation local only; no commit/push. Matching source publication/Vercel rollout and online-flow verification remain pending. Existing ambiguous/accepted messages must not be blindly requeued; do not increase provider attempts to compensate for uncertain delivery.

## [2026-10-31] — Locate continued morning SMS delay after provider acceptance

- **Type / state:** AUDIT | DOCS / LOCAL; read-only timing investigation, phone-side network check pending.
- **Request / reason:** User still observes pending registration/signing/acknowledgement messages despite full cellular signal; confirmed the phone internet connection was Wi-Fi.
- **Branch / revision:** `main`, `a3902abbaf4bb04db1e15cfa0620a7cbcee6cc9e`; prior source/documentation edits remain local/uncommitted.
- **Validation / findings:** Latest three event types and provider request timestamps match the screenshot. Backend admission waits were 233, 304 and 814 ms, each with one attempt. At approximately 07:29 Asia/Manila the provider still reported all three scheduled, with null last-attempted/sent/delivered timestamps and no failure reason. Phone policy remains ten messages/minute, one attempt and 600-second expiry. Initial exact/suffix screenshot-reference queries returned no rows; latest-event timestamp correlation established the match without copying identifiers or message contents. Backend/provider clocks differ by several seconds, so no cross-clock subsecond latency claim is made.
- **Interpretation / limits:** Current waiting is after backend dispatch/provider acceptance. Official provider source defines scheduled separately from phone sending and uses a Firebase-triggered, network-constrained Android worker. Provider/Wi-Fi/push/Android processing remains the uncertain boundary; neither strong cellular bars nor a foreground app proves that path is ready. No confirmed root cause or service outage claimed. User asked to switch phone from Wi-Fi to mobile data, reopen httpSMS and tap one heartbeat while observing only existing messages; answer pending.
- **Data / configuration / recovery:** Read-only PostgreSQL transactions and official provider GETs only. No SMS POST, requeue, business/schema/configuration change, phone-setting action by agent, restart or tunnel change. Redacted private evidence retained under ignored `database-export/sms-duplicate-investigation-2026-10-30/followup-2026-10-31.redacted.json`; no new recovery backup required. Prior source/data recovery retained.
- **Publication / outstanding:** Documentation local; no commit, push or deployment. Existing source-fix test results were not rerun for this read-only diagnosis. Await Wi-Fi/mobile-data comparison, then check the same provider statuses; do not blindly resend pending/accepted messages. Existing duplicate/pacing source changes still require matching publication as previously recorded.

## [2026-10-31] — Prevent repeated registration submits and reduce avoidable SMS queue latency

- **Type / state:** FIX | AUDIT / LOCAL; scope recorded IN_PROGRESS on 30 October, completed locally on 31 October (Asia/Manila).
- **Request / reason:** User reported duplicate registration texts and slow sending, sometimes completing near acknowledgement. User confirmed the phone app was foreground and messages appeared in native Messages only later.
- **Branch / revision:** `main`, base `a3902abbaf4bb04db1e15cfa0620a7cbcee6cc9e`; existing local workflow-restoration documentation retained. No branch operation.
- **Planned scope:** Correlate existing events read-only; guard rapid registration submission, remove unnecessary queue spacing and isolate status polling. Preserve atomic claims, consent checks, no-repeat handling and truthful delivery states. No live retry, migration or manual service restart.
- **Findings:** Two distinct documents with matching subject/recipient were created 1,202 ms apart, each with one provider attempt; this was not a retry of one outbox event. Backend dispatch waits were 826 and 19,637 ms; subsequent provider-to-phone waits were roughly 59 and 41 seconds. All three observed registration/acknowledgement messages ultimately reported Delivered. Acknowledgement contains no release/retry logic for earlier SMS. Exact repeated-click origin and remaining handset/push/job delay are unproven.
- **Actual changes / files:** Added `dashboard/src/utils/submissionGate.js` and regressions; applied one synchronous per-form gate around validation, attachment conversion and saving in `DocumentList`, `ReceptionistDashboard` and `Scanner`. Document form now displays Saving and disables Save/Cancel/close while pending; other paths retain their existing busy feedback with synchronous protection. `backend/services/smsOutbox.js` now checks dispatch every second, uses a bounded configurable six-second default instead of twenty seconds, and runs delivery reads independently every five seconds with 15-second Accepted/Sent and 60-second Unknown eligibility. `httpSms.js` checks configured pacing against the registered phone rate before POST; example configuration and setup/evidence/plan updated. Atomic database admission, attempt limits and no-repeat semantics remain.
- **Data / configuration impact:** No business-record deletion/merge, live retry/resend, schema migration, private environment edit or phone/provider-policy change. No user backend/tunnel manually started/stopped/restarted; user-owned development watchers may reload edited source. Existing accepted messages are not resubmitted. Existing private backup history retained.
- **Validation:** Final guarded disposable-PostgreSQL backend/startup suite 102 passed, zero failed/skipped; frontend suite 50 passed; production dashboard build passed. Regressions cover rapid submissions before async attachment work, gate release/retry, independent forms, slow status reads alongside dispatch, concurrent single dispatch, interval boundaries and phone-rate rejection before POST. A browser double-click on the actual DocumentList form with synthetic attachment and blocked backend produced exactly one pending save, disabled Save/Cancel, and closed only after simulated completion; zero browser console errors. Initial fixture resolution failures and one source-encoding build failure were corrected before the successful checks. Receptionist/scanner were not separately exercised in-browser; live post-fix SMS timing remains unverified.
- **Backup / recovery:** Original five edited application files and hashes, private read-only diagnostic references, redacted timing/provider evidence, final test output and synthetic browser screenshot retained under ignored `database-export/sms-duplicate-investigation-2026-10-30/`. No data restore needed for this source-only change. Test-only loopback fixture stopped after verification; user services unaffected.
- **Publication / deployment:** Local/uncommitted only; no commit, push or Vercel deployment. Prior live deployment does not include these changes. No real SMS sent by this batch.
- **Rollback:** Selectively reverse this batch's source edits using the saved originals/diff while preserving unrelated changes and all outbox/business data; remove the new helper/tests only if reversing their callers too. Restore prior worker pacing if necessary; no database rollback/table drop.
- **Outstanding / next action:** Publish matching frontend under the user's normal Git/Vercel flow and reload the backend using `npm run dev:backend` with manual Public VS Code port-5000 forwarding. Verify an agreed normal registration once, without repeated saves or blind resends. Investigate remaining post-provider wait on the handset/push/job path; full signal/foreground state alone does not establish the cause. No complete latency fix or live acceptance claimed.

## [2026-10-30] — Restore the user's VS Code port-forwarding workflow

- **Type / state:** CONFIG | SERVICE | DOCS / LOCAL CONFIGURATION APPLIED | FRONTEND DEPLOYED; preferred VS Code workflow restored.
- **Request / reason:** User explicitly prefers running `npm run dev:backend`, manually forwarding port 5000 in VS Code and making it Public; requested switching back to the original VS Code address. The replacement CLI tunnel was unnecessary for this preferred workflow.
- **Branch / revision:** `main`, `a3902abbaf4bb04db1e15cfa0620a7cbcee6cc9e`; existing local handoff documentation retained.
- **Intended scope:** Back up current private endpoint configuration; restore only backend/network public endpoint fields, remove the replacement CLI tunnel binding and keep automatic CLI hosting disabled. Update Vercel's production API destination and redeploy the current matching source. Keep backend startup and VS Code forwarding under user control; do not change database, SMS/scanner credentials or Pi tuning.
- **Actual configuration / files:** Restored only backend/network public endpoint fields to the original VS Code address, removed the replacement CLI ID assignment and set automatic CLI hosting off. Verified all unrelated parsed settings, including SMS/scanner credentials, unchanged; dashboard's local proxy and Pi tuning unchanged. Added the selected manual workflow to SMS/deployment/operation guidance and aggregate evidence. No application source edit, database write, SMS, service start/stop/restart or port-visibility change by the agent. The unused CLI resource was not deleted; its configuration binding is retired.
- **Backup / recovery:** Three private configuration recovery copies checksum-verified under ignored `database-export/restore-vscode-forwarding-2026-10-30/`, with a manifest. Restored fields were applied selectively rather than copying whole historical environments. Restoration not rehearsed; prior recovery histories retained.
- **Validation / publication:** Production Vercel API variable updated through the existing authenticated browser after the user completed its authenticator check directly. Redeployed matching main revision `a3902abbaf4bb04db1e15cfa0620a7cbcee6cc9e` as `dpl_AqUdGmJnaKhQuzgZSrddVBuZrwyN`, Ready/current. Public frontend HTTP 200; downloaded production bundle embeds the original VS Code API address and no replacement CLI address. Local endpoint/automatic-hosting/preserved-settings assertions and whitespace checks passed. Three Vercel build warnings reported with a successful build; no application code change justified rerunning the prior suite. Screenshot and redacted evidence retained privately in the restoration directory. A bounded old-address API probe returned 404 before deployment; live API reachability is not claimed while the user-owned forward is stopped/private.
- **Rollback:** Restore only this batch's endpoint fields from the private recovery copy and production variable, then redeploy if required. No tunnel resource deletion, Git commit or push planned.
- **Outstanding / next action:** Requested switch-back completed. User to restart their backend to reload the restored setting, manually forward port 5000 in VS Code and select Public. No CLI hosting command is required. Verify actual API availability once that user-controlled forward is active; do not replace the chosen workflow because an inactive/private forward is unavailable. No Git commit or push performed; completion documentation remains local.

## [2026-10-30] — Clarify VS Code forwarding versus the dedicated tunnel

- **Type / state:** AUDIT | DOCS / LOCAL; manual hosting instructions clarified.
- **Request / reason:** User observed different public addresses in backend output and VS Code Ports after taking over startup.
- **Branch / revision:** `main`, `a3902abbaf4bb04db1e15cfa0620a7cbcee6cc9e`; previous documentation edits retained.
- **Validation:** Read-only parsing confirms backend and network public endpoints match the replacement used by the production frontend. The saved dedicated tunnel ID matches recovery metadata, remains readable in the signed-in CLI account and contains port 5000. User screenshot shows VS Code maintaining its separate older Private forwarding address; the environment screenshot already matches the new backend address. Backend's Public output advertises configuration and does not itself create/start a tunnel.
- **Data / configuration impact:** None; no service started/stopped, endpoint or access setting changed, SMS, database operation or deployment. No credential from the screenshots copied into output or documentation.
- **Recovery / publication:** Existing recovery retained; documentation local/uncommitted, no commit/push. No backup required for read-only clarification.
- **Outstanding / next action:** User to keep the backend running and host the saved dedicated tunnel with the CLI in another terminal. VS Code's separate Private forward is not the tunnel used by the currently deployed frontend; changing the backend's advertised URL does not control VS Code forwarding.

## [2026-10-30] — Hand tunnel hosting back to the user

- **Type / state:** SERVICE | DOCS / LOCAL; recorded agent-started tunnel host already stopped.
- **Request / reason:** User additionally requested stopping the agent-started tunnel so they can host it themselves. A subsequent problem report has no details yet; clarification requested while completing this authorized stop.
- **Branch / revision:** `main`, `a3902abbaf4bb04db1e15cfa0620a7cbcee6cc9e`; prior handoff documentation changes retained.
- **Intended scope:** Verify the recorded dedicated tunnel process executable, command identity and creation time; stop only that host process, preserving the persistent tunnel/port configuration and all backend/dashboard/database processes.
- **Backup / recovery:** No data/configuration changes planned; existing recovery retained. Restart the same saved tunnel identity to restore public forwarding.
- **Validation / outcome:** Current process inventory contains no process for the recorded agent-started tunnel PID. It was already stopped, so no process termination or other service change was performed. No claim about an independently restarted user-owned host is made.
- **Publication / deployment:** Local service handoff only; no tunnel deletion, endpoint change, commit, push or deployment.
- **Outstanding / next action:** User can restart the same saved tunnel identity using `devtunnel host` with the private recorded tunnel ID. Details of the user's subsequent problem are pending; investigate the exact error/behavior when provided. No configuration, database, SMS, Git publication or cloud deployment change in this handoff.

## [2026-10-30] — Hand backend startup back to the user

- **Type / state:** SERVICE | DOCS / LOCAL; backend stopped for user-managed startup.
- **Request / reason:** User requested termination of the agent-started backend so they can run it themselves.
- **Branch / revision:** `main`, `a3902abbaf4bb04db1e15cfa0620a7cbcee6cc9e`; clean at inspection.
- **Intended scope:** Verify the recorded backend process against its executable, creation time and port-5000 listener, stop only that backend, and confirm the port is free. Leave the dashboard, PostgreSQL and public tunnel running; no configuration edits, automatic restart, SMS or deployment.
- **Backup / recovery:** No data/configuration changes planned; existing recovery retained. User can start the backend from the project using `npm run dev:backend`.
- **Validation / outcome:** Recorded PID, Node executable/server command and port ownership matched; backend was stopped and port 5000 was confirmed free. Dashboard port 5173, PostgreSQL port 5432 and the dedicated tunnel process remained running. The additional creation-time comparison encountered PowerShell JSON date-conversion/parsing errors and did not validate the timestamp; this limitation is recorded rather than claiming that check passed. No unrelated process was stopped.
- **Publication / deployment:** Local service handoff only; no commit, push or Vercel changes.
- **Outstanding / next action:** User to run `npm run dev:backend` from the project root. Public/local API and automatic SMS dispatch are unavailable while the backend is stopped; the tunnel/database/dashboard are retained. No configuration, database, SMS, commit/push or deployment action in this handoff.

## [2026-10-30] — Restore public backend tunnel

- **Type / state:** CONFIG | SERVICE | DOCS / DEPLOYED; public backend connection restored, matching production frontend redeployed and verified.
- **Request / reason:** Continue the user's requested public connection repair. Existing configured tunnel addresses are unavailable and absent from the saved tunnel account's inventory.
- **Branch / revision:** `main`, `40963ca4fbaa42147492ece0ce7f3bd8cae4b0c3`; no branch/commit/push operation planned.
- **Intended scope:** Preserve private endpoint/configuration recovery copies, create a dedicated labelled replacement tunnel for the existing port 5000 API, verify public health and authentication, and align the necessary endpoint settings without overwriting scanner/SMS credentials. Inspect/update the matching Vercel frontend when team authorization permits. Existing unrelated tunnels remain untouched; no database migration or test SMS.
- **Explicit approval / progress:** User explicitly approved the internet-accessible port-5000 tunnel after the automatic-review rejection. A dedicated labelled tunnel was then created and hosted without changing unrelated tunnels. Its generated public health endpoint returned HTTP 200/database ready. Vercel project/settings requests still return 403 after user-reported team consent; no frontend settings/deployment change claimed.
- **Actual configuration / services:** Updated only backend public API URL and network public URL/dedicated tunnel ID, preserving every other parsed setting and leaving local dashboard/Pi configuration unchanged. Checked zero in-flight SMS claims, verified ownership of the old backend process and restarted only that process. Dedicated tunnel and matching local dashboard remain running. No database changes or additional SMS performed.
- **Verified public result:** Public health HTTP 200/database ready on revision `40963ca4fbaa42147492ece0ce7f3bd8cae4b0c3`; advertised API URL matches the new public endpoint. Unauthenticated protected SMS endpoint HTTP 401; production-origin CORS preflight HTTP 204 with matching allow-origin. The public frontend serves HTTP 200, but its published bundle still contains the old tunnel API address. Private runtime/tunnel references and redacted verification retained in the repair folder.
- **Vercel handoff:** Connector project/settings access remained 403 despite reported consent. The existing signed-in browser can access the correct project, but editing the production API variable triggered an authenticator verification gate. User was asked to complete verification directly in Vercel; no code was requested in chat, no authentication barrier bypassed and no production variable saved/redeployment performed yet.
- **Completed Vercel update:** User completed authenticator verification in their own browser tab. Updated only production `VITE_API_BASE_URL` from the previously published obsolete tunnel to the verified replacement API. Browser save confirmation observed; redeployed the current `main` source `40963ca4fbaa42147492ece0ce7f3bd8cae4b0c3` with the latest project settings. Production deployment `dpl_6jNxWXymtBKnUmKRA3RKrWXZwWUr` became Ready and current on the existing production domain. Earlier pending/auth-blocked notes above describe intermediate states and are resolved through the authenticated browser; connector access itself remains unverified.
- **Final validation:** Published production bundle now contains the repaired API destination. Public health HTTP 200 with the expected current revision, public unauthenticated protected SMS HTTP 401, authenticated SMS status HTTP 200/enabled/ready, production-origin CORS preflight HTTP 204, and authenticated public WebSocket all passed. A two-minute existing-Admin token stayed in memory and was sent only to the approved user-owned public API. Live production sign-in rendered with zero browser console warnings/errors; no sign-in password, business workflow mutation, SMS or physical-device command used for verification. Deployment Ready/source/domain screenshot retained privately as `deployment-ready.jpg` in the repair folder. Vercel reported three build warnings but a successful Ready build; warning details were not reviewed in this connection-repair scope. No new application source change or test-suite rerun.
- **Backup / recovery evidence:** Five private configuration recovery copies prepared and checksum-verified under ignored `database-export/public-tunnel-repair-2026-10-30/private-config-before-repair/`; native activation recovery retained. Public port-5000 tunnel action prepared for review; no endpoint edits applied.
- **Initial validation / approval history:** Automatic approval review initially rejected the proposed new tunnel's anonymous transport access because the public access boundary/audience had not been specifically authorized. That command did not execute. Private backups were prepared independently, then the user explicitly approved the public port-5000 audience; subsequent tunnel creation/hosting, endpoint alignment and frontend redeployment completed as recorded above. No credential or authentication-policy weakening beyond the specifically approved tunnel transport.
- **Rollback:** Restore only endpoint changes from the private recovery copies and stop the newly identified tunnel host. Preserve business data, SMS outbox and newer writes.
- **Outstanding / next action:** Public connection repair and frontend alignment complete. Keep the laptop backend and dedicated tunnel host running; their private process IDs/recovery details are retained. No new automatic startup/service supervision was installed. Full signed-in workflow, physical Pi/native printing, phone-background delivery reliability and separate-storage recovery remain separate acceptance items. This completion documentation is local/uncommitted; no additional Git commit/push was made by the agent.

## [2026-10-30] — Diagnose public tunnel configuration mismatch

- **Type / state:** AUDIT | DOCS / LOCAL; connection repair awaits Vercel team authorization.
- **Request / reason:** User requested repair of the public backend connection after pushing/syncing changes.
- **Branch / revision:** `main`, `40963ca4fbaa42147492ece0ce7f3bd8cae4b0c3`; working tree clean at inspection. User reports push/sync; no remote release verification claimed.
- **Changes / files:** Read-only tunnel/account/project inspection and this completion record. Backend and network configuration reference different public tunnel addresses; neither served a healthy API. Neither configured tunnel appears in the saved CLI account's existing-tunnel inventory. No existing unrelated tunnel selected or modified.
- **Validation:** Local API HTTP 200/database ready, still running the earlier process revision. Backend-configured public health HTTP 404; network-configured health did not respond successfully within the bounded probe. Vercel project discovery found the expected project; project/settings requests returned HTTP 403 requiring the owning team's authorization. A short-lived consent link was provided to the user; no consent token/link stored here.
- **Data / configuration impact:** No configuration edits, database writes, SMS, service restart, tunnel creation/access change, commit, push or deployment. Private read-only tunnel metadata retained under ignored `database-export/public-tunnel-repair-2026-10-30/`; no keys/environment contents copied into this log.
- **Backup / recovery evidence:** Existing activation recovery retained; no new backup needed for read-only inspection.
- **Publication / deployment:** Repair is incomplete; local services retained unchanged. Vercel team consent is pending.
- **Rollback:** Documentation correction only; no runtime change to undo.
- **Outstanding / next action:** After team access is granted, inspect the deployed frontend endpoint, restore a dedicated usable tunnel, align only the necessary endpoint settings with private recovery copies, and verify public API/WebSocket/CORS and frontend behavior. Do not run broad network synchronization that could overwrite unrelated scanner credentials/settings.

## [2026-10-30] — Review public deployment readiness

- **Type / state:** AUDIT | DOCS / LOCAL; public go-live not ready.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User asked whether the SMS feature is ready for deployment; this request authorizes assessment, not publication.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; SMS implementation still modified/untracked locally and uncommitted.
- **Changes / files:** Read-only release assessment; this record, operation checkpoint and aggregate evidence only. Private redacted runtime evidence retained under ignored `database-export/httpsms-deployment-readiness-2026-10-30/`.
- **Validation:** Current local health HTTP 200, database connected, SMS configuration ready; configured public API HTTP 404. Aggregate live outbox has two Delivered and one Accepted row; latest message independently reports Delivered with sent/delivered timestamps. No recipient, document body, reference or credential copied into the log. Earlier development evidence records 145 passing tests and a passing dashboard build; those were not rerun for this read-only assessment. Confirmed test receipt and native recovery rehearsal remain valid historical evidence, not public acceptance.
- **Data / configuration impact:** Read-only local database/health and existing-message provider GET only; no new SMS, retry, configuration change, database write, service restart or deployment.
- **Backup / recovery evidence:** Verified local activation recovery bundle retained. Separate physical storage remains outstanding; the user's waiver covered the prior activation only.
- **Publication / deployment:** No commit, push or publication performed. Local runtime is active; matching Vercel release and external signed-in workflow acceptance are unverified.
- **Rollback:** Documentation correction only; no runtime/data rollback needed.
- **Outstanding / next action:** Restore public backend reachability, prepare/publish a matching tested source revision, verify external signed-in workflow and phone-background delivery/status confirmation, and resolve the applicable recovery requirement before broader go-live.

## [2026-10-30] — Investigate delayed normal-workflow SMS

- **Type / state:** AUDIT | DOCS / LOCAL; delay isolated after DigiPath submission, user subsequently reported the message sent.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User reported slow delivery of the first normal-workflow SMS after activation.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; existing local changes retained.
- **Changes / files:** This record, [setup troubleshooting](docs/HTTPSMS_SETUP.md) and [aggregate evidence](docs/httpsms-evidence-2026-10-30.json). No application/configuration change. Private diagnostic references and redacted timing/status evidence retained under ignored `database-export/httpsms-delay-2026-10-30/`; no phone numbers, document contents, keys or raw provider bodies copied into documentation.
- **Validation:** Read-only database inspection showed exactly one attempt and 2,187 ms from outbox creation to dispatch. The correlated provider message was scheduled with no sent/delivered timestamp; sender, SIM and one-attempt registration matched. This locates the observed multi-minute wait after backend submission. After being asked to open the phone app and send a heartbeat, the user reported the message sent; this does not independently establish which action resolved the wait or confirm recipient receipt. A final read-only lookup still mapped to Accepted with no sent/delivered timestamp, so provider reporting had not confirmed completion at that check. Honor's official background-launch guidance was verified; a phone background restriction is a possible cause, not established by this investigation. Evidence JSON and whitespace checks passed; no code test rerun for read-only diagnosis/documentation.
- **Data / configuration impact:** Read-only database/provider requests only. No retry, requeue, new SMS, deletion, provider setting change, local configuration change or service restart. Normal background worker remains responsible for status reconciliation.
- **Backup / recovery evidence:** No new backup needed for read-only checks; activation recovery bundle retained unchanged.
- **Publication / deployment:** Local documentation only; no commit, push or deployment.
- **Rollback:** Documentation correction only; do not resubmit a message whose provider outcome is pending.
- **Outstanding / next action:** Provider final status/recipient receipt remain unconfirmed at the last lookup. Review Honor app-launch/background settings and observe future delivery while the app is in the background; retain the original message/reference and allow read-only reconciliation.

## [2026-10-30] — Activate the verified httpSMS feature

- **Type / state:** CONFIG | SERVICE | DOCS / LOCAL; SMS enabled and running on the laptop, authenticated API verified. Public tunnel unavailable.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User explicitly requested activation after confirming receipt of the controlled test SMS.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; existing local application changes retained.
- **Intended scope:** Inspect the stopped/running system and current schema; take fresh native database, scan, configuration and source recovery copies and verify restoration in a separate test database. Prepare activation of the existing private httpSMS configuration, start the matching local backend/dashboard as needed, and verify authenticated readiness/history and worker operation without sending another test or requeueing old rows. Respect the operation plan's backup/cutover gates. No branch change, commit or push planned.
- **Changes / files:** Changed only the private SMS enable flag in ignored `backend/.env`; started the current backend and matching local dashboard in hidden background processes. The dashboard launch uses process-only local API/WebSocket settings; frontend/private network/Pi files are unchanged. Normal server startup starts the configured SMS worker after the listener binds. Updated SMS setup/evidence and operation/deployment checkpoints; no application source edit in this activation batch.
- **Data / configuration impact:** Created the separate live `sender_sms_outbox` table and its indexes/FK. Normal existing startup filled five missing incoming-document intake-office values from their origin offices, exactly as rehearsed; all other document fields and existing tables matched the before-state. The new outbox remained empty with zero delivery attempts. No historical SMS import, manual requeue, extra test SMS, device command, seed or data reset. No business records were created by verification.
- **Backup / recovery evidence:** Fresh private bundle retained under ignored `database-export/httpsms-activation-2026-10-30/20261030T070143Z/`: native dump, all 70 scans, five configuration files, 364 source files, manifests, prior settings, activation candidate and runtime evidence. Native restore into a new separately named test database passed; all 12 original table counts/full-row fingerprints matched, and copied scans/configuration/source hashes matched. The restored startup rehearsal created only the new table and five expected backfills; all other fields/tables stayed unchanged. Main source data/files were checked unchanged immediately before live startup. Restored test copy retained with SMS disabled and no real provider key. Separate physical storage is not available or claimed.
- **Explicit rollout exception:** After the fresh native restore, full-table fingerprint comparison, 70 scan checksums and successful startup rehearsal, the user explicitly authorized proceeding with the verified local backup for this activation, waiving the plan's separate-storage-copy gate for this batch only. No separate physical/off-machine backup is claimed.
- **Validation:** Local backend HTTP 200, database ready, revision `16b489671e3a8204a38cba25cefa976082a965fe`, started `2026-10-30T07:08:31.653Z` (15:08:31 Asia/Manila); source includes retained uncommitted changes. Authenticated SMS status HTTP 200 with enabled/ready true, unauthenticated status HTTP 401, history HTTP 200 with zero rows. A two-minute existing-Admin verification token stayed in memory and was used only for read-only local requests. Dashboard HTTP 200; its proxy returned the same backend start time and authenticated SMS readiness. Browser sign-in page rendered with zero console warnings/errors; signed-in document workflow acceptance was not performed. Existing-table fingerprints and zero outbox attempts confirmed no activation/verification SMS. Prior 145 automated tests and user-confirmed real delivery remain separate; application source unchanged, so no full suite rerun. JSON and Git whitespace checks passed.
- **Publication / deployment:** Backend and matching dashboard started locally on ports 5000/5173; private activation persisted. No commit, push, Vercel publication, Pi deployment or autostart/service installation. Existing configured public API returned HTTP 404; read-only CLI inspection could not locate that configured tunnel under the saved login. No new tunnel, endpoint change, access-policy change or token/configuration synchronization performed.
- **Rollback:** Restore only the prior SMS enable flag and restart the identified backend; preserve the new outbox and all newer business writes. Do not restore an older business database merely to disable SMS.
- **Outstanding / next action:** Local SMS activation complete; use the running local dashboard for new consented workflow events. Restore the existing public tunnel under its owning account and publish/verify the matching Vercel frontend as a separate external rollout. Signed-in browser/physical Pi acceptance and a separate-storage backup remain open; the storage waiver applies only to this activation.

## [2026-10-30] — Confirm test SMS handset receipt

- **Type / state:** DOCS / LOCAL; recipient receipt confirmed by the user.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User answered “Yes, received it” for the single controlled integration test message.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; existing local changes retained.
- **Changes / files:** Updated aggregate SMS evidence, setup guidance and operation/deployment checkpoints to record user-confirmed handset receipt. This follow-up resolves the pending recipient confirmation in the earlier test entry; its historical result is retained.
- **Data / configuration impact:** Documentation only; no SMS, provider request, database operation, configuration change or service restart. Normal sending remains disabled.
- **Backup / recovery evidence:** Not applicable to this documentation-only follow-up; prior private test recovery evidence retained.
- **Validation:** Aggregate evidence JSON parses and records confirmed handset receipt; pending items retain matching rollout/activation and running-browser acceptance. Git whitespace check passed. No application tests needed for recording user confirmation.
- **Publication / deployment:** Local and uncommitted; no push or deployment.
- **Rollback:** Revert only this receipt-confirmation documentation if a correction is needed.
- **Outstanding / next action:** The controlled backend-to-phone test is confirmed. A current backup, matching rollout, normal activation and running-browser acceptance remain pending.

## [2026-10-30] — Controlled DigiPath SMS integration test

- **Type / state:** AUDIT | SERVICE | DOCS / LOCAL; single-message integration test completed, provider reports delivery.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User authorized a controlled integration test and supplied the agreed recipient for exactly one message containing `DigiPath integration test`.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; existing local changes retained.
- **Intended scope:** Exercise the current document/outbox model, scoped SMS API, real provider adapter and delivery reconciliation using one synthetic document in a uniquely named schema in the existing disposable test database. Queue and dispatch only its single notification; guard the provider POST against any repeat. Keep the main backend disabled, existing business queues untouched and private settings unchanged. Record only aggregate results.
- **Changes / files:** Ignored one-shot harness plus this record, [setup](docs/HTTPSMS_SETUP.md), deployment/operation checkpoints and [aggregate evidence](docs/httpsms-evidence-2026-10-30.json). No application source change in this test batch. The harness used the current wrapped document model, transactional event hook, actual SMS API router, outbox dispatch and provider adapter. Loopback API authentication was an isolated synthetic Admin fixture; this does not establish live login/browser acceptance.
- **Data / configuration impact:** Exactly one synthetic document and notification created in a new isolated test schema, one real authorized provider send request, then read-only reconciliation of that message. The main database and historical queues were not accessed; private settings remained byte-for-byte unchanged and normal sending remained disabled. No business migration, normal server restart, activation or bulk dispatch.
- **Backup / recovery evidence:** No live backup required because this test did not modify live data/configuration. Private control/recovery references, a final outbox copy and redacted evidence are retained under ignored `database-export/httpsms-controlled-test-2026-10-30/20261030T065050Z/`. After the terminal delivery result, the harness validated and removed only its exact isolated schema. No restoration was needed or rehearsed.
- **Validation:** Wrapped creation atomically produced one Paused outbox row; intentional API queueing returned HTTP 202 Queued; the normal adapter verified sender/SIM and one-attempt policy and made exactly one POST containing only the agreed test message. Result advanced from Accepted to Delivered through a read-only provider lookup; sent/delivered timestamps were recorded and document-specific history matched the database. One delivery attempt, one provider POST, no retry or broad worker start. Persistent exclusive-create POST guard prevents rerun. Private harness syntax and Git whitespace checks passed. Prior 145 automated tests remain separate; no application code changed to justify a full rerun. Recipient handset confirmation remains separate from the provider's Delivered report.
- **Publication / deployment:** Local isolated integration test only; no commit, push, frontend publication or normal backend deployment/restart.
- **Rollback:** Test process stopped and synthetic schema removed after recording the final outcome. Private recovery evidence retained; do not rerun a send. The delivered SMS/provider record cannot be recalled by a local rollback.
- **Outstanding / next action:** Recipient handset confirmation is pending. Normal activation, a current backup before matching backend/frontend rollout, and running-system browser acceptance remain separate next steps; existing queues have not been dispatched.

## [2026-10-30] — Verify httpSMS authentication and registered sender read-only

- **Type / state:** AUDIT | DOCS / LOCAL; provider configuration verified, sending remains disabled.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User explicitly approved using the saved private key for one read-only request to the official httpSMS phones endpoint after the earlier automatic-approval rejection.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; existing local implementation changes retained.
- **Changes / files:** This completion record and current operation checkpoint only. Private environment file unchanged; no key, phone number, provider response body or FCM value copied into output or documentation.
- **Validation:** One authenticated HTTPS GET to the exact approved official phones endpoint succeeded. Provider accepted the key; exactly one registration matched the configured sender; registered SIM matched the selected SIM; maximum send attempts matched the required one-attempt policy. The private file's before/after bytes matched. Sending remains disabled. This resolves authentication/registration uncertainty from the preceding local-format check; it does not establish phone availability or DigiPath SMS delivery.
- **Data / configuration impact:** Read-only provider metadata request only; no provider-setting change, SMS, database action, local environment edit or service restart.
- **Backup / recovery evidence:** No new backup required for this read-only check; prior private recovery copies retained. No restoration claimed.
- **Publication / deployment:** Local documentation only; no commit, push or deployment.
- **Rollback:** Documentation correction only; no data/configuration rollback needed.
- **Outstanding / next action:** Reviewed matching rollout with the required current backup and a controlled DigiPath-to-phone test remain pending. The explicit permission covered the read-only verification, not activation, sends or provider changes.

## [2026-10-30] — Verify saved private httpSMS field format

- **Type / state:** AUDIT | DOCS / LOCAL; local validation complete, provider authentication unverified.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User asked whether their private API-key and sender configuration had been entered correctly.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; existing local implementation retained.
- **Changes / files:** Read-only parsing and validation of ignored `backend/.env`; this record only. No private values copied into output or documentation.
- **Validation:** All required fields are present and unique; key is populated, not an obvious placeholder, and header/whitespace-safe; sender format is canonical Philippine international form; selected SIM and timeout meet the current adapter configuration requirements. Sending remains disabled. A proposed read-only authentication/phone-registration request was rejected before execution by automatic approval review because external use of the private credential requires explicit permission. No provider response or credential validity claimed; the configured number's ownership/registration is not established by syntax validation.
- **Data / configuration impact:** None; no environment edit, provider/network call, SMS, database operation or service restart.
- **Backup / recovery evidence:** No new backup required for this read-only check; prior private recovery copies retained.
- **Publication / deployment:** Documentation local and uncommitted; no push/deployment.
- **Rollback:** Documentation correction only; no configuration/data rollback needed.
- **Outstanding / next action:** Obtain explicit permission before using the saved key for one read-only official httpSMS phones request. Sender/SIM registration, provider retry policy and controlled DigiPath delivery acceptance remain unverified in this check.

## [2026-10-30] — Add missing private httpSMS configuration fields

- **Type / state:** CONFIG | DOCS / LOCAL; fields added and verified.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User could not find the API-key field in the actual backend environment file; the new fields had been added to the example and guide only.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; existing local implementation retained.
- **Intended scope:** Add a clearly labelled httpSMS section with only missing fields to ignored `backend/.env`, using empty credential/sender placeholders and a disabled default. Preserve all existing bytes/parsed settings and do not display private values.
- **Changes / files:** Appended a labelled httpSMS section with five previously missing fields to ignored `backend/.env`; API-key entry is on line 41. Credential and sender fields are empty, and sending remains disabled. No application source change.
- **Data / configuration impact:** Private local field scaffolding only; no API key supplied, activation, database operation, service restart, provider request or SMS. Existing configuration bytes/values preserved; none copied into this log.
- **Backup / recovery evidence:** Prior private bytes and SHA-256 manifest retained under ignored `database-export/httpsms-env-fields-2026-10-30/1793342247950/`. Recovery copy checksum matched; restoration not rehearsed.
- **Validation:** Confirmed all five fields parse, each new assignment occurs once, all prior bytes remain an unchanged prefix and prior parsed settings match, saved bytes match the prepared result, and private/recovery paths are ignored. No application suite rerun for adding inactive fields; previous source test results remain separate.
- **Publication / deployment:** Private/local only; no commit, push or deployment.
- **Rollback:** Remove only the new section/fields using the private manifest if needed; preserve later private edits.
- **Outstanding / next action:** User to enter the API key and registered sender number privately, retaining the disabled setting until controlled integration setup; no key should be pasted into chat.

## [2026-10-30] — Remove obsolete sender-provider environment settings

- **Type / state:** CONFIG | DOCS / LOCAL; cleanup and validation complete.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User identified the former sender-provider block in the private backend environment file and requested its removal.
- **Branch / revision:** `main`, `16b489671e3a8204a38cba25cefa976082a965fe`; existing local httpSMS implementation changes retained.
- **Intended scope:** Remove only obsolete sender-provider/Twilio/SendGrid/Resend/email-from/webhook settings and their former heading from ignored `backend/.env`. Preserve the new httpSMS fields and every unrelated setting byte-for-byte. Do not copy environment values into this log or tool output.
- **Changes / files:** Removed the ten obsolete sender-provider/Twilio/SendGrid/Resend/email-from/webhook assignments and the former sender-notifications heading from ignored `backend/.env`. New httpSMS fields and every unrelated line/parsed setting were preserved; no application source change in this cleanup.
- **Data / configuration impact:** Private local configuration cleanup only; no activation, database operation, service restart, provider request or SMS. No environment values recorded here.
- **Backup / recovery evidence:** Previous private bytes and checksum manifest retained under ignored `database-export/sender-env-cleanup-2026-10-30/1793342114975/`. Copy SHA-256 matched the original before editing; restoration not rehearsed. Keep the private copy out of Git.
- **Validation:** Backend/scripts have no references to the obsolete names. Confirmed all obsolete assignments are gone, new httpSMS/unrelated parsed values and untouched lines are preserved, saved bytes match the prepared result, and both private file/recovery paths are ignored. No application suite rerun for removal of unused settings; the preceding 145-test source validation remains separate.
- **Publication / deployment:** Local/private change only; no commit, push or deployment.
- **Rollback:** Restore only the deleted settings from the private recovery copy if required; preserve any later private configuration edits.
- **Outstanding / next action:** Private httpSMS setup and controlled integration acceptance remain separate; no additional legacy-provider settings are needed.

## [2026-10-30] — Rebuild sender SMS with httpSMS

- **Type / state:** FEATURE | FIX | CONFIG | DOCS / LOCAL; implementation and automated validation complete, uncommitted.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User authorized rebuilding after confirming a successful httpSMS Android/GOMO test and correcting the SIM registration.
- **Branch / revision:** `main`, starting `16b489671e3a8204a38cba25cefa976082a965fe`; clean and aligned with local `origin/main` at start. Earlier reset is now committed; its original lifecycle entry remains historical.
- **Intended scope:** A new, separate PostgreSQL SMS outbox written atomically with document workflow changes; disabled-by-default httpSMS adapter and paced background worker; truthful provider states, bounded requests, current-consent/recipient checks, atomic attempt limits, unknown-outcome reconciliation without blind retransmission; scoped/paginated APIs and document-specific history integrated with preserved frontend. Add synthetic and disposable database/HTTP regressions and setup guidance. Existing historical sender tables are not reused or flushed.
- **Changes / files:** Added `backend/utils/sms.js`, `services/httpSms.js`, `services/smsOutbox.js` and `routes/sms.js`; a separate indexed `sender_sms_outbox` Sequelize/Prisma model; transactional document hooks and transactional new wrapped inserts. Provider validation verifies the sender/SIM and one-attempt phone policy; response/body deadlines, privacy-safe errors, one in-flight claim per row, five-attempt manual cap, paced dispatch, unknown-outcome reconciliation and distinct Accepted/Sent/Delivered states are covered. Preserved SMS UI/forms, reconnected its API adapter, added document-specific history and errors/paused/safe-retry controls, and corrected the queue toast and phone-format hint. Updated private configuration examples, JSON export table list, README/deployment/performance guidance and [setup](docs/HTTPSMS_SETUP.md); added unit and disposable PostgreSQL/HTTP regressions. [Aggregate verification](docs/httpsms-evidence-2026-10-30.json).
- **Data / configuration impact:** Source/schema definitions/examples only; tests created/dropped disposable restored-test schemas and synthetic files. No live backend restart, real SMS/provider call, business-record rewrite, private environment edit/key collection, automatic historical send, push or deployment. A redacted file-only readiness check found private activation still pending; no values recorded. The first authorized live startup will create the new table and run existing startup checks; a current native backup remains required first. Historical sender tables/rows are not reused or flushed.
- **Backup / recovery evidence:** Clean source revision is the rollback baseline. Do not run a live schema/data migration; preserve historical SMS tables and records. No new live database backup/restore claimed.
- **Validation:** All 145 distinct automated tests passed: final complete backend/startup run 98 passed, 0 failed, 0 skipped (47 regular backend, 45 PostgreSQL/HTTP, 6 startup); frontend 47 passed. Dashboard production build passed; 100 backend/startup CommonJS files parsed; diff whitespace check passed. Provider tests use mocked fetch; database/HTTP tests use disposable schemas in the guarded restored test database and temporary synthetic fixtures with teardown. Two initial integration fixtures omitted required subjects; fixed fixtures and reran successfully. Existing pg concurrent-client-query deprecation warning remains nonblocking. React review covered primitive effect dependencies, cancellation, parallel reads and loading/error/retry accessibility. No rendered-browser or DigiPath-to-real-phone acceptance performed. Prisma CLI unavailable; mirror updated, no Prisma migration/db push run.
- **Publication / deployment:** Local implementation only; no commit, push, or deployment requested.
- **Rollback:** Revert the focused source batch while keeping sending disabled; retain data and historical tables. Never restore an old business database solely to undo this feature.
- **Outstanding / next action:** Add private httpSMS key/sender/SIM settings, configure the provider phone's maximum attempts to one, then review matching rollout and perform one controlled DigiPath-to-phone acceptance. Sending stays paused until configured/enabled. User's standalone phone test is not evidence of DigiPath delivery. Do not send old queued messages automatically.

## [2026-10-30] — Remove SMS backend and preserve frontend for rebuilding

- **Type / state:** FIX | CONFIG | DOCS / LOCAL; removal and validation complete, uncommitted.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User requested removing the SMS backend to start again while preserving the SMS frontend.
- **Branch / revision:** `main`, starting `990a423bb66d2e454e9c88183ee8dfa5551ee0de`; existing Android implementation and audit working changes present. No new branch.
- **Intended scope:** Remove SMS provider/template/queue/retry implementation, workflow hooks, sender-outbox API routes/model/schema maintenance, obsolete SMS tests and setup settings. Preserve normal in-app notifications and frontend SMS components/forms/styles. Retain document contact/preferences as passive metadata for the preserved frontend; disconnect its SMS service from removed endpoints with explicit unavailable-send behavior. Preserve existing database records/tables and private environment files; no live data/schema reset.
- **Changes / files:** Deleted the sender notification utility, legacy model and provider tests; removed all workflow SMS hooks, outbox/resend API routes, Sequelize/Prisma sender model and startup schema maintenance, sender import/export/wipe support and provider settings from examples/test helpers. Ordinary in-app notifications remain. Preserved document contact/preferences as passive metadata; only the existing frontend API adapter changed: empty SMS history locally and an explicit unavailable error for sending. Added focused router/model/frontend regressions, updated README/deployment/current checkpoints, and marked the earlier SMS audit/probes as historical. [Aggregate evidence](docs/sms-backend-reset-evidence-2026-10-30.json).
- **Data / configuration impact:** No live business records, historical SMS rows/tables, private environment files or running services changed. PostgreSQL/HTTP tests created and removed disposable schemas/synthetic files in the restored test database only. No real SMS or gateway call. Existing private provider settings are now unused by this source; no live database migration/drop, import/export or workflow wipe was run.
- **Backup / recovery evidence:** Preserved 26 affected source files under ignored `database-export/sms-backend-reset-2026-10-30/1793331650893/`, with matching SHA-256 copies and a manifest. Frontend before-hashes cover 81 existing files; only `dashboard/src/api/documentService.js` changed, with components/forms/styles intact. Source restoration was not rehearsed; this is not a database backup.
- **Validation:** Backend: 39 passed, 0 failed, 27 opt-in checks initially skipped. Dashboard: 47 passed, 0 failed. All 27 opt-in PostgreSQL/HTTP checks then passed separately against disposable restored-test schemas; startup suite: 6 passed. Total 119 distinct passing tests. Production dashboard build passed; 94 backend/startup CommonJS files parsed; whitespace diff check passed. Two sandbox startup-readiness attempts failed because localhost fixture access returned EACCES; the unchanged suite passed outside the sandbox. A nonblocking pg concurrent-client-query deprecation warning appeared during integration. No live browser/phone/Pi acceptance claimed.
- **Publication / deployment:** Local work only; no commit, push, or deployment requested or performed.
- **Rollback:** Restore only the affected pre-removal source from the checksum manifest and remove the newly added reset tests/evidence if reverting the batch; preserve later/unrelated changes. No business database/configuration rollback is needed.
- **Outstanding / next action:** Replacement SMS backend remains future work. No source publication or restart was performed; an already running older backend is not changed by editing this checkout. Publish/restart matching frontend/backend separately when requested.

## [2026-10-30] — SMS feature audit and synthetic reproductions

- **Type / state:** AUDIT | DOCS / LOCAL; audit complete, repairs remain proposed.
- **Author / time:** Codex; 2026-10-30, Asia/Manila.
- **Request / reason:** User requested an audit of the system SMS feature.
- **Branch / revision:** `main`, `990a423bb66d2e454e9c88183ee8dfa5551ee0de`; eight existing modified files, including the uncommitted Android gateway implementation, were present at start and preserved. No branch change.
- **Changes / files:** Added `docs/SMS_AUDIT_2026-10-30.md` and synthetic probe source/output under `docs/sms-audit-evidence-2026-10-30/`. Identified eight findings: premature Sent status, ambiguous-send duplication/stuck claims, retry consent/stale-recipient bypass, non-transactional lost notifications, synchronous multi-office gateway waits, non-atomic retry cap, truncated dashboard history, and intake/provider number-validation mismatch. Four P1 and four P2; no application repair in this batch.
- **Data / configuration impact:** None. Configuration readiness inspected through a redacted file-only check; no environment contents or private records recorded. No real SMS, phone/gateway request, business database access/write, service restart, or live configuration change.
- **Backup / recovery evidence:** Not applicable for documentation and in-memory synthetic probes; no backup created or restoration claimed.
- **Validation:** Existing focused SMS tests: 7 passed. Full backend suite: 44 passed, 0 failed, 27 opt-in PostgreSQL/HTTP cases skipped. Eight added probes passed by reproducing current defects/observations using mocked storage/provider/authorization; passing probes do not mean repairs are complete. Whitespace diff check passed. Official gateway API/status guidance consulted. No real phone, carrier, SQL SMS-claim race, or production browser acceptance performed.
- **Publication / deployment:** Audit artifacts remain local and uncommitted; pre-existing source changes remain separate. No commit, push, deployment, or running-service readiness claim.
- **Rollback:** Remove this audit report/evidence and this entry if needed, preserving the prior local Android implementation/docs. No database/configuration rollback needed.
- **Outstanding / next action:** Keep delivery in outbox. Implement the proposed transactional outbox/delivery lifecycle/consent/retry repairs, then validate with disposable PostgreSQL/HTTP scenarios and separately authorized controlled phone acceptance. See the audit report for concrete repair order and limits.

## [2026-10-30] — Local Android SIM SMS gateway

- **Type / state:** FEATURE | FIX | DOCS / LOCAL; implementation and local tests complete, uncommitted.
- **Author / time:** Codex; Asia/Manila date.
- **Request / reason:** User selected sending through an always-on Android phone and its Philippine SIM/text promo instead of Twilio.
- **Branch / revision:** `main`, starting `990a423`; checkout clean and aligned with `origin/main` before this entry.
- **Intended scope:** Replace the Twilio SMS path with a local Android SMS Gateway API adapter. Configure a private LAN endpoint and credentials; retain default outbox, protected manual retries and the retry limit. Update SMS setup docs and tests with mocked provider requests only.
- **Changes / files:** Replaced Twilio SMS sending with an authenticated request to the SMS Gateway for Android Local Server API. The endpoint must be a private IPv4 LAN URL, redirects are rejected, and response bodies are not read or persisted. Recipients are limited to Philippine mobile numbers. Preserved the URL-free message, outbox default, atomic send claim and five-attempt manual retry limit. Updated environment example, retry response, deployment checklist, performance checkpoint and repair handoff. Tests mock the local gateway.
- **Data / configuration impact:** No live phone, SIM, backend environment, database, historical outbox row, or recipient data will be changed. No real SMS.
- **Backup / recovery evidence:** Source can be reverted as a focused batch; no data backup required.
- **Validation:** Focused SMS tests: 7 passed. First focused run found a private-IP validator bug (2 failed); corrected it and reran successfully. Full backend suite: 44 passed, 0 failed, 27 opt-in PostgreSQL/HTTP cases skipped. `git diff --check` passed. All gateway requests in tests used a stubbed `fetch`; no phone, network gateway, credentials or SMS were used. Android/network acceptance is pending.
- **Publication / deployment:** Source/docs/tests are local and uncommitted on `main`; user authorized implementation/tests only. No push, deployment, SMS provider call, device setup, service restart or live config change.
- **Rollback:** Revert the focused source/docs batch; keep SMS in outbox mode.
- **Outstanding / next action:** Confirm whether phone and backend laptop share a trusted Wi-Fi/LAN. Install and configure the Android gateway only after that; verify carrier terms and promo coverage. Keep outbox mode until a separately approved live test. No old queued notifications are automatically sent.

## [2026-10-30] — Multiple-office document detail layout

- **Type / state:** FIX / LOCAL; implementation and validation complete, included in the local UI commit containing this entry.
- **Request / reason:** User screenshot shows a long destination badge escaping the modal, a squeezed workflow heading, crowded delivery rows, and duplicate sender contact.
- **Branch / revision:** `main`, `73753da`; existing local startup-recovery documentation retained.
- **Intended scope:** Keep workflow summaries concise, allow location text to wrap without shrinking the heading, improve delivery/date and detail-row sizing, remove duplicate contact, and verify synthetic multi-office layouts across screen widths. No business data, backend, credential, Pi, SMS or deployment change.
- **Actual changes:** Workflow/detail location text summarizes multiple pending offices while the delivery card retains every recipient/status. Banner wraps with a stable heading; location icons do not shrink. Detail columns wrap long office names; delivery custody labels and received timestamps use separate lines. Removed the duplicate Sender Contact row. Extended the development-only delivery harness with seven synthetic destinations, six pending and one received; no real record copied into the fixture.
- **Validation:** All 46 frontend tests passed; production dashboard build passed. Synthetic browser verified modal/banner/card overflow absent at widths 390, 768, 1024 and 1280, all seven recipients and the received timestamp retained, no browser warnings/errors. Desktop proof saved in ignored `database-export/ui-layout-2026-10-30/after.jpg`. The sandbox-only preview could not be reached initially; rerunning the loopback fixture outside the sandbox resolved that check. Temporary preview server/tab stopped after validation; existing user services were not restarted.
- **Publication / recovery / outstanding:** Source and documentation are local on `main`; no push or deployment. Includes previously local startup-recovery documentation; private configurations remain ignored. Revert the focused UI change if needed; no database/file rollback required. Verify the actual record after the next frontend publication; physical Pi pairing and SMS remain separate pending work.

## [2026-10-30] — Scanner credential startup recovery

- **Type / state:** CONFIG | SERVICE / LOCAL; startup recovery validated.
- **Request / reason:** After syncing and stopping services, user reported backend startup blocked by the old weak device credential.
- **Branch / revision:** `main`, `73753da77189bfdb9834fe9a586975ca43ce6418`; checkout initially clean and aligned with local `origin/main`.
- **Intended scope:** Preserve current private configuration, apply only a coordinated strong scanner credential to local backend/network/Pi configuration copies, validate runtime and local readiness. Preserve existing database, URLs, JWT secret and device tuning. Physical Pi configuration/reconnect requires its actual update method; no hardware command or SMS.
- **Actual changes:** Applied the previously prepared strong scanner key to five ignored local files: `backend/.env`, `network.env`, `pi_ws_scanner.env`, `bridge.env`, and `raspberry_pi/.env`. All other parsed settings, including existing JWT secret, endpoints, database and device tuning, were preserved. No application source change or weakened startup guard.
- **Recovery evidence:** Previous bytes and before/after checksum manifest retained under ignored `database-export/credential-startup-recovery-2026-10-29T16-43-08-957Z/`. Configuration recovery evidence only, not a database backup; physical Pi not modified. Old weak values will still be rejected by the guard and should not be reused for normal startup.
- **Validation:** All five local copies match the strong credential; runtime validation passed. Briefly started the current backend bound to loopback port 5000: `/api/status` returned HTTP 200, ready=true, database=connected, revision `73753da`. Normal startup schema checks ran; no business-record mutation or hardware command was issued by verification. Stopped only that temporary backend afterward so the user can start it in their terminal.
- **Publication / outstanding:** User reported syncing and a Vercel build; local checkout aligns with local `origin/main` at `73753da`. No push or frontend deployment performed/independently verified in this recovery. User says physical Pi is not connected yet; copy matching private key settings to its actual runtime when connected, then verify heartbeat/scanning. User can now rerun backend start and restore port forwarding. SMS remains outbox-only. This log update is local.

## [2026-10-30] — Audit remediation: plan, implementation, tests and commits

- **Type / state:** FIX | CONFIG | DOCS | GIT / COMMITTED source; implementation and local validation complete. Final verification/handoff documentation accompanies this entry.
- **Author / time:** Codex; began 2026-10-29, local implementation verified 2026-10-30, Asia/Manila.
- **Request / reason:** User authorized comprehensive planning, execution, testing and commit of the audit repairs.
- **Branch / revision:** `main`, starting `7d0631dc534fbac9a58e9c85ade12ea731055727`; verified source committed as `d0291ff23133565d28283fcf1a430885fad657d9`. Prior audit report/evidence and changelog retained; no branch change.
- **Intended scope:** Follow `docs/SYSTEM_REPAIR_PLAN_2026-10-29.md`: insert-only creation and immutable identities; file/log/WebSocket authorization and session checks; safe print HTML/bridge targets/device configuration; transactional registration/edit/sign/archive/command admission and recoverable scan cleanup; guarded recovery/export/seed/import operations; compatible dependency remediation; focused regressions, isolated database/HTTP/browser/build checks; explicit local commit after review. SMS excluded by the user's later explicit exception below.
- **Data / configuration impact:** Planned tests use synthetic data and disposable schemas/storage. Live reconciliation begins read-only; no guessed historical repairs. Preserve existing private exports outside future Git snapshots. No production restart, Pi command, real SMS, push or deployment authorized by this entry.
- **Backup / recovery evidence:** Existing recovery artifacts retained; private export originals/copies checksum-matched and retained. No exact missing-file recovery candidate verified, and no new native live backup/restore/separate-storage check completed in this source repair. Source changes can be reverted by focused commit; preserve business records and files. See the recovery/configuration evidence below.
- **Actual changes / files:** Insert-only model creation, server document IDs, immutable identity, shared transaction context, atomic initial deliveries, locked state/custody checks, archive create/restore and device command admission/cancellation, terminal-command replay protection, and transactional document deletion. Protected file serving now checks owning-document permissions; image/PDF/download clients send scoped bearer headers and clean up previews. Office logs are scoped; WebSocket accounts/expiry/roles and command recipients are checked, with no full-document broadcast. Print markup is escaped; bridge requests require registered numeric LAN targets, reject redirects, and include response-body deadlines. Old scan files are retained rather than deleted on saves. Runtime requires strong credentials in every mode and advertises revision/start time. Added guarded PostgreSQL maintenance/reconciliation/configuration tools; removed predictable password recipes and future Git tracking of 11 private export files while preserving their local bytes/copies. Backend and dashboard dependencies/lockfiles updated; no automated major Sequelize downgrade. Updated runbooks and added synthetic/HTTP/PostgreSQL/browser regression coverage.
- **Validation:** Final regular suite: 89 passed, 0 failed, 27 opt-in cases skipped; all 27 separately passed against disposable PostgreSQL/HTTP schemas (116 distinct passing tests). Includes refusal of weak network-source scanner keys before any configuration rewrite. Production Vite 8.3.5 dashboard build passed; 95 backend/startup CommonJS files parsed; backend/dashboard npm audits both report zero vulnerabilities. Browser verified protected image/PDF rendering, expired-session denial, restored previews, and a 68-byte synthetic image download whose checksum matches the fixture. Original multi-office tests remain green. Initial sandbox readiness failure and a missing URL constructor in a VM test fixture were corrected/rerun; final checks passed. Physical Pi, native printing, four-device load and production rollout remain untested.
- **Explicit exception:** User directed that SMS (A17) be handled last in a later operation. Leave it disabled/outbox-only; no SMS implementation or real messages in this repair.
- **Recovery / configuration evidence:** Private export copies match all 11 retained local originals. Read-only reconciliation checked 85 documents: 15 absent stored files, 8 with inline covers, zero exact verified backup originals, 8 invalid custody references, 4 absent receipt timestamps with zero unambiguous event candidates, and 8 legacy queues. A private per-record manifest is under ignored `database-export/reconciliation-2026-10-29T15-32-32-188Z/`; no historical values were guessed or applied. Latest private coordinated config bundle (including previous settings) is under ignored `database-export/secure-rollout-2026-10-29T16-09-22-034Z-bd8859/`; no live configuration applied. Existing backend remained HTTP 200/ready and still lacks the new revision field, consistent with no source rollout. Temporary synthetic browser/API processes were stopped; user-owned services were left running.
- **Publication / deployment:** Source committed on `main` at `d0291ff`. [Final results](docs/SYSTEM_REPAIR_RESULTS_2026-10-29.md) and [aggregate evidence](docs/system-repair-evidence-2026-10-29/summary.json) record per-finding disposition, test boundaries, private recovery paths and release requirements; repair/performance plan checkpoints updated. No push, deployment, backend restart or physical Pi update. The documentation commit containing this entry is identifiable in Git history; no recursive self-hash commit is required.
- **Rollback:** Preserve business data/configuration and previous source revision. Keep frontend/backend attachment contracts aligned at rollout. No historical database rollback solely to undo source changes.
- **Outstanding / next action:** Review the committed handoff and schedule a separately authorized matching frontend/backend/Pi credential rollout with live role acceptance. Actual devices/native printing, historical record/original-file reconciliation, off-machine recovery and remaining measured performance phases stay pending. SMS remains the explicit user exception. Removing exports from the new snapshot does not erase Git history; assess/rotate any credentials reused from older published examples during rollout.

## [2026-10-29] — Full system audit and remaining defects

- **Type / state:** AUDIT | DOCS / LOCAL; application repairs remain PLANNED.
- **Author / time:** Codex; 2026-10-29, Asia/Manila.
- **Request / reason:** User requested a full audit for remaining errors and missing system capabilities.
- **Branch / revision:** `main`, `7d0631dc534fbac9a58e9c85ade12ea731055727`; clean checkout at start. Read-only remote check confirmed the same GitHub `main` revision. No branch change.
- **Changes / files:** Added `docs/SYSTEM_AUDIT_2026-10-29.md` and redacted aggregate evidence/reusable read-only and synthetic probes under `docs/system-audit-evidence-2026-10-29/`. Identified 18 findings/gaps, including create/upsert overwrite, default scanner-key configuration, unauthenticated scan downloads, WebSocket document disclosure, Office-wide log access, print HTML injection, early attachment deletion, archive linkage/concurrency, scanner command concurrency, backend custody checks, existing missing files/reference/timestamp/queue issues, dependency advisories, SMS outbox-only delivery, and tracked database exports. Distinguished proven behavior, source/configuration evidence, and unverified exploitation/runtime outcomes. Recorded remaining performance, production, recovery and physical-device acceptance work. No application fixes implemented.
- **Data / configuration impact:** Live database work used read-only transactions and aggregate/file-existence checks. User explicitly approved 60-second in-memory role tokens for bounded authenticated GETs. Integration writes used synthetic records in disposable schemas of the existing restored test database; teardown removed the schemas. Fault/concurrency/security probes used synthetic in-memory dependencies, intercepted bridge requests and fake WebSocket clients. No live business record, environment, persistent credential, backend/tunnel service, Pi file, or hardware command changed. Automatic review declined the separate device-key public probe; it was not executed or bypassed, and no device credential was transmitted. Report/evidence contain no credentials, private rows, scan contents or backup contents.
- **Backup / recovery evidence:** Existing ignored 28 October recovery artifacts retained. No new live backup, restore test or separate-storage verification performed in this audit. Missing attachment references require reconciliation against retained originals/backups; permanent loss was not established. Raw non-secret audit outputs retained in ignored `database-export/system-audit-2026-10-29/`.
- **Validation:** Regular suite 77 passed, 0 failed, 11 opt-in cases skipped; all 11 separately passed against PostgreSQL/HTTP (88 distinct passing tests). Production dashboard build passed. Syntax checks passed for 80 CommonJS, 23 Python, 6 PowerShell and 55 shell files; matching root/Pi Python/shell copies agreed. Ten isolated probes reproduced defects, not successful repairs. Local/public health and approved role GET checks passed; unauthenticated public scan range returned 206; sampled Office logs exposed the same 9,524 total as Admin. Read-only snapshot found 15 documents with absent stored attachments, 8 invalid custody references, 4 missing receipt timestamps, 8 legacy queues, 37 inline covers and 40 queued sender notifications. npm registry scans completed with 9 backend/11 dashboard affected package entries, including one critical entry in each; exploitability is context-dependent. Browser sign-in rendered and a synthetic missing tracking number returned a bounded error with recovered controls. Initial sandbox localhost/Bash/registry failures were resolved by authorized reruns. Actual device/motor/native-print/four-physical-device acceptance remains unverified.
- **Publication / deployment:** Audit documents/evidence are local and uncommitted. Earlier report/workflow source is now committed and on remote `main` at `7d0631d`, superseding the older entries' LOCAL publication snapshots. Published frontend assets contain report-worker and receipt-confirmation features and the configured public backend. Different local/public asset hashes alone do not establish staleness. Running backend revision and live multi-office mutations were not verified. No commit, push, restart or deployment performed by this audit.
- **Rollback:** Remove only the newly added audit report/evidence and this entry if unwanted; preserve prior application/history/data. No application or data rollback is required for the audit. Future repairs need focused regression checks and the existing operation plan's recovery/rollout process.
- **Outstanding / next action:** Review the report's prioritized repair order. First protect document creation, file access, WebSocket/log visibility, print metadata and coordinated device credentials; then make file/archive/workflow/command changes atomic. Reconcile existing data on the restored copy with a reviewed manifest and verified recovery before any live data change. Dependency remediation, SMS delivery if required, production/runbook drift and physical acceptance remain pending. Logging this audit does not authorize those repairs, data changes or publication.

## [2026-10-29] — Multiple-office delivery and explicit receipt confirmation

- **Type / state:** FIX | FEATURE / LOCAL
- **Author / time:** Codex; 2026-10-29, Asia/Manila.
- **Request / reason:** Group assessment found that only the first checked office gets a document; add a confirmation button for receiving documents.
- **Branch / revision:** `main`, `f5bfa866879c36e449055320a85f19f820e80520`; clean checkout at start. No branch change.
- **Intended scope:** Create independent deliveries to every selected office, preserve office access and per-office receipt history, and require explicit confirmation before recording receipt. Check both document and transmission send paths, approval gates, duplicate/concurrent receipt behavior, and focused regression coverage.
- **Changes / files:** Both send paths now create one transmission, timeline event, and office notification for every selected destination. `backend/utils/documentRouting.js` records a delivery group and independent receipts; the first selection remains the custody destination, and other offices receive copies. New `backend/utils/documentHandoffs.js` commits sends, receipts, and cancellation with a document row lock and one transaction, preventing conflicting sends, duplicate receipt, partial saves, or lost concurrent history. Cancellation retains other deliveries. Backend/frontend scope includes current copy recipients; SQL translation now recognizes `sendHistory` predicates instead of silently producing an unconstrained clause. Older copy access markers expire on onward sending. Approval gates cannot be bypassed by placing Mayor first in a multiple-office selection. Generic edits cannot rewrite route history or receipt identity. `dashboard/src/pages/DocumentList.jsx` restores Receive in rows/details, shows all office deliveries and receipt states, and explains custody/copies; `TransmissionList.jsx`, `App.jsx`, and new `utils/receiveDocument.js` use explicit Cancel / Confirm receipt, server-recorded identity/time, pending controls, and retryable failures. Routing/archive controls respect pending recipients. Added unit/SQL/HTTP/PostgreSQL coverage and a development-only synthetic browser harness. No dependency added.
- **Data / configuration impact:** No live record, application schema, credential, environment, backend/tunnel service, or Pi change. Integration writes used synthetic records inside a uniquely named temporary schema in the existing restored test database, then dropped that schema. Browser fixture used in-memory synthetic data only. Existing queued live deliveries were not backfilled or resent.
- **Backup / recovery evidence:** Existing operation backups retained. No new live backup needed for this source-only batch; disposable integration schemas were removed by test teardown. Screenshot retained in ignored `database-export/workflow-validation-2026-10-29/delivery-browser.jpg`.
- **Validation:** Final regular regression command (`node --test backend/test/*.test.js dashboard/src/utils/*.test.js dashboard/src/api/*.test.mjs scripts/start-all.test.js`): 77 passed, 0 failed; 11 opt-in integration cases skipped in that command and then separately all 11 passed against PostgreSQL. Integration covered both actual HTTP send handlers, notifications to all destinations, document visibility, confirmed receipt with server identity/time, receipt order, concurrent receipts/sends, duplicates, approval gates, atomic rollback, cancellation, and legacy single-office receipt. Browser verified three selected offices, second/third receipt before primary, Cancel with zero saves, synthetic failure/retry, final three receipts and custody, and visible per-office status. Production dashboard build passed. Initial obsolete queue assertion and incomplete SQL fixture were corrected; sandbox-only localhost connection/readiness failures passed when rerun with local network access. See `docs/workflow-evidence-2026-10-29.json` for aggregate evidence. These checks are synthetic acceptance, not production/four-device/Pi acceptance.
- **Publication / deployment:** Local uncommitted changes on `main`; no commit, push, deployment, or live backend restart. Prior report work was already committed at the starting revision `f5bfa86`; its deployment was not inspected here.
- **Rollback:** Before publication, reverse only this source batch while preserving earlier work and records. After any future multiple-recipient writes, finish/reconcile pending deliveries before downgrading to the old single-destination backend; keep frontend/backend contracts aligned. Do not restore an older database solely to revert source code.
- **Outstanding / next action:** Publish only when authorized, coordinate the updated backend and frontend, then verify a real three-office send and receipt with the intended roles. Existing legacy queued destinations require an explicit resend after their pending handoff is completed. Physical four-device/Pi acceptance and remaining optimization phases stay pending.

## [2026-10-28] — Large activity-report preview and printing reliability

- **Type / state:** FIX / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** User reported that ordinary online actions are smooth, but a roughly 490-page all-time activity preview hiccups and printing/export leaves the page stuck on Generating.
- **Branch / revision:** `main`, `4c8649e`; prior local verification-documentation changes preserved. No new branch.
- **Changes / files:** Intended scope was recorded before implementation: bounded, complete report generation and recoverable printing/export. Completed in `dashboard/src/pages/ReportsPage.jsx`, `utils/reportPdf.js`, `utils/reportWorkerClient.js`, `utils/reportExport.js`, `workers/reportPdf.worker.js`, `components/ReportPdfPreview.jsx` and report CSS. Removed the duplicate full-report DOM/measurement tree, per-second parent report recomputation and report screenshot export. Generate selectable paginated text in a background worker; snapshot filters/data/time per job, rate-limit progress, prevent overlapping jobs, and terminate the worker on cancellation/deadline. Preview renders one page at a time with direct page navigation and cleanup. Print reserves a PDF tab during the click and hands off the completed file; the user prints from that tab. PDF download reuses the prepared file. JPEG uses one canvas at a time: one-page JPG or a complete multi-page ZIP, with cancellation and an explicit archive-size limit. Added focused regression tests, synthetic fixtures and a development-only browser harness under `dashboard/test/`. Declared already-installed/locked `fflate` as a direct dependency; no package version changed.
- **Data / configuration impact:** Frontend source/tests and documentation only. Synthetic report fixtures used without account login or database access. No live records, schema, endpoints, credentials, services or Pi files changed. The user-owned main backend/tunnel remains running. Browser test downloads contain synthetic records only.
- **Backup / recovery evidence:** Existing verified database/scan/configuration backups and restored test copy retained. No data migration planned; source recovery through the existing committed checkpoint.
- **Validation:** Final frontend suite: 39/39 passed, including actual worker cancellation after progress, fresh retry, stalled seal-body deadline, failed assets, obsolete callbacks, summary/empty reports and oversized rows. Production build passed. Synthetic 10,000-row PDF: 589 pages, 1,639,972 bytes, every unique reference retained; actual caller timer continued while the worker ran. Production-built worker also generated all 10,000 records. A 4,000-word cell continued across 11 pages with no missing words and the next record intact. Rendered/visually inspected first/middle/last pages of large and oversized-row PDFs: seal, table boundaries, text, numbering and signature footer correct. Browser: complete 589-page preview, direct last-page navigation, 100,000-row cancellation and recovered controls, print handoff hint, downloaded three-page PDF containing all 30 records, three JPGs in a ZIP and one-page JPG at 918x1188. Initial Vite optional-HTML-chunk and browser UMD interop failures were corrected; final source and bundled workers passed. Offline dependency metadata lookup was unavailable; reused the existing locked package. Aggregate evidence: `docs/performance-evidence-2026-10-28/report-verification.json`; synthetic PDFs/images/screenshot retained in ignored `database-export/performance-operation-2026-10-28/report-validation/`. Screenshot alone does not establish which overlapping print/export action was pending in the original incident.
- **Publication / deployment:** Local work only; no commit/push/deployment for this fix yet. The currently published first batch remains unchanged.
- **Rollback:** Reverse this report-specific source batch while preserving earlier loading fixes, documentation and records; no database restore needed.
- **Outstanding / next action:** Review/test this local frontend fix, then include it with the existing verification documentation in the next authorized `main` commit/push and Vercel build. No commit, push or deployment performed here. Confirm the actual historical report and native PDF viewer/print dialog in the user's browser after publication; physical printing and live report acceptance were not performed. The in-app browser did not expose a separately inspectable native PDF print tab, so the handoff hint is not evidence of physical printing. Four physical devices/Pi, SQL report queries and other planned optimization phases remain pending.

## [2026-10-28] — User push and published frontend verified

- **Type / state:** AUDIT | DOCS / LOCAL verification record; application source PUSHED and updated frontend observed DEPLOYED
- **Author / time:** User synced the commits; Codex verified; 2026-10-28, Asia/Manila.
- **Request / reason:** User reported syncing and asked for the next step.
- **Branch / revision:** `main`, `4c8649eb3ede815b4c62592d10f1578a7cba08a6`, including application commit `c1ac509`; GitHub `refs/heads/main` matched exactly and the checkout was clean before this verification record.
- **Changes / files:** Verified GitHub publication, the served Vercel frontend and public read paths. Updated the log, plan and handoff only; no additional application changes, commit, push or deployment performed by Codex in this verification.
- **Data / configuration impact:** Read-only Git/public HTTP checks and a read-only database lookup for 60-second role-verification tokens. No business-record writes, account/password changes, stored tokens, Pi commands, environment rewrites or database restoration.
- **Backup / recovery evidence:** Existing verified native database dump, scan/configuration copies and restored test copy retained. No new backup required for the read-only verification; a separate-storage backup remains pending before future live data migration.
- **Validation:** GitHub main matched local `4c8649e`. Public API health returned HTTP 200 with connected database. Vercel served updated entry `/assets/index-a87e601a.js` (312,755 bytes), containing the new deadline/discovery/section-loading code, lazy document page and matching public backend origin. All five deferred document/archive/scanner/report/device-control assets returned valid JavaScript. Four concurrent role clients successfully read paginated documents and logs through the public API: Admin/Mayor 80 visible documents, sampled Receptionist 54, sampled Office 4. These are role/API checks from one client environment, not four physical devices or completed browser/Pi acceptance. Vercel's internal deployment commit/status metadata was not inspected; publication is established by the served updated assets. No unchanged application tests rerun; earlier 55-test/build results remain separate evidence.
- **Publication / deployment:** User's commits are on GitHub `main`; the new frontend is observed serving on the usual Vercel site and the matching laptop backend is publicly reachable. This confirms publication/connectivity of the first batch, not resolution of all remaining performance findings.
- **Rollback:** Retain backups and business records. If a release rollback becomes necessary, keep frontend/backend response contracts compatible; do not restore an older database dump solely to revert source code. No rollback performed.
- **Outstanding / next action:** User to refresh the usual online site, sign in, browse existing documents/scans/logs/reports and confirm behavior. Keep laptop, backend terminal and forwarding session running. Four physical devices/Pi, detailed workflow acceptance and remaining software/optimization phases are still pending. Follow-up documentation changes can be included with the next substantive batch; they do not require another frontend release for this check.

## [2026-10-28] — Forwarded backend verified before frontend publication

- **Type / state:** AUDIT | DOCS / LOCAL record; application source COMMITTED
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** User supplied the forwarded port-5000 address after starting the main backend.
- **Branch / revision:** `main`, source commit `c1ac509`; local tracking shows one unpublished commit. Follow-up log/plan/handoff edits remain separate local documentation changes.
- **Changes / files:** Verified the supplied public address and updated readiness records. No application code, endpoint setting, branch, or service configuration changed during this verification.
- **Data / configuration impact:** Health/config GETs, a browser-origin preflight, a read-only account lookup for a short-lived WS authentication check, and a public frontend asset read. No business-record writes, saved credentials, Pi commands, or database restoration.
- **Backup / recovery evidence:** Existing verified native backup, scan/configuration copies, and restored test copy retained; no new backup required for these read-only checks.
- **Validation:** Local and forwarded `/api/status` returned HTTP 200 with the expected API identity and connected database. Public config advertised the matching HTTPS API and WSS route. Vercel-origin preflight returned HTTP 204 with matching allowed origin/authorization headers. Authenticated public WS connection passed using a 60-second token kept out of logs. Current Vercel bundle contains the supplied backend origin; future-build environment settings were not directly inspected. This supersedes the earlier failed public check. No application suite rerun because source is unchanged; earlier 55-test/build results remain separate evidence.
- **Publication / deployment:** Laptop backend and public route verified. No push or new Vercel deployment performed by Codex; source `c1ac509` remains the pending application publication. These checks do not establish four-device capacity or complete the remaining software phases.
- **Rollback:** No configuration/data rollback needed for the verification. Preserve matching frontend/backend versions if a later release is reverted; do not restore the database merely to undo a source release.
- **Outstanding / next action:** Publish the tested application commit through the existing `main`/Vercel workflow and verify the resulting build and online login/document loading. Keep the laptop backend and tunnel running. Four-device/Pi acceptance and other planned optimization phases remain pending.

## [2026-10-28] — User commit verified and main laptop backend started

- **Type / state:** GIT | AUDIT / LOCAL record; application batch COMMITTED; main laptop backend RUNNING
- **Author / time:** User committed and started the backend; Codex verified; 2026-10-28, Asia/Manila.
- **Request / reason:** Verify the user's commit and backend startup before publishing the frontend.
- **Branch / revision:** `main`, `c1ac50905be6444d068ab74257f0237564b95cc2`; user commit title: Add performance audit scripts and validation summaries for 2026-10-28. Checkout was clean and one commit ahead of `origin/main` before this documentation entry; the last remote check still showed `73cf88f`.
- **Changes / files:** User committed the 57-file application/audit/test/documentation batch and ran `npm.cmd --prefix backend start`. This follow-up changes the log and plan only; no additional application code or branch created.
- **Data / configuration impact:** Main backend now uses its existing live configuration on port 5000. Standard startup database verification/backfill routines ran. This verification performed only health GETs; no separate data migration/restoration, password reset, environment rewrite, or Pi command was performed.
- **Backup / recovery evidence:** Previously verified native database dump, scan/configuration copies, and restored test copy remain in the ignored operation directory. No new backup or restore performed in this verification.
- **Validation:** Local `/api/status` returned HTTP 200 with the expected API identity and connected database. The configured public tunnel returned HTTP 404, so public availability remains unverified. Earlier isolated test services were listening on 5501/5174; their readiness does not establish main/public readiness. Application tests were not rerun for these runtime/documentation checks.
- **Publication / deployment:** Application changes committed locally on `main`; not pushed by Codex. Updated backend is running on the laptop; the matching Vercel frontend has not been deployed by this operation. No complete live-system acceptance claimed.
- **Rollback:** Stop the main backend in its user-owned terminal if required; retain data and backups. Any source rollback must keep frontend/backend contracts compatible. Do not restore an older database dump merely to stop or revert a service.
- **Outstanding / next action:** Verify the current forwarded address for port 5000 and its public visibility, then align/verify endpoint configuration before a push can publish the matching frontend. Physical Pi/four-device acceptance and other pending software phases remain separate work.

## [2026-10-28] — Initial manual browser feedback

- **Type / state:** DOCS / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Record the user's report that the isolated local test feels smooth.
- **Branch / revision:** `main`, `73cf88f`; existing local application changes preserved.
- **Changes / files:** Recorded manual feedback in `CHANGELOG.md` and updated the operation plan's validation checkpoint. This records the user's observation, not a measured speedup or complete acceptance of every workflow.
- **Data / configuration impact:** Documentation only. No account, database, environment, service, Pi, or deployment change in this batch.
- **Backup / recovery evidence:** No new backup needed for documentation; previously verified native backup and restored test copy retained.
- **Validation:** User reported “i think its all smooth now” after receiving the local browser checklist. Specific roles, pages, operations, timing measurements, and concurrent-device coverage were not confirmed. Earlier 55-test/build results remain separate evidence; no application tests rerun for this documentation-only update.
- **Publication / deployment:** Local documentation only; no commit/push/deployment. No claim that the running Vercel site has these fixes.
- **Rollback:** Add a correction if later testing contradicts this feedback; preserve the original observation and test evidence.
- **Outstanding / next action:** Continue remaining workflow/preview/SQL optimization batches, then complete detailed role checks and the deferred physical Pi/four-device/public-route acceptance before rollout.

## [2026-10-28] — Start the isolated dashboard for manual browser testing

- **Type / state:** CONFIG / LOCAL; isolated test services RUNNING
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** User asked how to test the improvements; make the isolated setup accessible with a direct address and a short checklist.
- **Branch / revision:** `main`, `73cf88f`; existing local changes preserved.
- **Changes / files:** Started the guarded test backend on loopback port 5501 and dashboard on loopback port 5174. Left both available for the user's browser checks at `http://127.0.0.1:5174/`. No application source edits in this batch.
- **Data / configuration impact:** Test services use the restored database and cloned scan directory, separate device key, and outbox notifications. No live database/environment-file/public-route/Pi/hosting changes; no account passwords reset. Proxy validation used synthetic frames in the isolated relay only.
- **Backup / recovery evidence:** Existing verified native backup and restored copy retained under ignored `database-export/performance-operation-2026-10-28/`.
- **Validation:** Both ports were unused before startup; backend connected to the test database. API/config proxy, authenticated WebSocket, uploaded PDF checksum, and preview-frame rate-limit checks passed through the isolated setup. Manual authenticated screens and physical devices remain unverified.
- **Publication / deployment:** Local test services only; no commit/push/deployment.
- **Rollback:** Stop only the test backend/frontend processes. Retain test data and backups; do not overwrite or restore the live database.
- **Outstanding / next action:** User to open the test address on this laptop, sign in, check the dashboard/documents/scans/logs/reports and a clearly labeled test edit. Physical Pi remains separate and may appear offline. Services intentionally left running for the manual check; stop only these test processes when finished.

## [2026-10-28] — Defer optional page bundles and prepare later local acceptance

- **Type / state:** FIX | DOCS / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Keep the backend/database on this laptop and prepare the physical four-device test for later; reduce initial browser download cost before that test.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Lazy-loaded document, archive, scanner, report and device-control pages; added Vite environment/proxy regression coverage and actual HTTP/WS/upload proxy verification. Startup now preserves existing configuration unless synchronization is explicitly requested, and reports the backend-configured public URL. Added the implementation/acceptance handoff, aggregate verification evidence, and clarified current PostgreSQL setup guidance.
- **Data / configuration impact:** Source/documentation only; no hosting migration, live environment rewrite, or Pi package deployment.
- **Backup / recovery evidence:** Verified native dump/test restore retained in the ignored operation directory. Separate-storage copy still pending before live data migration/cutover.
- **Validation:** All 55 regression tests passed; production build passed. Initial JavaScript entry is about 312 KB (approximately 91 KB gzip), down from the audited approximately 1.49 MB entry. Actual isolated Vite API/config, authenticated WS and PDF checksum checks passed. Initial proxy check could not reach the sandbox-bound Vite listener; restarting the isolated frontend with localhost access enabled resolved it. Browser automation stopped because its policy check could not verify the Windows browser URL; authenticated screen checks remain pending. Final read-only comparison verified all five live configuration files, 64 original scan hashes and 12 live table counts against backup. Disposable test fixtures were removed and isolated test services stopped.
- **Publication / deployment:** Local only; no commit/push/deployment.
- **Rollback:** Reverse this batch's source edits; keep the verified backups and completed records.
- **Outstanding / next action:** User selected laptop backend/database hosting and deferred physical acceptance. Follow docs/PERFORMANCE_IMPROVEMENTS_2026-10-28.md for later browser/device/public-route acceptance. Remaining SQL summaries/indexes/metrics, cross-record workflow guards, idle-preview work and rollout are explicitly pending; no live incident resolution claimed.

## [2026-10-28] — Existing-row update safety and scanner connection repairs

- **Type / state:** FIX / LOCAL; broader Phase 3 remains incomplete
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Continue the approved operation; user confirmed laptop hosting remains in place and physical four-device acceptance will occur later.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Added transactional row locks for existing-record findOneAndUpdate and relevant updateOne history/counter operations; corrected $each append and previous-value return semantics. Retained presence registration across hub initialization. Added a separate authenticated 30 FPS preview-frame budget, validated device identifiers, and preserved control-request limits. Full cross-record workflow transactions, schema guards and idle-preview transport changes remain pending.
- **Data / configuration impact:** Created and removed disposable synthetic records in the restored test database; live database/configuration and all Pi Python/mechanism package files unchanged.
- **Backup / recovery evidence:** Verified ignored native dump, scan/configuration copies, and restored test copy.
- **Validation:** All 55 final tests passed. Real PostgreSQL rehearsal preserved 20 concurrent writes, 22 individual history events after a two-event append, and counter 21 after another increment. Previous-value semantics verified. Presence-before-initialization regression passed. Simulated 25 FPS over one minute left the command quota available; actual authenticated burst accepted 30 and limited the 31st. Restored table/file counts matched after fixture cleanup. No physical Pi test performed.
- **Publication / deployment:** Local only; no commit/push/deployment.
- **Rollback:** Reverse only this batch's source edits. Preserve live originals and verified backups; disposable test records use an exact generated identifier and are cleaned by the test harness.
- **Outstanding / next action:** Review and implement the remaining multi-record workflow/pending-command guards, idle/hidden preview demand and physical acceptance before marking Phase 3 complete.

## [2026-10-28] — Document payload reduction and paginated listing foundation

- **Type / state:** FIX / LOCAL; broader Phase 2 remains incomplete
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Reduce the audited 34 MB document download and growing log requests after the loading reliability fixes.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Implemented SQL field projection with password exclusion, bounded/filterable document/log listing envelopes, metadata-only document pages, detail-on-open for scans/history and complete metadata collection for existing totals/report callers. Activity Logs uses server paging/search/filtering. New covers prefer persisted URLs; report generation excludes unused scan bodies/history. Existing inline covers remain intact.
- **Data / configuration impact:** No live cover migration or environment change. Synthetic image registration/persistence was tested against the isolated API; its exact fixture, notifications/logs and cloned-storage file were removed.
- **Backup / recovery evidence:** Verified ignored native dump, scan/configuration copies, and restored test copy from Phase 0.
- **Validation:** All 55 final tests and production build passed. Four concurrent local role clients matched scoped database IDs/totals and authorized detail access. Admin/Mayor first 50-document page: 56,244 response-body bytes; both pages covering all 80 records: 90,897 bytes. First 20-log page: 3,911 bytes with correct total 9,462. This is distinct from the original 34,170,244-byte full-record serialization measurement. Synthetic saved cover used its stored URL and downloaded bytes matched. Source-data/configuration checks and fixture cleanup passed.
- **Publication / deployment:** Local only; no commit/push/deployment.
- **Rollback:** Reverse this source batch; originals remain in the untouched live database and verified backup.
- **Outstanding / next action:** Complete SQL dashboard/report summaries, filtered report queries, server-driven document-page UI, and reviewed dry-run/rollback for legacy inline covers. Existing callers intentionally collect all metadata/log pages where complete totals are required; this preserves correctness but is not the final large-dataset design.

## [2026-10-28] — Loading reliability, independent sections, and endpoint verification

- **Type / state:** FIX / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** Begin the approved improvements after verifying the recovery/test checkpoint.
- **Branch / revision:** `main`, `73cf88f`; no branch created.
- **Changes / files:** Added request/body deadlines, cancellation and bounded safe-read retries; independent page-first collection commits and section retries; collection cache/deduplication/stale-response guards and targeted invalidation; verified API/WS selection independent of ICE; strict startup readiness; Vite `loadEnv`; 503 for authentication database failures; preservation of existing Pi camera tuning during network synchronization (explicit tuning opt-in required). Application shell renders before discovery completes.
- **Data / configuration impact:** Application source only. Validation uses the restored database and cloned storage. No live data normalization or endpoint/environment rewrite in this batch.
- **Backup / recovery evidence:** Verified dump, scan/configuration copies, and test restore at ignored `database-export/performance-operation-2026-10-28/`; separate-storage backup remains pending before live migration/cutover.
- **Validation:** 47 tests passed, including stalled JSON/blob bodies, cancellation, safe-read-only retries, discovery HTML rejection/recovery/deduplication, independent section loading, stale-response/session guards, ICE/WS consistency, authentication 503, and startup readiness. Production build passed. Initial test run found a test-loader syntax issue (corrected) and sandbox-denied localhost connections; the complete suite passed with localhost access enabled. Real four-device/Pi acceptance remains pending.
- **Publication / deployment:** Local only; no commit, push, or deployment performed.
- **Rollback:** Reverse this batch's source edits while preserving prior documentation and backups; no live data rollback is required.
- **Outstanding / next action:** Verify UI against the isolated running backend after payload changes. Public URL alignment awaits a reachable canonical endpoint; no existing environment files rewritten. Continue payload reduction and pagination; real devices/deployment remain pending.

## [2026-10-28] — Performance operation: backups and isolated test setup

- **Type / state:** CONFIG / LOCAL
- **Author / time:** Codex; 2026-10-28, Asia/Manila.
- **Request / reason:** User authorized beginning the performance improvement operation.
- **Branch / revision:** `main`, `73cf88f`; existing documentation changes preserved.
- **Changes / files:** Added guarded backup/restore and isolated-launch scripts, shared configurable upload storage, and storage isolation regression coverage. Created a native custom PostgreSQL dump, scan/configuration backups, and the separately named restored test database. Upload writers, file readers, and HTTP serving now share `UPLOADS_ROOT`, retaining the existing default.
- **Data / configuration impact:** Read-only production backup; created/restored `vinzons_digipath_perf_test_20261028` and cloned scan storage. Test backend uses loopback port 5501 and a separate device key. Live environment files and Pi mechanisms unchanged. No API listener or other PostgreSQL clients were connected before backup; source table counts and file hashes remained unchanged afterward.
- **Backup / recovery evidence:** Ignored `database-export/performance-operation-2026-10-28/`: `database.dump`, scan/configuration copies, scan manifest, verification and HTTP-storage verification. All 12 table counts match, including 80 documents and 9,462 logs; 64 files / 33,004,896 bytes match SHA-256 checksums. Restored test copy verified. Additional backup on separate storage remains pending before live migration/cutover.
- **Validation:** Backup/restore, all table counts, unchanged source/copy checksums, connected test health, and PDF/JPEG/PNG HTTP downloads verified. Initial backup command found the parent backup folder absent; corrected parent creation and reran successfully. Storage regression and existing test suite run before Phase 1. Four physical devices are unavailable for baseline testing.
- **Publication / deployment:** Local work only; no commit, push, or deployment authorized by this entry.
- **Rollback:** Retain backups; reverse only this batch's source edits. Stop test processes and retain the test database for inspection rather than dropping data automatically.
- **Outstanding / next action:** Test environment ready; proceed with loading fixes. Keep private files ignored and take a separate-storage copy before any live migration/cutover.

## [2026-10-28] — Change recording instructions and current-work history

- **Type / state:** DOCS / LOCAL
- **Author / time:** Codex; date recorded in Asia/Manila
- **Request / reason:** Create a log that records system changes and includes instructions for maintaining it.
- **Branch / revision:** `main`; starting revision `73cf88f`.
- **Changes / files:** Extended the existing `CHANGELOG.md` with maintenance instructions, lifecycle states, an entry template, and backfilled records for this chat's completed work. Added discoverability links in `README.md` and the operation plan. Added a narrow root `AGENTS.md` instruction requiring future coding work to maintain this log.
- **Data / configuration impact:** Documentation only. Removed plaintext database/demo-account credential values from historical entries; retained the descriptions of those past actions. This redaction does not rotate credentials or remove them from Git history.
- **Backup / recovery evidence:** Existing tracked documentation can be recovered through Git. No database backup was performed for this documentation task.
- **Validation:** Initial documentation QA identified missing recovery-information fields in two entries; corrected them before final checks. Documentation links, required logging fields, preservation of historical sections, credential redaction, and file-change scope checked. No application tests required for this documentation-only change.
- **Publication / deployment:** Local changes only; no commit, push, or deployment performed for this entry. `AGENTS.md` is a local instruction file ignored by the existing `.gitignore`; tracked documentation also contains the logging instructions.
- **Rollback:** Remove the new instruction/link sections and local `AGENTS.md` if needed; retain credential redactions and completed historical records.
- **Outstanding / next action:** Begin the operation plan with verified database/scan backups and an isolated test copy when implementation resumes.

## [2026-10-28] — Performance and deployment operation plan

- **Type / state:** DOCS / LOCAL; application work remains PLANNED
- **Author / time:** Codex; backfilled from the plan created during this chat.
- **Request / reason:** Prepare the operation while the user is away.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Created [the operation plan](docs/PERFORMANCE_AND_DEPLOYMENT_PLAN_2026-10-28.md), covering backups/restoration, request deadlines, independent loading, verified endpoints, payload reduction, targeted refreshes, concurrent-update handling, scanner transport, four-device tests, staging, cutover, and rollback. Incorporated the friend's additional loading findings.
- **Data / configuration impact:** None. Full database/scan backups, test restoration, migrations, fixes, and deployment have not started. The earlier Pi environment backup is separate from this planned full backup.
- **Backup / recovery evidence:** No data backup was performed for the planning task. Verified database/scan backups and restoration are the first pending operation checkpoint.
- **Validation:** Plan links, phase coverage, rollback section, and Markdown structure checked.
- **Publication / deployment:** Plan saved locally; not committed, pushed, or deployed.
- **Rollback:** Remove or revise the plan; no application/data rollback is needed.
- **Outstanding / next action:** Phase 0: recheck the checkout, make coordinated backups, and verify a restored test environment.

## [2026-10-28] — Four-user performance and loading audit

- **Type / state:** AUDIT / LOCAL
- **Author / time:** Codex; backfilled from the audit and saved evidence. Runtime samples were approximately 11:34–11:42 AM, Asia/Manila.
- **Request / reason:** Investigate slowness across four users/devices, sometimes on different internet connections.
- **Branch / revision:** `main`, `73cf88f`.
- **Changes / files:** Created [the full audit](docs/MULTI_USER_PERFORMANCE_AUDIT_2026-10-28.md) and [evidence/probe files](docs/audit-evidence-2026-10-28/). Confirmed oversized document payloads, global reload amplification, endpoint-discovery defects, missing request deadlines, and additional concurrency/scanner/query issues.
- **Data / configuration impact:** Read-only database queries and bounded public GET checks; no business records, application configuration, services, or Pi hardware changed. The production build produced ignored `dashboard/dist` output.
- **Backup / recovery evidence:** No full database/scan backup created during the audit; measurements were read-only.
- **Validation:** All 33 existing backend/frontend-utility/startup tests passed; production build passed. Isolated probes reproduced the reported defects. Actual Document-model JSON measured 34,170,244 bytes across 80 records; this is a serialization measurement, not captured live HTTP transfer size. A real four-device authenticated load run was unavailable because the local API was not listening and tunnel health checks failed.
- **Publication / deployment:** Report/evidence remain local and uncommitted; no application fixes deployed.
- **Rollback:** Remove the audit artifacts if no longer required; application/data state was not modified.
- **Outstanding / next action:** Implement and measure the fixes according to the operation plan; do not treat identified defects as resolved.

## [2026-10-28] — Remove the superseded experiment branch

- **Type / state:** GIT / completed locally and on GitHub
- **Author / time:** Codex; backfilled from verified Git command results in this chat.
- **Request / reason:** User requested deletion of `codex/render-local-db-experiment` after the Pi changes reached `main`.
- **Branch / revision:** Active checkout remained `main`, `73cf88f`; deleted branch tip was `e786bb4`.
- **Changes / files:** Deleted that exact local and remote branch. Before deletion, verified the nine Pi updates matched `main`. Its only file differences were two audit reports and an audit screenshot.
- **Data / configuration impact:** Git references only; no database, application configuration, Pi deployment, or `main` file changes.
- **Backup / recovery evidence:** Pi file parity with `main` was verified before deletion, and the former tip `e786bb4` is recorded here. No database/file backup was needed for this reference-only change; branch restoration was not tested.
- **Validation:** GitHub reported the branch deleted; local branch listing confirmed removal and `main` was unchanged.
- **Publication / deployment:** Remote branch deletion completed. No application deployment performed.
- **Rollback:** The former tip was `e786bb4`; restoration requires that commit to remain recoverable from repository history/reflog or another retained copy.
- **Outstanding / next action:** No further branch cleanup requested.

## [2026-10-28] — Update root Raspberry Pi package and publish on main

- **Type / state:** FIX / PUSHED
- **Author / time:** Codex; backfilled from source comparison, test results, Git history, and push verification. Commit time: **11:01:30 AM, Asia/Manila**.
- **Request / reason:** Replace outdated root Pi files with the package from `D:\VinzonsDIGIPATH-Pi` and ensure the changes are on `main`.
- **Branch / revision:** Result `main`, commit [`73cf88f`](https://github.com/ckdecodeder/VinzonsDIGIPATH/commit/73cf88fd14a7ddc85771a3431c6dd9a5e50a0328). Pi changes were initially committed/pushed by the user on the already-active experiment branch; the Pi-only changes were then applied and pushed to `main` as requested.
- **Changes / files:** Updated `digipath_hall_ys27.py`, `digipath_mechanism.py`, `digipath_tb6600.py`, both relevant Pi environment examples, and four Pi bootstrap/install/restart/USB-update scripts. This brought the newer motor/sensor handling, startup self-test, and installation fixes into the root package.
- **Data / configuration impact:** Copied the standalone `.env` into ignored root `pi_ws_scanner.env`. The runtime configuration remains local and is not included in the Git push. Website/backend application code and database records were unchanged.
- **Backup / recovery evidence:** Previous Pi runtime configuration preserved as ignored `pi_ws_scanner.before-replacement-2026-10-28.env`. This was a configuration copy, not a full database/scan backup or tested restore.
- **Validation:** All 30 mapped package files matched the standalone source after normalizing line endings; seven Python modules and 18 shell scripts passed syntax checks. Required mechanism imports and document-layer mapping passed. Lift/sort tests ran in simulation only. GitHub `main` was verified at `73cf88f` after push.
- **Publication / deployment:** Nine tracked Pi files were committed and pushed to `origin/main`. Physical Pi deployment and motor/camera operation were not performed or verified by this task.
- **Rollback:** Prior tracked baseline is `db1ba42`; restore a consistent package as a unit and validate its scanner imports before using it. Restore local Pi configuration from the preserved copy if needed. Do not overwrite subsequent user work.
- **Outstanding / next action:** Future physical deployment needs a package copy/restart and hardware validation. The audit also found that network synchronization can overwrite local Pi settings; resolve configuration alignment during the planned loading work.

---

## Historical entries

The entries below predate the current audit and are retained as historical records. Their completion/planned labels describe what was recorded at that time, not a fresh verification of today's system.


## [2026-09-30] — Phase 4: Frontend UI ✅

### FEATURE — Document Types Management Page (Admin Only)
- **New File:** `dashboard/src/pages/DocumentTypeList.jsx`
- New admin page accessible via the **Administration → Document Types** sidebar link
- Displays a table of all document types with their routing track and Mayor Approval status
- Admin can create, edit, and delete document types
- Edit/Create form includes a **toggle switch** for `requiresMayorApproval` and a **dropdown** for `routingTrack`

### FEATURE — Route Progress Stepper in Document Detail
- **File:** `dashboard/src/pages/DocumentList.jsx`
- Added a visual route progress bar inside the expanded document detail row
- Shows each office in `routePlan` as a pill-shaped badge
- **Current stop** is highlighted in primary color with a 📍 pin icon
- **Completed stops** show a ✓ green checkmark
- **Future stops** are shown in muted color
- Only displays if the document has a `routePlan` with more than one stop

### WIRED — App.jsx Plumbing
- **File:** `dashboard/src/App.jsx`
- Imported `DocumentTypeList` page and `documentTypeService` API
- Added `document-types` to the admin `ROLE_PAGES` access list
- Added three handler functions: `handleAddDocumentType`, `handleUpdateDocumentType`, `handleDeleteDocumentType`
- Added `case 'document-types'` to the admin page `renderPage` switch

---

## [2026-09-30] — Phase 3: API Updates ✅

### FEATURE — Document Types API
- **File:** `backend/routes/documentTypes.js`
- Updated the `POST /api/document-types` and `PUT /api/document-types/:id` routes.
- Safely extracts and casts `requiresMayorApproval` and `routingTrack` from the request body to ensure data integrity when admins update routing rules.

---

## [2026-09-30] — Phase 2: Mayor Gate & Route Logic ✅

### FEATURE — Mayor Gate on Document Creation
- **File:** `backend/routes/documents.js`
- Added logic in `normalizeDocumentPayload` to automatically lookup the `requiresMayorApproval` flag for the selected document type.
- If true, automatically generates a `routePlan` targeting the Mayor's office and forces the document into the Mayor's inbox with a `For Signing` status.

### FEATURE — Route Auto-Advancement
- **File:** `backend/routes/transmissions.js`
- Added logic to automatically increment `routeStep` whenever a transmission is received, moving the document to the next logical stop in the `routePlan`.

---

## [2026-09-30] — Phase 1: Database Schema Changes ✅

### FEATURE — Added Routing Fields to `DocumentType`
- **File:** `backend/models/index.js` (`DocumentTypeModel`)
- Added `requiresMayorApproval` (BOOLEAN, default: `false`) — flags a document type as needing Mayor sign-off before routing
- Added `routingTrack` (TEXT, default: `'direct'`) — defines the routing track: `direct`, `mayor`, or `sequential`
- Migration function `migrateDocumentTypeRoutingFields()` added; runs `ALTER TABLE IF NOT EXISTS` on every server start (safe to re-run)

### FEATURE — Added Routing Fields to `Document`
- **File:** `backend/models/index.js` (`DocumentModel`)
- Added `routePlan` (JSONB, default: `[]`) — ordered array of office IDs the document must visit
- Added `routeStep` (INTEGER, default: `0`) — pointer to the current position in `routePlan`
- Added `mayorApprovalCleared` (BOOLEAN, default: `false`) — flag set to `true` once the Mayor has signed/approved a document that required it
- Migration function `migrateDocumentRoutingFields()` added; runs `ALTER TABLE IF NOT EXISTS` on every server start (safe to re-run)

### Verification
- Ran `node -e "syncModels()"` — all 5 new columns applied to live PostgreSQL database successfully ✅

---


## [2026-09-30]

### CONFIG — Environment Setup
- Created `backend/.env` from `backend/.env.example`
- Set `DATABASE_URL` credentials to match the local PostgreSQL installation (credential value redacted)
- Generated secure random values for `JWT_SECRET` and `DEVICE_API_KEY`
- Set `MONGODB_URI` to `mongodb://127.0.0.1:27017/vinzons_digipath`
- Set `PORT=5000`, `NODE_ENV=development`, `HOST=0.0.0.0`

### FIX — Database Migration Script
- **File:** `backend/scripts/migrate-pg.js`
- Changed `sequelize.sync({ alter: true })` to `sequelize.sync({ force: true })`
- **Reason:** Running `npm run seed` (old MongoDB script) before `npm run migrate` created
  corrupted/partial PostgreSQL tables. The `force: true` flag drops and recreates all tables
  cleanly, resolving the "Validation error / id must be unique" crash during migration.

### MIGRATION — PostgreSQL Data Import
- Ran `npm run migrate` successfully
- Imported all collections from `dbcollections/` into PostgreSQL (`vinzons_digipath` database)
  - offices: 11 records
  - document_types: 9 records
  - users: 15 records
  - documents: 9 records
  - transmissions: 3 records
  - devices: 1 record
  - device_events: 8 records
  - notifications: 35 records
  - sender_notifications: 10 records
  - logs: 8,182 records

### CONFIG — Demo Passwords Reset
- Ran `node scripts/set-demo-passwords.js`
- Reset demo passwords for 15 accounts (credential values redacted)
- Affected demo accounts included Admin, Mayor, and Office roles; credential values are intentionally omitted

---

## [PLANNED] — Professor's Workflow Requirements

The following changes are planned and approved. They have not been implemented yet.
See `workflow_modification_plan.md` for the full technical breakdown.

### PLANNED FEATURE — Dynamic Routing Tracks (Track A / B / C)
- **Files:** `backend/models/DocumentType.js`, `backend/models/Document.js`
- Add `requiresMayorApproval` (boolean) and `routingTrack` (enum) to DocumentType
- Add `routePlan[]` (array of office IDs), `routeStep` (number), and
  `mayorApprovalCleared` (boolean) to Document
- **Purpose:** Support Direct, Mayor-Mediated, and Sequential multi-office routing

### PLANNED FEATURE — Mayor Gate on Document Creation
- **File:** `backend/routes/documents.js`
- When an Office user creates an Outgoing document, automatically check the document type
- If `requiresMayorApproval === true`, force document to Mayor's Office and lock it
  until Mayor signs it before it proceeds to the destination office

### PLANNED FEATURE — Route Advancement on Transmission Receive
- **File:** `backend/routes/transmissions.js`
- When a transmission is marked as received, auto-advance `routeStep` and update
  `currentOfficeId` to the next office in `routePlan`

### PLANNED FEATURE — Routing Preview UI on Document Form
- **File:** `dashboard/src/pages/ReceptionistDashboard.jsx`
- Show a visual preview of the routing path when a document type is selected

### PLANNED FEATURE — Route Progress Stepper UI on Document Detail
- **File:** `dashboard/src/pages/DocumentList.jsx`
- Show a horizontal stepper showing all stops in `routePlan` with the current
  `routeStep` highlighted so staff can see exactly where a document is in its journey

---

*This file is updated manually whenever a change is made to the system.*
*Add new dated entries after the instructions/template and before older dated entries. Follow the maintenance instructions at the top of this file.*
## [2026-10-30] — Philippines SMS sender and content requirements

- **Type / state:** FIX / LOCAL; implementation and validation complete, documenting for local commit.
- **Request / reason:** User plans to test the SMS feature with their Philippine SIM. Review of Twilio's current Philippines guideline found the prior SMS template included a tracking URL and deployment documentation did not specify registered alphanumeric Sender ID requirements.
- **Branch / revision:** `main`, starting `dfa2e09`.
- **Intended scope:** Keep the SMS template URL-free, support the configured registered alphanumeric sender ID, document registration before live delivery, add synthetic tests. No Twilio configuration/API request or real message.
- **Data / configuration impact:** None; outbox default and existing environment settings unchanged. No queue flushed.
- **Actual changes:** SMS templates now omit tracking URLs (retained for email only); `TWILIO_FROM_NUMBER` is documented as a registered Philippines alphanumeric Sender ID. Twilio's approximate registration lead time and requirement are documented. Test now checks that the message body has no URL and the configured sender value is used.
- **Validation:** Backend: 43 passed, 0 failed, 27 opt-in PostgreSQL cases skipped; dashboard: 46 passed, 0 failed; production Vite build passed. Synthetic Twilio tests verify registered sender value forwarding, URL omission, recipient formatting, bounded requests, redacted failures, one-at-a-time sends and outbox behavior. No credentials or real messages were used.
- **Publication / outstanding:** Commit source/docs locally on `main`; no push/deployment. Actual sender registration and one approved-recipient delivery remain operational steps. SMS stays disabled/outbox by default and the old queue will not be flushed.

## [2026-10-30] — SMS delivery completion

- **Type / state:** FEATURE | FIX / LOCAL; implementation and validation complete, committing source/docs on `main`.
- **Request / reason:** User returned after the usage reset and resumed the previously deferred SMS function.
- **Branch / revision:** `main`, starting `02c1f79`; clean checkout; four-hour Codex window reset and currently 0% used.
- **Intended scope:** Complete the existing Twilio SMS path with safe recipient normalization, bounded provider requests, privacy-safe delivery errors and protected/recoverable retry behavior. Add focused tests using a stubbed provider; no real messages, bulk sends or external service calls. Keep `SENDER_NOTIFICATION_PROVIDER=outbox` unless the user later configures Twilio themselves.
- **Data / configuration impact:** No environment credentials or existing queued sender messages changed; avoid retrying/backfilling existing outbox. No SMS sent.
- **Actual changes:** Twilio recipient validation accepts Philippine `09` mobiles and valid international numbers; requests have a 10-second default/30-second maximum and provider bodies are never persisted. Delivery rows are claimed under a lock (`Sending`) so concurrent retries send once; attempts/time are recorded, transient errors are redacted, and retries stop at five per message. Admin/Receptionist can retry visible SMS only; outbox mode remains default and will not flush old notifications. The UI explains number formats. `.env.example` and the deployment guide document configuration. No credentials were added.
- **Validation:** Backend suite: 42 passed, 0 failed; 27 opt-in PostgreSQL tests skipped because no disposable database was requested for this source change. SMS tests stub the provider and cover number formats, bounded requests, privacy-safe failures, one concurrent send claim, retry counting and outbox-only behavior. Dashboard: 46 passed, 0 failed. Production build passed. No Twilio call or real SMS sent.
- **Recovery / publication / next action:** Source rollback by focused commit revert; no database changes. Commit locally on `main`; no push or deployment. To activate later, the owner must set Twilio credentials privately, review consent/recipient and approve a single test phone; keep outbox mode until then. Legacy queued notifications require individual intentional requeue and are never automatically flushed.
