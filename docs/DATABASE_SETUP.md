# Database Setup - Vinzons DigiPath

The project now has MongoDB models, API routes, and a seed script that can load the current demo records into the database.

## 1. Install Or Create MongoDB

Use one of these options:

- Local MongoDB Community Server
- MongoDB Atlas cloud cluster

## 2. Configure Backend Environment

Open `backend/.env` and set:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/vinzons_digipath
PORT=5000
NODE_ENV=development
JWT_SECRET=change_this_to_a_long_random_secret
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:5173
API_BASE_URL=http://localhost:5000/api
DEVICE_API_KEY=change_this_device_key
DEVICE_HEARTBEAT_TIMEOUT_MS=30000
SCANNER_COMMAND_STALE_MS=300000
SCANNER_BRIDGE_TIMEOUT_MS=4000
SCANNER_BRIDGE_PORT=8080
REPORT_TEMPLATE_PATH=
MAX_ATTACHMENTS_PER_DOCUMENT=8
MAX_ATTACHMENT_BYTES=10485760
```

For MongoDB Atlas, replace `MONGODB_URI` with your Atlas connection string.
Leave `REPORT_TEMPLATE_PATH` blank to use `backend/templates/Vinzons_Report_Template.docx`, or set it to another official DOCX template path.

## 3. Seed The Database

From the project folder:

```powershell
cd .\backend
npm.cmd run seed
```

The seed command upserts records, so it can be run more than once without duplicating records that use the same IDs.
It also hashes the default account passwords before storing them in MongoDB.

## 3.5. Migrate Existing Records

If the database already has documents from an older version, run:

```powershell
npm.cmd run migrate
```

The migration backfills office location fields, timeline entries, archive timestamps, and missing transmission receive timestamps.

## 4. Run The System

From the project root, you can start both services:

```powershell
npm.cmd run dev
```

Or run each service separately.

Backend terminal:

```powershell
cd .\backend
npm.cmd run dev
```

Frontend terminal:

```powershell
cd .\dashboard
npm.cmd run dev
```

Open the frontend URL shown by Vite, usually:

```text
http://localhost:5173/
```

## 5. Check Connection

Open:

```text
http://localhost:5000/api/status
```

Expected database-connected response:

```json
{
  "status": "API is running",
"database": "connected"
}
```

## 6. Test The Full Workflow

With the backend running:

```powershell
npm.cmd run smoke
```

Expected:

```text
Workflow smoke test passed.
```

This creates one temporary test workflow in MongoDB so you can confirm CRUD, routing, receiving, signing, and archiving are connected.
The smoke test now checks public tracking, persistent notifications, signing/filing actions, and cleanup unless `SMOKE_KEEP_DATA=true` is set.

## Default Seed Login Accounts

```text
admin / admin123
mayor / mayor123
receptionist / recep123
```

## Security Notes

- Do not commit `backend/.env`.
- Do not commit `node_modules`, `dashboard/dist`, or `backend/uploads`.
- Use a long, unique `JWT_SECRET` for shared deployments.
- Production mode refuses to start if `JWT_SECRET` or `DEVICE_API_KEY` are missing or left on dev defaults.
- Uploads are restricted to JPG, PNG, WebP, and PDF files, with the size and count controlled by the attachment environment values.
- Office, user, and document type deletes are blocked when records still depend on them.
- Expired or invalid frontend sessions are cleared automatically and return the user to login.
- Passwords are stored as bcrypt hashes after seeding or creating users through the API.
