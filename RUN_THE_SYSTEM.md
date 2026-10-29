# Running the System

Assuming all dependencies are already installed and environment variables (`.env` files) are properly configured, here are the commands to run the Vinzons DigiPath system.

## Option 1: Run Everything Together (Recommended)

To start both the backend server and the frontend dashboard concurrently, open a terminal in the root project directory (`VinzonsDIGIPATH`) and run:

```bash
npm run dev
```

Alternatively, to start them without development auto-reloading:

```bash
npm start
```

## Option 2: Run Separately

If you prefer to run the components in separate terminal windows for easier log reading:

### Start the Backend
Open a terminal, navigate to the backend folder, and start the server:
```bash
cd backend
npm run dev
```
*(The backend runs on `http://localhost:5000`)*

### Start the Dashboard
Open a second terminal, navigate to the dashboard folder, and start the Vite dev server:
```bash
cd dashboard
npm run dev
```
*(The frontend runs on `http://localhost:5173`)*

## Accessing the Dashboard
Once the system is running, open your web browser and go to:
**http://localhost:5173**

## Current maintenance and rollout rules

Use the [repair handoff](docs/SYSTEM_REPAIR_RESULTS_2026-10-29.md). Migration is schema-only and requires an explicit apply flag; live schema work additionally requires the documented write pause and verified backup. Seed/import/password-reset utilities are restricted to disposable test databases. Never run smoke/role write tests against live records. The current backend and physical Pi must receive matching strong credentials before the repaired backend is restarted.
