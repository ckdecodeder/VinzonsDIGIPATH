# Chapter 4 Workflow Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align DigiPath's approval gate, office handoffs, receipt tracking, and archival completion with Chapter 4 while preserving document-specific routing.

**Architecture:** Keep the existing PostgreSQL models and API shape. Route all office handoffs through the existing `Transmission` records so a document remains at its source and in transit until the destination records receipt; enforce the document-type Mayor approval flag at every send entry point. Update the existing dashboard flow to reflect those recorded states.

**Tech Stack:** Node.js, Express, Sequelize/PostgreSQL, React/Vite, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-18-chapter-4-workflow-alignment-design.md`

## Global Constraints

- Keep direct, Mayor-related, and sequential multi-office routing available.
- Do not implement cryptographic or legally operative e-signatures.
- Do not add the adviser's activity-log/report filters or archive-folder category in this priority pass.
- Use a local test database, not the Dev Tunnel backend, for data-changing checks.
- Work in the existing `main` checkout; do not commit, push, or deploy during review.
- After each completed feature, give the user step-by-step directions for where to find it, how to try it, and what result to expect.

## Review Focus

1. A document type requiring Mayor approval may be sent to the Mayor's Office for review, but must not route onward before approval; pin the onward-send gate with `test_send_gate_blocks_required_unapproved_document` in Task 2.
2. A document type not requiring Mayor approval must still route directly; pin with `test_send_gate_allows_type_without_mayor_approval` in Task 2.
3. A rejection/resubmission must clear any prior approval and block sending until the new approval; pin with `test_resubmission_resets_mayor_approval` in Task 2.
4. A document must remain in transit at the sender until the right destination office records receipt; cover the source/current-office, wrong-office, duplicate-receipt, and timestamp cases in Task 3's local API scenarios.
5. A queued next office must not be treated as reached or archived before its own send and receipt; cover multi-office progression and premature-archive rejection in Tasks 3-4.

---

### Task 1: Prepare a local-only preview and test database

**Files:**
- Modify temporarily (ignored local settings only): `dashboard/.env`, `backend/.env`
- Read-only source for sample rows: `backend/data/seedData.js`

**Interfaces:**
- Dashboard requests use same-origin `/api` and Vite proxies to `http://127.0.0.1:5001`.
- Backend uses PostgreSQL at `127.0.0.1:55433`, database `vinzons_digipath_test`, and binds to `127.0.0.1:5001`.

- [x] Confirm those ports are free and the test database is newly created and local-only.
- [x] Set the ignored local environment files to the API/database values above; preserve all secrets and do not print them.
- [x] Create the schema with the existing PostgreSQL migrations/models, then load demo rows from `backend/data/seedData.js` through PostgreSQL models. Do not run the legacy MongoDB `npm run seed` script.
- [x] Start the backend and dashboard with the Vite proxy target explicitly set to port 5001; verify `/api/status` through localhost reports `database: connected` and a demo login succeeds through the dashboard proxy.

**Deliverable:** A localhost preview on port 5174 connected only to the new local test database. No tracked project files change in this task.

### Task 2: Enforce the configured Mayor approval gate

**Files:**
- Modify: `backend/routes/documents.js`
- Modify: `backend/routes/transmissions.js`
- Modify: `backend/utils/documentRouting.js`
- Modify: `backend/test/documentRouting.test.js`

**Interfaces:**
- Add `canSendDocument({ requiresMayorApproval, mayorApprovalCleared }) -> boolean` in `backend/utils/documentRouting.js`.
- Add `buildResubmissionUpdates() -> { intakeStatus, verifiedBy, verifiedAt, rejectionReason, mayorApprovalCleared }` in `backend/utils/documentRouting.js` and use it for the existing resubmit action.
- Both `POST /api/documents/:id/send` and `POST /api/transmissions` keep their current request bodies and return a client error with a clear message when the gate is not cleared.

