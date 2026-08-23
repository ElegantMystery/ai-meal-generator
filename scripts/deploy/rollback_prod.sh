#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/deploy_prod.sh"
perform_rollback "${1:?usage: rollback_prod.sh IMAGE_TAG}"
