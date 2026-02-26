#!/bin/bash
# tj-scraper-pipeline.sh
# Full Trader Joe's scraper pipeline for SSM Run Command execution on EC2.
#
# Steps:
#   1. Source secrets from /opt/meal-gen/.env
#   2. Install Playwright Chromium browser (idempotent)
#   3. Run the Playwright scraper → /tmp/tj-scraper-work/tj-items.json
#   4. Import items into RDS via import_tj.py
#   5. Backfill embeddings via the RAG container
#   6. Clean up temp files
#
# CloudWatch log group: /meal-gen/prod/scraper (set in SSM document)
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_DIR="/opt/meal-gen"
SCRIPTS_DIR="${APP_DIR}/scripts"
WORK_DIR="/tmp/tj-scraper-work"
VENV_DIR="${APP_DIR}/.venv"
RAG_CONTAINER="python-rag"
RAG_URL="http://localhost:8000"
REGION="us-east-1"

log()   { echo "[TJ-PIPELINE] [$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
error() { log "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Setup
# ---------------------------------------------------------------------------
log "=== TJ Scraper Pipeline Start ==="
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# ---------------------------------------------------------------------------
# 1. Source environment from .env (DB creds, RAG secret, etc.)
# ---------------------------------------------------------------------------
ENV_FILE="${APP_DIR}/.env"
[[ -f "$ENV_FILE" ]] || error ".env not found at ${ENV_FILE}"

# Export only the vars we need (avoid exporting unrelated secrets)
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|RAG_SHARED_SECRET|SPRING_DATASOURCE_URL)=' "$ENV_FILE" | sed 's/^/export /')"

# Derive PG vars from SPRING_DATASOURCE_URL if individual vars aren't set
if [[ -z "${PGHOST:-}" ]] && [[ -n "${SPRING_DATASOURCE_URL:-}" ]]; then
  # Format: jdbc:postgresql://host:port/dbname
  PGHOST=$(echo "$SPRING_DATASOURCE_URL" | sed -E 's|jdbc:postgresql://([^:/]+).*|\1|')
  PGPORT=$(echo "$SPRING_DATASOURCE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
  PGDATABASE=$(echo "$SPRING_DATASOURCE_URL" | sed -E 's|.*/([^?]+).*|\1|')
  export PGHOST PGPORT PGDATABASE
fi

[[ -n "${PGHOST:-}"     ]] || error "PGHOST not set"
[[ -n "${PGPASSWORD:-}" ]] || error "PGPASSWORD not set"
[[ -n "${RAG_SHARED_SECRET:-}" ]] || error "RAG_SHARED_SECRET not set"

PGUSER="${PGUSER:-meal_user}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-mealgen}"
export PGUSER PGPORT PGDATABASE

log "DB host: ${PGHOST}"

# ---------------------------------------------------------------------------
# 2. Ensure Playwright Chromium browser is installed on this machine
# ---------------------------------------------------------------------------
log "=== Step 2: Playwright browser install ==="
cd "$SCRIPTS_DIR"
npm install --prefer-offline 2>&1 || npm install 2>&1
npx playwright install chromium --with-deps 2>&1
log "Playwright ready"

# ---------------------------------------------------------------------------
# 3. Run the scraper
# ---------------------------------------------------------------------------
log "=== Step 3: Run TJ scraper ==="
cd "$SCRIPTS_DIR"
node scrape_tj.js --output "${WORK_DIR}/tj-items.json" --meta "${WORK_DIR}/tj-metadata.json" 2>&1

ITEM_COUNT=$(python3 -c "import json,sys; d=json.load(open('${WORK_DIR}/tj-items.json')); print(len(d))")
log "Scraped ${ITEM_COUNT} items"

[[ "$ITEM_COUNT" -ge 100 ]] || error "Too few items scraped (${ITEM_COUNT}), aborting import"

# ---------------------------------------------------------------------------
# 4. Import items into RDS
# ---------------------------------------------------------------------------
log "=== Step 4: Import items into database ==="

# Activate the project venv if it exists (for psycopg2)
if [[ -f "${VENV_DIR}/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "${VENV_DIR}/bin/activate"
fi

export TJ_JSON_PATH="${WORK_DIR}/tj-items.json"
python3 "${SCRIPTS_DIR}/import_tj.py" 2>&1
log "Database import complete"

# ---------------------------------------------------------------------------
# 5. Backfill embeddings via RAG container
# ---------------------------------------------------------------------------
log "=== Step 5: Backfill embeddings ==="

for EMBED_TYPE in items nutrition ingredients; do
  log "Backfilling ${EMBED_TYPE} embeddings..."
  UPDATED=1
  BATCH=0
  while [[ "$UPDATED" -gt 0 ]]; do
    RESPONSE=$(docker exec "$RAG_CONTAINER" \
      curl -s -X POST \
        "http://localhost:8000/embed/backfill/${EMBED_TYPE}" \
        -H 'Content-Type: application/json' \
        -H "X-RAG-SECRET: ${RAG_SHARED_SECRET}" \
        -d '{"limit": 200}' 2>&1) || {
          log "WARNING: embed backfill curl failed for ${EMBED_TYPE}, skipping"
          break
        }
    UPDATED=$(echo "$RESPONSE" | python3 -c \
      "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('updated',0))" 2>/dev/null || echo 0)
    BATCH=$((BATCH + 1))
    log "  ${EMBED_TYPE}: batch=${BATCH} updated=${UPDATED}"
  done
  log "${EMBED_TYPE} embeddings complete (${BATCH} batches)"
done

# ---------------------------------------------------------------------------
# 6. Cleanup
# ---------------------------------------------------------------------------
log "=== Step 6: Cleanup ==="
rm -rf "$WORK_DIR"
log "Temp files removed"

log "=== TJ Scraper Pipeline Complete ==="
