#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "documentation drift: $*" >&2
  exit 1
}

contract="docs/api-contract.md"
config="docs/configuration.md"

endpoints=(
  "GET /api/auth/csrf"
  "GET /api/auth/me"
  "POST /api/auth/complete-onboarding"
  "POST /api/auth/logout"
  "GET /api/items"
  "GET /api/items/costco"
  "GET /api/items/traderjoes"
  "POST /api/items"
  "GET /api/mealplans"
  "POST /api/mealplans"
  "GET /api/mealplans/{id}"
  "DELETE /api/mealplans/{id}"
  "POST /api/mealplans/generate"
  "POST /api/mealplans/generate-ai"
  "GET /api/mealplans/generation-requests/{id}"
  "GET /api/mealplans/generation-requests"
  "GET /api/mealplans/{id}/shopping-list"
  "GET /api/preferences/me"
  "PUT /api/preferences/me"
  "GET /api/subscription/status"
  "POST /api/subscription/checkout"
  "POST /api/subscription/portal"
  "POST /api/webhooks/stripe"
  "GET /health"
  "GET /ready"
  "POST /generate"
  "POST /embed/backfill/items"
  "POST /embed/backfill/nutrition"
  "POST /embed/backfill/ingredients"
)

for endpoint in "${endpoints[@]}"; do
  rg -Fq "\`$endpoint\`" "$contract" || fail "missing endpoint: $endpoint"
done

backend_route_count="$(rg '@(Get|Post|Put|Delete|Patch)Mapping' \
  backend/src/main/java/com/mealgen/backend/{auth,items,mealplan,preferences,subscription} \
  | wc -l | tr -d ' ')"
[[ "$backend_route_count" == "23" ]] || fail "backend route count changed; reconcile $contract"

rag_route_count="$(rg '@(router|app)\.(get|post|put|delete|patch)' rag/app | wc -l | tr -d ' ')"
[[ "$rag_route_count" == "6" ]] || fail "RAG route count changed; reconcile $contract"

while IFS='=' read -r variable _; do
  [[ "$variable" =~ ^[A-Z][A-Z0-9_]+$ ]] || continue
  rg -Fq "\`$variable\`" "$config" || fail "undocumented .env variable: $variable"
done < .env.example

while IFS= read -r variable; do
  rg -Fq "${variable}=" .env.example || fail "Compose variable missing from .env.example: $variable"
done < <(rg -o '\$\{[A-Z][A-Z0-9_]*' docker-compose.yml | sed 's/^${//' | sort -u)

rg -Fq "HTTP **429 Too Many Requests**" "$contract" || fail "429 quota contract missing"
rg -Fq "MiniMax-M3 generates plans" README.md || fail "generation provider missing"
rg -Fq "OpenAI is used only" README.md || fail "embedding-only provider role missing"
rg -Fq "./mvnw --batch-mode test" README.md || fail "backend verification missing"
rg -Fq "npm test -- --runInBand" README.md || fail "frontend verification missing"
rg -Fq "pytest rag/tests -q" README.md || fail "RAG verification missing"

if rg -n "403 QUOTA_EXCEEDED|local users \(email/password login\)|generation using OpenAI" \
  README.md AGENTS.md CLAUDE.md frontend/README.md docs \
  --glob '!project-audit-tasks.md' --glob '!plans/**'; then
  fail "stale quota, authentication, or provider statement found"
fi

echo "Documentation contract is current"
