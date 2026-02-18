#!/usr/bin/env bash
# bootstrap-rds.sh
#
# Run this ONCE on the EC2 instance after `terraform apply` and BEFORE starting
# the application containers for the first time.
#
# What it does:
#   1. Retrieves RDS master credentials from AWS Secrets Manager
#   2. Verifies connectivity to RDS
#   3. Verifies pgvector extension is available (required for Flyway V5/V020)
#   4. Prints next-step instructions
#
# Usage (on EC2):
#   chmod +x /opt/meal-gen/scripts/bootstrap-rds.sh
#   RDS_HOST=<rds-endpoint> AWS_REGION=us-east-1 bash /opt/meal-gen/scripts/bootstrap-rds.sh

set -euo pipefail

# ---- Config -----------------------------------------------------------------
AWS_REGION="${AWS_REGION:-us-east-1}"
PROJECT="${PROJECT:-meal-gen}"
ENV="${ENV:-prod}"
RDS_HOST="${RDS_HOST:?RDS_HOST env var is required}"
RDS_PORT="${RDS_PORT:-5432}"
DB_NAME="${DB_NAME:-mealgen}"

SECRET_ID="${PROJECT}/${ENV}/db-password"

# ---- Helpers ----------------------------------------------------------------
info()  { echo "[INFO]  $*"; }
ok()    { echo "[OK]    $*"; }
error() { echo "[ERROR] $*" >&2; exit 1; }

# ---- 1. Retrieve master credentials from Secrets Manager --------------------
info "Fetching DB credentials from Secrets Manager ($SECRET_ID)..."

# RDS managed master password is stored as JSON: {"username":"...","password":"..."}
SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$AWS_REGION" \
  --query SecretString \
  --output text)

# If using manage_master_user_password=true in Terraform, the secret is stored
# by RDS itself under a different ARN. Retrieve it via the cluster secret ARN:
#   aws rds describe-db-instances --db-instance-identifier meal-gen-prod-postgres \
#     --query 'DBInstances[0].MasterUserSecret.SecretArn'
# Then pass that ARN as SECRET_ID.
#
# For a manually-set password secret the format is just the plaintext password.
if echo "$SECRET_JSON" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  DB_USER=$(echo "$SECRET_JSON"     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['username'])")
  DB_PASSWORD=$(echo "$SECRET_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['password'])")
else
  # Plaintext password secret
  DB_USER="${DB_USER:-meal_user}"
  DB_PASSWORD="$SECRET_JSON"
fi

ok "Retrieved credentials for user: $DB_USER"

# ---- 2. Verify connectivity --------------------------------------------------
info "Testing connectivity to $RDS_HOST:$RDS_PORT/$DB_NAME ..."
export PGPASSWORD="$DB_PASSWORD"

psql \
  --host="$RDS_HOST" \
  --port="$RDS_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --command="\conninfo" \
  --no-password \
  || error "Cannot connect to RDS. Check security groups and RDS endpoint."

ok "Connected to RDS successfully."

# ---- 3. Verify pgvector is available ----------------------------------------
info "Checking pgvector availability..."

PGVECTOR_AVAILABLE=$(psql \
  --host="$RDS_HOST" \
  --port="$RDS_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-password \
  --tuples-only \
  --command="SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'vector';")

if [ "$(echo "$PGVECTOR_AVAILABLE" | tr -d ' ')" = "0" ]; then
  error "pgvector extension is not available on this RDS instance. \
Ensure you're using PostgreSQL 15+ and the pgvector parameter group."
fi

ok "pgvector is available."

# Check if already installed
PGVECTOR_INSTALLED=$(psql \
  --host="$RDS_HOST" \
  --port="$RDS_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-password \
  --tuples-only \
  --command="SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector';")

if [ "$(echo "$PGVECTOR_INSTALLED" | tr -d ' ')" = "1" ]; then
  ok "pgvector is already installed."
else
  info "Installing pgvector extension..."
  psql \
    --host="$RDS_HOST" \
    --port="$RDS_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --no-password \
    --command="CREATE EXTENSION IF NOT EXISTS vector;"
  ok "pgvector installed."
fi

# ---- 4. Write .env snippet for reference ------------------------------------
info "Writing DB env vars to /opt/meal-gen/.env.rds-snippet ..."
cat > /opt/meal-gen/.env.rds-snippet <<EOF
# Add these to /opt/meal-gen/.env
SPRING_DATASOURCE_URL=jdbc:postgresql://${RDS_HOST}:${RDS_PORT}/${DB_NAME}
SPRING_DATASOURCE_USERNAME=${DB_USER}
SPRING_DATASOURCE_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${RDS_HOST}:${RDS_PORT}/${DB_NAME}
EOF

ok "Snippet written to /opt/meal-gen/.env.rds-snippet"

echo ""
echo "============================================================"
echo " Bootstrap complete. Next steps:"
echo "============================================================"
echo " 1. Append /opt/meal-gen/.env.rds-snippet into /opt/meal-gen/.env"
echo " 2. Run: docker compose -f /opt/meal-gen/docker-compose.prod.yml up -d backend"
echo "    (Flyway will auto-run all 26 migrations on first start)"
echo " 3. Verify: curl http://localhost:8080/actuator/health"
echo " 4. Run seed script if migrating data from local:"
echo "    bash /opt/meal-gen/scripts/seed-rds.sh"
echo "============================================================"
