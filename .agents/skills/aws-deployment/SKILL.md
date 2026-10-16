---
name: aws-deployment
description: >-
  Execute strict, two-phase zero-downtime deployments to a free-tier AWS EC2 instance.
  Use when the user asks to deploy merged features, run migrations, or update Nginx in production.
---

# Strict AWS Zero-Downtime Deployment

Procedures and runbooks for safely deploying merged features, executing schema migrations, configuring Nginx, and restarting services on the single-node AWS EC2 free-tier production server (`t3.micro`, host: `socialfeed.duckdns.org` / `13.62.51.232`).

---

## When to Use

Activate and follow this skill whenever:
- Finalizing a deployment on the production AWS server after a pull request has been merged.
- Running production database migrations.
- Updating or reloading Nginx configurations (e.g., adding proxy routes or SSE streaming blocks).
- Rebuilding or restarting production Docker containers.

---

## Core Safety Rules & Invariants

> [!CAUTION]
> **Strict Two-Phase Execution**:
> Always separate deployments into **PHASE 1: INSPECT** (read-only) and **PHASE 2: APPLY** (state-changing).
> You must show the user your inspection findings and the exact commands for Phase 2, and **explicitly wait for user approval** before executing any state-changing command.

1. **Zero-Cost Constraint**: Use only existing open-source tools (PostgreSQL, Nginx, Docker Compose). Never install or configure paid software or services.
2. **Forbidden Destructive Commands**:
   - `docker compose down -v` (never drop volumes)
   - `docker system prune` or deleting database volumes/images
   - `rm -rf`
   - Modifying firewall / security group settings or AWS billing configurations
3. **Secret Safety**:
   - Never print SSH private keys, passwords, database connection strings, or JWT/API tokens in command outputs or reports.
   - Display hostnames and service names only.
4. **No Production Git Pushes**: Never run `git push` or alter Git history on the production server. All code must arrive via pull request merge and `git pull`.

---

## PHASE 1: INSPECT (Read-Only)

Connect to the production server via SSH using the configured SSH key and perform these non-destructive checks:

### 1. System Health & Resources
```bash
# Check OS distribution and kernel
cat /etc/os-release | grep -E "PRETTY_NAME|VERSION="

# Check disk space on root volume
df -h /

# List currently running containers and their uptime
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### 2. Compose Topology & Project Directory
```bash
# Locate project directory (typically ~/SocialFeed or ~/joupro)
pwd && ls -la

# Verify Docker Compose service names
docker compose ps
```
- Confirm the service names used for:
  - Backend API (e.g., `api` or `backend`)
  - Database (e.g., `db` or `postgres`)
  - Frontend (e.g., `frontend`)

### 3. Worker Count Verification (Critical for In-Memory SSE Broker)
The notifications broker uses an in-memory queue that requires **exactly a single worker process**.
```bash
# Verify worker flag in container command or running processes
docker compose exec api ps aux | grep uvicorn
```
- Ensure `--workers` is absent or set to `1`. If multiple workers are running, stop and alert the user.

### 4. Database Schema & Migration Status
```bash
# List existing tables to verify schema state
docker compose exec db psql -U postgres -d socialfeed -c "\dt"
```
- Inspect if the target migration's tables/columns exist or are pending.
- If earlier, unexpected migrations appear unapplied, **STOP** and report to the user instead of proceeding.

### 5. Nginx Configuration & Routing
```bash
# View active Nginx configuration for the site
cat /etc/nginx/sites-enabled/* | grep -E "server_name|location|proxy_pass" -A 10
```
- Inspect how `/api` is proxied (whether prefix is stripped and how backend routes match).
- Check SSL certificate management (e.g., Let's Encrypt / Certbot).

### 6. Phase 1 Report & User Approval Gate
Present a clear, structured summary of findings to the user:
- OS and free disk space
- Running containers and compose services
- Database connection details (host and DB name only, no passwords)
- Applied vs. pending migrations
- Current Nginx proxy configuration
- **The exact list of commands planned for Phase 2**

> [!IMPORTANT]
> **STOP AND WAIT FOR APPROVAL**: Do not run any commands from Phase 2 until the user explicitly responds with approval.

---

## PHASE 2: APPLY (State-Changing, After Approval)

Execute each step sequentially, verifying each action before moving to the next:

### Step 1: Database Backup
Verify free disk space prior to taking the backup:
```bash
# Check disk space
df -h /

# Create backup directory outside the repository if not present
mkdir -p ~/backups

# Execute pg_dump to a timestamped file
docker compose exec -T db pg_dump -U postgres -d socialfeed -F c > ~/backups/socialfeed_backup_$(date +%Y%m%d_%H%M%S).dump

# Verify backup size and path
ls -lh ~/backups/
```

### Step 2: Database Migration
Apply only the newly merged, idempotent migration:
```bash
# Apply migration via Alembic (stamping/upgrading) or idempotent SQL script
docker compose exec api alembic upgrade head
# Or execute idempotent script:
# docker compose exec -T db psql -U postgres -d socialfeed < migrations/<target_migration>.sql

# Verify newly created tables and indexes
docker compose exec db psql -U postgres -d socialfeed -c "\d+ <new_table>"
```

### Step 3: Nginx Update (If Required)
If an SSE stream or new proxy location block is needed:

1. **Back up current Nginx configuration**:
   ```bash
   sudo cp /etc/nginx/sites-available/<config_name> /etc/nginx/sites-available/<config_name>.bak_$(date +%Y%m%d_%H%M%S)
   ```
2. **Apply changes** with proper SSE settings:
   - `proxy_http_version 1.1;`
   - `proxy_buffering off;`
   - `proxy_cache off;`
   - `proxy_set_header Connection '';`
   - `proxy_read_timeout 3600s;`
   - `proxy_send_timeout 3600s;`
3. **Show configuration diff** to ensure no other blocks were altered:
   ```bash
   diff -u /etc/nginx/sites-available/<config_name>.bak_* /etc/nginx/sites-available/<config_name>
   ```
4. **Test and reload**:
   ```bash
   sudo nginx -t
   # If test passes:
   sudo systemctl reload nginx
   ```
   *(If `nginx -t` fails, restore the backup immediately: `sudo cp <backup> <config>` and abort).*

### Step 4: Container Restart
Rebuild and restart **ONLY** the backend container (and frontend only if updated):
```bash
# Rebuild and recreate backend container
docker compose up -d --build api

# Confirm container is healthy and running with 1 worker
docker compose ps api
docker compose logs --tail=50 api
```

---

## VERIFY (Read-Only Post-Deployment Checks)

Perform verification without inserting fake or dirty data into production:

### 1. Unauthenticated Endpoint Test
```bash
# Curl the new endpoint / SSE stream without authorization headers
curl -I -s https://socialfeed.duckdns.org/api/notifications/stream
```
- Verify: Returns `401 Unauthorized` quickly (not hanging or timing out).
- Verify: Response headers contain expected SSE proxy headers if configured.

### 2. Container Log Check
```bash
# Check recent backend logs for startup errors
docker compose logs --tail=100 api | grep -iE "error|exception|traceback|relation does not exist"
```
- Confirm: Zero unhandled tracebacks, zero "relation does not exist" database errors.

### 3. User Live Test Instructions
Provide the user with clear instructions to test live with their own accounts:
1. Open two browser windows (one standard, one incognito).
2. Log into Account A in Window 1 and Account B in Window 2.
3. Perform the trigger action (e.g., liking a post, commenting, sending a direct message).
4. Verify real-time push update and badge appearance in Window 2 without refreshing.
5. Verify clean read receipt and notification state.
