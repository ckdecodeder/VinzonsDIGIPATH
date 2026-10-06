# Vinzons DigiPath — Setup, Database, at Port/Link Guide

Gabay ito para sa bagong PC o teammate: paano i-clone ang repo, i-load ang database, at palitan ang dev tunnel / port links.

---

## Important: Hindi Prisma ang gamit dito

May `backend/prisma/schema.prisma` pero **reference lang** iyon. Ang tunay na setup ay:

| Gawain | Command |
|--------|---------|
| Gumawa ng tables + i-import ang data | `npm run migrate` |
| I-export ang live DB pabalik sa JSON (para ma-push sa Git) | `npm run export-db` |
| I-reset ang demo passwords pagkatapos ng migrate | `node backend/scripts/set-demo-passwords.js` |

Parang `prisma db push` + `prisma db seed`, pero ang seed files ay nasa **`dbcollections/*.json`**.

---

## 1. Unang setup (bagong laptop)

### Step A — Prerequisites

1. **Node.js** (LTS) — https://nodejs.org
2. **PostgreSQL** — https://www.postgresql.org/download/
   - Default port: `5432`
   - Tandaan ang postgres password mo

### Step B — Clone at install

```powershell
git clone https://github.com/xjmerco/VinzonsDIGIPATH.git
cd digipath
npm run install:all
```

### Step C — Environment files (`.env`)

**Hindi naka-push sa Git ang tunay na `.env`** (may password at JWT secret). Safe iyon — huwag i-force push ng secrets sa public GitHub.

Gawin mo manually:

```powershell
copy backend\.env.example backend\.env
copy dashboard\.env.example dashboard\.env
copy network.env.example network.env
```

Edit **`backend/.env`** — palitan ang database password:

```env
DATABASE_URL=postgresql://postgres:IYONG_PASSWORD@127.0.0.1:5432/vinzons_digipath
PORT=5000
JWT_SECRET=magpalit_ng_mahaba_at_random
DEVICE_API_KEY=dev-device-key-change-me
```

### Step D — Load database (automatic mula sa JSON)

Siguraduhing naka-on ang PostgreSQL, tapos:

```powershell
npm run migrate
```

Ito ang mangyayari:
1. Gagawa ng database `vinzons_digipath` kung wala pa
2. Gagawa/update ng lahat ng tables
3. I-import ang lahat ng records mula sa `dbcollections/*.json`

Optional — known demo logins:

```powershell
node backend/scripts/set-demo-passwords.js
```

| Username | Password |
|----------|----------|
| admin | admin123 |
| mayor | mayor123 |
| receptionist | recep123 |
| (iba pa) | `{username}123` |

### Step E — Run ang app

**Local lang (same PC):**

```powershell
npm run dev
```

- Dashboard: http://localhost:5173
- Backend API: http://localhost:5000

**Full stack (backend + dashboard + tunnel):**

```powershell
npm start
```

---

## 2. Paano i-push ang database data sa GitHub

Ang **database data** ay naka-store sa folder na **`dbcollections/`** — ito ang ini-import ng `npm run migrate`. Naka-track na ito sa Git (hindi kailangan ng `.env` para sa data).

### Kung may bagong data ka sa live PostgreSQL at gusto mong i-share:

```powershell
npm run export-db
git add dbcollections/
git commit -m "update database export"
git push
```

Sa ibang PC, pagkatapos ng `git pull`:

```powershell
npm run migrate
```

Mau-update/ma-merge ang records (upsert — hindi buburahin ang buong DB unless fresh install).

### Buong PostgreSQL dump (optional, advanced)

Kung gusto mo ng full SQL backup:

```powershell
pg_dump -U postgres -d vinzons_digipath -F c -f database-export/vinzons_digipath.dump
```

> Note: `database-export/` ay naka-gitignore. Ilipat manually o i-share sa ibang paraan kung kailangan.

---

## 3. Paano palitan ang link / forwarded port (Dev Tunnel)

Kapag nagbago ang VS Code/Cursor dev tunnel URL (hal. `https://XXXX-5000.asse.devtunnels.ms`), **isang file lang ang i-edit**:

### `network.env` (root folder)

```env
DIGIPATH_PUBLIC_BACKEND_URL=https://BAGONG-URL-DITO.asse.devtunnels.ms
DIGIPATH_DEVICE_API_KEY=dev-device-key-change-me
```

