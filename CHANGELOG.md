# Vinzons DigiPath — System Changelog

All changes made to this system are documented here in reverse-chronological order (newest first).

Format per entry:
- **Date** — The date the change was made
- **Type** — `FIX`, `FEATURE`, `CONFIG`, `REFACTOR`, `MIGRATION`, or `PLANNED`
- **Description** — What was changed and why


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
- Set `DATABASE_URL` PostgreSQL password to match local installation (`123`)
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
- Reset all 15 user passwords to `{username}123` format
- Key accounts: `santos/santos123` (Admin), `sean/sean123` (Mayor), `unc/unc123` (Office)

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
*Always add your entry at the TOP of the log, under today's date.*
