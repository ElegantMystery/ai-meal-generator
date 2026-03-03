#!/usr/bin/env bash
# run_pipeline.sh — Scrape Trader Joe's and upload results to EC2
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
ITEMS_FILE="$SCRIPT_DIR/tj-items.json"
META_FILE="$SCRIPT_DIR/tj-metadata.json"

SSH_OPTS="-i $EC2_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"

# ---------------------------------------------------------------------------
# Step 1: Scrape
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 1: Scraping Trader Joe's ==="
node "$SCRIPT_DIR/scrape_tj.js" --output "$ITEMS_FILE" --meta "$META_FILE"
echo "[pipeline] Scrape complete. $(python3 -c "import json; print(len(json.load(open('$ITEMS_FILE'))))" 2>/dev/null || echo '?') items collected."

# ---------------------------------------------------------------------------
# Step 2: SCP to EC2
# ---------------------------------------------------------------------------
echo "[pipeline] === Step 2: Uploading to EC2 ($EC2_HOST) ==="
scp $SSH_OPTS "$ITEMS_FILE" "$META_FILE" "${EC2_USER}@${EC2_HOST}:${EC2_DEST}/"
echo "[pipeline] Uploaded tj-items.json and tj-metadata.json to ${EC2_USER}@${EC2_HOST}:${EC2_DEST}/"

echo "[pipeline] Done."
