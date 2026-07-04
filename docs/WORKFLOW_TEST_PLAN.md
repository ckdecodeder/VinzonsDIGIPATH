# Workflow Test Plan

Use this checklist after pulling the updated branch.

## 1. Backend Health

```powershell
cd backend
npm.cmd run dev
```

Open:

```text
http://localhost:5000/api/status
```

Expected:

```json
"database": "connected"
```

## 2. Seed Or Migrate

For a fresh database:

```powershell
npm.cmd run seed
```

For an existing database that has older records:

```powershell
npm.cmd run migrate
```

## 3. Automated Workflow Smoke Test

Keep the backend running, then open another terminal:

```powershell
cd backend
npm.cmd run smoke
```

Expected result:

```text
Workflow smoke test passed.
```

This creates one test document, routes it, receives it, signs it, archives it, and prints the created IDs.
By default, the test deletes its own test document, transmission, and archive after passing. Set `SMOKE_KEEP_DATA=true` if you intentionally want to keep the test records.

## 4. Automated Role Audit

Keep the backend running, then run:

```powershell
cd backend
npm.cmd run audit:roles
```

Expected result:

```text
Workflow and role audit passed.
```

This confirms Admin, Mayor, and Receptionist permissions match the workflow boundaries.

## 5. Manual Dashboard Test

1. Login as `admin / admin123`.
2. Open Documents and create a new document with a scanned image or PDF attachment.
3. Click the document row and confirm the detail popup opens.
4. Click the scanned file and confirm the preview opens.
5. Route the document to another office.
6. Open Transmissions and click the transmission row.
7. Confirm the transmission detail popup opens.
8. Receive the transmission.
9. Add a document action, mark it For Signing if needed, then mark it For Filing.
10. Print the document claim slip and confirm it contains the tracking number.
11. Logout and use Track Document on the login page with that tracking number.
12. Archive the document.
13. Open Archives and click the archive row.
14. Confirm the archive detail popup and scanned paper preview work.
15. Open Reports, download each report category as an official DOCX report and confirm it follows the Vinzons report template.

## Notification Test

1. Create or scan a document as Receptionist.
2. Login as Mayor or Admin and confirm a persistent review notification appears.
3. Approve or reject the document.
4. Login as the creating Receptionist and confirm the approval or rejection notification appears.
5. Dismiss a notification, refresh the page, and confirm it stays dismissed.

## Security And Data Integrity Test

1. Try uploading a non-image/non-PDF file to a document and confirm the backend rejects it.
2. Try deleting an office that still has users or documents and confirm the system blocks it.
3. Try deleting a document type already used by documents and confirm the system blocks it.
4. Logout, manually clear or expire the token, then confirm the dashboard returns to the login screen on the next protected request.
5. Confirm `backend/.env`, `node_modules`, `dashboard/dist`, and `backend/uploads` are still excluded from Git.

## Scanner Intake Approval Test

1. Login as `receptionist / recep123`.
2. Open Scan Document.
3. Capture or upload a document and submit it.
4. Open Documents and confirm the document shows `Pending Review`.
5. Login as `mayor / mayor123` or `admin / admin123`.
6. Open the document detail popup.
7. Approve the document.
8. Confirm the Route, Process, Sign, and Archive actions are now available according to role.
9. Repeat with another scanned document and reject it with a reason. Confirm the reason appears in the document details and routing stays blocked.
10. Correct the rejected document as Receptionist or Admin, click Resubmit, then confirm it returns to `Pending Review`.

## Physical Device Connection Test

With the backend running, send a hardware heartbeat using the same value you set for `DEVICE_API_KEY`:

```powershell
curl.exe -X POST http://localhost:5000/api/devices/heartbeat `
  -H "Content-Type: application/json" `
  -H "x-device-key: YOUR_DEVICE_API_KEY" `
  -d "{\"deviceId\":\"DEV-001\",\"name\":\"Physical Document Scanner\",\"model\":\"Prototype\",\"location\":\"Reception Area\",\"payload\":{\"cpuUsage\":32,\"memoryUsage\":51,\"diskUsage\":28,\"networkLatency\":11}}"
```

Then open Device Management and confirm it changes to connected. Stop sending heartbeats and it should return to disconnected after the timeout.

To test RFID document location updates, send:

```powershell
curl.exe -X POST http://localhost:5000/api/devices/events `
  -H "Content-Type: application/json" `
  -H "x-device-key: YOUR_DEVICE_API_KEY" `
  -d "{\"deviceId\":\"DEV-001\",\"eventType\":\"rfid_detected\",\"documentId\":\"DOC-ID-HERE\",\"officeId\":\"OFF-002\",\"rfidTag\":\"RFID-TEST-001\",\"details\":\"Detected at receiving desk\"}"
```

Then open the document details and confirm the RFID tag and last detected office are shown.
