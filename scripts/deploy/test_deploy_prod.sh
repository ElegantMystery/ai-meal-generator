#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/deploy_prod.sh"

failures=0

assert_eq() {
  local expected=$1 actual=$2 message=$3
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $message (expected=$expected actual=$actual)"
    failures=$((failures + 1))
  fi
}

test_wait_for_service_retries_until_healthy() {
  local checks=0
  service_health() {
    checks=$((checks + 1))
    [[ "$checks" -ge 3 ]] && LAST_HEALTH=healthy || LAST_HEALTH=starting
  }
  sleep() { :; }

  wait_for_service rag 5
  assert_eq 3 "$checks" "bounded polling should retry"
}

test_rag_stage_uses_compose_service_name() {
  local restarted="" checked=""
  docker() { restarted=${*: -1}; }
  wait_for_service() { checked=$1; }
  verify_service_revision() { :; }
  ECR_REGISTRY=registry run_deploy_stage rag new-sha
  assert_eq python-rag "$restarted" "RAG restart should use the Compose service name"
  assert_eq python-rag "$checked" "RAG readiness should use the Compose service name"
}

test_failure_after_each_restart_rolls_back() {
  local stage
  for stage in rag backend frontend; do
    local rollback_tag=""
    perform_rollback() { rollback_tag=$1; }
    run_deploy_stage() { [[ "$1" != "$stage" ]]; }

    if deploy_services old-sha new-sha; then
      echo "FAIL: injected $stage failure should fail deployment"
      failures=$((failures + 1))
    fi
    assert_eq old-sha "$rollback_tag" "$stage failure should roll back"
  done
}

test_revision_mismatch_fails() {
  service_image() { echo "registry/service:wrong-sha"; }
  if verify_service_revision backend "registry/service:wanted-sha"; then
    echo "FAIL: revision mismatch should fail"
    failures=$((failures + 1))
  fi
}

test_unhealthy_stage_fails_before_revision_check() {
  local revision_checked=no
  docker() { :; }
  wait_for_service() { return 1; }
  verify_service_revision() { revision_checked=yes; }
  if ECR_REGISTRY=registry run_deploy_stage backend new-sha; then
    echo "FAIL: unhealthy stage should fail"
    failures=$((failures + 1))
  fi
  assert_eq no "$revision_checked" "unhealthy stage should stop before revision verification"
}

test_wait_for_service_retries_until_healthy
test_revision_mismatch_fails
test_unhealthy_stage_fails_before_revision_check
test_rag_stage_uses_compose_service_name
test_failure_after_each_restart_rolls_back

if [[ "$failures" -ne 0 ]]; then
  exit 1
fi
echo "deploy script tests passed"