- [x] Add the three named gate tests from Review Focus to `backend/test/documentRouting.test.js` and confirm they fail against the current behavior.
- [x] Check the document type's `requiresMayorApproval` value in both send handlers; permit an unapproved handoff to the Mayor's Office for review, and block onward routes until Mayor approval is recorded.
- [x] Set `mayorApprovalCleared` when the authorized signing/approval action succeeds; clear it when that approval is rejected or the document is resubmitted. Do not accept this gate field from ordinary document updates or creation payloads.
- [x] Run `node --test backend/test/documentRouting.test.js`; expect all routing helper tests to pass.

### Task 3: Make sending and receipt use one handoff record

**Files:**
- Modify: `backend/routes/documents.js`
- Modify: `backend/routes/transmissions.js`
- Modify: `backend/utils/documentRouting.js`
- Modify: `backend/test/documentRouting.test.js`
- Modify: `dashboard/src/components/Scanner.jsx`

**Interfaces:**
- Keep `POST /api/documents/:id/send` and `POST /api/transmissions` as supported entry points, but have both create a pending `Transmission` row.
- Keep `PUT /api/transmissions/:id` as the receipt action; only the destination office can record the receiver and receipt time.
- Add `buildSendTransition({ document, toOfficeIds, sentBy, sentAt }) -> { transmission, documentUpdates }` and `buildReceiveTransition({ document, toOfficeId }) -> documentUpdates` to `backend/utils/documentRouting.js` for shared state construction.

- [x] Extend helper tests for a send transition (`status: In Transit`, source remains `currentOfficeId`, first destination is recorded, remaining destinations stay queued) and receive transition (custody moves to the destination and the prior workflow status is restored).
- [x] Make office-originated registration create one active `Transmission`: send to the Mayor first only when its document type requires approval; otherwise send to its selected destination. Leave any additional selected destinations queued for the receiving office to forward after receipt.
- [x] Keep scanned paper at the Reception office as its recorded initial receipt, add destination selection to the scanner flow, then create the handoff to that selected office; do not force every document through the Mayor's Office.
- [x] Keep each handoff's sender, receiver, source/destination, send/receive timestamps, and timeline/log entries consistent across both API paths.
- [x] Exercise localhost API scenarios for direct routes, required-Mayor routes, multi-office routes, wrong-office receipt, duplicate receipt, and no current-office transfer before receipt.

### Task 4: Reflect handoff state in tracking and archive controls

**Files:**
- Modify: `dashboard/src/pages/DocumentList.jsx`
- Modify: `dashboard/src/pages/TransmissionList.jsx`
- Modify: `dashboard/src/utils/documentWorkflow.js`
- Modify: `dashboard/src/components/DocumentPreviewModal.jsx`
- Modify: `backend/routes/archives.js`

**Interfaces:**
- Continue to use the current document and transmission APIs; show states from persisted `Transmission` records and document status.
- Preserve the existing archive authorization rules and block archiving while a transmission or queued office handoff remains incomplete.

- [x] Update the document list, timeline, and preview to show the source office while in transit, then the receiving office after receipt; show one pending handoff at a time.
- [x] Keep the receive action available only to the destination office and refresh tracking after a successful receipt.
- [x] Reject archive requests for documents with a pending transmission or queued next office; add a local API scenario for this case.
- [x] Verify the completed, eligible document can still be archived under the existing authorization rules.

### Task 5: Review the integrated local workflow

**Files:**
- No additional source files unless a scenario exposes a gap in Tasks 2-4.

- [x] Run `npm --prefix backend test` and `npm --prefix dashboard run build`.
- [x] Manually walk through: (a) a direct route without Mayor approval, (b) a route requiring Mayor approval and a rejection/resubmission, and (c) two sequential office handoffs with receipt at each office.
- [x] Confirm activity history shows each registration, decision, send, receipt, forward, and archive action in order.
- [x] Confirm the browser still uses the local API/test database and the main checkout has no accidental tracked changes outside this spec, plan, and intended implementation files.

## Deferred adviser feedback

After the Chapter 4 workflow is aligned and reviewed, plan a separate pass for activity-log filters/reports, additional report filters based on database fields, and an archive folder type/category.
