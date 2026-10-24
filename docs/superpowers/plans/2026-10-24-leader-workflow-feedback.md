# Leader Workflow Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep document location and movement history accurate and visible in real time, preserve Receptionist tracking access through the full route, and make timeline and card text clear and consistent.

**Architecture:** Keep `Transmission` as the record of each send/receipt and `Document.currentOfficeId` plus `Document.status` as the current snapshot. Make the snapshot update and realtime refresh reliable, while adding a specific read-only tracking scope for the office that initially received the incoming document. Represent initial Mayor's Office reception separately from whether Mayor approval/action is required, after confirming the mapping in the leader's flowchart.

**Tech Stack:** Node.js, Express, Sequelize/PostgreSQL, React/Vite, WebSocket invalidation, Node test runner.

**Spec:** User-provided leader notes and Figure 6 flowchart (2026-10-24), together with `docs/superpowers/specs/2026-10-18-chapter-4-workflow-alignment-design.md`. The leader's new requirement for Receptionist tracking supersedes the earlier rule that a previous office loses visibility after forwarding.

## Global Constraints

- Preserve the existing authorization rules for send, receive, approval, and archive actions; receptionist lifecycle tracking is read-only.
- Do not treat a sent transmission as a completed arrival; the destination office receipt event is the custody transfer.
- Keep direct routing, Mayor-related routing, and multi-office routing available.
- Keep the initial Mayor's Office reception decision distinct from the Mayor action/approval decision shown later in the flowchart.
- Use a local test database for data-changing checks; do not use the Dev Tunnel or the original database for implementation checks.
- Do not add cryptographic or legally operative electronic-signature behavior.
- Do not commit, push, or deploy during review.

## Review Focus

1. A sent handoff remains in transit at its source until receipt is recorded by its actual destination; after receipt, the office and status update everywhere without a manual refresh.
2. The currently open document preview must refresh with the list; otherwise its cached document object can continue showing old status after a successful reload.
3. Receptionist visibility persists for incoming documents initially received at that Receptionist's office after any number of forwards, but does not grant permission to send, approve, edit, archive, or access unrelated office documents.
4. Existing documents need a safe, explicit value for the intake office when introducing a separate intake rule; legacy rows must not disappear from tracking.
5. Timeline entries with missing labels, machine action names, unknown office/user IDs, or duplicate events render as useful, human-readable history rather than raw or empty text.

---

### Task 1: Confirm and model the two Mayor-related decisions

**Files:**
- Modify: `backend/models/index.js`
- Modify: `backend/routes/documents.js`
- Modify: `backend/utils/documentRouting.js`
- Modify: `dashboard/src/pages/DocumentList.jsx`
- Modify: the document-type configuration UI (locate current component before implementation)
- Modify: the PostgreSQL migration/schema path used by the app
- Test: `backend/test/documentRouting.test.js`

- [ ] Confirm with the user how the flowchart's first decision, “initial reception at the Mayor's Office,” differs from its later “Mayor's action (signature/approval)” decision.
- [ ] Keep the current `requiresMayorApproval` meaning limited to the later action/approval gate; add a separate configurable intake/initial-reception value only if policy confirms it is needed.
- [ ] Define safe defaults for existing document types and legacy documents before applying a schema migration.
- [ ] Add decision-table tests for the combinations of Mayor's Office initial reception required/not required and Mayor action required/not required.
- [ ] Update new-document routing so scanning/registration and the first destination follow the configured intake decision, while onward routing follows the separate approval decision.

**Deliverable:** The system can represent and route each flowchart branch without conflating initial reception with approval.

### Task 2: Make receipt state and real-time refresh consistent

