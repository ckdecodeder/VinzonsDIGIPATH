# Diagram Notes - Vinzons DigiPath

## ERD Changes

- Added `Username` and `Password` to `USER` because the system has login accounts.
- Added document fields used by the dashboard: priority level, sender details, remarks, scanned text, and scanned image URL.
- Added `ACTIVITY_LOG` because the system records document, user, transmission, archive, login, logout, and device activities.
- Added `NOTIFICATION` because review requests, route acknowledgements, processing updates, and archive readiness are now stored in MongoDB instead of existing only in the frontend.
- Added `DEVICE` because the system has a scanner/device control panel.
- Kept `DOCUMENT_TYPE` because the UI uses document categories, even though the backend still needs a matching model before the database is fully complete.
- Clarified that one `DOCUMENT` can have many `TRANSMISSION` records.
- Clarified that `Received_by` in `TRANSMISSION` can be nullable while a transmission is still pending.

## DFD Changes

- Updated the process actors to use the current three roles: `Admin`, `Mayor`, and `Receptionist`.
- Added scanner/OCR flow because the dashboard has document scanning and text extraction.
- Added intake approval/rejection because scanned and receptionist-created documents now require Admin/Mayor review before routing.
- Added RFID/device event location updates because scanner hardware can update the document's current office and RFID metadata.
- Added external sender/public tracking acknowledgement because claim slips now expose a tracking number that can be checked without logging in.
- Added office processing updates because destination offices can start processing, add notes, and complete/sign documents through the workflow.
- Added archive flow because the system supports document archiving.
- Added activity log flow because logs are part of the project.
- Added data stores for users, offices, documents, transmissions, archives, activity logs, devices, and document types.

## Current Implementation Note

The updated ERD now matches the database-backed implementation more closely. The backend already includes `DOCUMENT_TYPE`, `DEVICE`, `LOG`, authentication, and the main CRUD routes used by the dashboard.

