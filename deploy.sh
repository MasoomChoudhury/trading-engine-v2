#!/bin/bash
# =============================================================================
# Nifty50 Analytics Platform — Deploy Script
# Usage: bash deploy.sh
#
# On this VPS, .env is persisted at /root/nifty50-analytics/.env
# (it's gitignored so git pull never touches it).
# The script detects this and skips restore — no need to re-enter credentials.
# =============================================================================

set -e

REPO_URL="https://github.com/MasoomChoudhury/trading-engine-v2.git"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENV_BACKUP="/tmp/nifty50.env.backup.$(date +%s)"
NOW=$(date '+%Y-%m-%d %H:%M:%S')

echo "=============================================="
echo " Nifty50 Analytics — Deploy Script"
echo " Started: $NOW"
echo " Project: $PROJECT_DIR"
echo "=============================================="

# ── 1. Preserve .env (secrets not in repo) ────────────────────────────────
# .env is gitignored, but we backup to /tmp just in case
echo ""
echo "[1/7] Checking .env..."
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$ENV_BACKUP"
    echo "  → Found at $ENV_FILE — backed up to $ENV_BACKUP"
    ENV_EXISTED=true
else
    echo "  → No .env found — will create from .env.example"
    ENV_EXISTED=false
fi

# ── 2. Stop & remove existing containers ──────────────────────────────────
echo ""
echo "[2/7] Stopping existing containers..."
cd "$PROJECT_DIR"
docker compose down --remove-orphans 2>/dev/null || true
echo "  → Containers stopped"

# ── 3. Pull latest code from GitHub ───────────────────────────────────────
echo ""
echo "[3/7] Pulling latest code from GitHub..."
cd "$PROJECT_DIR"

if [ -d ".git" ]; then
    # Ensure we have the right remote
    git remote set-url origin "$REPO_URL" 2>/dev/null || true
    CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "master")
    git fetch origin "$CURRENT_BRANCH"
    git reset --hard "origin/$CURRENT_BRANCH"
    echo "  → Pulled latest ($CURRENT_BRANCH branch)"
else
    # Fresh clone if not a git repo
    if [ -d "$PROJECT_DIR" ] && [ "$(ls -A "$PROJECT_DIR" 2>/dev/null)" ]; then
        mv "$PROJECT_DIR" "${PROJECT_DIR}.old.$(date +%s)"
    fi
    git clone "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    echo "  → Cloned fresh from GitHub"
fi

# ── 4. Restore .env (only if it didn't exist) ────────────────────────────
# .env is gitignored so git pull never overwrites it.
# If somehow missing, restore from backup or create from example.
echo ""
echo "[4/7] Restoring .env..."
if [ "$ENV_EXISTED" = true ]; then
    cp "$ENV_BACKUP" "$ENV_FILE"
    echo "  → Restored from backup"
elif [ -f "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$ENV_FILE"
    echo "  → Restored from backup"
elif [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    echo "  → Created from .env.example — *** FILL IN YOUR CREDENTIALS ***"
else
    echo "  → WARNING: No .env or .env.example found!"
fi

# ── 5. Build & start containers ──────────────────────────────────────────
echo ""
echo "[5/7] Building and starting containers..."
cd "$PROJECT_DIR"
docker compose up -d --build
echo "  → Containers built and started"

# ── 6. Post-deploy setup ─────────────────────────────────────────────────
echo ""
echo "[6/7] Running post-deploy checks..."

# Wait for containers to be healthy
echo "  → Waiting for backend to be healthy..."
BACKEND_OK=false
for i in $(seq 1 15); do
    if curl -sf http://localhost:8001/api/v1/health > /dev/null 2>&1; then
        BACKEND_OK=true
        echo "  → Backend: HEALTHY (${i}x3s)"
        break
    fi
    sleep 3
done

if [ "$BACKEND_OK" != true ]; then
    echo "  → Backend: UNHEALTHY"
    echo "    Run: docker compose -f $PROJECT_DIR/docker-compose.yml logs backend"
fi

# Create logs DB tables (idempotent — CREATE TABLE IF NOT EXISTS)
echo "  → Ensuring logs DB tables exist..."
docker exec nifty50-postgres psql -U nifty50logs -d nifty50_logs -c "
CREATE TABLE IF NOT EXISTS api_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    endpoint VARCHAR(500) NOT NULL,
    method VARCHAR(10) NOT NULL,
    request_params JSONB,
    response_status INTEGER,
    response_body JSONB,
    duration_ms INTEGER,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_logs_timestamp ON api_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint ON api_logs (endpoint);

CREATE TABLE IF NOT EXISTS market_status_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    market VARCHAR(50),
    status VARCHAR(50),
    server_time TIMESTAMPTZ,
    data JSONB
);
CREATE INDEX IF NOT EXISTS idx_market_status_timestamp ON market_status_log (timestamp DESC);

CREATE TABLE IF NOT EXISTS app_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
" > /dev/null 2>&1 && echo "  → Logs DB tables: OK" || echo "  → Logs DB tables: FAILED"

# ── 7. Trigger data refresh ──────────────────────────────────────────────
echo ""
echo "[7/7] Triggering initial data refresh..."
REFRESH_OK=false
for i in $(seq 1 5); do
    if curl -sf -X POST http://localhost:8001/api/v1/admin/refresh > /dev/null 2>&1; then
        REFRESH_OK=true
        echo "  → Data refresh: OK"
        break
    fi
    sleep 2
done
if [ "$REFRESH_OK" != true ]; then
    echo "  → Data refresh: FAILED (will auto-retry in 5min via scheduler)"
fi

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo "=============================================="
echo " Deploy complete!"
echo ""
echo " Site: https://nifty50.masoomchoudhury.com"
echo " Backend: http://localhost:8001"
echo " Frontend: http://localhost:3001"
echo ""
echo " Useful commands:"
echo "   bash deploy.sh                        # re-deploy (safe, keeps .env)"
echo "   docker compose -f $PROJECT_DIR/docker-compose.yml logs -f"
echo "   docker compose -f $PROJECT_DIR/docker-compose.yml restart"
echo "   docker compose -f $PROJECT_DIR/docker-compose.yml down"
echo "=============================================="