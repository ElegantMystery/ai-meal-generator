#!/usr/bin/env bash
# run_pipeline.sh — Scrape Whole Foods and upload results to EC2
#
# Usage:
#   ./run_pipeline.sh
#
# Connection (set one of EC2_INSTANCE_ID or EC2_HOST):
#   EC2_INSTANCE_ID — EC2 instance id (e.g. i-0123…); connect via SSM Session
#                     Manager — no public :22 needed. Requires AWS CLI +
#                     session-manager-plugin + AWS credentials. (preferred)
#   EC2_HOST        — public IP/hostname; legacy direct SSH (needs :22 open)
#   EC2_USER  — SSH user                   (default: ec2-user)
#   EC2_KEY   — path to .pem key           (default: ~/.ssh/meal-gen-key.pem)
#   EC2_DEST  — destination path on EC2    (default: /tmp)
#   AWS_REGION — region for SSM            (default: us-east-1)
#
# After uploading, SSH into EC2 and run:
#   cd /tmp
#   export PGPASSWORD=<password>
#   python3 import_wholefoods.py

set -euo pipefail

EC2_USER="${EC2_USER:-ec2-user}"
EC2_KEY="${EC2_KEY:-$HOME/.ssh/meal-gen-key.pem}"
EC2_DEST="${EC2_DEST:-/tmp}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Prefer SSM (tunnels SSH with no inbound :22); fall back to a direct public host.
SSH_OPTS=(-i "$EC2_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30)
if [[ -n "${EC2_INSTANCE_ID:-}" ]]; then
  EC2_TARGET="$EC2_INSTANCE_ID"
  SSH_OPTS+=(-o "ProxyCommand=aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p --region $AWS_REGION")
else
  EC2_TARGET="${EC2_HOST:?set EC2_INSTANCE_ID (SSM, preferred) or EC2_HOST}"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITEMS_FILE="$SCRIPT_DIR/wholefoods-items.json"
META_FILE="$SCRIPT_DIR/wholefoods-metadata.json"
NUTRITION_FILE="$SCRIPT_DIR/wholefoods-nutrition-parsed.json"
INGREDIENTS_FILE="$SCRIPT_DIR/wholefoods-ingredients-parsed.json"

# ---------------------------------------------------------------------------
# Step 1: Scrape
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 1: Scraping Whole Foods ==="
node "$SCRIPT_DIR/scrape_wholefoods.js" --output "$ITEMS_FILE" --meta "$META_FILE"
ITEM_COUNT=$(python3 -c "import json; print(len(json.load(open('$ITEMS_FILE'))))" 2>/dev/null || echo 0)
echo "[pipeline] Scrape complete. ${ITEM_COUNT} items collected."
[[ "$ITEM_COUNT" -ge 500 ]] || { echo "[pipeline] ERROR: Only ${ITEM_COUNT} items scraped (threshold: 500). Scraper may be blocked."; exit 1; }

# ---------------------------------------------------------------------------
# Step 2: Parse nutrition
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 2: Parsing nutrition ==="
python3 "$SCRIPT_DIR/parse_nutrition.py" "$ITEMS_FILE" "$NUTRITION_FILE"

# ---------------------------------------------------------------------------
# Step 3: Parse ingredients
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 3: Parsing ingredients ==="
python3 "$SCRIPT_DIR/parse_ingredients.py" "$ITEMS_FILE" "$INGREDIENTS_FILE"

# ---------------------------------------------------------------------------
# Step 4: SCP to EC2
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 4: Uploading to EC2 ($EC2_TARGET) ==="
scp "${SSH_OPTS[@]}" \
  "$ITEMS_FILE" "$META_FILE" "$NUTRITION_FILE" "$INGREDIENTS_FILE" \
  "$SCRIPT_DIR/import_wholefoods.py" \
  "${EC2_USER}@${EC2_TARGET}:${EC2_DEST}/"
echo "[pipeline] Uploaded to ${EC2_USER}@${EC2_TARGET}:${EC2_DEST}/"

# ---------------------------------------------------------------------------
# Step 5: Import on EC2
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 5: Importing into RDS on EC2 ==="
ssh "${SSH_OPTS[@]}" "${EC2_USER}@${EC2_TARGET}" bash <<EOF
  set -e
  cd ${EC2_DEST}

  # Load env from the app .env file (PGPASSWORD must be set)
  if [[ -f /opt/meal-gen/.env ]]; then
    export \$(grep -v '^#' /opt/meal-gen/.env | grep 'SPRING_DATASOURCE\|PGPASSWORD\|DB_' | xargs) 2>/dev/null || true
  fi

  # Derive PGPASSWORD from Spring datasource URL if not set directly
  if [[ -z "\${PGPASSWORD:-}" ]] && [[ -n "\${SPRING_DATASOURCE_URL:-}" ]]; then
    export PGPASSWORD="\${SPRING_DATASOURCE_PASSWORD:-}"
  fi

  export PGHOST="${PGHOST:?set PGHOST to the RDS endpoint}"
  export PGPORT="${PGPORT:-5432}"
  export PGDATABASE="${PGDATABASE:-mealgen}"
  export PGUSER="${PGUSER:-meal_user}"

  export WF_JSON_PATH="${EC2_DEST}/wholefoods-items.json"
  export WF_NUTRITION_PARSED="${EC2_DEST}/wholefoods-nutrition-parsed.json"
  export WF_INGREDIENTS_PARSED="${EC2_DEST}/wholefoods-ingredients-parsed.json"

  python3 "${EC2_DEST}/import_wholefoods.py"
EOF

echo "[pipeline] === Step 6: Backfilling embeddings ==="
echo "[pipeline] Run manually from backend container if needed:"
echo "  docker exec mealgen-backend curl -s -X POST http://python-rag:8000/embed/backfill/items \\"
echo "    -H 'Content-Type: application/json' -H \"X-RAG-SECRET: \$RAG_SECRET\" -d '{}'"

echo "[pipeline] Done."
