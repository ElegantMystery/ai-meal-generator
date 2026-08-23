#!/usr/bin/env bash
set -euo pipefail

failed=0

while IFS= read -r action_line; do
  action_ref="${action_line#*@}"
  action_ref="${action_ref%% *}"
  if [[ ! "$action_ref" =~ ^[0-9a-f]{40}$ ]]; then
    echo "$action_line"
    failed=1
  fi
done < <(grep -REn 'uses:[[:space:]]+[^.][^[:space:]#]*@' .github/workflows)

if [[ "$failed" -ne 0 ]]; then
  echo "External GitHub Actions must be pinned to a full commit SHA (retain the version as a comment)."
fi

if grep -REn 'runs-on:[[:space:]]+[^#[:space:]]*latest|session-manager-downloads/plugin/latest/' \
    .github/workflows; then
  echo "Runner images and downloaded CI tools must use explicit versions."
  failed=1
fi

if grep -En '^FROM[[:space:]]+[^@[:space:]]+([[:space:]]+AS[[:space:]]+[^[:space:]]+)?$' \
    backend/Dockerfile frontend/Dockerfile rag/Dockerfile; then
  echo "Dockerfile base images must include an immutable sha256 digest."
  failed=1
fi

if grep -En 'image:[[:space:]]+(nginx|certbot/certbot|pgvector/pgvector):[^@[:space:]]+$' \
    docker-compose.yml docker-compose.prod.yml; then
  echo "Third-party Compose images must include an immutable sha256 digest."
  failed=1
fi

if grep -En 'IMAGE_TAG:-latest' docker-compose.prod.yml; then
  echo "Production application images must not fall back to the mutable latest tag."
  failed=1
fi

exit "$failed"
