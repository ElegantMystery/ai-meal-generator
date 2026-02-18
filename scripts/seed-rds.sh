#!/usr/bin/env bash
# seed-rds.sh
#
# Dumps item data from your LOCAL PostgreSQL and restores it to RDS via EC2.
# Run this from your LOCAL machine after the backend has started on EC2
# (Flyway must have already created the schema).
#
# Tables migrated (data only — schema created by Flyway):
#   items, item_nutrition, item_ingredients,
#   item_embeddings, item_nutrition_embeddings, item_ingredients_embeddings
#
# Users, preferences, and meal plans are NOT migrated.
#
# Usage:
#   EC2_HOST=<elastic-ip> EC2_KEY=~/.ssh/meal-gen-key.pem \
#   RDS_HOST=<rds-endpoint> bash scripts/seed-rds.sh

set -euo pipefail

# ---- Config (override via env vars) ----------------------------------------
LOCAL_DB_HOST="${LOCAL_DB_HOST:-localhost}"
LOCAL_DB_PORT="${LOCAL_DB_PORT:-5432}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-mealgen}"
LOCAL_DB_USER="${LOCAL_DB_USER:-meal_user}"
LOCAL_DB_PASSWORD="${LOCAL_DB_PASSWORD:-236810}"

EC2_HOST="${EC2_HOST:?EC2_HOST is required (Elastic IP)}"
EC2_USER="${EC2_USER:-ec2-user}"
EC2_KEY="${EC2_KEY:?EC2_KEY is required (path to .pem file)}"

RDS_HOST="${RDS_HOST:?RDS_HOST is required (RDS endpoint hostname)}"
RDS_PORT="${RDS_PORT:-5432}"
RDS_DB_NAME="${RDS_DB_NAME:-mealgen}"
RDS_USER="${RDS_USER:-meal_user}"

DUMP_FILE="/tmp/mealgen-seed-$(date +%Y%m%d-%H%M%S).dump"

SSH_OPTS="-i $EC2_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"

# ---- Helpers ----------------------------------------------------------------
info()  { echo "[INFO]  $*"; }
ok()    { echo "[OK]    $*"; }
error() { echo "[ERROR] $*" >&2; exit 1; }

# Tables to seed (order matters for foreign keys)
TABLES=(
  items
  item_nutrition
  item_ingredients
  item_embeddings
  item_nutrition_embeddings
  item_ingredients_embeddings
)

# ---- 1. Verify local DB is running ------------------------------------------
info "Verifying local PostgreSQL connection..."
PGPASSWORD="$LOCAL_DB_PASSWORD" psql \
  --host="$LOCAL_DB_HOST" \
  --port="$LOCAL_DB_PORT" \
  --username="$LOCAL_DB_USER" \
  --dbname="$LOCAL_DB_NAME" \
  --command="\conninfo" \
  --no-password \
  || error "Cannot connect to local DB. Is Docker Compose running?"
ok "Local DB reachable."

# ---- 2. Check row counts locally --------------------------------------------
info "Local row counts:"
for table in "${TABLES[@]}"; do
  COUNT=$(PGPASSWORD="$LOCAL_DB_PASSWORD" psql \
    --host="$LOCAL_DB_HOST" \
    --port="$LOCAL_DB_PORT" \
    --username="$LOCAL_DB_USER" \
    --dbname="$LOCAL_DB_NAME" \
    --no-password \
    --tuples-only \
    --command="SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
  printf "  %-40s %s rows\n" "$table" "$(echo "$COUNT" | tr -d ' ')"
done

# ---- 3. Dump data from local DB ---------------------------------------------
info "Dumping data from local DB to $DUMP_FILE ..."

TABLE_FLAGS=()
for table in "${TABLES[@]}"; do
  TABLE_FLAGS+=("--table=$table")
done

PGPASSWORD="$LOCAL_DB_PASSWORD" pg_dump \
  --host="$LOCAL_DB_HOST" \
  --port="$LOCAL_DB_PORT" \
  --username="$LOCAL_DB_USER" \
  --dbname="$LOCAL_DB_NAME" \
  --no-password \
  --format=custom \
  --data-only \
  --no-privileges \
  --no-owner \
  "${TABLE_FLAGS[@]}" \
  --file="$DUMP_FILE"

DUMP_SIZE=$(du -sh "$DUMP_FILE" | cut -f1)
ok "Dump complete: $DUMP_FILE ($DUMP_SIZE)"

# ---- 4. Copy dump to EC2 ----------------------------------------------------
info "Copying dump to EC2 ($EC2_HOST)..."
scp $SSH_OPTS "$DUMP_FILE" "${EC2_USER}@${EC2_HOST}:/tmp/mealgen-seed.dump"
ok "Dump transferred to EC2."

# ---- 5. Restore to RDS via EC2 ----------------------------------------------
info "Restoring to RDS via EC2..."
# shellcheck disable=SC2087
ssh $SSH_OPTS "${EC2_USER}@${EC2_HOST}" bash <<REMOTE
set -euo pipefail

# Get RDS password from Secrets Manager
RDS_PASSWORD=\$(aws secretsmanager get-secret-value \
  --secret-id "meal-gen/prod/db-password" \
  --region us-east-1 \
  --query SecretString \
  --output text | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('password', sys.stdin.read().strip()))" 2>/dev/null \
  || aws secretsmanager get-secret-value \
       --secret-id "meal-gen/prod/db-password" \
       --region us-east-1 \
       --query SecretString \
       --output text)

export PGPASSWORD="\$RDS_PASSWORD"

echo "[EC2] Restoring dump to RDS $RDS_HOST/$RDS_DB_NAME ..."
pg_restore \
  --host="$RDS_HOST" \
  --port="$RDS_PORT" \
  --username="$RDS_USER" \
  --dbname="$RDS_DB_NAME" \
  --no-password \
  --no-owner \
  --no-privileges \
  --data-only \
  --disable-triggers \
  --jobs=4 \
  /tmp/mealgen-seed.dump

echo "[EC2] Verifying row counts on RDS..."
for table in items item_nutrition item_ingredients item_embeddings item_nutrition_embeddings item_ingredients_embeddings; do
  COUNT=\$(psql \
    --host="$RDS_HOST" \
    --port="$RDS_PORT" \
    --username="$RDS_USER" \
    --dbname="$RDS_DB_NAME" \
    --no-password \
    --tuples-only \
    --command="SELECT COUNT(*) FROM \$table;")
  printf "  %-40s %s rows\n" "\$table" "\$(echo \$COUNT | tr -d ' ')"
done

rm -f /tmp/mealgen-seed.dump
echo "[EC2] Done."
REMOTE

# ---- 6. Clean up local dump -------------------------------------------------
rm -f "$DUMP_FILE"
ok "Local dump file removed."

echo ""
echo "============================================================"
echo " Seed complete."
echo " Verify the AI generation endpoint works:"
echo "   curl -X POST https://<domain>/api/mealplans/generate-ai \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"store\":\"your-store\",\"days\":3}'"
echo "============================================================"
