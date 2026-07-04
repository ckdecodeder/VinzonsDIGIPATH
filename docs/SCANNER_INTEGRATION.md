# Scanner Integration

The dashboard supports camera/manual upload scans. Physical scanner connection status is separate and is controlled only by hardware API-key events.

Scanned documents now enter the system as:

```text
intakeStatus = Pending Review
status = Received
```

An Admin or Mayor must approve the document before it can be routed, processed, signed, or archived. If it is rejected, the reason is stored on the document and the current office can resubmit it after correction.

## Dashboard Scan Endpoint

```text
POST http://localhost:5000/api/scanner/documents
Authorization: Bearer <login-token>
Content-Type: application/json
```

Allowed roles:

```text
Admin, Receptionist
```

## Payload

```json
{
  "document": {
    "subject": "Incoming permit request",
    "documentDirection": "Incoming",
    "priorityLevel": "normal",
    "documentTypeId": "DT-001",
    "dateReceived": "2026-05-06",
    "originOfficeId": "OFF-001",
    "currentOfficeId": "OFF-001",
    "senderName": "External Sender"
  },
  "attachment": {
    "name": "permit-request.jpg",
    "type": "image/jpeg",
    "dataUrl": "data:image/jpeg;base64,<base64-data>",
    "source": "scanner"
  }
}
```

The backend stores the scanned file under:

```text
backend/uploads/scans
```

The saved document stores a file URL in `scannedFiles[].url`, so the dashboard can preview the scanned paper later.

## Expected Response

```json
{
  "document": {
    "id": "DOC-...",
    "trackingNumber": "TRK-2026-....",
    "status": "Received",
    "intakeStatus": "Pending Review",
    "scannedFiles": [
      {
        "url": "http://localhost:5000/uploads/scans/..."
      }
    ]
  }
}
```

## Physical Device Connection

Set `DEVICE_API_KEY` in `backend/.env`. The physical scanner must send this header on every hardware request:

```text
x-device-key: <DEVICE_API_KEY>
Content-Type: application/json
```

The Raspberry Pi bridge now sends this automatically when it starts:

```text
POST http://localhost:5000/api/devices/connect
```

The bridge also sends heartbeats automatically before `DEVICE_HEARTBEAT_TIMEOUT_MS` expires. The default backend timeout is 30 seconds and the bridge default heartbeat interval is 10 seconds:

```text
POST http://localhost:5000/api/devices/heartbeat
```

Disconnect cleanly when the device shuts down:

```text
POST http://localhost:5000/api/devices/disconnect
```

Report scanner/RFID events through:

```text
POST http://localhost:5000/api/devices/events
```

## Raspberry Pi Command Bridge

The `s` branch scanner bridge has been integrated as [pi_scanner_bridge.py](../pi_scanner_bridge.py). Run it on the Raspberry Pi, not on the dashboard computer.

Pi environment:

```bash
export DIGIPATH_BACKEND_BASE_URL="http://YOUR_BACKEND_IP:5000/api"
export DIGIPATH_DEVICE_API_KEY="same value as backend DEVICE_API_KEY"
export DIGIPATH_DEVICE_ID="DEV-001"
export DIGIPATH_OFFICE_ID="OFF-001"
export DIGIPATH_STREAM_PORT="8080"
export DIGIPATH_CAMERA_CLI=""
export DIGIPATH_HEARTBEAT_INTERVAL_SECS="10"
python3 pi_scanner_bridge.py
```

Install Pi dependencies:

```bash
sudo apt install -y tesseract-ocr
pip3 install picamera2 pytesseract Pillow requests
```

The bridge:

- Serves an MJPEG preview at `http://PI_IP:8080/stream.mjpg`.
- Serves a single preview frame at `http://PI_IP:8080/snapshot.jpg`.
- Serves bridge health JSON at `http://PI_IP:8080/status`.
- Uses `picamera2` when available and falls back to `rpicam-still` / `libcamera-still` for preview snapshots.
- Auto-connects to `POST /api/devices/connect` on startup.
- Sends recurring `POST /api/devices/heartbeat` events.
- Sends `POST /api/devices/disconnect` on clean shutdown.
- Exposes local one-button dashboard actions at `POST http://PI_IP:8080/connect`, `/heartbeat`, and `/disconnect`.
- Polls `GET /api/devices/:deviceId/commands` using `x-device-key`.
- Uploads completed scans to `POST /api/devices/scans` using `x-device-key`.
- Marks scan commands as `Executed` or `Failed` through `PUT /api/devices/commands/:id`.

The dashboard can queue a physical scan command from Scan Documents when Device Management shows the scanner as connected. The live preview uses `/snapshot.jpg`, but capture uses the backend command queue and Pi upload worker. A preview warning does not automatically mean capture failed; confirm the command status and uploaded attachment.

Device Management also has a **Connect Scanner** button that calls the Pi bridge's local `/connect` endpoint, so the teammate does not need to type manual backend commands as long as `pi_scanner_bridge.py` is already running on the Raspberry Pi and the bridge URL points to the Pi.

For service installation and SSH deployment, see [RASPBERRY_PI_SETUP.md](../RASPBERRY_PI_SETUP.md). The deploy script copied from the `tenth` branch is available at [scripts/deploy-pi-bridge.ps1](../scripts/deploy-pi-bridge.ps1).

Example heartbeat payload:

```json
{
  "deviceId": "DEV-001",
  "name": "Physical Document Scanner",
  "model": "Scanner prototype",
  "location": "Reception Area",
  "serialNumber": "DEVICE-SERIAL",
  "firmware": "prototype",
  "payload": {
    "cpuUsage": 32,
    "memoryUsage": 51,
    "diskUsage": 28,
    "networkLatency": 11
  }
}
```

Example RFID event payload:

```json
{
  "deviceId": "DEV-001",
  "eventType": "rfid_detected",
  "documentId": "DOC-123456-789",
  "officeId": "OFF-003",
  "rfidTag": "RFID-2026-0001",
  "signalStrength": -42,
  "details": "Document detected near Engineering receiving desk"
}
```

When an `rfid_detected` event includes `documentId`, `officeId`, and `rfidTag`, the backend records the device event, appends a document timeline entry, stores the RFID tag on the document, and updates the document's current office/location.

## Scanner Device Notes

- Dashboard camera/manual scans do not mark the physical device as connected.
- The scanner is shown as connected only while fresh hardware heartbeat/events are being received.
- The bridge server starts even if the camera is not ready, so `/status` can explain whether the camera is available.
- The dashboard preview and bridge controls go through authenticated backend proxy routes under `/api/device/bridge/*`, which avoids browser CORS issues and malformed direct bridge URLs.
- Stale Pending/Executing scan commands are cancelled before a new command after `SCANNER_COMMAND_STALE_MS`.
- Send base64 image/PDF data as a `dataUrl`.
- Device command and scan upload endpoints require `x-device-key`.
- Do not route to the same office as the origin office.
- For large scans, compress to a reasonable image size before sending.
