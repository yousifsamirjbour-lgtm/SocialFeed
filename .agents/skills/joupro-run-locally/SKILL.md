---
name: joupro-run-locally
description: >-
  Procedures, runbooks, and commands for running the Joupro (SocialFeed) full-stack app locally using uv and Vite without Docker.
  Activate this skill whenever the user says "run the app locally", asks to start the local servers, run with uv, or launch the frontend and backend natively.
---

# Running Joupro (SocialFeed) Locally with uv (No Docker)

This skill provides step-by-step procedures to launch and verify the full-stack Joupro (SocialFeed) application locally on Windows using `uv` for the Python backend and `npm` / Vite for the React frontend.

> [!CAUTION]
> **DO NOT USE DOCKER TO RUN THE APP LOCALLY.**
> The host laptop resources are strictly limited. Always run the services natively using Python (`uv`) and Node.js (`npm`).

---

## 1. Architecture & Port Mapping

| Service | Technology | Command / Runner | Working Directory | Local Port | Health Check URL |
|---|---|---|---|---|---|
| **Backend** | FastAPI + Uvicorn | `uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000 --env-file backend/.env` | Project Root (`C:\Users\Al-Qema\Desktop\joupro`) | `8000` | `http://127.0.0.1:8000/docs` |
| **Frontend** | React 19 + Vite | `npm run dev` | `frontend/` | `5173` | `http://localhost:5173/` |
| **Database** | PostgreSQL | Native Windows Service | Localhost | `5432` | `localhost:5432` |

---

## 2. Step-by-Step Launch Workflow

### Step 1: Pre-flight Verification (Port Check)
Verify that ports `8000` and `5173` are not already occupied:

```powershell
Get-NetTCPConnection -LocalPort 8000, 5173 -State Listen -ErrorAction SilentlyContinue
```

If ports are in use by previous dev runs:
- To kill an existing process by PID: `Stop-Process -Id <OwningProcess> -Force`

Check that local PostgreSQL is accepting connections on port 5432:
```powershell
Test-NetConnection -ComputerName localhost -Port 5432
```

---

### Step 2: Start Backend Server (`uv`)

Launch FastAPI with `uv` as a background process from the project root:

```powershell
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000 --env-file backend/.env
```

*Key flags:*
- `--host 127.0.0.1`: Binds to local loopback.
- `--port 8000`: Standard API port.
- `--env-file backend/.env`: Injects local database URL (`localhost:5432`), Cloudinary, Tavily, and Groq credentials.

---

### Step 3: Start Frontend Server (`npm / Vite`)

Launch the Vite development server as a background process inside the `frontend/` directory:

```powershell
cd frontend
npm run dev
```

*Vite Proxy Behavior:*
- Vite proxies `/api/*` requests to `http://127.0.0.1:8000/*` with path rewrite (`rewrite: (path) => path.replace(/^\/api/, '')`), providing seamless communication between React and FastAPI without CORS or Docker networks.

---

### Step 4: Verification & Health Checks

Verify both servers are actively listening:
```powershell
Get-NetTCPConnection -LocalPort 8000, 5173 -State Listen
```

Run HTTP health check requests in PowerShell:
```powershell
# 1. Backend docs
(Invoke-WebRequest -Uri "http://127.0.0.1:8000/docs" -UseBasicParsing).StatusCode
# Expected output: 200

# 2. Frontend root
(Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing).StatusCode
# Expected output: 200

# 3. Vite proxy link to backend
(Invoke-WebRequest -Uri "http://localhost:5173/api/docs" -UseBasicParsing).StatusCode
# Expected output: 200
```

---

## 3. User Links

Once both processes are running and healthy, present the active links to the user:
- **Application Frontend**: [http://localhost:5173](http://localhost:5173)
- **Interactive Backend API Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
