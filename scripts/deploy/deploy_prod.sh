#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
DEPLOY_HEALTH_TIMEOUT=${DEPLOY_HEALTH_TIMEOUT:-180}
LAST_HEALTH=""
LAST_IMAGE=""

update_env() {
  local key=$1 value=$2 env_file=${3:-.env}
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    echo "${key}=${value}" >> "$env_file"
  fi
}

service_health() {
  local service=$1 container_id
  container_id=$(docker compose -f "$COMPOSE_FILE" ps -q "$service") || return 1
  [[ -n "$container_id" ]] || { LAST_HEALTH=missing; return; }
  LAST_HEALTH=$(docker inspect --format \
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$container_id") || return 1
}

wait_for_service() {
  local service=$1 timeout=${2:-$DEPLOY_HEALTH_TIMEOUT} elapsed=0
  while (( elapsed < timeout )); do
    service_health "$service" || LAST_HEALTH=inspect-failed
    if [[ "$LAST_HEALTH" == healthy || "$LAST_HEALTH" == running ]]; then
      echo "$service is $LAST_HEALTH"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo "$service failed readiness polling after ${timeout}s (status=$LAST_HEALTH)" >&2
  return 1
}

service_image() {
  local service=$1 container_id
  container_id=$(docker compose -f "$COMPOSE_FILE" ps -q "$service") || return 1
  [[ -n "$container_id" ]] || { LAST_IMAGE=missing; echo "$LAST_IMAGE"; return; }
  LAST_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$container_id") || return 1
  echo "$LAST_IMAGE"
}

verify_service_revision() {
  local service=$1 expected=$2 actual
  actual=$(service_image "$service") || return 1
  if [[ "$actual" != "$expected" ]]; then
    echo "$service revision mismatch: expected=$expected actual=$actual" >&2
    return 1
  fi
}

repository_for_service() {
  case "$1" in
    rag) echo meal-gen-rag ;;
    backend) echo meal-gen-backend ;;
    frontend) echo meal-gen-frontend ;;
    *) return 1 ;;
  esac
}

compose_service_for_stage() {
  case "$1" in
    rag) echo python-rag ;;
    backend|frontend) echo "$1" ;;
    *) return 1 ;;
  esac
}

run_deploy_stage() {
  local service=$1 image_tag=$2 repository compose_service expected
  repository=$(repository_for_service "$service") || return 1
  compose_service=$(compose_service_for_stage "$service") || return 1
  expected="${ECR_REGISTRY}/${repository}:${image_tag}"
  docker compose -f "$COMPOSE_FILE" up -d --no-deps "$compose_service" || return 1
  wait_for_service "$compose_service" || return 1
  verify_service_revision "$compose_service" "$expected" || return 1
  if [[ "${DEPLOY_FAIL_AFTER:-}" == "$service" ]]; then
    echo "Injected failure after $service restart" >&2
    return 1
  fi
}

perform_rollback() {
  local previous_tag=$1
  [[ -n "$previous_tag" ]] || {
    echo "No previous IMAGE_TAG is available for rollback" >&2
    return 1
  }
  echo "Rolling back to $previous_tag"
  if [[ -z "${ECR_REGISTRY:-}" ]]; then
    ECR_REGISTRY=$(sed -n 's/^ECR_REGISTRY=//p' .env | tail -1)
  fi
  [[ -n "$ECR_REGISTRY" ]] || { echo "ECR_REGISTRY is required" >&2; return 1; }
  update_env IMAGE_TAG "$previous_tag" || return 1
  IMAGE_TAG=$previous_tag docker compose -f "$COMPOSE_FILE" pull python-rag backend frontend || return 1
  IMAGE_TAG=$previous_tag docker compose -f "$COMPOSE_FILE" up -d --no-deps python-rag || return 1
  wait_for_service python-rag || return 1
  IMAGE_TAG=$previous_tag docker compose -f "$COMPOSE_FILE" up -d --no-deps backend || return 1
  wait_for_service backend || return 1
  IMAGE_TAG=$previous_tag docker compose -f "$COMPOSE_FILE" up -d --no-deps frontend nginx || return 1
  wait_for_service frontend || return 1
  wait_for_service nginx || return 1
  verify_service_revision python-rag "${ECR_REGISTRY}/meal-gen-rag:${previous_tag}" || return 1
  verify_service_revision backend "${ECR_REGISTRY}/meal-gen-backend:${previous_tag}" || return 1
  verify_service_revision frontend "${ECR_REGISTRY}/meal-gen-frontend:${previous_tag}" || return 1
  echo "$previous_tag" > .deployed-revision
}

deploy_services() {
  local previous_tag=$1 image_tag=$2 stage
  for stage in rag backend frontend; do
    if ! run_deploy_stage "$stage" "$image_tag"; then
      perform_rollback "$previous_tag" || {
        echo "Automatic rollback to $previous_tag failed" >&2
        return 1
      }
      return 1
    fi
  done
}

main() {
  local image_tag=${1:?usage: deploy_prod.sh IMAGE_TAG}
  local previous_tag
  previous_tag=$(sed -n 's/^IMAGE_TAG=//p' .env | tail -1)
  [[ "$previous_tag" != "$image_tag" ]] || previous_tag=$(cat .deployed-revision 2>/dev/null || true)

  touch .deployed-revision
  update_env ECR_REGISTRY "$ECR_REGISTRY"
  update_env IMAGE_TAG "$image_tag"
  if ! docker compose -f "$COMPOSE_FILE" pull; then
    update_env IMAGE_TAG "$previous_tag"
    return 1
  fi
  if ! deploy_services "$previous_tag" "$image_tag"; then
    exit 1
  fi
  docker compose -f "$COMPOSE_FILE" up -d --no-deps nginx certbot || return 1
  wait_for_service nginx || return 1
  echo "$image_tag" > .deployed-revision
  echo "Deployment complete ($image_tag); rollback: scripts/deploy/rollback_prod.sh $previous_tag"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
