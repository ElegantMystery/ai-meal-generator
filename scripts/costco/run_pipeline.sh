#!/usr/bin/env bash
# run_pipeline.sh — Scrape Costco food & drinks and upload results to EC2
#
# Usage:
#   ./run_pipeline.sh
#
# Environment variables (all have defaults):
#   EC2_HOST  — EC2 public IP or hostname  (default: 54.205.145.93)
#   EC2_USER  — SSH user                   (default: ec2-user)
#   EC2_KEY   — path to .pem key           (default: ~/.ssh/meal-gen-key.pem)
#   EC2_DEST  — destination path on EC2    (default: /tmp)

set -euo pipefail

EC2_HOST="${EC2_HOST:-54.205.145.93}"
EC2_USER="${EC2_USER:-ec2-user}"
EC2_KEY="${EC2_KEY:-$HOME/.ssh/meal-gen-key.pem}"
EC2_DEST="${EC2_DEST:-/tmp}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITEMS_FILE="$SCRIPT_DIR/costco-items.json"
META_FILE="$SCRIPT_DIR/costco-metadata.json"
NUTRITION_FILE="$SCRIPT_DIR/costco-nutrition-parsed.json"
INGREDIENTS_FILE="$SCRIPT_DIR/costco-ingredients-parsed.json"

# StrictHostKeyChecking=no is intentional for ephemeral CI runners.
SSH_OPTS=(-i "$EC2_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10)

# ---------------------------------------------------------------------------
# Step 1: Scrape
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 1: Scraping Costco ==="
node "$SCRIPT_DIR/scrape_costco.js" --output "$ITEMS_FILE" --meta "$META_FILE"
ITEM_COUNT=$(python3 -c "import json; print(len(json.load(open('$ITEMS_FILE'))))" 2>/dev/null || echo 0)
echo "[pipeline] Scrape complete. ${ITEM_COUNT} items collected."
[[ "$ITEM_COUNT" -ge 200 ]] || {
  echo "[pipeline] ERROR: Only ${ITEM_COUNT} items scraped (threshold: 200). Scraper may be blocked."
  echo "[pipeline] TIP: Run discover_categories.js to diagnose API patterns."
  exit 1
}

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
scp "${SSH_OPTS[@]}" \
  "$ITEMS_FILE" "$META_FILE" "$NUTRITION_FILE" "$INGREDIENTS_FILE" \
  "${EC2_USER}@${EC2_HOST}:${EC2_DEST}/"
echo "[pipeline] Uploaded costco-items.json, costco-metadata.json, costco-nutrition-parsed.json, costco-ingredients-parsed.json to ${EC2_USER}@${EC2_HOST}:${EC2_DEST}/"

echo "[pipeline] Done."
