# Deployment Checklist

## Required Environment

Backend:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/vinzons_digipath
PORT=5000
NODE_ENV=production
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:5173
API_BASE_URL=http://localhost:5000/api
DEVICE_API_KEY=replace_with_a_long_random_device_key
DEVICE_HEARTBEAT_TIMEOUT_MS=30000
SCANNER_COMMAND_STALE_MS=300000
SCANNER_BRIDGE_TIMEOUT_MS=4000
SCANNER_BRIDGE_PORT=8080
REPORT_TEMPLATE_PATH=
MAX_ATTACHMENTS_PER_DOCUMENT=8
MAX_ATTACHMENT_BYTES=10485760
```

Dashboard:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

## Before Sharing With The Team

- Confirm `backend/.env` is not committed.
- Confirm `backend/templates/Vinzons_Report_Template.docx` exists, or set `REPORT_TEMPLATE_PATH` to the deployed official report template.
- Confirm `node_modules/`, `dashboard/dist/`, and `backend/uploads/` are not committed.
- Run `npm.cmd run build` inside `dashboard`.
- Run backend syntax checks or start the backend once.
- Run `npm.cmd run migrate` if the database already has records.
- Run `npm.cmd run smoke` with the backend running.

## Production Notes

- Use a real long `JWT_SECRET`.
- Use a separate long `DEVICE_API_KEY` for the physical scanner.
- Keep `NODE_ENV=production` in deployed backend environments so weak secrets are rejected at startup.
- Restrict `CORS_ORIGIN` to the deployed dashboard URL.
- Keep attachment limits appropriate for your storage budget.
- Back up MongoDB before running migrations on real data.
- Back up `backend/uploads/scans` if scanned paper files are stored locally.
- For shared hosting, prefer persistent storage for `backend/uploads/scans`; otherwise uploaded scans may disappear when the server restarts or redeploys.