Tapos i-sync sa lahat ng `.env` files:

```powershell
npm run network:sync
```

Awtomatikong ma-u-update ang:
- `dashboard/.env` → `VITE_API_BASE_URL`, `VITE_WS_URL`
- `backend/.env` → `PUBLIC_API_URL`, `DEVICE_API_KEY`
- `bridge.env` → Pi scanner bridge config
- `pi_ws_scanner.env` / `raspberry_pi/` copies kung meron

### Sa VS Code / Cursor — i-forward ang ports

| Port | Service |
|------|---------|
| **5000** | Backend API — **Visibility: Public** |
| **5173** | Dashboard (optional, para sa remote browser) |

Pagkatapos makuha ang bagong tunnel URL para sa port 5000, ilagay sa `network.env` at `npm run network:sync`.

### Local dev lang (walang tunnel)

Sa `network.env`, pwede mong i-set:

```env
DIGIPATH_DASHBOARD_LOCAL_API=1
```

Tapos `npm run network:sync` — gagamitin ng dashboard ang `/api` proxy sa localhost.

O manual sa `dashboard/.env`:

```env
VITE_API_BASE_URL=/api
```

At sa `dashboard/vite.config.js`, ang proxy target ay default `http://127.0.0.1:5000`.

Kung iba ang backend port (hal. 5001):

```env
# dashboard/.env
VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:5001
```

```env
# backend/.env
PORT=5001
```

---

## 4. Quick reference — ports at URLs

| Setting | File | Halaga (default) |
|---------|------|------------------|
| Backend port | `backend/.env` → `PORT` | `5000` |
| Dashboard port | `dashboard/vite.config.js` | `5173` |
| Public API URL | `network.env` → `DIGIPATH_PUBLIC_BACKEND_URL` | dev tunnel URL |
| Frontend API | `dashboard/.env` → `VITE_API_BASE_URL` | sync via `network:sync` |
| DB connection | `backend/.env` → `DATABASE_URL` | `postgresql://...@127.0.0.1:5432/vinzons_digipath` |
| Pi bridge | `bridge.env` | synced from `network.env` |
| Scanner bridge port | `backend/.env` → `SCANNER_BRIDGE_PORT` | `8080` |

---

## 5. Troubleshooting

### `DATABASE_URL is not set`
- May `backend/.env` ba? Copy mula sa `backend/.env.example`.

### `Migration failed` / cannot connect
- Naka-run ba ang PostgreSQL service?
- Tama ba ang password sa `DATABASE_URL`?

### Dashboard blank / API error
- Backend running sa port 5000?
- Kung remote: tama ba ang `DIGIPATH_PUBLIC_BACKEND_URL` + `npm run network:sync`?
- Try local: `DIGIPATH_DASHBOARD_LOCAL_API=1` then sync.

### Login ayaw
- Run: `node backend/scripts/set-demo-passwords.js`

### Malaking `dbcollections` files
- Normal — may embedded PDF scans sa documents JSON. Git push ay maaaring mabagal; consider Git LFS kung sobrang laki.

---

## 6. Buong workflow cheat sheet

```powershell
# Bagong machine
git clone <repo-url>
cd digipath
npm run install:all
copy backend\.env.example backend\.env
copy network.env.example network.env
# edit backend/.env DATABASE_URL + JWT_SECRET
npm run migrate
node backend/scripts/set-demo-passwords.js

# Bagong dev tunnel URL
# edit network.env → DIGIPATH_PUBLIC_BACKEND_URL
npm run network:sync
npm start

# I-share ang latest DB sa team
npm run export-db
git add dbcollections/
git commit -m "update database"
git push

# Sa teammate machine
git pull
npm run migrate
```

---

## Bakit hindi naka-push ang `.env`?

May tunay na password (`DATABASE_URL`), `JWT_SECRET`, at API keys ang `.env`. Kung ma-push sa GitHub, **kahit sino pwedeng mag-login o ma-access ang DB**.

Safe approach:
- Push **`*.env.example`** + **`dbcollections/`** + **`network.env.example`**
- I-share ang tunay na `.env` privately (Messenger, email, USB) o gamitin **private repo** lang

Kung **private repo** at talagang gusto ninyong isama ang `.env`, kailangan alisin sa `.gitignore` — **hindi recommended** para sa public GitHub.
