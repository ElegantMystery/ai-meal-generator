#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${1:-https://whole-haul.com}
EXPECTED_SHA=${2:-}
attempts=${SMOKE_ATTEMPTS:-30}

poll_http() {
  local name=$1 url=$2 expected_body=${3:-} attempt body
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if body=$(curl -fsS --max-time 10 "$url" 2>/dev/null); then
      if [[ -z "$expected_body" || "$body" == *"$expected_body"* ]]; then
        echo "$name passed"
        return 0
      fi
    fi
    sleep 2
  done
  echo "$name failed after $attempts attempts" >&2
  return 1
}

poll_http frontend "$BASE_URL" '<html'
poll_http backend_database "$BASE_URL/actuator/health" '"status":"UP"'

headers=$(curl -sS -D - -o /dev/null --max-time 10 \
  -X POST -H 'Accept: text/event-stream' -H 'Idempotency-Key: deploy-smoke' \
  "$BASE_URL/api/mealplans/generate-ai")
grep -qi '^x-accel-buffering: no' <<<"$headers" || {
  echo "SSE proxy does not advertise buffering disabled" >&2
  exit 1
}

if [[ -n "$EXPECTED_SHA" ]]; then
  actual=$(curl -fsS --max-time 10 "$BASE_URL/deploy-revision")
  [[ "$actual" == "$EXPECTED_SHA" ]] || {
    echo "deployed revision mismatch: expected=$EXPECTED_SHA actual=$actual" >&2
    exit 1
  }
fi
echo "production smoke tests passed"