**Files:**
- Modify: `backend/utils/documentRouting.js`
- Modify: `backend/routes/transmissions.js`
- Modify: `backend/routes/documents.js` only where another send/receive path bypasses the shared transition
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/components/DocumentPreviewModal.jsx`
- Test: `backend/test/documentRouting.test.js` and focused frontend state/formatting tests

- [ ] Trace all send, receive, forward, and return endpoints; ensure they update the same `Transmission` and `Document` records using shared transition logic.
- [ ] On destination receipt, set `currentOfficeId` to the receiving office, restore the correct workflow status, close the active send-history entry, and persist receiver/time before broadcasting.
- [ ] Ensure each mutation broadcasts invalidation for every affected collection and the client reloads documents and transmissions after reconnecting or receiving the event.
- [ ] Keep the selected preview bound to the latest document by ID so an open modal cannot retain stale status/location after `loadData()` completes.
- [ ] Add a reconnect or bounded refresh fallback only if investigation shows WebSocket invalidation cannot reliably cover offline/reconnecting clients.
- [ ] Verify with two signed-in clients: after one office records receipt, both the source tracker and destination tracker show the right status/location without reloading.

**Deliverable:** A receipt is the single transition point for current custody, and all open views converge to the persisted state promptly.

### Task 3: Preserve Receptionist lifecycle tracking without broadening action access

**Files:**
- Modify: `backend/utils/documentScope.js`
- Modify: `backend/routes/documents.js` registration/read paths as needed
- Modify: `backend/models/index.js` and migration path if a dedicated intake-office field is needed
- Modify: `dashboard/src/pages/ReceptionistDashboard.jsx`
- Modify: `dashboard/src/App.jsx` only if client-side visibility filters duplicate server scoping
- Test: `backend/test/documentScope.test.js` and route authorization tests

- [ ] Store or confirm a stable initial-reception office for incoming documents; do not rely on current destination, which changes during routing.
- [ ] Include incoming documents first received at the user's Receptionist office throughout their lifecycle, including transit, later offices, completion, and archive where policy permits.
- [ ] Keep the view read-only for historical documents; only the current/destination office and existing approval roles can perform workflow actions.
- [ ] Keep other office roles scoped to their current work and existing allowed tracking history; do not grant every previous office the Receptionist exception.
- [ ] Add tests proving visibility remains after Mayor forwards a document to Agriculture and after later sequential forwards, and proving an unrelated Receptionist cannot see it.

**Deliverable:** The Receptionist can monitor the full movement history of documents initially received at their office without acquiring workflow control over them.

### Task 4: Clean labels, timeline text, and layout

**Files:**
- Modify: `dashboard/src/components/DocumentPreviewModal.jsx`
- Modify: `dashboard/src/pages/ReceptionistDashboard.jsx`
- Modify: `dashboard/src/pages/DocumentList.jsx`
- Modify: relevant shared CSS in `dashboard/src/index.css`
- Add or modify: a focused timeline presentation/label helper and its tests if needed

- [ ] Inventory the cards, status boxes, workflow explanations, and timeline using the leader's notes and a current UI walkthrough.
- [ ] Map known machine actions (for example, underscore-separated action keys) to concise user-facing labels; show details only when they add useful context.
- [ ] Suppress empty, duplicate, unknown, or internal-only metadata instead of displaying raw IDs or fallback technical strings.
- [ ] Present timeline events in chronological order with consistent date, office, and person formatting.
- [ ] Align card labels, spacing, and text wrapping across the affected views; keep the meaning of each workflow state explicit.
- [ ] Review at desktop and narrow viewport widths for clipping, awkward wrapping, and inconsistent alignment.

**Deliverable:** Tracking cards and history read clearly to municipal staff without exposing internal action strings or filler text.

### Task 5: Integrated workflow review

- [ ] Test all four combinations of initial Mayor reception and Mayor approval/action using representative document types.
- [ ] Walk through receive, send, Mayor approval/rejection, return for revision, forward to Agriculture, receipt there, next-office forwarding, and completion/archive.
- [ ] Confirm status/current location, send/receive history, and Receptionist tracking update after every step without a manual refresh.
- [ ] Confirm role permissions remain correct and the Receptionist tracking exception is read-only.
- [ ] Review Timeline and dashboard cards against the leader's wording and verify layout at supported widths.
- [ ] Run the focused backend/frontend checks and the project build on the local test database; report any remaining Mayor's Office policy questions.

## Workflow interpretation used for implementation

Figure 6 explicitly shows two independent decisions: whether a document first goes through reception at the Mayor's Office, and whether it needs Mayor action/signature/approval after scanning and registration. The implementation represents them with separate document-type settings. Mayor approval still routes through the Mayor as an approval step when initial Mayor reception is not selected; both settings together produce one Mayor stop with the signing status. Existing document types default to no special initial reception, preserving their current route behavior.
