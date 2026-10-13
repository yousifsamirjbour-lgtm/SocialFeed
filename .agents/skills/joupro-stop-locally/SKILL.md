---
name: joupro-stop-locally
description: >-
  Procedures and commands to stop and shut down the locally running Joupro (SocialFeed) servers (FastAPI backend on port 8000 and Vite frontend on port 5173).
  Activate this skill whenever the user says "shut the app down", "stop the app", "stop the servers", "kill the servers", or asks to terminate local dev processes.
---

# Shutting Down Joupro (SocialFeed) Local Servers

This skill provides step-by-step procedures to cleanly terminate and verify the shutdown of the full-stack Joupro (SocialFeed) development servers on Windows.

---

## 1. Port Identification

The local app runs on two dedicated ports:
- **Port 8000**: FastAPI / Uvicorn backend server
- **Port 5173**: Vite development frontend server

---

## 2. Step-by-Step Shutdown Workflow

### Step 1: Terminate Managed Background Tasks
If the servers were launched in the current agent session, list and kill the running background tasks:

1. List active tasks:
   ```text
   manage_task: action='list'
   ```
2. Kill backend task (`uvicorn` / `uv`) and frontend task (`vite` / `npm`):
   ```text
   manage_task: action='kill', TaskId='<backend_task_id>'
   manage_task: action='kill', TaskId='<frontend_task_id>'
   ```

---

### Step 2: Kill Orphaned Processes by Port
If the processes were started in an external terminal or remain listening on the ports after task cancellation, locate their PIDs and force stop them using PowerShell:

```powershell
$conns = Get-NetTCPConnection -LocalPort 8000, 5173 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $conns | ForEach-Object {
        Write-Host "Stopping PID $($_.OwningProcess) on port $($_.LocalPort)..."
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "No active processes found on ports 8000 or 5173."
}
```

---

### Step 3: Verify Full Shutdown

Verify that both ports are completely closed and no longer listening:

```powershell
Get-NetTCPConnection -LocalPort 8000, 5173 -State Listen -ErrorAction SilentlyContinue
```

*Expected Result:*
- The command should return nothing (exit code 1 or empty output).
- Both port `8000` and port `5173` are confirmed free and released.

---

### Step 4: Confirm to User

Notify the user that:
1. The FastAPI backend server on port 8000 is stopped.
2. The Vite frontend server on port 5173 is stopped.
3. System resources have been freed.
