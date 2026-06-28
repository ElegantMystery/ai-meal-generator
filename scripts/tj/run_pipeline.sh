#!/usr/bin/env bash
# run_pipeline.sh — Scrape Trader Joe's and upload results to EC2
#
# Usage:
#   ./run_pipeline.sh
#
# Environment variables:
#   EC2_HOST  — EC2 public IP or hostname  (required)
#   EC2_USER  — SSH user                   (default: ec2-user)
#   EC2_KEY   — path to .pem key           (default: ~/.ssh/meal-gen-key.pem)
#   EC2_DEST  — destination path on EC2    (default: /tmp)

set -euo pipefail

EC2_HOST="${EC2_HOST:?set EC2_HOST to the EC2 public IP/hostname}"
EC2_USER="${EC2_USER:-ec2-user}"
EC2_KEY="${EC2_KEY:-$HOME/.ssh/meal-gen-key.pem}"
EC2_DEST="${EC2_DEST:-/tmp}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITEMS_FILE="$SCRIPT_DIR/tj-items.json"
META_FILE="$SCRIPT_DIR/tj-metadata.json"
NUTRITION_FILE="$SCRIPT_DIR/tj-nutrition-parsed.json"
INGREDIENTS_FILE="$SCRIPT_DIR/tj-ingredients-parsed.json"

SSH_OPTS="-i $EC2_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"

# ---------------------------------------------------------------------------
# Step 1: Scrape
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 1: Scraping Trader Joe's ==="
node "$SCRIPT_DIR/scrape_tj.js" --output "$ITEMS_FILE" --meta "$META_FILE"
ITEM_COUNT=$(python3 -c "import json; print(len(json.load(open('$ITEMS_FILE'))))" 2>/dev/null || echo 0)
echo "[pipeline] Scrape complete. ${ITEM_COUNT} items collected."
[[ "$ITEM_COUNT" -ge 1500 ]] || { echo "[pipeline] ERROR: Only ${ITEM_COUNT} items scraped (threshold: 1500). Scraper may be blocked."; exit 1; }

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
echo "[pipeline] === Step 4: Uploading to EC2 ($EC2_HOST) ==="
scp $SSH_OPTS "$ITEMS_FILE" "$META_FILE" "$NUTRITION_FILE" "$INGREDIENTS_FILE" "${EC2_USER}@${EC2_HOST}:${EC2_DEST}/"
echo "[pipeline] Uploaded tj-items.json, tj-metadata.json, tj-nutrition-parsed.json, tj-ingredients-parsed.json to ${EC2_USER}@${EC2_HOST}:${EC2_DEST}/"

echo "[pipeline] Done."
